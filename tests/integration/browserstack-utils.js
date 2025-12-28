/**
 * BrowserStack utilities for cross-platform integration tests
 *
 * Usage: Set BROWSERSTACK=1 environment variable to use BrowserStack instead of local browser
 * Requires: BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY in environment
 *
 * Based on: https://github.com/browserstack/puppeteer-browserstack
 */

const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const BrowserStackLocal = require('browserstack-local').Local;

const TEST_TIMEOUT = 120000; // BrowserStack tests need longer timeout
const TEST_VIEWPORT = { width: 400, height: 400 };

let bsLocal = null;
let httpServer = null;
let httpPort = null;

// Start BrowserStack Local tunnel
async function startLocalTunnel() {
  if (bsLocal && bsLocal.isRunning()) return;

  bsLocal = new BrowserStackLocal();

  return new Promise((resolve, reject) => {
    const args = {
      key: process.env.BROWSERSTACK_ACCESS_KEY,
      force: true,
      onlyAutomate: true,
      forceLocal: true
    };

    bsLocal.start(args, (error) => {
      if (error) {
        console.error('BrowserStack Local tunnel failed to start:', error);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

// Stop BrowserStack Local tunnel
async function stopLocalTunnel() {
  if (!bsLocal) return;

  return new Promise((resolve) => {
    bsLocal.stop(() => {
      bsLocal = null;
      resolve();
    });
  });
}

// Start local HTTP server to serve the app
async function startHttpServer() {
  if (httpServer) return httpPort;

  const htmlPath = path.join(__dirname, '../../index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  httpServer = http.createServer((req, res) => {
    // Serve index.html for root or any HTML request
    if (req.url === '/' || req.url.startsWith('/?') || req.url.endsWith('.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      httpPort = httpServer.address().port;
      resolve(httpPort);
    });
  });
}

// Stop local HTTP server
function stopHttpServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    httpPort = null;
  }
}

// Check if BrowserStack mode is enabled
function isBrowserStack() {
  return process.env.BROWSERSTACK === '1' &&
         process.env.BROWSERSTACK_USERNAME &&
         process.env.BROWSERSTACK_ACCESS_KEY;
}

// Get the target platform (default to 'windows' for cross-platform testing)
function getTargetPlatform() {
  return process.env.BROWSERSTACK_PLATFORM || 'windows';
}

// Get capabilities for a platform
function getCaps(platform = 'windows') {
  const base = {
    'browserstack.username': process.env.BROWSERSTACK_USERNAME,
    'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    'browserstack.local': 'true',
    'browser': 'chrome',
    'browser_version': 'latest',
    'build': `mandelbrot-${new Date().toISOString().split('T')[0]}`,
    'name': 'Mandelbrot Integration Tests',
    // Note: BrowserStack VMs use SwiftShader (software rendering) - no real GPU
    // WebGPU is unavailable because navigator.gpu is undefined in their Chrome build
    // WebGL works via SwiftShader/ANGLE
  };

  switch (platform) {
    case 'mac':
      return { ...base, 'os': 'os x', 'os_version': 'sonoma' };
    case 'windows':
    default:
      return { ...base, 'os': 'Windows', 'os_version': '11' };
  }
}

// Setup browser - connects to BrowserStack
async function setupBrowserStack() {
  if (!isBrowserStack()) {
    throw new Error('BrowserStack credentials not configured. Set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY.');
  }

  // Start local tunnel and HTTP server
  await startLocalTunnel();
  await startHttpServer();

  const platform = getTargetPlatform();
  const caps = getCaps(platform);

  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://cdp.browserstack.com/puppeteer?caps=${encodeURIComponent(JSON.stringify(caps))}`
  });

  // Store cleanup info on browser object
  browser._browserstack = true;

  return browser;
}

// Setup page for BrowserStack
async function setupPageBrowserStack(browser) {
  const page = await browser.newPage();
  await page.setViewport(TEST_VIEWPORT);

  // Polyfill for page.waitForTimeout (removed in Puppeteer v22+)
  if (!page.waitForTimeout) {
    page.waitForTimeout = (ms) => new Promise(r => setTimeout(r, ms));
  }

  // Wrap page.goto to automatically transform file:// URLs to HTTP URLs
  // This allows tests to work without modification on BrowserStack
  const originalGoto = page.goto.bind(page);
  page.goto = async function(url, options) {
    let transformedUrl = url;
    // Transform file:// URLs to use the local HTTP server
    if (url.startsWith('file://') && url.includes('index.html')) {
      const queryMatch = url.match(/index\.html(\?.*)?$/);
      const queryString = queryMatch ? (queryMatch[1] || '') : '';
      transformedUrl = `http://localhost:${httpPort}/${queryString}`;
    }
    return originalGoto(transformedUrl, options);
  };

  // Wrap page.close to terminate workers before closing
  const originalClose = page.close.bind(page);
  page.close = async function() {
    try {
      await page.evaluate(() => {
        if (window.explorer?.scheduler?.workers) {
          window.explorer.scheduler.workers.forEach(w => w.terminate());
        }
      });
    } catch (e) { /* page may already be closed */ }
    return originalClose();
  };

  return page;
}

// Navigate to app via local HTTP server
async function navigateToAppBrowserStack(page, queryParams = '') {
  if (!httpPort) {
    throw new Error('HTTP server not started. Call setupBrowserStack first.');
  }

  const url = `http://localhost:${httpPort}/${queryParams}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 60000 });
  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && !view.uninteresting();
  }, { timeout: 60000 });
  await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 60000 });
}

// Close browser and cleanup BrowserStack resources
async function closeBrowserStack(browser) {
  if (!browser) return;

  try {
    const pages = await browser.pages();
    await Promise.all(pages.map(async (page) => {
      try {
        await page.evaluate(() => {
          if (window.explorer?.scheduler?.workers) {
            window.explorer.scheduler.workers.forEach(w => w.terminate());
            window.explorer.scheduler.workers = [];
          }
        });
      } catch (e) { /* page may be closed */ }
      try { await page.close(); } catch (e) { /* ignore */ }
    }));

    await browser.close();
  } catch (e) { /* ignore */ }

  stopHttpServer();
  await stopLocalTunnel();
}

// Get app URL for BrowserStack (uses HTTP server)
function getAppUrlBrowserStack(queryString = '') {
  if (!httpPort) {
    throw new Error('HTTP server not started. Call setupBrowserStack first.');
  }
  return `http://localhost:${httpPort}/${queryString}`;
}

module.exports = {
  TEST_TIMEOUT,
  TEST_VIEWPORT,
  isBrowserStack,
  getTargetPlatform,
  setupBrowserStack,
  setupPageBrowserStack,
  navigateToAppBrowserStack,
  closeBrowserStack,
  getAppUrlBrowserStack,
  startLocalTunnel,
  stopLocalTunnel,
  startHttpServer,
  stopHttpServer
};

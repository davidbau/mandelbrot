/**
 * LambdaTest utilities for cross-platform integration tests
 *
 * Usage: Set LAMBDATEST=1 environment variable to use LambdaTest instead of local browser
 * Requires: LT_USERNAME and LT_ACCESS_KEY in environment (or .env.local)
 *
 * Based on: https://github.com/LambdaTest/playwright-sample
 * Docs: https://www.lambdatest.com/support/docs/playwright-testing/
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const Tunnel = require('@lambdatest/node-tunnel');

const TEST_TIMEOUT = 120000; // LambdaTest tests need longer timeout
const TEST_VIEWPORT = { width: 400, height: 400 };

let ltTunnel = null;
let httpServer = null;
let httpPort = null;

// Start LambdaTest tunnel
async function startLocalTunnel() {
  if (ltTunnel) return;

  const tunnelArgs = {
    user: process.env.LT_USERNAME,
    key: process.env.LT_ACCESS_KEY,
    tunnelName: `mandelbrot-${Date.now()}`,
    logFile: path.join(__dirname, '../../.lambdatest-tunnel.log'),
  };

  ltTunnel = new Tunnel();

  return new Promise((resolve, reject) => {
    ltTunnel.start(tunnelArgs, (error) => {
      if (error) {
        console.error('LambdaTest tunnel failed to start:', error);
        reject(error);
      } else {
        // Store tunnel name for capabilities
        ltTunnel._tunnelName = tunnelArgs.tunnelName;
        resolve();
      }
    });
  });
}

// Stop LambdaTest tunnel
async function stopLocalTunnel() {
  if (!ltTunnel) return;

  return new Promise((resolve) => {
    ltTunnel.stop(() => {
      ltTunnel = null;
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

// Check if LambdaTest mode is enabled
function isLambdaTest() {
  return process.env.LAMBDATEST === '1' &&
         process.env.LT_USERNAME &&
         process.env.LT_ACCESS_KEY;
}

// Get the target platform (default to 'windows' for cross-platform testing)
function getTargetPlatform() {
  return process.env.LAMBDATEST_PLATFORM || 'windows';
}

// Get Playwright client version for LambdaTest
function getPlaywrightVersion() {
  try {
    const pkg = require('playwright/package.json');
    return pkg.version;
  } catch (e) {
    return '1.40.0'; // Fallback version
  }
}

// Get capabilities for a platform
function getCaps(platform = 'windows') {
  const platformMap = {
    'windows': { platform: 'Windows 10' },
    'mac': { platform: 'MacOS Ventura' },
    'linux': { platform: 'Linux' }
  };

  const platformCaps = platformMap[platform] || platformMap['windows'];

  return {
    browserName: 'Chrome',
    browserVersion: 'latest',
    'LT:Options': {
      ...platformCaps,
      build: `mandelbrot-${new Date().toISOString().split('T')[0]}`,
      name: 'Mandelbrot Integration Tests',
      user: process.env.LT_USERNAME,
      accessKey: process.env.LT_ACCESS_KEY,
      tunnel: true,
      tunnelName: ltTunnel?._tunnelName || '',
      network: true,
      video: true,
      console: true,
      playwrightClientVersion: getPlaywrightVersion()
    }
  };
}

// Setup browser - connects to LambdaTest via CDP
async function setupLambdaTest() {
  if (!isLambdaTest()) {
    throw new Error('LambdaTest credentials not configured. Set LT_USERNAME and LT_ACCESS_KEY.');
  }

  // Start local tunnel and HTTP server
  await startLocalTunnel();
  await startHttpServer();

  const platform = getTargetPlatform();
  const caps = getCaps(platform);

  // Connect to LambdaTest via CDP endpoint
  // Docs: https://www.lambdatest.com/support/docs/playwright-testing/
  const browser = await chromium.connect({
    wsEndpoint: `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(JSON.stringify(caps))}`
  });

  // Store cleanup info on browser object
  browser._lambdatest = true;

  return browser;
}

// Setup page for LambdaTest
async function setupPageLambdaTest(browser) {
  // Get existing context or create new one
  const context = browser.contexts()[0] || await browser.newContext({ viewport: TEST_VIEWPORT });
  const page = await context.newPage();

  // Set viewport
  await page.setViewportSize(TEST_VIEWPORT);

  // Add waitForTimeout helper for compatibility
  page.waitForTimeout = (ms) => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);

  // Wrap page.goto to automatically transform file:// URLs to HTTP URLs
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
async function navigateToAppLambdaTest(page, queryParams = '') {
  if (!httpPort) {
    throw new Error('HTTP server not started. Call setupLambdaTest first.');
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

// Close browser and cleanup LambdaTest resources
async function closeLambdaTest(browser) {
  if (!browser) return;

  try {
    const contexts = browser.contexts();
    await Promise.all(contexts.map(async (context) => {
      const pages = context.pages();
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
    }));

    await browser.close();
  } catch (e) { /* ignore */ }

  stopHttpServer();
  await stopLocalTunnel();
}

// Get app URL for LambdaTest (uses HTTP server)
function getAppUrlLambdaTest(queryString = '') {
  if (!httpPort) {
    throw new Error('HTTP server not started. Call setupLambdaTest first.');
  }
  return `http://localhost:${httpPort}/${queryString}`;
}

module.exports = {
  TEST_TIMEOUT,
  TEST_VIEWPORT,
  isLambdaTest,
  getTargetPlatform,
  setupLambdaTest,
  setupPageLambdaTest,
  navigateToAppLambdaTest,
  closeLambdaTest,
  getAppUrlLambdaTest,
  startLocalTunnel,
  stopLocalTunnel,
  startHttpServer,
  stopHttpServer
};

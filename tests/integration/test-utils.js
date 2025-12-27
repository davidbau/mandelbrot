/**
 * Shared utilities for integration tests
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { setTimeout: sleep } = require('node:timers/promises');
const { startCoverage, stopCoverage, clearCoverage, isCoverageEnabled } = require('../utils/coverage');

const TEST_TIMEOUT = 30000; // 30 seconds for integration tests
const TEST_VIEWPORT = { width: 400, height: 400 };

// Find system Chrome for better headless support
function findChrome() {
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',  // macOS
    '/usr/bin/google-chrome',  // Linux
    '/usr/bin/chromium-browser',  // Linux Chromium
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',  // Windows
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'  // Windows x86
  ];
  for (const p of chromePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;  // Fall back to Puppeteer's bundled Chrome
}

// Helper function to wait for initial view to be ready (has computed some pixels)
async function waitForViewReady(page, viewIndex = 0) {
  await page.waitForFunction(
    (idx) => {
      const view = window.explorer?.grid?.views?.[idx];
      return view && !view.uninteresting();
    },
    { timeout: 10000 },
    viewIndex
  );
}

// Standard browser setup for tests
async function setupBrowser() {
  const chromePath = findChrome();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandelbrot-puppeteer-'));
  const platform = os.platform();

  // ANGLE backend varies by platform:
  // - macOS: metal (best performance)
  // - Linux: vulkan or swiftshader (software fallback for headless)
  // - Windows: d3d11
  const angleBackend = platform === 'darwin' ? 'metal'
                     : platform === 'win32' ? 'd3d11'
                     : 'swiftshader';  // Linux: use software renderer for reliable headless

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-crashpad',
      '--disable-features=Crashpad',
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      `--use-angle=${angleBackend}`,
    ]
  };
  launchOptions.userDataDir = userDataDir;
  if (chromePath) {
    launchOptions.executablePath = chromePath;
  }
  const browser = await puppeteer.launch(launchOptions);
  const originalClose = browser.close.bind(browser);
  browser.close = async () => {
    await originalClose();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };
  return browser;
}

// Standard page setup for tests
async function setupPage(browser, options = {}) {
  const page = await browser.newPage();
  await page.setViewport(TEST_VIEWPORT);

  // Polyfill for page.waitForTimeout (removed in Puppeteer v22+)
  if (!page.waitForTimeout) {
    page.waitForTimeout = (ms) => sleep(ms);
  }

  // Start coverage collection if enabled
  if (isCoverageEnabled()) {
    let testName = 'unknown';
    try {
       // Only available inside test/it blocks or if running via Jest
       testName = expect.getState().currentTestName || 'unknown';
    } catch(e) {}
    await startCoverage(page, testName);
  }

  // Wrap page.close to terminate workers and collect coverage before closing
  const originalClose = page.close.bind(page);
  page.close = async function() {
    // Terminate workers before closing to prevent hanging
    try {
      await page.evaluate(() => {
        if (window.explorer?.scheduler?.workers) {
          window.explorer.scheduler.workers.forEach(w => w.terminate());
        }
      });
    } catch (e) { /* page may already be navigated away */ }

    if (isCoverageEnabled()) {
      await stopCoverage(page);
    }
    return originalClose();
  };

  // Capture console messages (optional, can be noisy)
  if (options.captureConsole) {
    page.on('console', msg => {
      console.log(`Browser console [${msg.type()}]:`, msg.text());
    });
  }

  return page;
}

// Clean up page and collect coverage (for explicit use if needed)
async function teardownPage(page) {
  // Terminate workers before closing to prevent hanging
  try {
    await page.evaluate(() => {
      if (window.explorer?.scheduler?.workers) {
        window.explorer.scheduler.workers.forEach(w => w.terminate());
      }
    });
  } catch (e) { /* page may already be closed */ }
  await page.close();
}

// On Linux, swiftshader (software WebGPU) is very slow and has resource contention.
// Use CPU-only computation for reliable, fast tests.
const useCpuOnly = os.platform() === 'linux';

// Append CPU-only debug flags to query string if on Linux
function appendCpuDebugFlags(queryParams) {
  if (!useCpuOnly) return queryParams;
  // Parse existing query string
  const hasQuery = queryParams.startsWith('?');
  const separator = hasQuery ? '&' : '?';
  const existingDebug = queryParams.match(/debug=([^&]*)/);
  if (existingDebug) {
    // Append to existing debug flags if not already present
    const flags = existingDebug[1];
    if (!flags.includes('nogpu')) {
      return queryParams.replace(/debug=([^&]*)/, `debug=${flags},nogpu,nogl`);
    }
    return queryParams;
  }
  return `${queryParams}${separator}debug=nogpu,nogl`;
}

// Navigate to the app and wait for explorer to initialize AND initial view to be ready
async function navigateToApp(page, queryParams = '') {
  const adjustedParams = appendCpuDebugFlags(queryParams);
  const htmlPath = `file://${path.join(__dirname, '../../index.html')}${adjustedParams}`;
  await page.goto(htmlPath, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
  // Wait for initial view to exist and have some computation
  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && !view.uninteresting();
  }, { timeout: 15000 });
  // Wait for any initial update process to complete
  await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 15000 });
}

// Navigate to app with full URL and wait for proper preconditions
// Use this instead of direct page.goto() calls in tests
async function navigateToUrl(page, url) {
  // Append CPU debug flags to URL if on Linux
  const adjustedUrl = useCpuOnly ? appendCpuDebugFlagsToUrl(url) : url;
  await page.goto(adjustedUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
  // Wait for initial view to exist
  await page.waitForFunction(() => {
    const views = window.explorer?.grid?.views;
    return views && views.length > 0 && views[0] !== null;
  }, { timeout: 15000 });
  // Wait for any initial update process to complete
  await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 15000 });
}

// Append CPU debug flags to a full URL
// Note: We avoid URL.searchParams to preserve original encoding (commas, plus signs)
function appendCpuDebugFlagsToUrl(url) {
  const hasQuery = url.includes('?');
  const existingDebugMatch = url.match(/[?&]debug=([^&]*)/);
  if (existingDebugMatch) {
    const flags = existingDebugMatch[1];
    if (!flags.includes('nogpu')) {
      return url.replace(/([?&])debug=([^&]*)/, `$1debug=${flags},nogpu,nogl`);
    }
    return url;
  }
  return `${url}${hasQuery ? '&' : '?'}debug=nogpu,nogl`;
}

// Get the base URL for the app
function getAppUrl(queryString = '') {
  const baseUrl = `file://${path.join(__dirname, '../../index.html')}${queryString}`;
  return useCpuOnly ? appendCpuDebugFlagsToUrl(baseUrl) : baseUrl;
}

// Close browser with timeout to prevent hanging in afterAll
async function closeBrowser(browser, timeout = 10000) {
  if (!browser) return;
  try {
    // Close all pages first to terminate workers
    const pages = await browser.pages();
    await Promise.all(pages.map(async (page) => {
      try {
        // Terminate workers and wait briefly for cleanup
        await page.evaluate(() => {
          if (window.explorer?.scheduler?.workers) {
            window.explorer.scheduler.workers.forEach(w => w.terminate());
            window.explorer.scheduler.workers = [];
          }
        });
      } catch (e) { /* page may be closed */ }
      try { await page.close(); } catch (e) { /* ignore */ }
    }));

    // Delay before browser close to allow worker threads to finish terminating
    await new Promise(r => setTimeout(r, 200));

    // Race browser.close() against timeout, ensuring timer is cleaned up
    const proc = browser.process();
    let timeoutId;
    await Promise.race([
      browser.close().finally(() => clearTimeout(timeoutId)),
      new Promise(resolve => {
        timeoutId = setTimeout(() => {
          if (proc) proc.kill('SIGKILL');
          resolve();
        }, timeout);
      })
    ]);
  } catch (e) { /* ignore */ }
}

module.exports = {
  TEST_TIMEOUT,
  TEST_VIEWPORT,
  findChrome,
  waitForViewReady,
  setupBrowser,
  setupPage,
  teardownPage,
  navigateToApp,
  navigateToUrl,
  getAppUrl,
  closeBrowser,
  clearCoverage,
  isCoverageEnabled,
  useCpuOnly,
  appendCpuDebugFlags
};

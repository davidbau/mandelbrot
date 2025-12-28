/**
 * Shared utilities for integration tests
 *
 * Supports both local Playwright and BrowserStack modes.
 * Set BROWSERSTACK=1 environment variable to use BrowserStack.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { startCoverage, stopCoverage, clearCoverage, isCoverageEnabled } = require('../utils/coverage');

// BrowserStack mode detection
const browserStackUtils = process.env.BROWSERSTACK === '1' ? require('./browserstack-utils') : null;

// BrowserStack tests need longer timeout for remote browser startup
const TEST_TIMEOUT = browserStackUtils ? 120000 : 30000;
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
  return null;  // Fall back to Playwright's bundled Chromium
}

// Helper function to wait for initial view to be ready (has computed some pixels)
async function waitForViewReady(page, viewIndex = 0) {
  await page.waitForFunction(
    (idx) => {
      const view = window.explorer?.grid?.views?.[idx];
      return view && !view.uninteresting();
    },
    viewIndex,
    { timeout: 10000 }
  );
}

// Standard browser setup for tests
async function setupBrowser() {
  // Use BrowserStack if enabled
  if (browserStackUtils) {
    return browserStackUtils.setupBrowserStack();
  }

  const chromePath = findChrome();
  const platform = os.platform();

  // ANGLE backend varies by platform:
  // - macOS: metal (best performance)
  // - Linux: vulkan or swiftshader (software fallback for headless)
  // - Windows: d3d11
  const angleBackend = platform === 'darwin' ? 'metal'
                     : platform === 'win32' ? 'd3d11'
                     : 'swiftshader';  // Linux: use software renderer for reliable headless

  const launchOptions = {
    headless: true,
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
  if (chromePath) {
    launchOptions.executablePath = chromePath;
  }
  const browser = await chromium.launch(launchOptions);
  return browser;
}

// Standard page setup for tests
async function setupPage(browser, options = {}) {
  // Use BrowserStack page setup if enabled
  if (browserStackUtils && browser._browserstack) {
    return browserStackUtils.setupPageBrowserStack(browser);
  }

  const context = await browser.newContext({
    viewport: TEST_VIEWPORT,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();

  // Add waitForTimeout helper for compatibility
  page.waitForTimeout = (ms) => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);

  // Start coverage collection if enabled
  if (isCoverageEnabled()) {
    let testName = 'unknown';
    try {
       // Only available inside test/it blocks or if running via Jest
       testName = expect.getState().currentTestName || 'unknown';
    } catch(e) {}
    await startCoverage(page, testName);
  }

  // Store original close for cleanup
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

    // Close context (which closes the page)
    try {
      await context.close();
    } catch (e) {
      // Fall back to page close if context close fails
      try { await originalClose(); } catch (e2) { /* ignore */ }
    }
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
  // Use BrowserStack navigation if enabled
  if (browserStackUtils) {
    const browser = page.context().browser();
    if (browser && browser._browserstack) {
      return browserStackUtils.navigateToAppBrowserStack(page, queryParams);
    }
  }

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
  // Use BrowserStack URL if enabled (requires HTTP server to be running)
  if (browserStackUtils) {
    return browserStackUtils.getAppUrlBrowserStack(queryString);
  }

  const baseUrl = `file://${path.join(__dirname, '../../index.html')}${queryString}`;
  return useCpuOnly ? appendCpuDebugFlagsToUrl(baseUrl) : baseUrl;
}

// Check if running in BrowserStack mode
function isBrowserStack() {
  return browserStackUtils !== null;
}

// Close browser with timeout to prevent hanging in afterAll
async function closeBrowser(browser, timeout = 10000) {
  if (!browser) return;

  // Use BrowserStack cleanup if enabled
  if (browserStackUtils && browser._browserstack) {
    return browserStackUtils.closeBrowserStack(browser);
  }

  try {
    // Close all contexts/pages first to terminate workers
    const contexts = browser.contexts();
    await Promise.all(contexts.map(async (context) => {
      const pages = context.pages();
      await Promise.all(pages.map(async (page) => {
        try {
          // Terminate workers
          await page.evaluate(() => {
            if (window.explorer?.scheduler?.workers) {
              window.explorer.scheduler.workers.forEach(w => w.terminate());
              window.explorer.scheduler.workers = [];
            }
          });
        } catch (e) { /* page may be closed */ }
      }));
      try { await context.close(); } catch (e) { /* ignore */ }
    }));

    // Close browser with timeout - use unref() to prevent blocking Jest exit
    let timeoutId;
    await Promise.race([
      browser.close(),
      new Promise(resolve => {
        timeoutId = setTimeout(resolve, timeout);
        // unref() allows the process to exit even if this timer is still pending
        if (timeoutId.unref) timeoutId.unref();
      })
    ]);
    clearTimeout(timeoutId);
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
  appendCpuDebugFlags,
  isBrowserStack
};

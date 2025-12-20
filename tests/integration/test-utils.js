/**
 * Shared utilities for integration tests
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { setTimeout: sleep } = require('node:timers/promises');
const { startCoverage, stopCoverage, clearCoverage, isCoverageEnabled } = require('../utils/coverage');

const TEST_TIMEOUT = 60000; // 60 seconds for integration tests
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
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=metal',
    ]
  };
  if (chromePath) {
    launchOptions.executablePath = chromePath;
  }
  return await puppeteer.launch(launchOptions);
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

// Navigate to the app and wait for explorer to initialize AND initial view to be ready
async function navigateToApp(page, queryParams = '') {
  const htmlPath = `file://${path.join(__dirname, '../../index.html')}${queryParams}`;
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
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
  // Wait for initial view to exist
  await page.waitForFunction(() => {
    const views = window.explorer?.grid?.views;
    return views && views.length > 0 && views[0] !== null;
  }, { timeout: 15000 });
  // Wait for any initial update process to complete
  await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 15000 });
}

// Get the base URL for the app
function getAppUrl(queryString = '') {
  return `file://${path.join(__dirname, '../../index.html')}${queryString}`;
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
  isCoverageEnabled
};

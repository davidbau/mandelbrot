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
    await startCoverage(page);

    // Wrap page.close to collect coverage before closing
    const originalClose = page.close.bind(page);
    page.close = async function() {
      await stopCoverage(page);
      return originalClose();
    };
  }

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
  await page.close();
}

// Navigate to the app and wait for explorer to initialize
async function navigateToApp(page, queryParams = '') {
  const htmlPath = `file://${path.join(__dirname, '../../index.html')}${queryParams}`;
  await page.goto(htmlPath, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
  await sleep(200);
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
  clearCoverage,
  isCoverageEnabled
};

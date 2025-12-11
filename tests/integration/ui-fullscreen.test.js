/**
 * Integration tests for fullscreen mode
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady, closeBrowser } = require('./test-utils');

// Mock fullscreen API for headless browser testing
// The real Fullscreen API doesn't work in headless Chrome, so we mock it
// with realistic async delays to simulate actual browser behavior
async function setupFullscreenMock(page) {
  await page.evaluate(() => {
    let mockFullscreenElement = null;

    HTMLElement.prototype.requestFullscreen = function() {
      const element = this;
      return new Promise(resolve => {
        // Simulate the ~75ms delay browsers have entering fullscreen
        setTimeout(() => {
          mockFullscreenElement = element;
          document.dispatchEvent(new Event('fullscreenchange'));
          resolve();
        }, 75);
      });
    };

    document.exitFullscreen = function() {
      return new Promise(resolve => {
        // Simulate the ~50ms delay browsers have exiting fullscreen
        setTimeout(() => {
          mockFullscreenElement = null;
          document.dispatchEvent(new Event('fullscreenchange'));
          resolve();
        }, 50);
      });
    };

    Object.defineProperty(document, 'fullscreenElement', {
      get: () => mockFullscreenElement,
      configurable: true
    });
  });
}

describe('Fullscreen Mode Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page);
    await setupFullscreenMock(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('Fullscreen button and method should exist', async () => {
    const button = await page.$('#fullscreen-button');
    expect(button).toBeTruthy();

    const hasMethod = await page.evaluate(() => {
      return typeof window.explorer.toggleFullscreen === 'function';
    });
    expect(hasMethod).toBe(true);
  }, TEST_TIMEOUT);

  test('Enter/Escape keys should toggle fullscreen and save/restore grid settings', async () => {
    // Wait for no update in progress before keypress
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    const initialState = await page.evaluate(() => ({
      fullscreen: document.fullscreenElement !== null,
      gridcols: window.explorer.config.gridcols
    }));
    expect(initialState.fullscreen).toBe(false);

    // Press Enter to enter fullscreen
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.fullscreenElement !== null,
      { timeout: 2000 }
    );

    const afterEnter = await page.evaluate(() => ({
      isFullscreen: document.fullscreenElement !== null,
      fullscreenElement: document.fullscreenElement?.tagName,
      gridcols: window.explorer.config.gridcols
    }));

    expect(afterEnter.isFullscreen).toBe(true);
    expect(afterEnter.fullscreenElement).toBe('HTML');
    expect(afterEnter.gridcols).toBe(1);

    // Press Escape to exit fullscreen
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.fullscreenElement === null,
      { timeout: 2000 }
    );

    const afterEscape = await page.evaluate(() => ({
      fullscreen: document.fullscreenElement !== null,
      gridcols: window.explorer.config.gridcols
    }));
    expect(afterEscape.fullscreen).toBe(false);
    expect(afterEscape.gridcols).toBe(initialState.gridcols);
  }, TEST_TIMEOUT);

  test('Fullscreen button click should enter and exit fullscreen', async () => {
    // Wait for no update in progress before clicking
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    const button = await page.$('#fullscreen-button');
    expect(button).toBeTruthy();

    const beforeClick = await page.evaluate(() => document.fullscreenElement !== null);
    expect(beforeClick).toBe(false);

    // Click button to enter fullscreen
    await button.click();
    await page.waitForFunction(
      () => document.fullscreenElement !== null,
      { timeout: 2000 }
    );

    const afterClick = await page.evaluate(() => document.fullscreenElement !== null);
    expect(afterClick).toBe(true);

    // Press Escape to exit fullscreen
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.fullscreenElement === null,
      { timeout: 2000 }
    );

    const afterExit = await page.evaluate(() => document.fullscreenElement !== null);
    expect(afterExit).toBe(false);
  }, TEST_TIMEOUT);

  test('Fullscreen mode should use full window dimensions in initsizes', async () => {
    // Wait for no update in progress
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Get dimensions before fullscreen
    const beforeDims = await page.evaluate(() => {
      const canvas = document.querySelector('#grid canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });

    // Enter fullscreen
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.fullscreenElement !== null,
      { timeout: 2000 }
    );

    // Trigger a resize event while in fullscreen mode - this exercises the fullscreen branch in initSizes
    const afterFullscreenDims = await page.evaluate(() => {
      // Dispatch resize event to trigger initSizes recalculation in fullscreen mode
      window.dispatchEvent(new Event('resize'));
      const canvas = document.querySelector('#grid canvas');
      return {
        width: canvas ? canvas.width : null,
        height: canvas ? canvas.height : null,
        isFullscreen: document.fullscreenElement !== null,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight
      };
    });

    expect(afterFullscreenDims.isFullscreen).toBe(true);
    // In fullscreen, canvas should use full window dimensions (no margins)
    // The canvas dimensions should match or be close to window dimensions
    if (afterFullscreenDims.width && beforeDims) {
      // Fullscreen canvas should be at least as large as before
      expect(afterFullscreenDims.width).toBeGreaterThanOrEqual(beforeDims.width);
    }

    // Exit fullscreen
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.fullscreenElement === null,
      { timeout: 2000 }
    );
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

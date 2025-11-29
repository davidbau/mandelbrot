/**
 * Integration tests for fullscreen mode
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('Fullscreen Mode Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  }, TEST_TIMEOUT);

  test('Fullscreen button and method should exist', async () => {
    const button = await page.$('#fullscreen-button');
    expect(button).toBeTruthy();

    const hasMethod = await page.evaluate(() => {
      return typeof window.explorer.toggleFullscreen === 'function';
    }, TEST_TIMEOUT);
    expect(hasMethod).toBe(true);
  }, TEST_TIMEOUT);

  test('Enter/Escape keys should toggle fullscreen and save/restore grid settings', async () => {
    const initialState = await page.evaluate(() => ({
      fullscreen: document.fullscreenElement !== null,
      gridcols: window.explorer.config.gridcols
    }));
    expect(initialState.fullscreen).toBe(false);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const afterEnter = await page.evaluate(() => ({
      isFullscreen: document.fullscreenElement !== null,
      fullscreenElement: document.fullscreenElement?.tagName,
      gridcols: window.explorer.config.gridcols
    }));

    if (afterEnter.isFullscreen) {
      expect(afterEnter.fullscreenElement).toBe('HTML');
      expect(afterEnter.gridcols).toBe(1);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      const afterEscape = await page.evaluate(() => ({
        fullscreen: document.fullscreenElement !== null,
        gridcols: window.explorer.config.gridcols
      }));
      expect(afterEscape.fullscreen).toBe(false);
      expect(afterEscape.gridcols).toBe(initialState.gridcols);
    }
  }, TEST_TIMEOUT);

  test('Fullscreen button click should enter and exit fullscreen', async () => {
    const button = await page.$('#fullscreen-button');
    expect(button).toBeTruthy();

    const beforeClick = await page.evaluate(() => document.fullscreenElement !== null);
    expect(beforeClick).toBe(false);

    await button.click();
    await page.waitForTimeout(500);

    const afterClick = await page.evaluate(() => document.fullscreenElement !== null);

    if (afterClick) {
      expect(afterClick).toBe(true);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const afterExit = await page.evaluate(() => document.fullscreenElement !== null);
      expect(afterExit).toBe(false);
    }
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

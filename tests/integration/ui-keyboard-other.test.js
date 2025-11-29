/**
 * Integration tests for keyboard exponent, resolution, and help commands
 * Tests X, Z, F, D, ? keys
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('Keyboard Exponent/Resolution/Help Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {});
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) await page.close();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  }, TEST_TIMEOUT);

  describe('Exponent and Resolution Commands', () => {
    test('X/Z keys control exponent, exponent cannot go below 2', async () => {
      const initialExp = await page.evaluate(() => window.explorer.config.exponent);
      expect(initialExp).toBe(2);

      await page.keyboard.press('x');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.explorer.config.exponent)).toBe(3);

      await page.keyboard.press('z');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.explorer.config.exponent)).toBe(2);

      await page.keyboard.press('z');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.explorer.config.exponent)).toBe(2);
    }, TEST_TIMEOUT);

    test('F/D keys control pixel ratio', async () => {
      const initialRatio = await page.evaluate(() => window.explorer.config.pixelRatio);

      await page.keyboard.press('f');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.explorer.config.pixelRatio)).toBe(initialRatio + 1);

      await page.keyboard.press('d');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.explorer.config.pixelRatio)).toBe(initialRatio);
    }, TEST_TIMEOUT);
  });

  describe('Help Text Box', () => {
    test('? key shows help (centered), X closebox hides it', async () => {
      const initialStyle = await page.evaluate(() => {
        const textEl = document.getElementById('text');
        return window.getComputedStyle(textEl).display;
      });
      expect(initialStyle).toBe('inline-block');

      const closebox = await page.$('#text .closebox');
      expect(closebox).toBeTruthy();
      await closebox.click();
      await page.waitForTimeout(200);
      const hiddenAfter = await page.evaluate(() => document.getElementById('text').style.display);
      expect(hiddenAfter).toBe('none');

      await page.keyboard.type('?');
      await page.waitForTimeout(200);
      const afterShow = await page.evaluate(() => {
        const textEl = document.getElementById('text');
        return {
          styleDisplay: textEl.style.display,
          computedDisplay: window.getComputedStyle(textEl).display
        };
      });
      expect(afterShow.styleDisplay).not.toBe('block');
      expect(afterShow.computedDisplay).toBe('inline-block');
    }, TEST_TIMEOUT);
  });
});

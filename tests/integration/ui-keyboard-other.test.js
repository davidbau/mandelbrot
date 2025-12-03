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
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

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
  }, TEST_TIMEOUT);

  describe('Help Text Box', () => {
    test('? key shows help (centered), X closebox hides it', async () => {
      const initialStyle = await page.evaluate(() => {
        const textEl = document.getElementById('text');
        return window.getComputedStyle(textEl).display;
      }, TEST_TIMEOUT);
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
      }, TEST_TIMEOUT);
      expect(afterShow.styleDisplay).not.toBe('block');
      expect(afterShow.computedDisplay).toBe('inline-block');
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Unknown Color Cycling', () => {
    test('U key cycles unknown color forward, Shift+U cycles backward', async () => {
      await waitForViewReady(page);

      // Get initial unknown color
      const initialColor = await page.evaluate(() => window.explorer.config.unknowncolor);

      // Press U to cycle forward
      await page.keyboard.press('u');
      await page.waitForTimeout(200);
      const afterU = await page.evaluate(() => window.explorer.config.unknowncolor);
      expect(afterU).not.toBe(initialColor);

      // Press Shift+U to cycle backward (should return to initial)
      await page.keyboard.down('Shift');
      await page.keyboard.press('u');
      await page.keyboard.up('Shift');
      await page.waitForTimeout(200);
      const afterShiftU = await page.evaluate(() => window.explorer.config.unknowncolor);
      expect(afterShiftU).toBe(initialColor);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Backspace Key', () => {
    test('Backspace closes deepest view when multiple views exist', async () => {
      await waitForViewReady(page);

      // Click to create a second view
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });
      await page.waitForTimeout(300);

      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsBefore).toBeGreaterThanOrEqual(2);

      // Press backspace to close deepest view
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(300);

      const viewsAfter = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsAfter).toBe(viewsBefore - 1);
    }, TEST_TIMEOUT);

    test('Backspace does nothing with only one view', async () => {
      await waitForViewReady(page);

      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsBefore).toBe(1);

      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);

      const viewsAfter = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsAfter).toBe(1);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

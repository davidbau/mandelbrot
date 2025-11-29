/**
 * Integration tests for keyboard navigation and grid commands
 * Tests T, U, I, C, H, G keys
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('Keyboard Navigation Tests', () => {
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
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }, TEST_TIMEOUT);

  describe('Theme and Color Commands', () => {
    test('T key should cycle through color themes', async () => {
      const initialTheme = await page.evaluate(() => window.explorer.config.theme);
      await page.keyboard.press('t');
      await page.waitForTimeout(100);
      const newTheme = await page.evaluate(() => window.explorer.config.theme);
      expect(newTheme).not.toBe(initialTheme);
    }, TEST_TIMEOUT);

    test('Shift+T should cycle themes backward', async () => {
      const initialTheme = await page.evaluate(() => window.explorer.config.theme);
      await page.keyboard.down('Shift');
      await page.keyboard.press('t');
      await page.keyboard.up('Shift');
      await page.waitForTimeout(100);
      const newTheme = await page.evaluate(() => window.explorer.config.theme);
      expect(newTheme).not.toBe(initialTheme);
    }, TEST_TIMEOUT);

    test('U key should cycle unknown color', async () => {
      const initialColor = await page.evaluate(() => window.explorer.config.unknowncolor);
      await page.keyboard.press('u');
      await page.waitForTimeout(100);
      const newColor = await page.evaluate(() => window.explorer.config.unknowncolor);
      expect(newColor).not.toBe(initialColor);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Navigation Commands', () => {
    test('I key should zoom in at current position', async () => {
      await waitForViewReady(page);
      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);

      await page.keyboard.press('i');
      await page.waitForFunction(
        (before) => window.explorer.grid.views.length > before,
        { timeout: 5000 },
        viewsBefore
      );

      const viewsAfter = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsAfter).toBe(viewsBefore + 1);

      const sizes = await page.evaluate(() => {
        const views = window.explorer.grid.views;
        return { firstSize: views[0].sizes[0], lastSize: views[views.length - 1].sizes[0] };
      }, TEST_TIMEOUT);
      expect(sizes.lastSize).toBeLessThan(sizes.firstSize);
    }, TEST_TIMEOUT);

    test('C key should center views when multiple views exist', async () => {
      await waitForViewReady(page);

      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);

      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 }, TEST_TIMEOUT);
      await page.waitForTimeout(500);

      await page.keyboard.press('c');
      await page.waitForTimeout(500);

      const viewsAfter = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsAfter).toBeGreaterThanOrEqual(2);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Grid Commands', () => {
    test('H key should increase grid columns', async () => {
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);
      await page.keyboard.press('h');
      await page.waitForTimeout(500);
      const newCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(newCols).toBe(initialCols + 1);
    }, TEST_TIMEOUT);

    test('G key should decrease grid columns', async () => {
      await page.keyboard.press('h');
      await page.waitForTimeout(500);
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);

      await page.keyboard.press('g');
      await page.waitForTimeout(500);
      const newCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(newCols).toBe(initialCols - 1);
    }, TEST_TIMEOUT);

    test('H key should work repeatedly during relayout', async () => {
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);
      await page.keyboard.press('h');
      await page.keyboard.press('h');
      await page.keyboard.press('h');
      await page.waitForTimeout(500);
      const finalCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(finalCols).toBe(initialCols + 3);
    }, TEST_TIMEOUT);

    test('H key should resize canvases correctly', async () => {
      // Wait for initial layout to complete
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      // Get initial canvas dimensions
      const initialState = await page.evaluate(() => ({
        gridcols: window.explorer.config.gridcols,
        cssDimsWidth: window.explorer.config.cssDimsWidth,
        canvasWidth: window.explorer.grid.canvas(0)?.width,
        canvasStyleWidth: window.explorer.grid.canvas(0)?.style.width
      }));

      // Press H to increase grid columns
      await page.keyboard.press('h');
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      // Get new canvas dimensions
      const newState = await page.evaluate(() => ({
        gridcols: window.explorer.config.gridcols,
        cssDimsWidth: window.explorer.config.cssDimsWidth,
        canvasWidth: window.explorer.grid.canvas(0)?.width,
        canvasStyleWidth: window.explorer.grid.canvas(0)?.style.width
      }));

      // Grid columns should have increased
      expect(newState.gridcols).toBe(initialState.gridcols + 1);

      // Canvas should have shrunk (more columns = smaller individual canvases)
      expect(newState.cssDimsWidth).toBeLessThan(initialState.cssDimsWidth);

      // Canvas element dimensions should match config
      expect(newState.canvasStyleWidth).toBe(newState.cssDimsWidth + 'px');
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

/**
 * Integration tests for keyboard grid grow/shrink commands
 * Tests H and G keys
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('Keyboard Grid Grow/Shrink Tests', () => {
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

  describe('H and G keys control grid columns', () => {
    test('H key adds a column, G key removes a column', async () => {
      // Start with 1 column
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(initialCols).toBe(1);

      // Wait for the initial view to start computing
      await waitForViewReady(page, 0);

      // Press H to add a column
      await page.keyboard.press('h');
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 2,
        { timeout: 5000 }
      );

      // Should now have 2 columns
      expect(await page.evaluate(() => window.explorer.config.gridcols)).toBe(2);

      // Press G to remove a column
      await page.keyboard.press('g');
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 1,
        { timeout: 5000 }
      );

      // Should be back to 1 column
      expect(await page.evaluate(() => window.explorer.config.gridcols)).toBe(1);
    }, TEST_TIMEOUT);

    test('G key cannot reduce below 1 column', async () => {
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(initialCols).toBe(1);

      // Try pressing G when already at 1 column - should stay at 1
      await page.keyboard.press('g');
      await page.waitForTimeout(300);

      expect(await page.evaluate(() => window.explorer.config.gridcols)).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe('Computation continues after grid changes', () => {
    test('H key early in computation should not stall iteration progress', async () => {
      // Navigate fresh to ensure we catch computation early
      await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

      // Wait until there's at least one view
      await page.waitForFunction(
        () => window.explorer.grid.views.length >= 1,
        { timeout: 5000 }
      );

      // Get initial iteration count (should be low since we just started)
      const initialDi = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Press H immediately to add a column
      await page.keyboard.press('h');

      // Wait for update to complete (views length changes)
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 2 &&
              !window.explorer.grid.currentUpdateProcess,
        { timeout: 10000 }
      );

      // Record the iteration count right after layout change
      const diAfterLayout = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Wait for computation to continue for a reasonable period
      await page.waitForTimeout(2000);

      // Check iteration progress - should have increased substantially
      const diFinal = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // The iteration count should increase after layout change
      // If computation is stalled, diFinal will be close to diAfterLayout
      expect(diFinal).toBeGreaterThan(diAfterLayout + 10);
    }, TEST_TIMEOUT);

    test('Multiple H presses should not stall computation', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

      // Wait for initial view
      await page.waitForFunction(
        () => window.explorer.grid.views.length >= 1,
        { timeout: 5000 }
      );

      // Press H three times quickly
      await page.keyboard.press('h');
      await page.waitForTimeout(100);
      await page.keyboard.press('h');
      await page.waitForTimeout(100);
      await page.keyboard.press('h');

      // Wait for layout to settle (3 columns now)
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 4 &&
              !window.explorer.grid.currentUpdateProcess,
        { timeout: 15000 }
      );

      // Record iteration count
      const diAfterLayout = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Wait for more computation
      await page.waitForTimeout(2000);

      // Check progress
      const diFinal = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Should have made progress
      expect(diFinal).toBeGreaterThan(diAfterLayout + 10);
    }, TEST_TIMEOUT);

    test('H followed by G should resume computation', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

      // Let some computation happen first
      await page.waitForFunction(
        () => window.explorer.grid.views?.[0]?.di > 10,
        { timeout: 10000 }
      );

      // H then G
      await page.keyboard.press('h');
      await page.waitForTimeout(500);
      await page.keyboard.press('g');

      // Wait for layout to settle
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 1 &&
              !window.explorer.grid.currentUpdateProcess,
        { timeout: 10000 }
      );

      const diAfterLayout = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Wait for more computation
      await page.waitForTimeout(2000);

      const diFinal = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Should continue making progress
      expect(diFinal).toBeGreaterThan(diAfterLayout + 10);
    }, TEST_TIMEOUT);
  });
}, TEST_TIMEOUT);

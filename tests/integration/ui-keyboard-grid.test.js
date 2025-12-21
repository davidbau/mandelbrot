/**
 * Integration tests for keyboard grid grow/shrink commands
 * Tests H and G keys
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady, closeBrowser } = require('./test-utils');

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
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  describe('H and G keys control grid columns', () => {
    test('H key adds a column, G key removes a column', async () => {
      // Start with 1 column
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(initialCols).toBe(1);

      // Wait for the initial view to start computing
      await waitForViewReady(page, 0);

      // Ensure no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });

      // Press H to add a column
      await page.keyboard.press('h');
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 2,
        { timeout: 5000 }
      );

      // Should now have 2 columns
      expect(await page.evaluate(() => window.explorer.config.gridcols)).toBe(2);

      // Ensure no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });

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

      // Ensure no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });

      // Try pressing G when already at 1 column - should stay at 1
      await page.keyboard.press('g');
      // Wait for any potential change to settle, then verify still at 1
      await page.waitForFunction(
        () => !window.explorer.grid.currentUpdateProcess,
        { timeout: 5000 }
      );

      expect(await page.evaluate(() => window.explorer.config.gridcols)).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe('Computation continues after grid changes', () => {
    test('H key early in computation should not stall iteration progress', async () => {
      // Navigate fresh to ensure we catch computation early
      await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

      // Wait until there's at least one view with some computation started
      await page.waitForFunction(
        () => {
          const view = window.explorer?.grid?.views?.[0];
          return view && !view.uninteresting();
        },
        { timeout: 10000 }
      );

      // Get initial iteration count (should be low since we just started)
      const initialDi = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Ensure no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });

      // Press H to add a column
      await page.keyboard.press('h');

      // Wait for update to complete (views length changes)
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 2 &&
              !window.explorer.grid.currentUpdateProcess,
        { timeout: 10000 }
      );

      // Record the iteration count right after layout change
      const diAfterLayout = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Wait for computation to continue - should increase by at least 5 diverged pixels
      // After grid change, views are recreated so di starts low
      await page.waitForFunction(
        (baseline) => (window.explorer.grid.views[0]?.di || 0) > baseline + 5,
        { timeout: 30000 },
        diAfterLayout
      );

      // Check iteration progress - should have increased
      const diFinal = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // The diverged count should increase after layout change
      expect(diFinal).toBeGreaterThan(diAfterLayout + 5);
    }, TEST_TIMEOUT);

    test('Multiple H presses should not stall computation', async () => {
      const url = `file://${path.join(__dirname, '../../index.html')}?debug=fastload&width=240&height=240&pixelratio=1`;
      await page.goto(url);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

      // Wait for initial view with some computation started
      await page.waitForFunction(
        () => {
          const view = window.explorer?.grid?.views?.[0];
          return view && !view.uninteresting();
        },
        { timeout: 10000 }
      );

      // Press H three times, waiting for each to take effect
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
      await page.keyboard.press('h');
      await page.waitForFunction(() => window.explorer.config.gridcols === 2, { timeout: 5000 });
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
      await page.keyboard.press('h');
      await page.waitForFunction(() => window.explorer.config.gridcols === 3, { timeout: 5000 });
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
      await page.keyboard.press('h');

      // Wait for layout to settle (4 columns now)
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 4 &&
              !window.explorer.grid.currentUpdateProcess,
        { timeout: 15000 }
      );

      // Record total uncomputed pixels after layout
      const unAfterLayout = await page.evaluate(() => {
        const views = window.explorer.grid.views || [];
        return views.reduce((sum, view) => sum + (view?.un ?? 0), 0);
      });

      // Wait for computation to continue after layout (un should decrease)
      await page.waitForFunction(
        (baseline) => {
          const views = window.explorer.grid.views || [];
          const current = views.reduce((sum, view) => sum + (view?.un ?? 0), 0);
          return current < baseline;
        },
        { timeout: 30000 },
        unAfterLayout
      );

      // Check progress
      const unFinal = await page.evaluate(() => {
        const views = window.explorer.grid.views || [];
        return views.reduce((sum, view) => sum + (view?.un ?? 0), 0);
      });

      // Should have made progress
      expect(unFinal).toBeLessThan(unAfterLayout);
    }, TEST_TIMEOUT);

    test('H followed by G should resume computation', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

      // Wait for initial view with some computation started
      await page.waitForFunction(
        () => {
          const view = window.explorer?.grid?.views?.[0];
          return view && !view.uninteresting();
        },
        { timeout: 10000 }
      );

      // Let some computation happen first
      await page.waitForFunction(
        () => window.explorer.grid.views?.[0]?.di > 10,
        { timeout: 15000 }
      );

      // H then G
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
      await page.keyboard.press('h');
      await page.waitForFunction(() => window.explorer.config.gridcols === 2, { timeout: 5000 });
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
      await page.keyboard.press('g');

      // Wait for layout to settle
      await page.waitForFunction(
        () => window.explorer.config.gridcols === 1 &&
              !window.explorer.grid.currentUpdateProcess,
        { timeout: 10000 }
      );

      const diAfterLayout = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Wait for computation to continue - should increase by at least 10 iterations
      await page.waitForFunction(
        (baseline) => (window.explorer.grid.views[0]?.di || 0) > baseline + 10,
        { timeout: 20000 },
        diAfterLayout
      );

      const diFinal = await page.evaluate(() => window.explorer.grid.views[0]?.di || 0);

      // Should continue making progress
      expect(diFinal).toBeGreaterThan(diAfterLayout + 10);
    }, TEST_TIMEOUT);
  });
}, TEST_TIMEOUT);

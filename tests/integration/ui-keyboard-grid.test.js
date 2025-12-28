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

      // Record state right after layout change
      const stateAfterLayout = await page.evaluate(() => ({
        di: window.explorer.grid.views[0]?.di || 0,
        un: window.explorer.grid.views[0]?.un || 0
      }));

      // Wait for computation to complete (un reaches 0) or di to increase
      // Views may inherit from parent and have few pixels to compute
      await page.waitForFunction(
        (baseline) => {
          const view = window.explorer.grid.views[0];
          if (!view) return false;
          // Either computation completed (un=0) or we made progress (di increased)
          return view.un === 0 || view.di > baseline.di;
        },
        stateAfterLayout,
        { timeout: 30000 }
      );

      // Verify computation made progress
      const stateFinal = await page.evaluate(() => ({
        di: window.explorer.grid.views[0]?.di || 0,
        un: window.explorer.grid.views[0]?.un || 0
      }));

      // Either computation completed or di increased
      const computationProgressed = stateFinal.un === 0 || stateFinal.di > stateAfterLayout.di;
      expect(computationProgressed).toBe(true);
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

      // Record state after layout
      const stateAfterLayout = await page.evaluate(() => {
        const views = window.explorer.grid.views || [];
        return {
          totalUn: views.reduce((sum, view) => sum + (view?.un ?? 0), 0),
          totalDi: views.reduce((sum, view) => sum + (view?.di ?? 0), 0)
        };
      });

      // Wait for computation to make progress (un decreases or all complete)
      await page.waitForFunction(
        (baseline) => {
          const views = window.explorer.grid.views || [];
          const totalUn = views.reduce((sum, view) => sum + (view?.un ?? 0), 0);
          const totalDi = views.reduce((sum, view) => sum + (view?.di ?? 0), 0);
          // Either un decreased, all complete, or di increased
          return totalUn < baseline.totalUn || totalUn === 0 || totalDi > baseline.totalDi;
        },
        stateAfterLayout,
        { timeout: 30000 }
      );

      // Check progress
      const stateFinal = await page.evaluate(() => {
        const views = window.explorer.grid.views || [];
        return {
          totalUn: views.reduce((sum, view) => sum + (view?.un ?? 0), 0),
          totalDi: views.reduce((sum, view) => sum + (view?.di ?? 0), 0)
        };
      });

      // Should have made progress: un decreased, completed, or di increased
      const madeProgress = stateFinal.totalUn < stateAfterLayout.totalUn ||
                          stateFinal.totalUn === 0 ||
                          stateFinal.totalDi > stateAfterLayout.totalDi;
      expect(madeProgress).toBe(true);
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

      // Record state right after layout
      const stateAfterLayout = await page.evaluate(() => ({
        di: window.explorer.grid.views[0]?.di || 0,
        un: window.explorer.grid.views[0]?.un || 0
      }));

      // Wait for computation to make progress or complete
      await page.waitForFunction(
        (baseline) => {
          const view = window.explorer.grid.views[0];
          if (!view) return false;
          // Either computation completed (un=0) or we made progress (di increased)
          return view.un === 0 || view.di > baseline.di;
        },
        stateAfterLayout,
        { timeout: 20000 }
      );

      const stateFinal = await page.evaluate(() => ({
        di: window.explorer.grid.views[0]?.di || 0,
        un: window.explorer.grid.views[0]?.un || 0
      }));

      // Should continue making progress: either completed or di increased
      const madeProgress = stateFinal.un === 0 || stateFinal.di > stateAfterLayout.di;
      expect(madeProgress).toBe(true);
    }, TEST_TIMEOUT);
  });
}, TEST_TIMEOUT);

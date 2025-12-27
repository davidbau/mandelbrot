/**
 * Integration tests for browser history - view preservation
 * Tests that views are properly preserved during popstate navigation
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, navigateToUrl, getAppUrl, waitForViewReady, closeBrowser } = require('./test-utils');

describe('Browser History View Preservation Tests', () => {
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
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('Preserved views should retain all computed pixels after popstate', async () => {
    // This test reproduces an issue where after popstate, preserved views
    // show parent composite but early iteration child pixels are missing
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i'));
    await page.waitForFunction(() => window.explorer.grid.views.length >= 3, { timeout: 5000 });

    // Wait for some computation to occur on view 2 (the child view)
    await page.waitForFunction(() => {
      const view = window.explorer.grid.views[2];
      return view && view.di > 1000;  // Wait for some diverged pixels
    }, { timeout: 15000 });

    // Record the computed pixels (nn array) for view 2 before popstate
    const beforeState = await page.evaluate(() => {
      const view = window.explorer.grid.views[2];
      // Count non-zero pixels in nn array (computed pixels)
      const computedCount = view.nn.filter(n => n !== 0).length;
      // Get diverged pixels (positive values, meaning they escaped)
      const divergedPixels = view.nn.filter(n => n > 0).length;
      // Get a sample of the iteration distribution
      const iterValues = view.nn.filter(n => n > 0);
      const minIter = iterValues.length > 0 ? Math.min(...iterValues) : 0;
      const maxIter = iterValues.length > 0 ? Math.max(...iterValues) : 0;
      return {
        viewId: view.id,
        computedCount,
        divergedPixels,
        minIter,
        maxIter,
        di: view.di,
        it: view.it,
        hiLength: view.hi.length
      };
    });

    expect(beforeState.computedCount).toBeGreaterThan(1000);
    expect(beforeState.divergedPixels).toBeGreaterThan(0);

    // Create a new history entry by adding a 4th view (deeper zoom)
    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const config = window.explorer.config;

      // Push current state
      history.pushState(null, '', location.href);

      // sizesQD is already in state format [sizeDouble, reOct, imOct]
      // Use the ACTUAL coordinates from existing views to ensure exact match
      const state = {
        sizes: [
          grid.views[0].sizesQD,  // Preserve exact coords
          grid.views[1].sizesQD,  // Preserve exact coords
          grid.views[2].sizesQD,  // Preserve exact coords
          [config.firstsize / Math.pow(config.zoomfactor, 3), [-0.66, 0, 0, 0], [0.26, 0, 0, 0]]  // NEW 4th view (oct coords)
        ],
        hidden: []
      };
      grid.updateLayout(state);
    });

    // Wait for 4th view to be created
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 4 &&
      window.explorer.grid.views.every(v => v !== null),
      { timeout: 5000 }
    );

    // Verify the view we're tracking is still the same object
    // (either in stableViews or already in views after immediate placement)
    const stateBeforePopstate = await page.evaluate((origId) => {
      const grid = window.explorer.grid;
      // Check if the original view exists in stableViews OR in views
      const inStableViews = (grid.stableViews || []).some(v => v?.id === origId);
      const inViews = grid.views.some(v => v?.id === origId);
      return {
        updateInProgress: !!grid.currentUpdateProcess,
        originalViewFound: inStableViews || inViews,
        originalId: origId
      };
    }, beforeState.viewId);
    // Key invariant: original view 2 must be preserved (in stableViews or already in views)
    expect(stateBeforePopstate.originalViewFound).toBe(true);

    // Update URL and set lastCenters for popstate detection
    await page.evaluate(() => {
      window.explorer.urlHandler.updateurl();
    });

    // Now go back - this should trigger popstate and preserve views 0,1,2
    await page.evaluate(() => history.back());

    // Wait for popstate to be processed
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 10000 }
    );

    // Check that view 2 retained its computed pixels
    const afterState = await page.evaluate(() => {
      const view = window.explorer.grid.views[2];
      const computedCount = view.nn.filter(n => n !== 0).length;
      const divergedPixels = view.nn.filter(n => n > 0).length;
      const iterValues = view.nn.filter(n => n > 0);
      const minIter = iterValues.length > 0 ? Math.min(...iterValues) : 0;
      const maxIter = iterValues.length > 0 ? Math.max(...iterValues) : 0;
      return {
        viewId: view.id,
        computedCount,
        divergedPixels,
        minIter,
        maxIter,
        di: view.di,
        it: view.it,
        hiLength: view.hi.length
      };
    });

    // View should still have its computed pixels
    // Note: If view ID differs, the view was not preserved (recreated instead)
    expect(afterState.viewId).toBe(beforeState.viewId);
    expect(afterState.computedCount).toBeGreaterThanOrEqual(beforeState.computedCount);
    // Diverged pixels should still be present
    expect(afterState.divergedPixels).toBeGreaterThanOrEqual(beforeState.divergedPixels);
    // Histogram should be preserved
    expect(afterState.hiLength).toBeGreaterThanOrEqual(beforeState.hiLength);
    // Min iteration should be preserved (early iteration pixels still present)
    expect(afterState.minIter).toBe(beforeState.minIter);

    // Now verify the canvas has the correct pixels drawn
    // Get canvas pixel data and verify it matches the nn array
    const canvasCheck = await page.evaluate(() => {
      const grid = window.explorer.grid;
      const view = grid.views[2];
      const canvas = grid.canvas(2);
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Count non-transparent pixels on canvas (where alpha > 0)
      let drawnPixels = 0;
      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) drawnPixels++;
      }

      // Count computed pixels in nn array
      const computedInNn = view.nn.filter(n => n !== 0).length;

      return {
        drawnPixels,
        computedInNn,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
      };
    });

    // Canvas should have drawn pixels (not all transparent)
    expect(canvasCheck.drawnPixels).toBeGreaterThan(0);
    // The number of drawn pixels should be close to the computed pixels
    // (some might be transparent due to composite rendering)
    expect(canvasCheck.drawnPixels).toBeGreaterThanOrEqual(canvasCheck.computedInNn * 0.5);
  }, TEST_TIMEOUT);

  test('Preserved view at different index should draw correctly', async () => {
    // This test simulates a scenario where a view moves to a different index
    // during popstate (e.g., view 2 becomes view 1 when view 1 is removed)
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i'));
    await page.waitForFunction(() => window.explorer.grid.views.length >= 3, { timeout: 10000 });

    // Wait for some computation on view 2
    await page.waitForFunction(() => {
      const view = window.explorer.grid.views[2];
      return view && view.di > 0;
    }, { timeout: 20000 });

    // Give a bit more time for computation
    await page.waitForTimeout(500);

    // Record state of view 2 before changes
    const view2Before = await page.evaluate(() => {
      const view = window.explorer.grid.views[2];
      return {
        viewId: view.id,
        k: view.k,
        computedCount: view.nn.filter(n => n !== 0).length,
        di: view.di,
        sizes: view.sizes
      };
    });

    expect(view2Before.computedCount).toBeGreaterThan(0);

    // Simulate: push current state, then remove view 1 (middle view)
    // This will cause view 2 (at -0.65+0.25i) to move to index 1
    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const config = window.explorer.config;

      history.pushState(null, '', location.href);
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = window.explorer.urlHandler.extractHidden(
        window.explorer.urlHandler.currenturl()
      );

      // sizesQD is already in state format [sizeDouble, reOct, imOct]
      // New state: remove view 1, so view 2 (at -0.65+0.25i) should move to index 1
      const state = {
        sizes: [
          [config.firstsize, config.firstrQD, config.firstjQD],
          // Skip the old view 1, keep view 2's coordinates at new index 1
          grid.views[2].sizesQD
        ],
        hidden: []
      };
      grid.updateLayout(state);
    });

    // Wait for 2 views
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 2 &&
      window.explorer.grid.views.every(v => v !== null) &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 10000 }
    );

    await page.evaluate(() => {
      window.explorer.urlHandler.updateurl();
    });

    // Go back - this should restore original 3 views
    // View at new index 1 (originally at index 2) should be preserved and moved back to index 2
    await page.evaluate(() => history.back());

    // Wait for popstate to complete
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 10000 }
    );

    // Check that view 2 retained its computed pixels and draws correctly
    const afterState = await page.evaluate(() => {
      const grid = window.explorer.grid;
      const view = grid.views[2];
      const canvas = grid.canvas(2);

      if (!canvas) return { error: 'canvas not found' };

      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let drawnPixels = 0;
      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) drawnPixels++;
      }

      return {
        viewId: view.id,
        k: view.k,
        computedCount: view.nn.filter(n => n !== 0).length,
        di: view.di,
        drawnPixels,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
      };
    });

    // View should have computed pixels
    expect(afterState.computedCount).toBeGreaterThan(0);
    // Canvas should have drawn pixels
    expect(afterState.drawnPixels).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  test('Rapid back/forward during update should preserve view data', async () => {
    // This test reproduces a race condition where popstate fires while
    // an update process is in progress, causing views to be lost
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i'));
    await page.waitForFunction(() => window.explorer.grid.views.length >= 3, { timeout: 10000 });

    // Wait for computation on view 2 (just needs some pixels computed)
    await page.waitForFunction(() => {
      const view = window.explorer.grid.views[2];
      return view && view.di > 0;
    }, { timeout: 20000 });

    // Record view 2's computed state
    const view2Before = await page.evaluate(() => {
      const view = window.explorer.grid.views[2];
      return {
        id: view.id,
        computedCount: view.nn.filter(n => n !== 0).length,
        di: view.di
      };
    });

    expect(view2Before.computedCount).toBeGreaterThan(0);

    // Hide view 1 (middle view) - this creates a history entry
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = window.explorer.urlHandler.extractHidden(
        window.explorer.urlHandler.currenturl()
      );
    });
    // Wait for no update before clicking closebox (click is ignored during updates)
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
    await page.click('#b_1 .closebox');
    await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 5000 });

    // Now rapidly go back and forward multiple times to trigger race condition
    // The key is to trigger popstate while an update is still in progress
    // 3 cycles is enough to verify oldViews chaining works for N>1 updates
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => history.back());
      // Don't wait for update to complete - immediately go forward
      await page.waitForTimeout(20);  // Small delay to let popstate fire
      await page.evaluate(() => history.forward());
      await page.waitForTimeout(20);
    }

    // Final back to restore unhidden state
    await page.evaluate(() => history.back());

    // Wait for everything to settle
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
    await page.waitForFunction(() => window.explorer.grid.views.length === 3, { timeout: 5000 });

    // Check if view 2 still has its computed data
    const view2After = await page.evaluate(() => {
      const view = window.explorer.grid.views[2];
      if (!view) return { error: 'view 2 is null' };
      return {
        id: view.id,
        computedCount: view.nn.filter(n => n !== 0).length,
        di: view.di,
        hi: view.hi ? view.hi.length : 0
      };
    });

    // View 2 should still have computed pixels (may have more due to continued computation)
    expect(view2After.computedCount).toBeGreaterThanOrEqual(view2Before.computedCount);
    // Histogram should still exist
    expect(view2After.hi).toBeGreaterThan(0);
  }, TEST_TIMEOUT);
});

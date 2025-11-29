/**
 * Integration tests for browser history and navigation
 * Tests pushState/replaceState behavior and view preservation during popstate
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('Browser History Tests', () => {
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

  test('centersWereLost should detect when center points are removed or replaced', async () => {
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Test centersWereLost logic directly (it's now a standalone function)
    const testResults = await page.evaluate(() => {
      return {
        // Same centers - no loss
        sameExact: centersWereLost('-0.5+0i', '-0.5+0i'),
        // Adding centers (zooming deeper) - no loss
        addingCenters: centersWereLost('-0.5+0i', '-0.5+0i,-0.6+0.2i'),
        // Removing centers - loss
        removingCenters: centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i'),
        // Replacing center - loss
        replacingCenter: centersWereLost('-0.5+0i', '-0.7+0.1i'),
        // Empty to something - no loss
        emptyToSomething: centersWereLost('', '-0.5+0i'),
        // Something to empty - loss
        somethingToEmpty: centersWereLost('-0.5+0i', ''),
        // Changing deeper center - loss
        changingDeeper: centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i,-0.7+0.3i'),
      };
    });

    expect(testResults.sameExact).toBe(false);
    expect(testResults.addingCenters).toBe(false);
    expect(testResults.removingCenters).toBe(true);
    expect(testResults.replacingCenter).toBe(true);
    expect(testResults.emptyToSomething).toBe(false);
    expect(testResults.somethingToEmpty).toBe(true);
    expect(testResults.changingDeeper).toBe(true);
  }, TEST_TIMEOUT);

  test('Should use pushState when centers are replaced via updateurl', async () => {
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Get initial history length and current centers from URL
    const { initialLength, currentCenters } = await page.evaluate(() => ({
      initialLength: history.length,
      currentCenters: window.explorer.urlHandler.extractCenters(window.explorer.urlHandler.currenturl())
    }));

    // Initialize lastCenters to match current URL
    await page.evaluate((centers) => {
      window.explorer.urlHandler.lastCenters = centers;
    }, currentCenters);

    // Trigger a URL update - since centers haven't changed, should use replaceState
    await page.evaluate(() => {
      window.explorer.grid.notifyurl();
    });
    await page.waitForTimeout(100);

    const afterSameLength = await page.evaluate(() => history.length);
    // Same centers should NOT push (replaceState)
    expect(afterSameLength).toBe(initialLength);

    // Now simulate that we previously had more centers (user will lose them)
    await page.evaluate((centers) => {
      window.explorer.urlHandler.lastCenters = centers + ',-0.6+0.2i,-0.7+0.3i';
      window.explorer.grid.notifyurl();
    }, currentCenters);
    await page.waitForTimeout(100);

    const afterReplaceLength = await page.evaluate(() => history.length);
    // Removing centers should push to history
    expect(afterReplaceLength).toBeGreaterThan(initialLength);
  }, TEST_TIMEOUT);

  test('handlePopState should preserve unchanged views when navigating back', async () => {
    // Start with default view
    await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(200);

    // Simulate creating 3 views by clicking to zoom
    // We'll manually set up the state to have 3 views
    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const config = window.explorer.config;

      // Create a state with 3 views at specific coordinates
      const state = {
        sizes: [
          [config.firstsize, config.firstr, config.firstj],
          [config.firstsize / config.zoomfactor, [-0.6, 0], [0.2, 0]],
          [config.firstsize / config.zoomfactor / config.zoomfactor, [-0.65, 0], [0.25, 0]]
        ],
        hidden: []
      };
      grid.updateLayout(state);
    });

    // Wait for views to be created
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      window.explorer.grid.views.every(v => v !== null),
      { timeout: 5000 }
    );

    const initialSetup = await page.evaluate(() => {
      window.explorer.urlHandler.updateurl();
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      return {
        viewCount: window.explorer.grid.views.length,
        url: location.search
      };
    });

    expect(initialSetup.viewCount).toBe(3);

    // Now add a 4th view (simulating click on 3rd view)
    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const config = window.explorer.config;

      const state = {
        sizes: [
          [config.firstsize, config.firstr, config.firstj],
          [config.firstsize / config.zoomfactor, [-0.6, 0], [0.2, 0]],
          [config.firstsize / config.zoomfactor / config.zoomfactor, [-0.65, 0], [0.25, 0]],
          [config.firstsize / Math.pow(config.zoomfactor, 3), [-0.66, 0], [0.26, 0]]
        ],
        hidden: []
      };
      grid.updateLayout(state);
    });

    // Wait for 4th view
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 4 &&
      window.explorer.grid.views.every(v => v !== null),
      { timeout: 5000 }
    );

    const afterFourthView = await page.evaluate(() => {
      window.explorer.urlHandler.updateurl();
      return {
        viewCount: window.explorer.grid.views.length,
        historyLength: history.length,
        url: location.search
      };
    });

    expect(afterFourthView.viewCount).toBe(4);

    // Replace 4th view with different coordinates (simulating click elsewhere on 3rd view)
    // This should trigger pushState since centers are being lost
    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const config = window.explorer.config;

      const state = {
        sizes: [
          [config.firstsize, config.firstr, config.firstj],
          [config.firstsize / config.zoomfactor, [-0.6, 0], [0.2, 0]],
          [config.firstsize / config.zoomfactor / config.zoomfactor, [-0.65, 0], [0.25, 0]],
          [config.firstsize / Math.pow(config.zoomfactor, 3), [-0.67, 0], [0.27, 0]]  // Different!
        ],
        hidden: []
      };
      grid.updateLayout(state);
    });

    // Wait for views
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 4 &&
      window.explorer.grid.views.every(v => v !== null),
      { timeout: 5000 }
    );

    const afterReplace = await page.evaluate(() => {
      window.explorer.urlHandler.updateurl();
      // Get view IDs to track which views are preserved
      return {
        viewCount: window.explorer.grid.views.length,
        historyLength: history.length,
        viewIds: window.explorer.grid.views.map(v => v ? v.id : null),
        url: location.search
      };
    });

    expect(afterReplace.viewCount).toBe(4);
    const viewIdsBeforeBack = afterReplace.viewIds;

    // Now trigger popstate (go back)
    await page.evaluate(() => {
      history.back();
    });
    // Wait for popstate to be processed and view coordinates to update
    await page.waitForFunction(() => {
      const v = window.explorer.grid.views[3];
      return v && Math.abs(v.sizes[1][0] - (-0.66)) < 0.01;
    }, { timeout: 5000 });

    // Check that first 3 views were preserved (same IDs) and 4th is new
    const afterBack = await page.evaluate(() => {
      const grid = window.explorer.grid;
      const gridElement = document.getElementById('grid');
      // View wrappers have IDs like 'b_0', 'b_1', etc.
      const viewWrappers = gridElement.querySelectorAll('div[id^="b_"]');
      return {
        viewCount: grid.views.length,
        viewIds: grid.views.map(v => v ? v.id : null),
        viewCoords: grid.views.map(v => v ? { re: v.sizes[1][0], im: v.sizes[2][0] } : null),
        currentUrl: location.search,
        canvasCount: grid.canvascount,
        domViewWrapperCount: viewWrappers.length,
        domViewWrapperIds: Array.from(viewWrappers).map(w => w.id)
      };
    });

    expect(afterBack.viewCount).toBe(4);

    // First 3 views should have same IDs (preserved)
    expect(afterBack.viewIds[0]).toBe(viewIdsBeforeBack[0]);
    expect(afterBack.viewIds[1]).toBe(viewIdsBeforeBack[1]);
    expect(afterBack.viewIds[2]).toBe(viewIdsBeforeBack[2]);

    // 4th view should have different ID (recreated)
    expect(afterBack.viewIds[3]).not.toBe(viewIdsBeforeBack[3]);

    // 4th view should be at the original coordinates (-0.66, 0.26)
    expect(afterBack.viewCoords[3].re).toBeCloseTo(-0.66, 5);
    expect(afterBack.viewCoords[3].im).toBeCloseTo(0.26, 5);

    // DOM should have exactly 4 view wrappers (no extra/leftover)
    expect(afterBack.domViewWrapperCount).toBe(4);
    expect(afterBack.canvasCount).toBe(4);

    // DOM order should be correct (b_0, b_1, b_2, b_3 in that order)
    expect(afterBack.domViewWrapperIds).toEqual(['b_0', 'b_1', 'b_2', 'b_3']);
  }, TEST_TIMEOUT);

  test('handlePopState should restore default theme when going back to URL without theme', async () => {
    // Start with default view (no theme parameter = default 'warm')
    await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(200);

    // Verify starting with default theme
    const initialTheme = await page.evaluate(() => window.explorer.config.theme);
    expect(initialTheme).toBe('warm');

    // Use pushState to add theme=neon to history, then change the theme config
    await page.evaluate(() => {
      // Set up lastCenters for the urlHandler
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      // Push a new history entry with neon theme
      history.pushState(null, '', '?theme=neon');
      // Manually update the theme (simulating what would happen on page load with theme param)
      window.explorer.store.dispatch(window.explorer.store.actions.updateConfig({ theme: 'neon' }));
    });

    // Verify theme changed to neon
    const neonTheme = await page.evaluate(() => window.explorer.config.theme);
    expect(neonTheme).toBe('neon');

    // Now go back - this should trigger popstate and restore the default theme
    await page.evaluate(() => {
      // Update lastCenters for the current state
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      history.back();
    });
    // Wait for theme to be restored
    await page.waitForFunction(() => window.explorer.config.theme === 'warm', { timeout: 5000 });

    // Theme should be restored to default 'warm'
    const restoredTheme = await page.evaluate(() => window.explorer.config.theme);
    expect(restoredTheme).toBe('warm');
  }, TEST_TIMEOUT);
});

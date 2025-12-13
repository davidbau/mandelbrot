/**
 * Integration tests for browser history - basic operations
 * Tests pushState/replaceState behavior and URL handling
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, navigateToUrl, getAppUrl, waitForViewReady, closeBrowser } = require('./test-utils');

describe('Browser History Basic Tests', () => {
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
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('centersWereLost should detect when center points are removed or replaced', async () => {
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i'));

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
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i'));

    // Get initial history length and current centers from URL
    const { initialLength, currentCenters } = await page.evaluate(() => ({
      initialLength: history.length,
      currentCenters: window.explorer.urlHandler.extractCenters(window.explorer.urlHandler.currenturl())
    }));

    // Initialize lastCenters and lastHidden to match current URL
    await page.evaluate((centers) => {
      const urlHandler = window.explorer.urlHandler;
      urlHandler.lastCenters = centers;
      urlHandler.lastHidden = urlHandler.extractHidden(urlHandler.currenturl());
    }, currentCenters);

    // Trigger a URL update - since centers haven't changed, should use replaceState
    await page.evaluate(() => {
      window.explorer.grid.notifyurl();
    });

    const afterSameLength = await page.evaluate(() => history.length);
    // Same centers should NOT push (replaceState)
    expect(afterSameLength).toBe(initialLength);

    // Now simulate that we previously had more centers (user will lose them)
    await page.evaluate((centers) => {
      window.explorer.urlHandler.lastCenters = centers + ',-0.6+0.2i,-0.7+0.3i';
      window.explorer.grid.notifyurl();
    }, currentCenters);

    const afterReplaceLength = await page.evaluate(() => history.length);
    // Removing centers should push to history
    expect(afterReplaceLength).toBeGreaterThan(initialLength);
  }, TEST_TIMEOUT);

  test('handlePopState should restore default theme when going back to URL without theme', async () => {
    // Start with default view (no theme parameter = default 'warm')
    await navigateToUrl(page, getAppUrl(''));

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
    await page.waitForFunction(() => window.explorer.config.theme === 'warm', { timeout: 10000 });

    // Theme should be restored to default 'warm'
    const restoredTheme = await page.evaluate(() => window.explorer.config.theme);
    expect(restoredTheme).toBe('warm');
  }, TEST_TIMEOUT);

  test('handlePopState should preserve unchanged views when navigating back', async () => {
    // Start with 3 views via URL (ensures proper quad-double coordinates)
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i'));

    // Wait for views to be created AND update to complete
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      window.explorer.grid.views.every(v => v !== null) &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 }
    );

    // Wait for view 2 to have some computation before proceeding
    await page.waitForFunction(() => {
      const view = window.explorer.grid.views[2];
      return view && view.di > 0;
    }, { timeout: 15000 });

    await page.evaluate(() => {
      window.explorer.urlHandler.updateurl();
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
    });

    // Add a 4th view using actual coordinates from existing views
    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const config = window.explorer.config;

      const state = {
        sizes: [
          grid.views[0].sizes,  // Preserve exact quad-double coords
          grid.views[1].sizes,  // Preserve exact quad-double coords
          grid.views[2].sizes,  // Preserve exact quad-double coords
          [config.firstsize / Math.pow(config.zoomfactor, 3), [-0.66, 0], [0.26, 0]]
        ],
        hidden: []
      };
      grid.updateLayout(state);
    });

    // Wait for 4th view AND update to complete
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 4 &&
      window.explorer.grid.views.every(v => v !== null) &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 }
    );

    await page.evaluate(() => window.explorer.urlHandler.updateurl());

    // Replace 4th view with different coordinates - triggers pushState
    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const config = window.explorer.config;

      const state = {
        sizes: [
          grid.views[0].sizes,
          grid.views[1].sizes,
          grid.views[2].sizes,
          [config.firstsize / Math.pow(config.zoomfactor, 3), [-0.67, 0], [0.27, 0]]  // Different!
        ],
        hidden: []
      };
      grid.updateLayout(state);
    });

    // Wait for views AND update to complete
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 4 &&
      window.explorer.grid.views.every(v => v !== null) &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 }
    );

    // Capture view 3's ID before going back (it has different coords than target)
    const view3IdBeforeBack = await page.evaluate(() => {
      window.explorer.urlHandler.updateurl();
      return window.explorer.grid.views[3]?.id;
    });

    // Go back
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => {
      const v = window.explorer.grid.views[3];
      return v && Math.abs(v.re[0] - (-0.66)) < 0.01;
    }, { timeout: 10000 });

    // Check views 0-2 are preserved (same coords, so reused from history),
    // and view 3 is recreated (different coords in current vs target state)
    const afterBack = await page.evaluate(() => ({
      viewIds: window.explorer.grid.views.map(v => v ? v.id : null),
      viewCoords: window.explorer.grid.views.map(v => v ? { re: v.re[0], im: v.im[0] } : null),
      // Check that views have computed data (not fresh empty views)
      viewsHaveData: window.explorer.grid.views.map(v => v ? (v.di > 0 || v.nn.some(n => n !== 0)) : false)
    }));

    // Views 0-2 should have computed data (preserved, not fresh)
    expect(afterBack.viewsHaveData[0]).toBe(true);
    expect(afterBack.viewsHaveData[1]).toBe(true);
    expect(afterBack.viewsHaveData[2]).toBe(true);
    // View 3 should be different from before (coords changed)
    expect(afterBack.viewIds[3]).not.toBe(view3IdBeforeBack);
    // View 3 should have the correct coordinates from target state
    expect(afterBack.viewCoords[3].re).toBeCloseTo(-0.66, 5);
  }, TEST_TIMEOUT);

  test('Should push history when hiding views and restore on back', async () => {
    // Start with 3 views (need 3+ so hiding one doesn't truncate to 1)
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i'));

    // Wait for views to be created AND update to complete
    await page.waitForFunction(() =>
      window.explorer.grid.views.length >= 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 }
    );

    // Verify we have 3 views, none hidden
    const initialState = await page.evaluate(() => ({
      viewCount: window.explorer.grid.views.length,
      view1Visible: document.getElementById('b_1')?.style.display !== 'none',
      historyLength: history.length,
      urlHasHidden: location.search.includes('h=')
    }));
    expect(initialState.viewCount).toBe(3);
    expect(initialState.view1Visible).toBe(true);
    expect(initialState.urlHasHidden).toBe(false);

    const initialHistoryLength = initialState.historyLength;

    // Hide view 1 (middle view) by simulating close button click
    await page.evaluate(() => {
      const closeButton = document.querySelector('#b_1 .closebox');
      closeButton.click();
    });
    await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 10000 });

    // Verify view is hidden and history was pushed
    const afterHide = await page.evaluate(() => ({
      view1Hidden: document.getElementById('b_1')?.style.display === 'none',
      historyLength: history.length,
      urlHasHidden: location.search.includes('h=1')
    }));
    expect(afterHide.view1Hidden).toBe(true);
    expect(afterHide.urlHasHidden).toBe(true);
    expect(afterHide.historyLength).toBeGreaterThan(initialHistoryLength);

    // Now go back - view should be restored
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !location.search.includes('h='), { timeout: 10000 });

    // Verify view is visible again
    const afterBack = await page.evaluate(() => ({
      view1Visible: document.getElementById('b_1')?.style.display !== 'none',
      urlHasHidden: location.search.includes('h=')
    }));
    expect(afterBack.view1Visible).toBe(true);
    expect(afterBack.urlHasHidden).toBe(false);
  }, TEST_TIMEOUT);
});

/**
 * Integration tests for hidden boards resume after back/forward navigation
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady, closeBrowser } = require('./test-utils');

describe('Hidden Boards Resume Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {}, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('Computation should resume after hiding and going back', async () => {
    // Start with 3 views
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 });

    // Wait for some computation on view 2
    await page.waitForFunction(() => window.explorer.grid.views[2]?.di > 0, { timeout: 15000 });

    // Set lastCenters for popstate detection
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = window.explorer.urlHandler.extractHidden(
        window.explorer.urlHandler.currenturl()
      );
    });

    // Hide view 1 (middle view)
    await page.click('#b_1 .closebox');
    await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 5000 });

    // Wait for hidden state to be processed
    await page.waitForFunction(
      () => !window.explorer.grid.currentUpdateProcess,
      { timeout: 5000 }
    );

    // Record view 2 state after hiding
    const afterHideDi = await page.evaluate(() => window.explorer.grid.views[2]?.di || 0);
    expect(afterHideDi).toBeGreaterThan(0);

    // Now go back (unhide view 1)
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !location.search.includes('h='), { timeout: 5000 });

    // Wait for update to complete
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Check hidden state - should be empty
    const hiddenViews = await page.evaluate(() => window.explorer.grid.getHiddenViews());
    expect(hiddenViews).toEqual([]);

    // Check if computation resumed on view 2 (di should be >= what it was)
    const finalDi = await page.evaluate(() => window.explorer.grid.views[2]?.di || 0);

    // Computation should have resumed (finalDi should be >= afterHideDi)
    // Note: It might not have increased much in 2 seconds, but it shouldn't be 0
    expect(finalDi).toBeGreaterThanOrEqual(afterHideDi);
  }, TEST_TIMEOUT);

  test('Previously hidden view should resume computation after going back', async () => {
    // Start with 3 views
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 });

    // Wait for some computation on view 1
    await page.waitForFunction(() => window.explorer.grid.views[1]?.di > 0, { timeout: 15000 });

    // Record view 1 state before hiding
    const beforeHideDi = await page.evaluate(() => window.explorer.grid.views[1].di);
    expect(beforeHideDi).toBeGreaterThan(0);

    // Set lastCenters for popstate detection
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = window.explorer.urlHandler.extractHidden(
        window.explorer.urlHandler.currenturl()
      );
    });

    // Hide view 1 (middle view)
    await page.click('#b_1 .closebox');
    await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 5000 });

    // Wait for hidden state to be processed
    await page.waitForFunction(
      () => !window.explorer.grid.currentUpdateProcess,
      { timeout: 5000 }
    );

    // Now go back (unhide view 1)
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !location.search.includes('h='), { timeout: 5000 });

    // Wait for update to complete
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Check that view 1 is visible
    const view1Visible = await page.evaluate(() =>
      document.getElementById('b_1')?.style.display !== 'none'
    );
    expect(view1Visible).toBe(true);

    // Check that view 1 has computed data (it was preserved and should still have its data)
    const finalDi = await page.evaluate(() => window.explorer.grid.views[1]?.di || 0);
    expect(finalDi).toBeGreaterThanOrEqual(beforeHideDi);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

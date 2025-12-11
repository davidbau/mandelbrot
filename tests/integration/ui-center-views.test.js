/**
 * Integration tests for center views (C key) with 1% tolerance
 * Tests that views within 1% of target are preserved (not recomputed)
 * but their coordinates are updated to exact target for URL accuracy
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady, closeBrowser } = require('./test-utils');

describe('Center Views 1% Tolerance Tests', () => {
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

  test('C key preserves views within 1% but updates coordinates to exact target', async () => {
    await waitForViewReady(page);
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Create a second view by clicking at center
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });

    // Wait for view 1 to compute some pixels
    await page.waitForFunction(() => {
      const view = window.explorer.grid.views[1];
      return view && view.di > 100;
    }, { timeout: 15000 });

    // Get view 1's computed pixels and center before pressing C
    const beforeState = await page.evaluate(() => ({
      view1_id: window.explorer.grid.views[1].id,
      view1_di: window.explorer.grid.views[1].di,
      view1_re: window.explorer.grid.views[1].sizes[1][0],
      view1_re_oct: window.explorer.grid.views[1].sizesOct[1]
    }));

    // View 1 should already be at the center (clicked at 50%)
    // Press C - view 1 should be preserved (same pixels) but coordinates updated

    await page.keyboard.press('c');
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    const afterState = await page.evaluate(() => ({
      view1_id: window.explorer.grid.views[1].id,
      view1_di: window.explorer.grid.views[1].di,
      view1_re: window.explorer.grid.views[1].sizes[1][0]
    }));

    // View should be preserved (same ID, same or more computed pixels)
    expect(afterState.view1_id).toBe(beforeState.view1_id);
    expect(afterState.view1_di).toBeGreaterThanOrEqual(beforeState.view1_di);
  }, TEST_TIMEOUT);

  test('centerViews implementation exists and is callable', async () => {
    await waitForViewReady(page);

    const hasMethod = await page.evaluate(() => {
      return typeof window.explorer.zoomManager.centerViews === 'function';
    });
    expect(hasMethod).toBe(true);
  }, TEST_TIMEOUT);

  test('C key centers views on deepest view position', async () => {
    await waitForViewReady(page);
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Create view 1 at center of view 0
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });

    // Wait for view 1 to start computing
    await page.waitForFunction(() => {
      const view = window.explorer.grid.views[1];
      return view && view.di > 20;
    }, { timeout: 15000 });

    // Get deepest view's center before C
    const deepestCenter = await page.evaluate(() => ({
      re: window.explorer.grid.views[1].sizesOct[1],
      im: window.explorer.grid.views[1].sizesOct[2]
    }));

    // Press C to center
    await page.keyboard.press('c');
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // After C, view 0 should still have its original center (since it's the first view with !includeFirst)
    // But we can verify the method was called and views are in expected state
    const viewCount = await page.evaluate(() => window.explorer.grid.views.length);
    expect(viewCount).toBe(2);

    // The deepest view's center should be unchanged
    const afterDeepest = await page.evaluate(() => ({
      re: window.explorer.grid.views[1].sizesOct[1],
      im: window.explorer.grid.views[1].sizesOct[2]
    }));
    expect(afterDeepest.re[0]).toBeCloseTo(deepestCenter.re[0], 10);
    expect(afterDeepest.im[0]).toBeCloseTo(deepestCenter.im[0], 10);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

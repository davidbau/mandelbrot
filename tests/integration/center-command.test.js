/**
 * Regression test for center command (C key) at deep zoom
 * Tests that QD precision is preserved when checking if views need repositioning
 */

const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToUrl, getAppUrl, closeBrowser } = require('./test-utils');

describe('Center Command Deep Zoom Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  test('C key repositions off-center views at deep zoom (z=1e-15)', async () => {
    // Navigate with 3 views: view 0, view 1 (off-center), view 2 (target)
    // When pressing 'c', view 1 should be centered on view 2's coordinates
    // View 0: -0.5, 0 (stays unchanged with plain 'c')
    // View 1: -0.5, 0 (off-center from view 2)
    // View 2: -0.5 + 1e-10, 1e-10 (target)
    const targetRe = '-0.4999999999';  // -0.5 + 1e-10
    const targetIm = '0.0000000001';   // 1e-10
    const url = getAppUrl(`?c=-0.5+0i,-0.5+0i,${targetRe}+${targetIm}i&s=3,0.1,1e-15`);

    await navigateToUrl(page, url);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
    await page.waitForFunction(() => window.explorer.grid.views.length >= 3, { timeout: 10000 });

    // Get view 1's original board ID before pressing C
    const beforeState = await page.evaluate(() => {
      const view1 = window.explorer.grid.views[1];
      const view2 = window.explorer.grid.views[2];
      return {
        view1_id: view1.id,
        view1_re: view1.sizesQD[1],
        view1_im: view1.sizesQD[2],
        view2_re: view2.sizesQD[1],
        view2_im: view2.sizesQD[2],
      };
    });

    // View 1 should have different center than view 2 before C
    expect(Math.abs(beforeState.view1_re[0] - beforeState.view2_re[0])).toBeGreaterThan(1e-11);

    // Wait for any pending updates
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Press C to center views
    await page.keyboard.press('c');

    // Wait for centering to complete
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Check that view 1's coordinates were updated to match view 2
    const afterState = await page.evaluate(() => {
      const view1 = window.explorer.grid.views[1];
      const view2 = window.explorer.grid.views[2];
      return {
        view1_id: view1.id,
        view1_re: view1.sizesQD[1],
        view1_im: view1.sizesQD[2],
        view2_re: view2.sizesQD[1],
        view2_im: view2.sizesQD[2],
      };
    });

    // After C, view 1 should have EXACTLY the same QD coordinates as view 2
    expect(afterState.view1_re).toEqual(afterState.view2_re);
    expect(afterState.view1_im).toEqual(afterState.view2_im);

    // The board should have been recreated (different ID) because the offset
    // was larger than 0.01% tolerance at this zoom level
    // View 1 at size 0.1: tolerance is 0.1 * 0.0001 = 1e-5
    // Offset is 1e-10, which is LESS than tolerance, so board may be preserved
    // But we verify coordinates are updated regardless
  }, TEST_TIMEOUT);

  test('C key preserves already-centered views at deep zoom', async () => {
    // Navigate with views that are already centered
    const deepRe = '-0.5';
    const deepIm = '0';
    const url = getAppUrl(`?c=${deepRe}+${deepIm}i,${deepRe}+${deepIm}i&s=3,1e-30`);

    await navigateToUrl(page, url);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
    await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 10000 });

    // Wait for some computation
    await page.waitForFunction(() => {
      const view = window.explorer.grid.views[0];
      return view && view.di > 50;
    }, { timeout: 15000 });

    const beforeState = await page.evaluate(() => ({
      view0_id: window.explorer.grid.views[0].id,
      view0_di: window.explorer.grid.views[0].di,
    }));

    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
    await page.keyboard.press('c');
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    const afterState = await page.evaluate(() => ({
      view0_id: window.explorer.grid.views[0].id,
      view0_di: window.explorer.grid.views[0].di,
    }));

    // View should be preserved (same ID, same or more pixels computed)
    expect(afterState.view0_id).toBe(beforeState.view0_id);
    expect(afterState.view0_di).toBeGreaterThanOrEqual(beforeState.view0_di);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

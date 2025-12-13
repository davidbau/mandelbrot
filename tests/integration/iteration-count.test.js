/**
 * Tests that iteration counts (nn values) match between CpuBoard and ZhuoranBoard.
 * This verifies that perturbation-based boards report the same escape iteration
 * as the reference CpuBoard implementation.
 */

const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToUrl, getAppUrl, closeBrowser } = require('./test-utils');

describe('Iteration count consistency', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {}, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  test('ZhuoranBoard iteration counts match CpuBoard', async () => {
    // Test CpuBoard
    await navigateToUrl(page, getAppUrl('?a=16:9&board=cpu'));
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));

    const cpuData = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const samples = [];
      // Sample diverged pixels from different areas
      for (let x = 600; x < 700; x += 10) {
        const nn = view.nn[120 * view.config.dimsWidth + x];
        if (nn > 0) samples.push({ x, nn });
      }
      return { di: view.di, samples };
    });

    // Test ZhuoranBoard
    await navigateToUrl(page, getAppUrl('?a=16:9&board=zhuoran'));
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));

    const zhuoranData = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const samples = [];
      for (let x = 600; x < 700; x += 10) {
        const nn = view.nn[120 * view.config.dimsWidth + x];
        if (nn > 0) samples.push({ x, nn });
      }
      return { di: view.di, samples };
    });

    // Both boards should have significant divergence
    expect(cpuData.di).toBeGreaterThan(200000);
    expect(zhuoranData.di).toBeGreaterThan(200000);

    // Extract just the nn values for comparison
    const cpuNN = cpuData.samples.map(s => s.nn);
    const zhuoranNN = zhuoranData.samples.map(s => s.nn);

    // Should have same number of samples
    expect(zhuoranNN.length).toBe(cpuNN.length);

    // Iteration counts should match exactly
    expect(zhuoranNN).toEqual(cpuNN);
  }, TEST_TIMEOUT);
});

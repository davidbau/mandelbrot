/**
 * Integration tests for GPU results readback pipeline.
 * Verifies that GPU boards report readback activity and progress.
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

describe('GPU results readback', () => {
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

  const boards = [
    { key: 'gpu', name: 'GpuBoard' },
    { key: 'gpuz', name: 'GpuZhuoranBoard' },
    { key: 'gpua', name: 'GpuAdaptiveBoard' }
  ];

  test.each(boards)('readback activity for %s', async ({ key, name }) => {
    const cwd = process.cwd();
    const url = `file://${path.join(cwd, 'index.html')}?` +
      `z=3.13e3&c=-0.75+0.025i&board=${key}&grid=20&subpixel=1&maxiter=500&gpu=1`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(
      (expected) => window.explorer?.grid?.views?.[0]?.boardType === expected,
      { timeout: 10000 },
      name
    );

    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view &&
        (view.resultsReadbackBatches || 0) > 0 &&
        view.un < view.nn.length;
    }, { timeout: 20000 });

    const stats = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      return {
        batches: view.resultsReadbackBatches || 0,
        bytes: view.resultsReadbackBytes || 0,
        un: view.un,
        total: view.nn.length
      };
    });

    expect(stats.batches).toBeGreaterThan(0);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.un).toBeLessThan(stats.total);
  }, 30000);
});

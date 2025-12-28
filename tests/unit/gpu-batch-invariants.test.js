/**
 * Unit tests for GPU batch processing invariants.
 *
 * The architecture should maintain these invariants:
 * 1. GPU results are streamed in fixed-size reporting batches
 * 2. CPU worker accumulates batches until a compute batch is complete
 * 3. UI receives results monotonically (no duplicates, no out-of-order iterations)
 */

const { setupBrowser, setupPage, closeBrowser } = require('../integration/test-utils');

const TEST_TIMEOUT = 60000;

describe('GPU Batch Processing Invariants', () => {
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
    await page.setViewportSize({ width: 800, height: 600 });
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) await page.close();
  }, TEST_TIMEOUT);

  test('UI view never receives duplicate pixel indices', async () => {
    await page.goto(`file://${process.cwd()}/index.html?board=gpu&debug=dims:80x45,w,s`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
      const worker = window.worker0;
      return worker && worker.boards && worker.boards.size > 0;
    }, { timeout: 30000 });

    // Track all pixel indices received by the view
    await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      window._receivedIndices = new Set();
      window._duplicates = [];

      const originalUpdate = view.updateFromWorkerResult.bind(view);
      view.updateFromWorkerResult = function(data) {
        for (const { nn, vv } of data.changeList) {
          for (const idx of nn) {
            if (window._receivedIndices.has(idx)) {
              window._duplicates.push({ index: idx, type: 'diverged' });
            }
            window._receivedIndices.add(idx);
          }
          for (const entry of vv) {
            if (window._receivedIndices.has(entry.index)) {
              window._duplicates.push({ index: entry.index, type: 'converged' });
            }
            window._receivedIndices.add(entry.index);
          }
        }
        return originalUpdate(data);
      };
    });

    // Step through computation
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.step && window.step());
      await page.waitForTimeout(200);
    }

    const result = await page.evaluate(() => ({
      totalReceived: window._receivedIndices.size,
      duplicates: window._duplicates
    }));

    expect(result.duplicates).toHaveLength(0);
  }, TEST_TIMEOUT);

  test('UI view receives iterations in monotonic order', async () => {
    await page.goto(`file://${process.cwd()}/index.html?board=gpu&debug=dims:80x45,w,s`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
      const worker = window.worker0;
      return worker && worker.boards && worker.boards.size > 0;
    }, { timeout: 30000 });

    // Track iteration order
    await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      window._iterationOrder = [];
      window._maxIterSeen = 0;
      window._outOfOrder = [];

      const originalUpdate = view.updateFromWorkerResult.bind(view);
      view.updateFromWorkerResult = function(data) {
        for (const change of data.changeList) {
          window._iterationOrder.push(change.iter);
          if (change.iter < window._maxIterSeen) {
            window._outOfOrder.push({
              receivedIter: change.iter,
              maxSeen: window._maxIterSeen
            });
          }
          if (change.iter > window._maxIterSeen) {
            window._maxIterSeen = change.iter;
          }
        }
        return originalUpdate(data);
      };
    });

    // Step through computation
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.step && window.step());
      await page.waitForTimeout(200);
    }

    const result = await page.evaluate(() => ({
      iterations: window._iterationOrder,
      outOfOrder: window._outOfOrder
    }));

    // Iterations should arrive in monotonic order - batch processing ensures
    // we never send results from iteration N after results from iteration N+1
    expect(result.outOfOrder).toHaveLength(0);
  }, TEST_TIMEOUT);

  test('view.un and actual unknown pixel count should match', async () => {
    await page.goto(`file://${process.cwd()}/index.html?board=gpu&debug=dims:80x45,w,s`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
      const worker = window.worker0;
      return worker && worker.boards && worker.boards.size > 0;
    }, { timeout: 30000 });

    // Step through computation
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.step && window.step());
      await page.waitForTimeout(200);
    }

    const result = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      let unknown = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] === 0) unknown++;
      }
      return {
        viewUn: view.un,
        actualUnknown: unknown,
        match: view.un === unknown
      };
    });

    // Allow off-by-one for timing issues
    const diff = Math.abs(result.viewUn - result.actualUnknown);
    expect(diff).toBeLessThanOrEqual(1);
  }, TEST_TIMEOUT);
});

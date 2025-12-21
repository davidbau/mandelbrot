/**
 * Test that AdaptiveGpuBoard correctly rebases when the orbit passes near zero.
 *
 * This test catches a bug where AdaptiveGpuBoard had an extra guard condition
 * `z_norm > 1e-13` that prevented rebasing when z was very small. This caused
 * catastrophic false divergence around iteration 9997 at z=1e29 zoom.
 *
 * The fix was to remove the guard, matching ScaledGpuZhuoranBoard's behavior.
 */

const puppeteer = require('puppeteer');
const path = require('path');

const TEST_TIMEOUT = 60000;

describe('AdaptiveGpuBoard rebase behavior', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) {
      // Terminate all workers before closing browser to prevent exit warnings
      for (const page of await browser.pages()) {
        try {
          await page.evaluate(() => {
            if (window.worker0) window.worker0.terminate?.();
          });
        } catch (e) { /* page may already be closed */ }
      }
      await browser.close();
    }
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 320, height: 180 });  // Small viewport for speed
  });

  afterEach(async () => {
    if (page) {
      try {
        await page.evaluate(() => {
          if (window.worker0) window.worker0.terminate?.();
        });
      } catch (e) { /* ignore */ }
      await page.close();
    }
  });

  test('AdaptiveGpuBoard rebases correctly when orbit passes near zero', async () => {
    // This location at z=1e29 causes the reference orbit to pass near zero
    // around iteration 1236. Both boards should rebase at that point.
    const params = new URLSearchParams({
      z: '1e29',
      c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
      a: '16:9',
      grid: '40',  // Larger grid = fewer pixels for speed
      pixelratio: '1',
      board: 'adaptive',
      debug: 'w,s,fastload'  // MockWorker + step mode + fast view loading
    });

    const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;
    await page.goto(url, { waitUntil: 'load' });

    // Wait for board to be created
    await page.waitForFunction(() => window.worker0?.boards?.size > 0, { timeout: 10000 });

    // Step to iteration 1300 (past the rebase point at ~1237)
    await page.evaluate(() => step(1300));
    await page.waitForFunction(() => window.worker0.stepsRequested === 0, { timeout: 20000 });

    // Check pixel 0's refiter - it should have rebased (refiter < 300, not ~1300)
    const state = await page.evaluate(async () => {
      const board = Array.from(window.worker0.boards.values())[0];
      const data = await board.readBuffer(board.buffers.pixels, Uint8Array);
      const pixelU32 = new Uint32Array(data.buffer, 0, 15);

      return {
        iter: board.it,
        refiter: pixelU32[4],  // ref_iter is at offset 4 in the pixel struct
        nn: board.nn[0]
      };
    });

    // After 1300 iterations, refiter should be much lower due to rebasing
    // Without the fix, refiter would be ~1300 (no rebase)
    // With the fix, refiter should be < 300 (rebased around iter 1237)
    expect(state.refiter).toBeLessThan(300);
    expect(state.nn).toBe(0);  // Should not have diverged
  }, TEST_TIMEOUT);

  test('AdaptiveGpuBoard matches QDZ refiter sequence', async () => {
    // Collect refiter sequence for both boards and verify they match
    async function collectRefiterSequence(boardType) {
      const testPage = await browser.newPage();
      await testPage.setViewport({ width: 320, height: 180 });

      const params = new URLSearchParams({
        z: '1e29',
        c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
        a: '16:9',
        grid: '40',
        pixelratio: '1',
        board: boardType,
        debug: 'w,s,fastload'  // MockWorker + step mode + fast view loading
      });

      const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;
      await testPage.goto(url, { waitUntil: 'load' });
      await testPage.waitForFunction(() => window.worker0?.boards?.size > 0, { timeout: 10000 });

      // Step without callback, then read final state and find rebase iteration
      const TARGET_ITERS = 1500;
      await testPage.evaluate((target) => step(target), TARGET_ITERS);
      await testPage.waitForFunction(() => window.worker0.stepsRequested === 0, { timeout: 30000 });

      // Get the board's current refiter and check for rebase
      const result = await testPage.evaluate(async () => {
        const board = Array.from(window.worker0.boards.values())[0];
        const isAdaptive = board.constructor.name === 'AdaptiveGpuBoard';
        let refiter;
        if (isAdaptive) {
          const data = await board.readBuffer(board.buffers.pixels, Uint8Array);
          const view = new Int32Array(data.buffer, 0, 15);
          refiter = view[4];
        } else {
          refiter = board.refIter?.[0] || board.it;
        }
        return { iter: board.it, refiter, nn: board.nn[0] };
      });

      await testPage.evaluate(() => {
        if (window.worker0) window.worker0.terminate?.();
      });
      await testPage.close();
      return result;
    }

    // Run both boards in parallel
    const [adaptiveResult, qdzResult] = await Promise.all([
      collectRefiterSequence('adaptive'),
      collectRefiterSequence('qdz')
    ]);

    // Both should have rebased - refiter should be much less than iterations
    // The rebase happens around iter 1237, so refiter should be < 300
    expect(adaptiveResult.refiter).toBeLessThan(300);
    expect(qdzResult.refiter).toBeLessThan(300);

    // Both should reach same iteration count
    expect(adaptiveResult.iter).toBeGreaterThanOrEqual(1500);
    expect(qdzResult.iter).toBeGreaterThanOrEqual(1500);

    // Neither should have diverged
    expect(adaptiveResult.nn).toBe(0);
    expect(qdzResult.nn).toBe(0);

    // Refiter values should be close (within 10 iterations of each other)
    expect(Math.abs(adaptiveResult.refiter - qdzResult.refiter)).toBeLessThan(10);
  }, TEST_TIMEOUT);
});

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
      debug: 'w,s'  // MockWorker + step mode
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
        debug: 'w,s'
      });

      const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;
      await testPage.goto(url, { waitUntil: 'load' });
      await testPage.waitForFunction(() => window.worker0?.boards?.size > 0, { timeout: 10000 });

      // Set up callback to collect refiter values
      await testPage.evaluate(() => {
        window.refiterSequence = [];
      });

      // Step to 1500, collecting refiter at each step
      await testPage.evaluate(() => {
        step(1500, async () => {
          const board = Array.from(window.worker0.boards.values())[0];
          // For QDZ: read from pixel state buffer, refiter is at u32[3]
          // For Adaptive: refiter is at i32[4]
          const isAdaptive = board.constructor.name === 'AdaptiveGpuBoard';
          if (isAdaptive) {
            const data = await board.readBuffer(board.buffers.pixels, Uint8Array);
            const view = new Int32Array(data.buffer, 0, 15);
            window.refiterSequence.push(view[4]);  // ref_iter at offset 4
          } else {
            // QDZ uses refIter array directly
            window.refiterSequence.push(board.refIter?.[0] || board.it);
          }
        });
      });
      await testPage.waitForFunction(() => window.worker0.stepsRequested === 0, { timeout: 30000 });

      const sequence = await testPage.evaluate(() => window.refiterSequence);

      await testPage.evaluate(() => {
        if (window.worker0) window.worker0.terminate?.();
      });
      await testPage.close();
      return sequence;
    }

    // Run both boards in parallel
    const [adaptiveSeq, qdzSeq] = await Promise.all([
      collectRefiterSequence('adaptive'),
      collectRefiterSequence('qdz')
    ]);

    // Both sequences should be identical - same rebasing behavior
    expect(adaptiveSeq.length).toBe(qdzSeq.length);
    // Check that refiter drops (rebases) at the same iteration for both
    expect(adaptiveSeq).toEqual(qdzSeq);
  }, TEST_TIMEOUT);
});

/**
 * Integration tests for GpuAdaptiveBoard
 * Tests adaptive per-pixel scaling for deep zoom GPU perturbation.
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

describe('GpuAdaptiveBoard', () => {
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

  async function runBoard(boardType, zoom, c, maxiter = 200) {
    const cwd = process.cwd();
    // Use grid=20 and subpixel=1 for fast tests
    const url = `file://${path.join(cwd, 'index.html')}?z=${zoom}&c=${c}&board=${boardType}&grid=20&subpixel=1&maxiter=${maxiter}`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

    // Wait for completion
    await page.waitForFunction(
      () => {
        const view = window.explorer?.grid?.views?.[0];
        return view && view.un === 0;
      },
      { timeout: 30000 }
    );

    return await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = Array.from(view.nn);
      let diverged = 0, converged = 0;
      for (const v of nn) {
        if (v > 0) diverged++;
        else if (v < 0) converged++;
      }
      return { nn, diverged, converged, total: nn.length, boardType: view.boardType };
    });
  }

  function compareIterations(nn1, nn2) {
    let exact = 0, within5 = 0, divergedBoth = 0;
    for (let i = 0; i < nn1.length; i++) {
      if (nn1[i] > 0 && nn2[i] > 0) {
        divergedBoth++;
        if (nn1[i] === nn2[i]) exact++;
        if (Math.abs(nn1[i] - nn2[i]) <= 5) within5++;
      }
    }
    return {
      exactRate: divergedBoth > 0 ? exact / divergedBoth : 0,
      within5Rate: divergedBoth > 0 ? within5 / divergedBoth : 0,
      divergedBoth
    };
  }

  const TEST_CENTER = '-0.74543+0.11301i';

  test('at z=1e20, should match QDZhuoranBoard >95%', async () => {
    const octResult = await runBoard('qdz', '1e20', TEST_CENTER, 200);
    expect(octResult.diverged).toBeGreaterThan(0);

    await page.close();
    page = await browser.newPage();

    const adaptiveResult = await runBoard('gpua', '1e20', TEST_CENTER, 200);
    const comparison = compareIterations(adaptiveResult.nn, octResult.nn);
    expect(comparison.within5Rate).toBeGreaterThan(0.95);
  }, 30000);

  test('should be selectable via board=gpua', async () => {
    const cwd = process.cwd();
    const url = `file://${path.join(cwd, 'index.html')}?z=1e20&c=${TEST_CENTER}&board=gpua&grid=20&subpixel=1`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 500));

    const boardType = await page.evaluate(() => window.explorer?.grid?.views?.[0]?.boardType);
    expect(boardType).toBe('GpuAdaptiveBoard');
  }, 15000);

  test('convergence detection at z=5', async () => {
    const CONVERGENT_CENTER = '+0.1972+0.5798i';

    const gpuResult = await runBoard('gpuz', '5', CONVERGENT_CENTER, 500);
    expect(gpuResult.converged).toBeGreaterThan(0);

    await page.close();
    page = await browser.newPage();

    const adaptiveResult = await runBoard('gpua', '5', CONVERGENT_CENTER, 500);
    // Expect reasonable convergence detection
    expect(adaptiveResult.converged).toBeGreaterThan(gpuResult.converged * 0.5);
  }, 60000);

  test('no trapezoid bug at z=5e29 (rebasing threshold)', async () => {
    // This test verifies the fix for the "trapezoid bug" where rebasing at
    // very small z values caused pixels to get stuck with incorrect iteration
    // counts. The fix adds a minimum z threshold (1e-13) to skip rebasing
    // when z² would underflow or produce unrecoverable tiny values.
    //
    // Location chosen because it exhibits the bug when threshold is too low.
    const TRAPEZOID_CENTER = '-0.53040750060512211537022930878823+0.67082992953379211136335172587405i';
    const TRAPEZOID_ZOOM = '5.00e+29';

    // Set viewport to match the test parameters (256x144 at 16:9)
    await page.setViewport({ width: 256, height: 144 });

    // Run gpuz as reference (doesn't have the bug)
    const cwd = process.cwd();
    const gpuUrl = `file://${path.join(cwd, 'index.html')}?z=${TRAPEZOID_ZOOM}&c=${TRAPEZOID_CENTER}&board=gpuz&grid=1&maxiter=3000&width=256&height=144&a=16:9&pixelratio=1`;

    await page.goto(gpuUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const view = window.explorer?.grid?.views?.[0];
        return view && view.un === 0;
      },
      { timeout: 60000 }
    );

    const gpuResult = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      return { nn: Array.from(view.nn) };
    });

    await page.close();
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await page.setViewport({ width: 256, height: 144 });

    // Run adaptive board
    const adaptiveUrl = `file://${path.join(cwd, 'index.html')}?z=${TRAPEZOID_ZOOM}&c=${TRAPEZOID_CENTER}&board=gpua&grid=1&maxiter=3000&width=256&height=144&a=16:9&pixelratio=1`;

    await page.goto(adaptiveUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const view = window.explorer?.grid?.views?.[0];
        return view && view.un === 0;
      },
      { timeout: 60000 }
    );

    const adaptiveResult = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      return { nn: Array.from(view.nn) };
    });

    // Count pixels with large iteration differences (>300 = trapezoid bug)
    let trapezoidPixels = 0;
    for (let i = 0; i < gpuResult.nn.length; i++) {
      if (gpuResult.nn[i] > 0 && adaptiveResult.nn[i] > 0) {
        const diff = Math.abs(adaptiveResult.nn[i] - gpuResult.nn[i]);
        if (diff > 300) {
          trapezoidPixels++;
        }
      }
    }

    // With the 1e-13 threshold fix, we should have very few trapezoid pixels
    // (typically 4 or fewer, which are f32 boundary noise, not the systematic bug)
    expect(trapezoidPixels).toBeLessThan(10);
  }, 90000);
});

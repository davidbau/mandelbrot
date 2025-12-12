/**
 * Integration tests for AdaptiveGpuBoard
 *
 * Tests adaptive per-pixel scaling for deep zoom GPU perturbation.
 * Compares results against OctZhuoranBoard (CPU reference) at extreme zoom levels.
 */

const puppeteer = require('puppeteer');
const path = require('path');

const TEST_TIMEOUT = 120000; // 2 minutes for deep zoom tests

describe('AdaptiveGpuBoard', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  /**
   * Helper to run a board and get iteration results
   */
  async function runBoard(boardType, zoom, c, maxiter = 500, width = 64, height = 64) {
    const cwd = process.cwd();
    const url = `file://${path.join(cwd, 'index.html')}?z=${zoom}&c=${c}&board=${boardType}&grid=1&maxiter=${maxiter}&width=${width}&height=${height}`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });

    // Wait for computation to complete
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;
    }, { timeout: 90000 });

    const result = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = Array.from(view.nn); // Copy iteration counts

      let diverged = 0, converged = 0, maxIter = 0;
      for (let i = 0; i < nn.length; i++) {
        if (nn[i] > 0) {
          diverged++;
          maxIter = Math.max(maxIter, nn[i]);
        } else if (nn[i] < 0) {
          converged++;
        }
      }

      return {
        boardType: view.boardType,
        nn,
        diverged,
        converged,
        maxIter,
        total: view.config.dimsArea,
        it: view.it
      };
    });

    return result;
  }

  /**
   * Compare two iteration arrays and compute match statistics
   */
  function compareIterations(nn1, nn2) {
    let exact = 0;
    let within1 = 0;
    let within5 = 0;
    let divergedBoth = 0;
    let diverged1Only = 0;
    let diverged2Only = 0;

    for (let i = 0; i < nn1.length; i++) {
      const v1 = nn1[i];
      const v2 = nn2[i];

      if (v1 > 0 && v2 > 0) {
        divergedBoth++;
        if (v1 === v2) exact++;
        if (Math.abs(v1 - v2) <= 1) within1++;
        if (Math.abs(v1 - v2) <= 5) within5++;
      } else if (v1 > 0) {
        diverged1Only++;
      } else if (v2 > 0) {
        diverged2Only++;
      }
    }

    return {
      exact,
      within1,
      within5,
      divergedBoth,
      diverged1Only,
      diverged2Only,
      total: nn1.length,
      exactRate: divergedBoth > 0 ? exact / divergedBoth : 0,
      within1Rate: divergedBoth > 0 ? within1 / divergedBoth : 0,
      within5Rate: divergedBoth > 0 ? within5 / divergedBoth : 0
    };
  }

  // Test location: seahorse valley at deep zoom
  // c = -0.74543 + 0.11301i
  const TEST_CENTER = '-0.74543+0.11301i';

  describe('deep zoom comparison with OctZhuoranBoard', () => {

    test('at z=1e40, should match OctZhuoranBoard >90%', async () => {
      // Run OctZhuoranBoard (CPU reference)
      const octResult = await runBoard('octzhuoran', '1e40', TEST_CENTER, 500, 64, 64);
      expect(octResult.diverged).toBeGreaterThan(0);
      console.log(`OctZhuoranBoard: ${octResult.diverged}/${octResult.total} diverged`);

      // Create new page for adaptive board
      await page.close();
      page = await browser.newPage();

      // Run AdaptiveBoard
      const adaptiveResult = await runBoard('adaptive', '1e40', TEST_CENTER, 500, 64, 64);
      console.log(`AdaptiveGpuZhuoranBoard: ${adaptiveResult.diverged}/${adaptiveResult.total} diverged`);

      // Compare results
      const comparison = compareIterations(adaptiveResult.nn, octResult.nn);
      console.log(`Comparison: ${comparison.exact}/${comparison.divergedBoth} exact (${(comparison.exactRate * 100).toFixed(1)}%)`);
      console.log(`  Within 1: ${(comparison.within1Rate * 100).toFixed(1)}%`);
      console.log(`  Within 5: ${(comparison.within5Rate * 100).toFixed(1)}%`);
      console.log(`  Diverged in adaptive only: ${comparison.diverged1Only}`);
      console.log(`  Diverged in oct only: ${comparison.diverged2Only}`);

      // Expect high match rate at z=1e40
      // The adaptive scaling should enable accurate escape detection
      expect(comparison.within5Rate).toBeGreaterThan(0.90);
    }, TEST_TIMEOUT);

    test('at z=1e20, should match OctZhuoranBoard >95%', async () => {
      const octResult = await runBoard('octzhuoran', '1e20', TEST_CENTER, 500, 64, 64);
      expect(octResult.diverged).toBeGreaterThan(0);
      console.log(`OctZhuoranBoard: ${octResult.diverged}/${octResult.total} diverged`);

      await page.close();
      page = await browser.newPage();

      const adaptiveResult = await runBoard('adaptive', '1e20', TEST_CENTER, 500, 64, 64);
      console.log(`AdaptiveGpuZhuoranBoard: ${adaptiveResult.diverged}/${adaptiveResult.total} diverged`);

      const comparison = compareIterations(adaptiveResult.nn, octResult.nn);
      console.log(`Comparison: ${comparison.exact}/${comparison.divergedBoth} exact (${(comparison.exactRate * 100).toFixed(1)}%)`);

      expect(comparison.within5Rate).toBeGreaterThan(0.95);
    }, TEST_TIMEOUT);

    test('at z=1e10, should match OctZhuoranBoard >98%', async () => {
      const octResult = await runBoard('octzhuoran', '1e10', TEST_CENTER, 500, 64, 64);
      expect(octResult.diverged).toBeGreaterThan(0);
      console.log(`OctZhuoranBoard: ${octResult.diverged}/${octResult.total} diverged`);

      await page.close();
      page = await browser.newPage();

      const adaptiveResult = await runBoard('adaptive', '1e10', TEST_CENTER, 500, 64, 64);
      console.log(`AdaptiveGpuZhuoranBoard: ${adaptiveResult.diverged}/${adaptiveResult.total} diverged`);

      const comparison = compareIterations(adaptiveResult.nn, octResult.nn);
      console.log(`Comparison: ${comparison.exact}/${comparison.divergedBoth} exact (${(comparison.exactRate * 100).toFixed(1)}%)`);

      expect(comparison.within5Rate).toBeGreaterThan(0.98);
    }, TEST_TIMEOUT);

  });

  describe('board selection and basic functionality', () => {

    test('should be selectable via board=adaptivegpuzhuoran', async () => {
      const cwd = process.cwd();
      const url = `file://${path.join(cwd, 'index.html')}?z=1e20&c=${TEST_CENTER}&board=adaptive&grid=1&width=32&height=32`;

      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

      // Wait a bit for board to initialize
      await new Promise(r => setTimeout(r, 2000));

      const boardType = await page.evaluate(() => {
        return window.explorer?.grid?.views?.[0]?.boardType;
      });

      // Should select AdaptiveGpuBoard when WebGPU is available
      expect(boardType).toBe('AdaptiveGpuBoard');
    }, 30000);

  });
});

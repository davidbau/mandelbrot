/**
 * Regression test for GpuZhuoranBoard at z=1e20 near c=-1.8
 *
 * At commit 955d4cf, this location shows varied iteration counts in a fractal pattern.
 * A regression caused all pixels to diverge at the same iteration (138).
 *
 * The bug was in GpuZhuoranBoard.processGPUResults() which incorrectly marked ALL
 * remaining pixels as diverged when refOrbitEscaped=true. Fixed by removing that code
 * and letting pixels continue iterating naturally.
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, closeBrowser } = require('./test-utils');

describe('GpuZhuoran Regression Tests', () => {
  let browser;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('z=1e20 near c=-1.8 should show varied iteration counts, not uniform divergence', async () => {
    const page = await setupPage(browser, {}, TEST_TIMEOUT);
    try {
      // Navigate to the specific deep zoom location that was broken
      // Use gpuzhuoran (not octzhuoran) - this is the board type that had the bug
      const url = 'file://' + path.join(process.cwd(), 'index.html') +
        '?z=1.00e+20&c=-1.72413124442322315641234+0.00000000000000000000100i&board=gpuzhuoran&grid=1&width=48&height=27';

      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

      // Wait for some computation to complete
      await page.waitForFunction(() => {
        const view = window.explorer?.grid?.views?.[0];
        return view && view.di > 100;
      }, { timeout: 30000 });

      // Check that iteration counts are varied, not uniform
      const stats = await page.evaluate(() => {
        const view = window.explorer.grid.views[0];
        const nn = view.nn;
        const iterCounts = {};
        for (let i = 0; i < nn.length; i++) {
          if (nn[i] !== 0) {
            iterCounts[nn[i]] = (iterCounts[nn[i]] || 0) + 1;
          }
        }

        // Get unique non-zero iteration values
        const uniqueIters = Object.keys(iterCounts).filter(k => k !== '0').length;
        const diPixels = view.di;
        const mostCommonIter = Object.entries(iterCounts)
          .filter(([k]) => k !== '0')
          .sort((a, b) => b[1] - a[1])[0];

        return {
          boardType: view.boardType,
          di: diPixels,
          un: view.un,
          total: view.config.dimsArea,
          uniqueIterCount: uniqueIters,
          mostCommon: mostCommonIter ? { iter: parseInt(mostCommonIter[0]), count: mostCommonIter[1] } : null,
          refOrbitEscaped: view.board?.refOrbitEscaped,
          refIterations: view.board?.refIterations
        };
      });

      console.log('Stats:', JSON.stringify(stats, null, 2));

      // Key assertion: there should be multiple different iteration counts
      // Not all pixels diverging at the same iteration (which would indicate a bug)
      expect(stats.uniqueIterCount).toBeGreaterThan(3);

      // If all computed pixels have the same iteration count, that's the bug
      if (stats.mostCommon && stats.di > 0) {
        const uniformityRatio = stats.mostCommon.count / stats.di;
        expect(uniformityRatio).toBeLessThan(0.95);  // Less than 95% should have same iter
      }

    } finally {
      if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
    }
  }, TEST_TIMEOUT);

  test('computation completes with varied iterations at deep zoom', async () => {
    const page = await setupPage(browser, {}, TEST_TIMEOUT);
    try {
      // Test that computation completes successfully at z=1e20
      // Use gpuzhuoran (not octzhuoran) - this is the board type that had the bug
      const url = 'file://' + path.join(process.cwd(), 'index.html') +
        '?z=1.00e+20&c=-1.72413124442322315641234+0.00000000000000000000100i&board=gpuzhuoran&grid=1&width=48&height=27&maxiter=500';

      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

      // Wait for significant computation progress
      await page.waitForFunction(() => {
        const view = window.explorer?.grid?.views?.[0];
        return view && view.di > 500;
      }, { timeout: 30000 });

      const stats = await page.evaluate(() => {
        const view = window.explorer.grid.views[0];
        const nn = view.nn;
        const iterCounts = {};
        for (let i = 0; i < nn.length; i++) {
          if (nn[i] !== 0) {
            iterCounts[nn[i]] = (iterCounts[nn[i]] || 0) + 1;
          }
        }
        const uniqueIters = Object.keys(iterCounts).filter(k => k !== '0').length;

        return {
          boardType: view.boardType,
          di: view.di,
          un: view.un,
          uniqueIterCount: uniqueIters
        };
      });

      console.log('Deep zoom stats:', JSON.stringify(stats, null, 2));

      // Should have computed significant pixels
      expect(stats.di).toBeGreaterThan(100);
      // Should have varied iteration counts (key regression check)
      expect(stats.uniqueIterCount).toBeGreaterThan(3);

    } finally {
      if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
    }
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

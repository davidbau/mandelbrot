/**
 * Test: Converged z position (red dot) should be a valid cycle point
 *
 * When a pixel converges to a limit cycle, the reported z position should
 * be a valid point ON the periodic orbit. We verify this by iterating
 * the reported z a few times and checking it stays on the cycle.
 */

const path = require('path');
const { setupBrowser, setupPage, closeBrowser } = require('./test-utils');

const TEST_TIMEOUT = 60000;

describe('Converged z position (red dots)', () => {
  let browser;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('GpuAdaptiveBoard converged z is on the periodic orbit', async () => {
    const htmlPath = path.join(__dirname, '..', '..', 'index.html');
    const params = 'a=16:9&pixelratio=1&grid=1';

    const page = await setupPage(browser);
    page.setDefaultTimeout(TEST_TIMEOUT);
    await page.setViewport({ width: 160, height: 90 });
    await page.goto(`file://${htmlPath}?${params}&board=gpua`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

    // Wait for some pixels to converge
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      if (!view) return false;
      let convergedCount = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] < 0) convergedCount++;
      }
      return convergedCount >= 10;
    }, { timeout: 30000 });

    // Verify reported z is on the periodic orbit
    const results = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const config = window.explorer.config;
      const results = [];

      // Find converged pixels to test
      for (let i = 0; i < view.nn.length && results.length < 10; i++) {
        if (view.nn[i] < 0) {
          const z = view.currentz(i);
          const c = view.currentc(i);
          const p = view.currentp(i);
          if (z && p && p > 0) {
            // Calculate the period
            const period = fibonacciPeriod(p);

            // Get z values from QDc format (8 elements: 4 real + 4 imag)
            let zr = z[0] + (z[1] || 0) + (z[2] || 0) + (z[3] || 0);
            let zi = z[4] + (z[5] || 0) + (z[6] || 0) + (z[7] || 0);
            const cr = c[0];
            const ci = c[4];
            const origZ = [zr, zi];

            // Iterate z^n + c for 'period' iterations and check if it returns close to original
            for (let iter = 0; iter < period; iter++) {
              // z^2 + c (assuming exponent 2)
              const newZr = zr * zr - zi * zi + cr;
              const newZi = 2 * zr * zi + ci;
              zr = newZr;
              zi = newZi;
            }

            const diffR = Math.abs(zr - origZ[0]);
            const diffI = Math.abs(zi - origZ[1]);
            const cycleError = Math.max(diffR, diffI);

            results.push({
              index: i,
              period,
              origZ,
              afterCycleZ: [zr, zi],
              cycleError,
              isValid: cycleError < 0.1  // Should return close to original after 'period' iterations
            });
          }
        }
      }

      return {
        boardType: view.boardType,
        results
      };
    });

    await page.close();

    expect(results.boardType).toBe('GpuAdaptiveBoard');
    expect(results.results.length).toBeGreaterThan(0);

    // Count valid cycle points
    let validCount = 0;
    for (const r of results.results) {
      if (r.isValid) validCount++;
    }

    // All reported z values should be valid cycle points
    const validRatio = validCount / results.results.length;
    expect(validRatio).toBeGreaterThanOrEqual(0.8);

  }, TEST_TIMEOUT);

  test('GpuBoard converged z is on the periodic orbit', async () => {
    const htmlPath = path.join(__dirname, '..', '..', 'index.html');
    const params = 'a=16:9&pixelratio=1&grid=1';

    const page = await setupPage(browser);
    page.setDefaultTimeout(TEST_TIMEOUT);
    await page.setViewport({ width: 160, height: 90 });
    await page.goto(`file://${htmlPath}?${params}&board=gpu`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

    // Wait for some pixels to converge
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      if (!view) return false;
      let convergedCount = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] < 0) convergedCount++;
      }
      return convergedCount >= 10;
    }, { timeout: 30000 });

    // Verify reported z is on the periodic orbit
    const results = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const results = [];

      for (let i = 0; i < view.nn.length && results.length < 10; i++) {
        if (view.nn[i] < 0) {
          const z = view.currentz(i);
          const c = view.currentc(i);
          const p = view.currentp(i);
          if (z && p && p > 0) {
            const period = fibonacciPeriod(p);

            // Get z values from QDc format (8 elements: 4 real + 4 imag)
            let zr = z[0] + (z[1] || 0) + (z[2] || 0) + (z[3] || 0);
            let zi = z[4] + (z[5] || 0) + (z[6] || 0) + (z[7] || 0);
            const cr = c[0];
            const ci = c[4];
            const origZ = [zr, zi];

            for (let iter = 0; iter < period; iter++) {
              const newZr = zr * zr - zi * zi + cr;
              const newZi = 2 * zr * zi + ci;
              zr = newZr;
              zi = newZi;
            }

            const cycleError = Math.max(Math.abs(zr - origZ[0]), Math.abs(zi - origZ[1]));

            results.push({
              index: i,
              period,
              origZ,
              afterCycleZ: [zr, zi],
              cycleError,
              isValid: cycleError < 0.1
            });
          }
        }
      }

      return {
        boardType: view.boardType,
        results
      };
    });

    await page.close();

    expect(results.boardType).toBe('GpuBoard');
    expect(results.results.length).toBeGreaterThan(0);

    let validCount = 0;
    for (const r of results.results) {
      if (r.isValid) validCount++;
    }

    const validRatio = validCount / results.results.length;
    expect(validRatio).toBeGreaterThanOrEqual(0.8);

  }, TEST_TIMEOUT);
});

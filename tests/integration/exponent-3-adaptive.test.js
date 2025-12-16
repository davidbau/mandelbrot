/**
 * Test: AdaptiveGpuBoard with exponent=3 matches GpuZhuoranBoard
 */

const path = require('path');
const { setupBrowser, setupPage, closeBrowser } = require('./test-utils');

const TEST_TIMEOUT = 60000;

describe('Exponent 3 - AdaptiveGpuBoard vs GpuZhuoranBoard', () => {
  let browser;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('AdaptiveGpuBoard and GpuZhuoranBoard match at z=1e28, exponent=3', async () => {
    const htmlPath = path.join(__dirname, '..', '..', 'index.html');
    const params = 'z=1e28&exponent=3&c=+0.4339460643798616581994852249997-0.0152649376914194242586126998695i&a=16:9&pixelratio=1&grid=1';

    // Test GpuZhuoranBoard
    const page1 = await setupPage(browser);
    page1.setDefaultTimeout(TEST_TIMEOUT);
    await page1.setViewport({ width: 160, height: 90 });
    await page1.goto(`file://${htmlPath}?${params}&board=gpuz`, { waitUntil: 'load' });
    await page1.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
    await page1.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;  // Wait for all pixels to finish
    }, { timeout: 30000 });

    const zhuoran = await page1.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = view.nn;
      const total = nn.length;
      let diverged = 0, converged = 0, computing = 0;
      let maxIter = 0;
      for (let i = 0; i < total; i++) {
        if (nn[i] > 0) {
          diverged++;
          maxIter = Math.max(maxIter, nn[i]);
        }
        else if (nn[i] < 0) converged++;
        else computing++;
      }
      return {
        diverged, converged, computing, total, maxIter,
        boardType: view.boardType,
        di: view.di,
        un: view.un
      };
    });

    await page1.close();

    // Test AdaptiveGpuBoard
    const page2 = await setupPage(browser);
    page2.setDefaultTimeout(TEST_TIMEOUT);
    await page2.setViewport({ width: 160, height: 90 });
    await page2.goto(`file://${htmlPath}?${params}&board=adaptive`, { waitUntil: 'load' });
    await page2.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
    await page2.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;  // Wait for all pixels to finish
    }, { timeout: 30000 });

    const adaptive = await page2.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = view.nn;
      const total = nn.length;
      let diverged = 0, converged = 0, computing = 0;
      let maxIter = 0;
      for (let i = 0; i < total; i++) {
        if (nn[i] > 0) {
          diverged++;
          maxIter = Math.max(maxIter, nn[i]);
        }
        else if (nn[i] < 0) converged++;
        else computing++;
      }
      return {
        diverged, converged, computing, total, maxIter,
        boardType: view.boardType,
        di: view.di,
        un: view.un
      };
    });

    await page2.close();

    // Both boards should have the same total pixels
    expect(zhuoran.total).toBe(adaptive.total);

    // Both should be using the correct board type
    expect(zhuoran.boardType).toBe('GpuZhuoranBoard');
    expect(adaptive.boardType).toBe('AdaptiveGpuBoard');

    // Both should have similar divergence patterns (within 5% tolerance)
    const divergedRatio = adaptive.diverged / zhuoran.diverged;
    expect(divergedRatio).toBeGreaterThan(0.95);
    expect(divergedRatio).toBeLessThan(1.05);

    // Both should have similar convergence patterns
    if (zhuoran.converged > 0 || adaptive.converged > 0) {
      const convergedDiff = Math.abs(adaptive.converged - zhuoran.converged);
      const convergedTolerance = Math.max(10, zhuoran.total * 0.05);
      expect(convergedDiff).toBeLessThan(convergedTolerance);
    }

  }, TEST_TIMEOUT);
});

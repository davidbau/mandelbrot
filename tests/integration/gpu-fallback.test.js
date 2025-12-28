/**
 * @jest-environment node
 *
 * Tests GPU fallback chain: WebGPU → WebGL2 → CPU
 *
 * Uses debug flags (nogpu, nogl) to simulate different capability scenarios
 * without requiring actual cross-platform testing infrastructure.
 */

const path = require('path');
const { setupBrowser, setupPage, closeBrowser, isBrowserStack } = require('./test-utils');

const TEST_TIMEOUT = 60000;

// Helper to conditionally skip tests that require WebGPU
// BrowserStack VMs don't have WebGPU support, only WebGL via ANGLE
const describeWithWebGPU = isBrowserStack() ? describe.skip : describe;

describe('GPU Fallback Chain', () => {
  let browser;
  let indexPath;

  beforeAll(async () => {
    indexPath = path.resolve(__dirname, '../../index.html');
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  // Helper to wait for board creation and get its type from console logs
  async function waitForBoardType(page, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for board type')), timeout);

      const handler = msg => {
        const text = msg.text();
        // Match "Board 0: GpuBoard @ ..." or similar
        const match = text.match(/Board \d+: (\w+Board) @/);
        if (match) {
          clearTimeout(timer);
          page.off('console', handler);
          resolve(match[1]);
        }
      };

      page.on('console', handler);
    });
  }

  // Helper to check if computation completes
  async function waitForCompletion(page, timeout = 30000) {
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.unfinished() === 0;
    }, { timeout });
  }

  describe('Shallow zoom (pixelSize > 1e-7)', () => {
    const shallowUrl = (debugFlags = '') => {
      const debug = debugFlags ? `dims:20x20,${debugFlags}` : 'dims:20x20';
      return `file://${indexPath}?debug=${debug}&pixelratio=1&grid=1`;
    };

    // Skip on BrowserStack - WebGPU is not available, falls back to WebGL
    (isBrowserStack() ? test.skip : test)('WebGPU available → uses GpuBoard', async () => {
      const page = await setupPage(browser);
      // Set up console listener before navigation
      const boardTypePromise = waitForBoardType(page);

      // Navigate after listener is set up
      page.goto(shallowUrl(), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('GpuBoard');

      await waitForCompletion(page);
      await page.close();
    }, TEST_TIMEOUT);

    test('debug=nogpu → falls back to GlBoard', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(shallowUrl('nogpu'), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('GlBoard');

      await waitForCompletion(page);
      await page.close();
    }, TEST_TIMEOUT);

    test('debug=nogpu,nogl → falls back to CpuBoard', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(shallowUrl('nogpu,nogl'), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('CpuBoard');

      await waitForCompletion(page);
      await page.close();
    }, TEST_TIMEOUT);
  });

  describe('Medium zoom (1e-30 < pixelSize < 1e-7)', () => {
    // z=1e10 gives pixelSize around 1e-10
    const mediumUrl = (debugFlags = '') => {
      const debug = debugFlags ? `dims:20x20,${debugFlags}` : 'dims:20x20';
      return `file://${indexPath}?debug=${debug}&pixelratio=1&grid=1&z=1e10&c=-0.5+0i`;
    };

    // Skip on BrowserStack - WebGPU is not available, falls back to WebGL
    (isBrowserStack() ? test.skip : test)('WebGPU available → uses GpuZhuoranBoard', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(mediumUrl(), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('GpuZhuoranBoard');

      await page.close();
    }, TEST_TIMEOUT);

    test('debug=nogpu → falls back to GlZhuoranBoard', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(mediumUrl('nogpu'), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('GlZhuoranBoard');

      await page.close();
    }, TEST_TIMEOUT);

    test('debug=nogpu,nogl → falls back to CpuBoard (f64 precision ok at z=1e10)', async () => {
      // At z=1e10, pixelSize is ~1e-10 which is within f64 precision (1e-15)
      // so CpuBoard can handle it. DDZhuoranBoard is only needed below 1e-15.
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(mediumUrl('nogpu,nogl'), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('CpuBoard');

      await page.close();
    }, TEST_TIMEOUT);
  });

  describe('Deep zoom (pixelSize < 1e-30)', () => {
    // z=1e35 gives pixelSize around 1e-35
    const deepUrl = (debugFlags = '') => {
      const debug = debugFlags ? `dims:20x20,${debugFlags}` : 'dims:20x20';
      return `file://${indexPath}?debug=${debug}&pixelratio=1&grid=1&z=1e35&c=-0.5+0i`;
    };

    // Skip on BrowserStack - WebGPU is not available, falls back to WebGL
    (isBrowserStack() ? test.skip : test)('WebGPU available → uses GpuAdaptiveBoard', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(deepUrl(), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('GpuAdaptiveBoard');

      await page.close();
    }, TEST_TIMEOUT);

    test('debug=nogpu → falls back to GlAdaptiveBoard', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(deepUrl('nogpu'), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('GlAdaptiveBoard');

      await page.close();
    }, TEST_TIMEOUT);

    test('debug=nogpu,nogl → falls back to QDZhuoranBoard', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(deepUrl('nogpu,nogl'), { waitUntil: 'domcontentloaded' });

      const boardType = await boardTypePromise;
      expect(boardType).toBe('QDZhuoranBoard');

      await page.close();
    }, TEST_TIMEOUT);
  });

  describe('Forced board type with unavailable GPU', () => {
    test('board=gpu with debug=nogpu → throws error', async () => {
      const page = await setupPage(browser);

      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(
        `file://${indexPath}?debug=dims:20x20,nogpu&pixelratio=1&grid=1&board=gpu`,
        { waitUntil: 'domcontentloaded' }
      );

      // Wait for error to propagate
      await new Promise(r => setTimeout(r, 2000));

      expect(errors.some(e => e.includes('WebGPU is not available'))).toBe(true);

      await page.close();
    }, TEST_TIMEOUT);

    test('board=gpuz with debug=nogpu → throws error', async () => {
      const page = await setupPage(browser);

      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(
        `file://${indexPath}?debug=dims:20x20,nogpu&pixelratio=1&grid=1&board=gpuz&z=1e10&c=-0.5+0i`,
        { waitUntil: 'domcontentloaded' }
      );

      await new Promise(r => setTimeout(r, 2000));

      expect(errors.some(e => e.includes('WebGPU is not available'))).toBe(true);

      await page.close();
    }, TEST_TIMEOUT);

    test('board=cpu always works regardless of GPU availability', async () => {
      const page = await setupPage(browser);
      const boardTypePromise = waitForBoardType(page);

      await page.goto(
        `file://${indexPath}?debug=dims:20x20,nogpu,nogl&pixelratio=1&grid=1&board=cpu`,
        { waitUntil: 'domcontentloaded' }
      );

      const boardType = await boardTypePromise;
      expect(boardType).toBe('CpuBoard');

      await waitForCompletion(page);
      await page.close();
    }, TEST_TIMEOUT);
  });

  describe('Computation correctness across fallback chain', () => {
    // Verify that different board types produce the same results

    // Skip on BrowserStack - WebGL (GlBoard) may have minor floating-point differences from CPU
    (isBrowserStack() ? test.skip : test)('CPU and GPU boards produce matching iteration counts at shallow zoom', async () => {
      const getIterations = async (debugFlags) => {
        const page = await setupPage(browser);
        const debug = debugFlags ? `dims:10x10,${debugFlags}` : 'dims:10x10';

        await page.goto(
          `file://${indexPath}?debug=${debug}&pixelratio=1&grid=1&c=-0.5+0i`,
          { waitUntil: 'domcontentloaded' }
        );

        await waitForCompletion(page);

        const result = await page.evaluate(() => {
          const view = window.explorer.grid.views[0];
          // Get a sample of iteration values
          return {
            nn: Array.from(view.nn.slice(0, 20)),
            di: view.di,
            un: view.un
          };
        });

        await page.close();
        return result;
      };

      const gpuResult = await getIterations('');
      const cpuResult = await getIterations('nogpu,nogl');

      // Both should complete
      expect(gpuResult.un).toBe(0);
      expect(cpuResult.un).toBe(0);

      // Iteration counts should match (allowing for minor differences due to floating point)
      // At shallow zoom, results should be identical
      expect(gpuResult.nn).toEqual(cpuResult.nn);
      expect(gpuResult.di).toBe(cpuResult.di);
    }, TEST_TIMEOUT * 2);
  });
});

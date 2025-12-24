/**
 * Integration tests for GPU vs CPU histogram matching.
 *
 * At default zoom, GPU and CPU should produce similar histograms.
 * This is a sanity check to catch GPU computation bugs.
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

const COMPUTATION_TIMEOUT = 120000; // 2 minutes

async function navigateToApp(page, queryParams = '') {
  const htmlPath = `file://${path.join(__dirname, '../../index.html')}${queryParams}`;
  await page.goto(htmlPath, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
  await page.waitForFunction(() => {
    return window.explorer?.grid?.views?.[0] !== undefined;
  }, { timeout: 15000 });
}

async function getHistogramData(page) {
  return await page.evaluate(() => {
    const view = window.explorer.grid.views[0];
    const nn = view.nn;

    const histogram = new Map();
    let diverged = 0;
    let converged = 0;
    let unknown = 0;

    for (let i = 0; i < nn.length; i++) {
      const val = nn[i];
      if (val > 0) {
        diverged++;
        histogram.set(val, (histogram.get(val) || 0) + 1);
      } else if (val < 0) {
        converged++;
        histogram.set(-val, (histogram.get(-val) || 0) + 1);
      } else {
        unknown++;
      }
    }

    // Top 20 iterations by count
    const sortedHist = Array.from(histogram.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    return {
      it: view.it,
      di: view.di,
      un: view.un,
      total: nn.length,
      diverged,
      converged,
      unknown,
      histogram: sortedHist
    };
  });
}

describe('GPU vs CPU histogram matching', () => {
  let browser;
  let launchFailed = false;

  beforeAll(async () => {
    try {
      browser = await setupBrowser();
    } catch (e) {
      launchFailed = true;
      console.warn('Browser launch failed:', e.message);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) {
      await closeBrowser(browser);
    }
  }, TEST_TIMEOUT);

  test('GpuBoard and CpuBoard should have similar diverged/converged counts', async () => {
    if (launchFailed) return;

    // Test CPU
    let page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page, '?board=cpu&debug=dims:320x180');
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;
    }, { timeout: COMPUTATION_TIMEOUT });
    const cpuData = await getHistogramData(page);
    await page.close();

    // Test GPU
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page, '?board=gpu&debug=dims:320x180');
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un <= 1; // Allow 1 unknown for GPU edge cases
    }, { timeout: COMPUTATION_TIMEOUT });
    const gpuData = await getHistogramData(page);
    await page.close();

    // Basic sanity: both should complete
    expect(cpuData.unknown).toBe(0);
    expect(gpuData.unknown).toBeLessThanOrEqual(1);

    // Total pixel counts should match
    expect(cpuData.total).toBe(gpuData.total);

    // Diverged + converged counts should be within 1% of each other
    const cpuCompleted = cpuData.diverged + cpuData.converged;
    const gpuCompleted = gpuData.diverged + gpuData.converged;
    const completedDiff = Math.abs(cpuCompleted - gpuCompleted);
    const completedTolerance = cpuData.total * 0.01;
    expect(completedDiff).toBeLessThanOrEqual(completedTolerance);

    // Diverged counts should be within 5% of each other
    // Note: convergence detection can differ due to float32 vs float64
    const divergedDiff = Math.abs(cpuData.diverged - gpuData.diverged);
    const divergedTolerance = cpuData.total * 0.05;
    expect(divergedDiff).toBeLessThanOrEqual(divergedTolerance);
  }, COMPUTATION_TIMEOUT + 30000);

  test('Low iteration counts should match closely', async () => {
    if (launchFailed) return;

    // Test CPU
    let page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page, '?board=cpu&debug=dims:320x180');
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;
    }, { timeout: COMPUTATION_TIMEOUT });
    const cpuData = await getHistogramData(page);
    await page.close();

    // Test GPU
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page, '?board=gpu&debug=dims:320x180');
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un <= 1;
    }, { timeout: COMPUTATION_TIMEOUT });
    const gpuData = await getHistogramData(page);
    await page.close();

    // Convert histograms to maps
    const cpuHistMap = new Map(cpuData.histogram);
    const gpuHistMap = new Map(gpuData.histogram);

    // Low iteration values (1-2) should match closely - these are definite escapes
    // Iterations 1-2 represent pixels where |z|>2 after just 1-2 iterations
    // These should be nearly identical between CPU and GPU since escape detection
    // is straightforward (just checking magnitude > 4)
    for (let iter = 1; iter <= 2; iter++) {
      const cpuCount = cpuHistMap.get(iter) || 0;
      const gpuCount = gpuHistMap.get(iter) || 0;

      if (cpuCount > 100) {
        const diff = Math.abs(cpuCount - gpuCount);
        // Allow 1% tolerance for float32 rounding at escape boundary
        const tolerance = cpuCount * 0.01;
        expect(diff).toBeLessThanOrEqual(tolerance + 10);
      }
    }

    // Iteration 2 should match exactly - these escape very clearly
    const cpu2 = cpuHistMap.get(2) || 0;
    const gpu2 = gpuHistMap.get(2) || 0;
    expect(cpu2).toBe(gpu2); // Iteration 2 should be identical
  }, COMPUTATION_TIMEOUT + 30000);
});

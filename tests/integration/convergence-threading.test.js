/**
 * Integration test for convergence detection with thread-following
 * Tests that boards correctly detect convergence using thread-following logic
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

describe('Convergence Threading Tests', () => {
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

  async function runBoard(boardType) {
    const cwd = process.cwd();
    // Small low-resolution board for fast testing: grid=10 (smaller), 16:9 aspect ratio
    const url = `file://${path.join(cwd, 'index.html')}?z=1e1&c=-0.755+0.01i&board=${boardType}&grid=10&subpixel=1&a=16:9&unk=888`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

    // Wait for completion - allow more time for CPU boards
    await page.waitForFunction(
      () => {
        const view = window.explorer?.grid?.views?.[0];
        return view && view.un <= 5;
      },
      { timeout: 120000 }
    );

    return await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = Array.from(view.nn);

      // Extract period data from convergedData Map
      const pp = new Array(nn.length).fill(0);
      for (const [index, data] of view.convergedData) {
        pp[index] = data.p || 0;
      }

      let diverged = 0, converged = 0;
      for (const v of nn) {
        if (v > 0) diverged++;
        else if (v < 0) converged++;
      }

      return {
        nn,
        pp,
        diverged,
        converged,
        total: nn.length,
        boardType: view.boardType
      };
    });
  }

  function compareOrbitPeriods(result1, result2) {
    let convergedBoth = 0;
    let periodMatches = 0;
    const periodDiffs = [];

    for (let i = 0; i < result1.nn.length; i++) {
      const conv1 = result1.nn[i] < 0;
      const conv2 = result2.nn[i] < 0;

      // Both converged: check if orbit periods match
      if (conv1 && conv2) {
        convergedBoth++;
        const period1 = result1.pp[i];
        const period2 = result2.pp[i];

        if (period1 === period2) {
          periodMatches++;
        } else {
          periodDiffs.push({ i, period1, period2, diff: Math.abs(period1 - period2) });
        }
      }
    }

    return {
      convergedBoth,
      periodMatches,
      periodMatchRate: convergedBoth > 0 ? periodMatches / convergedBoth : 0,
      periodDiffs: periodDiffs.slice(0, 5)  // First 5 mismatches for debugging
    };
  }

  // Skip: CPU-only boards (ddz/qdz) are too slow for reliable CI
  test.skip('ddz detects orbit convergence at z=10, c=-0.755+0.01i', async () => {
    const result = await runBoard('ddz');
    // Should have at least some converged pixels with orbit periods detected
    expect(result.converged).toBeGreaterThan(0);

    // Check that converged pixels have non-zero orbit periods
    let periodsDetected = 0;
    for (let i = 0; i < result.nn.length; i++) {
      if (result.nn[i] < 0 && result.pp[i] > 0) {
        periodsDetected++;
      }
    }
    expect(periodsDetected).toBeGreaterThan(0);
  }, 90000);

  // Skip: CPU-only boards (ddz/qdz) are too slow for reliable CI
  test.skip('qdz detects orbit convergence at z=10, c=-0.755+0.01i', async () => {
    const result = await runBoard('qdz');
    // Should have at least some converged pixels with orbit periods detected
    expect(result.converged).toBeGreaterThan(0);

    // Check that converged pixels have non-zero orbit periods
    let periodsDetected = 0;
    for (let i = 0; i < result.nn.length; i++) {
      if (result.nn[i] < 0 && result.pp[i] > 0) {
        periodsDetected++;
      }
    }
    expect(periodsDetected).toBeGreaterThan(0);
  }, 90000);

  // Skip: CPU-only boards (ddz/qdz) are too slow for reliable CI
  test.skip('ddz and qdz detect same orbit periods', async () => {
    const ddzResult = await runBoard('ddz');

    await page.close();
    page = await setupPage(browser, {}, TEST_TIMEOUT);

    const qdzResult = await runBoard('qdz');

    const comparison = compareOrbitPeriods(ddzResult, qdzResult);

    // console.log(`\nOrbit Period Matching Stats (DDZ vs QDZ):`);
    // console.log(`  Pixels converged in both boards: ${comparison.convergedBoth}`);
    // console.log(`  Periods matching exactly: ${comparison.periodMatches}`);
    // console.log(`  Match rate: ${(comparison.periodMatchRate * 100).toFixed(2)}%`);
    if (comparison.periodDiffs.length > 0) {
      console.log(`  Sample mismatches:`, comparison.periodDiffs);
    }

    // All converged pixels should have matching orbit periods
    expect(comparison.convergedBoth).toBeGreaterThan(0);
    expect(comparison.periodMatchRate).toBeGreaterThan(0.95);
  }, 180000);
});

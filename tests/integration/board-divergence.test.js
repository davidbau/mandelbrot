/**
 * Board divergence comparison tests
 *
 * Tests that different board implementations (gpuzhuoran, octzhuoran)
 * produce correct results at various zoom levels.
 *
 * Test coordinate (full precision):
 * c = -1.75000000000000000000000000000000000000 + 0.01201028937689993109013890640835730030i
 *
 * At this location, pixels escape in less than ~500 iterations with diverse
 * iteration counts, making it ideal for verifying board implementations match.
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

// Full precision coordinate for deep zoom testing
const TEST_CENTER_RE = '-1.75000000000000000000000000000000000000';
const TEST_CENTER_IM = '0.01201028937689993109013890640835730030';
const TEST_CENTER = `${TEST_CENTER_RE}+${TEST_CENTER_IM}i`;

describe('Board Divergence Comparison Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
    page = await setupPage(browser, {}, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  /**
   * Helper to get iteration counts from a board at a specific zoom level
   */
  async function getBoardIterations(boardType, zoom) {
    const url = 'file://' + path.join(process.cwd(), 'index.html') +
      `?z=${zoom}&c=${TEST_CENTER}&board=${boardType}&grid=1&maxiter=700`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

    // Wait for computation to complete (all pixels done)
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;
    }, { timeout: 30000 });

    return await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = view.nn;

      // Get unique iteration counts
      const iterCounts = {};
      for (let i = 0; i < nn.length; i++) {
        if (nn[i] !== 0) {
          iterCounts[nn[i]] = (iterCounts[nn[i]] || 0) + 1;
        }
      }

      return {
        boardType: view.boardType,
        total: view.config.dimsArea,
        uniqueIters: Object.keys(iterCounts).length,
        // Sample first 100 pixels for comparison
        sample: Array.from(nn.slice(0, 100))
      };
    });
  }

  test('gpuzhuoran shows diverse iterations at z=1e20', async () => {
    const result = await getBoardIterations('gpuzhuoran', '1e20');
    console.log(`gpuzhuoran: ${result.boardType}, unique=${result.uniqueIters}`);
    expect(result.uniqueIters).toBeGreaterThan(10);
  }, TEST_TIMEOUT);

  test('octzhuoran shows diverse iterations at z=1e20', async () => {
    const result = await getBoardIterations('octzhuoran', '1e20');
    console.log(`octzhuoran: ${result.boardType}, unique=${result.uniqueIters}`);
    expect(result.uniqueIters).toBeGreaterThan(10);
  }, TEST_TIMEOUT);

  test('octzhuoran shows diverse iterations at z=1e35', async () => {
    const result = await getBoardIterations('octzhuoran', '1e35');
    console.log(`octzhuoran at z=1e35: ${result.boardType}, unique=${result.uniqueIters}`);
    expect(result.uniqueIters).toBeGreaterThan(10);
  }, TEST_TIMEOUT);

  test('gpuzhuoran and octzhuoran produce similar results at z=1e20', async () => {
    const gpuResult = await getBoardIterations('gpuzhuoran', '1e20');
    const octResult = await getBoardIterations('octzhuoran', '1e20');

    console.log(`gpuzhuoran: unique=${gpuResult.uniqueIters}`);
    console.log(`octzhuoran: unique=${octResult.uniqueIters}`);

    // Compare sample pixels
    let matches = 0;
    for (let i = 0; i < gpuResult.sample.length; i++) {
      if (gpuResult.sample[i] === octResult.sample[i]) matches++;
    }
    const matchRate = matches / gpuResult.sample.length;
    console.log(`Sample match: ${matches}/${gpuResult.sample.length} (${(matchRate * 100).toFixed(1)}%)`);

    // Expect high match rate between GPU and CPU perturbation implementations
    expect(matchRate).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

/**
 * Integration tests for AdaptiveGpuBoard
 * Tests adaptive per-pixel scaling for deep zoom GPU perturbation.
 */

const puppeteer = require('puppeteer');
const path = require('path');

describe('AdaptiveGpuBoard', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    if (page) await page.close();
  });

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
      { timeout: 20000 }
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

  test('at z=1e20, should match OctZhuoranBoard >95%', async () => {
    const octResult = await runBoard('octzhuoran', '1e20', TEST_CENTER, 200);
    expect(octResult.diverged).toBeGreaterThan(0);

    await page.close();
    page = await browser.newPage();

    const adaptiveResult = await runBoard('adaptive', '1e20', TEST_CENTER, 200);
    const comparison = compareIterations(adaptiveResult.nn, octResult.nn);
    expect(comparison.within5Rate).toBeGreaterThan(0.95);
  }, 30000);

  test('should be selectable via board=adaptive', async () => {
    const cwd = process.cwd();
    const url = `file://${path.join(cwd, 'index.html')}?z=1e20&c=${TEST_CENTER}&board=adaptive&grid=20&subpixel=1`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 500));

    const boardType = await page.evaluate(() => window.explorer?.grid?.views?.[0]?.boardType);
    expect(boardType).toBe('AdaptiveGpuBoard');
  }, 15000);

  test('convergence detection at z=5', async () => {
    const CONVERGENT_CENTER = '+0.1972+0.5798i';

    const octResult = await runBoard('octzhuoran', '5', CONVERGENT_CENTER, 500);
    expect(octResult.converged).toBeGreaterThan(0);

    await page.close();
    page = await browser.newPage();

    const adaptiveResult = await runBoard('adaptive', '5', CONVERGENT_CENTER, 500);
    // Expect reasonable convergence detection
    expect(adaptiveResult.converged).toBeGreaterThan(octResult.converged * 0.5);
  }, 30000);
});

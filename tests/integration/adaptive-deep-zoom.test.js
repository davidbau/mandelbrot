/**
 * Integration tests for AdaptiveGpuBoard at deep zoom (z=1e35)
 * Compares adaptive board to OctZhuoranBoard reference.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

describe('AdaptiveGpuBoard at z=1e35', () => {
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

  async function runBoard(boardType) {
    const page = await setupPage(browser, {}, TEST_TIMEOUT);

    const CENTER = '-1.8+0.000000000000000000000000000000000003i';
    const ZOOM = '1e35';
    const url = `file://${path.join(__dirname, '../../index.html')}?z=${ZOOM}&c=${CENTER}&board=${boardType}&grid=20&subpixel=1`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

    // Wait for completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;
    }, { timeout: 60000 });

    const result = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = Array.from(view.nn);
      let diverged = 0, converged = 0;
      for (const v of nn) {
        if (v > 0) diverged++;
        else if (v < 0) converged++;
      }
      return {
        nn,
        diverged,
        converged,
        total: nn.length,
        boardType: view.boardType
      };
    });

    await page.close();
    return result;
  }

  test('adaptive vs octzhuoran at z=1e35 near c=-1.8', async () => {
    if (launchFailed) return;

    // Run octzhuoran first (reference)
    const octResult = await runBoard('octzhuoran');
    expect(octResult.diverged).toBeGreaterThan(0);

    // Run adaptive
    const adaptiveResult = await runBoard('adaptive');
    expect(adaptiveResult.diverged).toBeGreaterThan(0);

    // Compare iteration counts
    let exact = 0, within5 = 0, divergedBoth = 0;
    const diffs = [];
    for (let i = 0; i < octResult.nn.length; i++) {
      if (octResult.nn[i] > 0 && adaptiveResult.nn[i] > 0) {
        divergedBoth++;
        const diff = adaptiveResult.nn[i] - octResult.nn[i];
        if (diff === 0) exact++;
        if (Math.abs(diff) <= 5) within5++;
        if (diffs.length < 20) diffs.push(diff);
      }
    }

    const exactRate = exact / divergedBoth;
    const within5Rate = within5 / divergedBoth;

    // Expect at least 90% within 5 iterations
    expect(within5Rate).toBeGreaterThan(0.9);
  }, 120000);
});

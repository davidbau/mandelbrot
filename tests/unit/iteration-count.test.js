/**
 * Tests that iteration counts (nn values) match between CpuBoard and ZhuoranBoard.
 * This verifies that perturbation-based boards report the same escape iteration
 * as the reference CpuBoard implementation.
 */

const puppeteer = require('puppeteer');
const path = require('path');

const TEST_TIMEOUT = 60000;

describe('Iteration count consistency', () => {
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

  test('ZhuoranBoard iteration counts match CpuBoard', async () => {
    const htmlPath = 'file://' + path.join(__dirname, '../../index.html');

    // Test CpuBoard
    await page.goto(htmlPath + '?a=16:9&board=cpu', { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));

    const cpuData = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const samples = [];
      // Sample diverged pixels from different areas
      for (let x = 600; x < 700; x += 10) {
        const nn = view.nn[120 * view.config.dimsWidth + x];
        if (nn > 0) samples.push({ x, nn });
      }
      return { di: view.di, samples };
    });

    // Test ZhuoranBoard
    await page.goto(htmlPath + '?a=16:9&board=zhuoran', { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));

    const zhuoranData = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const samples = [];
      for (let x = 600; x < 700; x += 10) {
        const nn = view.nn[120 * view.config.dimsWidth + x];
        if (nn > 0) samples.push({ x, nn });
      }
      return { di: view.di, samples };
    });

    // Both boards should have significant divergence
    expect(cpuData.di).toBeGreaterThan(200000);
    expect(zhuoranData.di).toBeGreaterThan(200000);

    // Extract just the nn values for comparison
    const cpuNN = cpuData.samples.map(s => s.nn);
    const zhuoranNN = zhuoranData.samples.map(s => s.nn);

    // Should have same number of samples
    expect(zhuoranNN.length).toBe(cpuNN.length);

    // Iteration counts should match exactly
    expect(zhuoranNN).toEqual(cpuNN);
  }, TEST_TIMEOUT);
});

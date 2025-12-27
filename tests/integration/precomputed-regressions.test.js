/**
 * @jest-environment node
 */
const path = require('path');
const { setupBrowser, setupPage } = require('./test-utils');

const TEST_TIMEOUT = 60000;

describe('Precomputed inheritance regressions', () => {
  let browser;
  let indexPath;

  beforeAll(async () => {
    indexPath = path.resolve(__dirname, '../../index.html');

    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  }, TEST_TIMEOUT);

  test('computeInheritance rejects converged regions with mismatched derived periods', async () => {
    const page = await setupPage(browser);

    await page.goto(`file://${indexPath}?debug=dims:5x5&pixelratio=1&grid=1`, {
      waitUntil: 'domcontentloaded'
    });

    const result = await page.evaluate(() => {
      const grid = window.explorer.grid;
      const parent = grid.views[0];
      const width = grid.config.dimsWidth;
      const centerX = 2;
      const centerY = 2;
      const centerIdx = centerY * width + centerX;

      parent.nn = new Array(width * width).fill(0);
      parent.convergedData = new Map();

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = (centerY + dy) * width + (centerX + dx);
          parent.nn[idx] = -10;
          parent.convergedData.set(idx, { z: [0, 0], p: 2 });
        }
      }

      const mismatchIdx = (centerY - 1) * width + centerX;
      parent.convergedData.set(mismatchIdx, { z: [0, 0], p: 4 });

      const child = { size: parent.size, re: parent.re, im: parent.im };
      const inherited = grid.computeInheritance(parent, child);
      const inheritedIndices = inherited.packed ?
        Array.from(inherited.cIndices) :
        inherited.converged.map(item => item.index);
      return {
        centerIdx,
        inherited: inheritedIndices
      };
    });

    expect(result.inherited).not.toContain(result.centerIdx);

    await page.close();
  }, TEST_TIMEOUT);

  test('CpuBoard flushes precomputed at the correct iteration', async () => {
    const page = await setupPage(browser);

    await page.goto(`file://${indexPath}?debug=w`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(() => {
      const config = {
        dimsWidth: 1,
        dimsHeight: 1,
        dimsArea: 1,
        aspectRatio: 1,
        exponent: 2
      };
      const inheritedData = { diverged: [{ index: 0, iter: 1 }], converged: [] };
      const board = new CpuBoard(0, 1, 0, 0, config, 1, inheritedData);
      board.iterate(1);
      return board.changeList.map(change => change.iter);
    });

    expect(result).toEqual([1]);

    await page.close();
  }, TEST_TIMEOUT);

  test('GpuBoard reports precomputed pixels even when all pixels are inherited', async () => {
    const page = await setupPage(browser);

    await page.goto(`file://${indexPath}?debug=w`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const config = {
        dimsWidth: 1,
        dimsHeight: 1,
        dimsArea: 1,
        aspectRatio: 1,
        exponent: 2
      };
      const inheritedData = { diverged: [{ index: 0, iter: 7 }], converged: [] };
      const board = new GpuBoard(0, 1, 0, 0, config, 1, inheritedData);
      board.activeCount = 0;
      await board.compute(1);
      return {
        changeIters: board.changeList.map(change => change.iter),
        nn0: board.nn[0]
      };
    });

    expect(result.changeIters).toEqual([7]);
    expect(result.nn0).toBe(7);

    await page.close();
  }, TEST_TIMEOUT);

  async function getInheritedLogCount(page, boardType, className) {
    const logs = [];
    page.on('console', msg => logs.push(msg.text()));

    await page.goto(
      `file://${indexPath}?debug=dims:20x20,inherit&pixelratio=1&grid=1&board=${boardType}&inherit=1&c=-0.5+0i&z=2`,
      { waitUntil: 'domcontentloaded' }
    );

    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.unfinished() === 0;
    }, { timeout: 30000 });

    await page.evaluate(() => {
      const grid = window.explorer.grid;
      const parent = grid.views[0];
      const size = parent.size / grid.config.zoomfactor;
      grid.makeView(1, size, parent.re, parent.im, true);
      grid.startViewComputation(1);
    });

    const deadline = Date.now() + 30000;
    let line = null;
    while (Date.now() < deadline) {
      line = logs.find(msg => msg.includes(`Board 1 (${className})`) && msg.includes('received'));
      if (line) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!line) {
      throw new Error(`No inheritance log found for ${className}`);
    }
    const match = line.match(/received (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  test('GpuZhuoranBoard applies inherited precomputed points', async () => {
    const page = await setupPage(browser);
    const inheritedCount = await getInheritedLogCount(page, 'gpuz', 'GpuZhuoranBoard');
    expect(inheritedCount).toBeGreaterThan(0);
    await page.close();
  }, TEST_TIMEOUT);

  test('GpuAdaptiveBoard applies inherited precomputed points', async () => {
    const page = await setupPage(browser);
    const inheritedCount = await getInheritedLogCount(page, 'gpua', 'GpuAdaptiveBoard');
    expect(inheritedCount).toBeGreaterThan(0);
    await page.close();
  }, TEST_TIMEOUT);
});

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
  });

  test('computeInheritance rejects converged regions with mismatched periods', async () => {
    const page = await setupPage(browser);

    await page.goto(`file://${indexPath}?dims=5x5&grid=1`, {
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
      parent.convergedData.set(mismatchIdx, { z: [0, 0], p: 3 });

      const child = { size: parent.size, re: parent.re, im: parent.im };
      const inherited = grid.computeInheritance(parent, child);
      return {
        centerIdx,
        inherited: inherited.converged.map(item => item.index)
      };
    });

    expect(result.inherited).not.toContain(result.centerIdx);

    await page.close();
  }, TEST_TIMEOUT);

  test('CpuBoard flushes precomputed at the correct iteration', async () => {
    const page = await setupPage(browser);

    await page.goto(`file://${indexPath}`, { waitUntil: 'domcontentloaded' });

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

    await page.goto(`file://${indexPath}`, { waitUntil: 'domcontentloaded' });

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
});

#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Quick readback metrics check for GPU boards.
 */
const { setupBrowser, setupPage, closeBrowser } = require('./integration/test-utils');

const BOARD_TYPES = ['gpu', 'gpuz', 'gpua'];
const SIZE = 1000;
const DURATION_MS = 10000;
const LOCATION = {
  z: '3.13e3',
  c: '-0.75+0.025i'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildUrl(boardKey) {
  const debug = `t,dims:${SIZE}x${SIZE}`;
  const params = [
    `z=${LOCATION.z}`,
    `c=${encodeURIComponent(LOCATION.c)}`,
    'grid=1',
    `board=${boardKey}`,
    'gpu=1',
    'pixelratio=1',
    'maxiter=5000',
    `debug=${encodeURIComponent(debug)}`
  ].join('&');
  return `file://${__dirname}/../index.html?${params}`;
}

async function runBoard(browser, boardKey) {
  const url = buildUrl(boardKey);
  const page = await setupPage(browser);
  await page.setViewport({ width: SIZE + 100, height: SIZE + 100 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer?.grid?.views?.[0], { timeout: 60000 });
  await page.waitForFunction(() => window.explorer.grid.views[0]?.boardType, { timeout: 60000 });

  await sleep(DURATION_MS);

  const stats = await page.evaluate(() => {
    const view = window.explorer?.grid?.views?.[0];
    if (!view) return null;
    return {
      boardType: view.boardType,
      resultsReadbackBytes: view.resultsReadbackBytes || 0,
      resultsReadbackBatches: view.resultsReadbackBatches || 0,
      lastResultsCount: view.lastResultsCount || 0,
      activeCount: view.activeCount || 0,
      un: view.un || 0,
      di: view.di || 0
    };
  });

  await page.close();
  return stats;
}

async function run() {
  const browser = await setupBrowser();
  try {
    for (const boardKey of BOARD_TYPES) {
      const result = await runBoard(browser, boardKey);
      console.log(JSON.stringify(result));
    }
  } finally {
    await closeBrowser(browser);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

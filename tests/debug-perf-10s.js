/**
 * Simple 10-second performance benchmark for GPU boards
 * Measures iterations achieved at a difficult location: z=1e4&c=-0.75+0.01i
 */
const puppeteer = require('puppeteer');
const path = require('path');

const TEST_DURATION_MS = 30000;
const LOCATION = 'z=1e4&c=-0.75+0.01i';

async function runBenchmark(boardType) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${LOCATION}&board=${boardType}`;

  console.log(`\n=== ${boardType} ===`);
  console.log(`URL: ${url}`);

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  const startTime = Date.now();
  let lastIt = 0;
  let lastUn = -1;

  // Run for TEST_DURATION_MS
  while (Date.now() - startTime < TEST_DURATION_MS) {
    await new Promise(r => setTimeout(r, 500));

    const status = await page.evaluate(() => {
      const v = window.explorer?.grid?.views?.[0];
      if (!v) return null;
      return {
        it: v.it,
        un: v.un,
        di: v.di,
        boardType: v.boardType,
        compactionCount: v.compactionCount || 0,
        activeCount: v.activeCount || v.config?.dimsArea
      };
    });

    if (status) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (status.it !== lastIt || status.un !== lastUn) {
        console.log(`  ${elapsed}s: it=${status.it.toLocaleString()}, un=${status.un.toLocaleString()}, di=${status.di.toLocaleString()}, compactions=${status.compactionCount}, active=${status.activeCount.toLocaleString()}`);
        lastIt = status.it;
        lastUn = status.un;
      }
    }
  }

  // Final measurement
  const finalStatus = await page.evaluate(() => {
    const v = window.explorer?.grid?.views?.[0];
    if (!v) return null;
    return {
      it: v.it,
      un: v.un,
      di: v.di,
      boardType: v.boardType,
      dimsWidth: v.config.dimsWidth,
      dimsHeight: v.config.dimsHeight,
      compactionCount: v.compactionCount || 0,
      activeCount: v.activeCount || v.config?.dimsArea
    };
  });

  await browser.close();

  return {
    boardType,
    iterations: finalStatus?.it || 0,
    unfinished: finalStatus?.un || 0,
    diverged: finalStatus?.di || 0,
    dims: finalStatus ? `${finalStatus.dimsWidth}x${finalStatus.dimsHeight}` : 'unknown',
    compactionCount: finalStatus?.compactionCount || 0,
    activeCount: finalStatus?.activeCount || 0
  };
}

(async () => {
  console.log(`Performance benchmark: ${LOCATION}`);
  console.log(`Duration: ${TEST_DURATION_MS / 1000} seconds per board`);

  const boards = process.argv.slice(2);
  if (boards.length === 0) {
    boards.push('gpuz', 'adaptive');
  }

  const results = [];
  for (const board of boards) {
    const result = await runBenchmark(board);
    results.push(result);
    console.log(`\nResult: ${result.iterations.toLocaleString()} iterations, ${result.unfinished.toLocaleString()} unfinished, ${result.diverged.toLocaleString()} diverged, ${result.compactionCount} compactions`);
  }

  console.log('\n=== Summary ===');
  console.log('Board\t\tIterations\tCompactions\tUnfinished\tDims');
  for (const r of results) {
    console.log(`${r.boardType}\t\t${r.iterations.toLocaleString()}\t\t${r.compactionCount}\t\t${r.unfinished.toLocaleString()}\t\t${r.dims}`);
  }
})();

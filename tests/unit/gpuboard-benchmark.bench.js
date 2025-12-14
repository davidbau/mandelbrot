/**
 * Benchmark: GpuBoard buffer consolidation
 * Tests shallow zoom performance with consolidated 3-binding layout
 */
const path = require('path');
const { setupBrowser, setupPage, closeBrowser } = require('../integration/test-utils');

const TARGET_ITERATIONS = 1000000;  // 1 million iterations
const CENTER = '+0.1351987480952356+0.672078316539112i';
const ZOOM = '1e6';  // Within GpuBoard range (< 1e7)

async function runBenchmark(page) {
  const htmlPath = path.join(__dirname, '..', '..', 'index.html');
  const url = `file://${htmlPath}?c=${CENTER}&z=${ZOOM}&a=16:9&pixelratio=1&grid=1`;

  console.log(`\n=== Benchmarking GpuBoard at z=${ZOOM} ===`);

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && view.di > 0;
  }, { timeout: 30000 });

  const state = await page.evaluate(() => {
    const view = window.explorer.grid.views[0];
    return {
      boardType: view.board?.constructor?.name || 'unknown',
      total: view.nn?.length || 0
    };
  });

  console.log(`Board type: ${state.boardType}, pixels: ${state.total}`);

  const startTime = Date.now();
  const maxWaitMs = 120000;

  while (Date.now() - startTime < maxWaitMs) {
    const result = await page.evaluate((target) => {
      const view = window.explorer.grid.views[0];
      if (!view || !view.nn) return { maxIter: 0, computing: true };

      let maxIter = 0, computing = 0;
      for (let i = 0; i < view.nn.length; i++) {
        const n = view.nn[i];
        if (n === 0) computing++;
        else maxIter = Math.max(maxIter, Math.abs(n));
      }
      return { maxIter, computing, total: view.nn.length, done: computing === 0 || maxIter >= target };
    }, TARGET_ITERATIONS);

    if (result.maxIter >= TARGET_ITERATIONS || result.done) {
      const elapsed = Date.now() - startTime;
      console.log(`Completed: ${result.maxIter} iters in ${(elapsed / 1000).toFixed(2)}s`);
      return { elapsed, maxIter: result.maxIter };
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`Timeout`);
  return { elapsed: maxWaitMs, timeout: true };
}

async function main() {
  console.log('GpuBoard Benchmark (3-binding consolidated layout)');
  console.log(`Target: ${TARGET_ITERATIONS} iterations at z=${ZOOM}`);

  const browser = await setupBrowser();
  const results = [];

  try {
    for (let i = 1; i <= 5; i++) {
      console.log(`\n--- Run ${i} ---`);
      const page = await setupPage(browser);
      page.setDefaultTimeout(120000);
      // Viewport tuned for ~5-7 second benchmark
      await page.setViewport({ width: 1280, height: 720 });
      const result = await runBenchmark(page);
      results.push(result);
      await page.close();
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n=== RESULTS ===');
    const times = results.filter(r => !r.timeout).map(r => r.elapsed / 1000);
    console.log(`Times: ${times.map(t => t.toFixed(2) + 's').join(', ')}`);
    console.log(`Average: ${(times.reduce((a,b) => a+b, 0) / times.length).toFixed(2)}s`);

  } finally {
    await closeBrowser(browser);
  }
}

main().catch(console.error);

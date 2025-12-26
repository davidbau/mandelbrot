/**
 * Benchmark: GpuZhuoranBoard vs GpuAdaptiveBoard
 *
 * Measures time to reach 100,000 iterations at:
 * z=2e13, a=16:9, c=+0.1351987480952356+0.672078316539112i
 */

const path = require('path');
const { setupBrowser, setupPage, closeBrowser } = require('../integration/test-utils');

const TARGET_ITERATIONS = 1000000;  // 1 million iterations
const CENTER = '+0.1351987480952356+0.672078316539112i';
const ZOOM = '2e13';

async function runBenchmark(page, boardType) {
  const htmlPath = path.join(__dirname, '..', '..', 'index.html');
  const url = `file://${htmlPath}?c=${CENTER}&z=${ZOOM}&a=16:9&board=${boardType}&pixelratio=1&grid=1`;

  console.log(`\n=== Benchmarking ${boardType} ===`);
  console.log(`URL: ?c=${CENTER}&z=${ZOOM}&board=${boardType}`);

  // Capture console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`  [PAGE ERROR] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.log(`  [PAGE EXCEPTION] ${err.message}`);
  });

  console.log(`  Loading: ${url}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

  // Wait for computation to complete - GPU boards use di === total as completion indicator
  // But first just wait for any computation to happen
  console.log('  Waiting for computation to progress...');
  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    if (!view) return false;
    // GPU boards complete when di equals total (no "un" tracking for GPU)
    return view.di > 0;
  }, { timeout: 30000 });

  // Check state
  const preCheck = await page.evaluate(() => {
    const view = window.explorer?.grid?.views?.[0];
    return {
      hasBoard: !!view?.board,
      boardName: view?.board?.constructor?.name,
      viewDi: view?.di,
      viewUn: view?.un,
      viewTotal: view?.config?.dimsArea
    };
  });
  console.log(`  State: board=${preCheck.hasBoard} (${preCheck.boardName}), di=${preCheck.viewDi}, un=${preCheck.viewUn}, total=${preCheck.viewTotal}`);

  // Get initial state
  const initialState = await page.evaluate(() => {
    const view = window.explorer.grid.views[0];
    return {
      boardType: view.boardType || 'unknown',
      pixelSize: view.config?.pixelSize || 0
    };
  });

  console.log(`Board type: ${initialState.boardType}`);
  console.log(`Pixel size: ${initialState.pixelSize.toExponential(2)}`);

  const startTime = Date.now();

  // Poll until we reach target iterations or timeout
  const maxWaitMs = 120000; // 2 minutes max
  let lastMaxIter = 0;
  let lastLogTime = startTime;

  while (Date.now() - startTime < maxWaitMs) {
    const state = await page.evaluate((target) => {
      const view = window.explorer.grid.views[0];
      if (!view || !view.nn) {
        return { maxIter: 0, computing: true };
      }

      const nn = view.nn;
      let maxIter = 0;
      let computing = 0;

      for (let i = 0; i < nn.length; i++) {
        const n = nn[i];
        if (n === 0) {
          computing++;
        } else {
          maxIter = Math.max(maxIter, Math.abs(n));
        }
      }

      return {
        maxIter,
        computing,
        total: nn.length,
        done: computing === 0 || maxIter >= target
      };
    }, TARGET_ITERATIONS);

    // Log progress every 5 seconds
    const now = Date.now();
    if (now - lastLogTime > 5000 || state.maxIter !== lastMaxIter) {
      if (state.maxIter !== lastMaxIter) {
        console.log(`  Max iterations: ${state.maxIter}, still computing: ${state.computing}/${state.total}`);
        lastMaxIter = state.maxIter;
        lastLogTime = now;
      }
    }

    if (state.maxIter >= TARGET_ITERATIONS) {
      const elapsed = Date.now() - startTime;
      console.log(`\n✓ Reached ${TARGET_ITERATIONS} iterations in ${(elapsed / 1000).toFixed(2)}s`);
      return { boardType, elapsed, maxIter: state.maxIter };
    }

    if (state.done && state.maxIter < TARGET_ITERATIONS) {
      const elapsed = Date.now() - startTime;
      console.log(`\n✓ All pixels finished at ${state.maxIter} iterations in ${(elapsed / 1000).toFixed(2)}s`);
      return { boardType, elapsed, maxIter: state.maxIter };
    }

    await new Promise(r => setTimeout(r, 100));  // Poll frequently for precision
  }

  const elapsed = Date.now() - startTime;
  console.log(`\n✗ Timeout after ${(elapsed / 1000).toFixed(2)}s at ${lastMaxIter} iterations`);
  return { boardType, elapsed, maxIter: lastMaxIter, timeout: true };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Board Benchmark: GpuZhuoranBoard vs GpuAdaptiveBoard');
  console.log('='.repeat(60));
  console.log(`Target: ${TARGET_ITERATIONS} iterations`);
  console.log(`Location: c=${CENTER}, z=${ZOOM}`);

  const browser = await setupBrowser();

  try {
    // Run GpuZhuoranBoard benchmark
    const page1 = await setupPage(browser);
    page1.setDefaultTimeout(120000);
    await page1.setViewport({ width: 160, height: 90 }); // 16:9 aspect, small for speed
    const gpuzResult = await runBenchmark(page1, 'gpuz');
    await page1.close();

    // Small pause between tests
    await new Promise(r => setTimeout(r, 2000));

    // Run GpuAdaptiveBoard benchmark
    const page2 = await setupPage(browser);
    page2.setDefaultTimeout(120000);
    await page2.setViewport({ width: 160, height: 90 });
    const adaptiveResult = await runBenchmark(page2, 'gpua');
    await page2.close();

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`GpuZhuoranBoard: ${(gpuzResult.elapsed / 1000).toFixed(2)}s (${gpuzResult.maxIter} iters)`);
    console.log(`GpuAdaptiveBoard: ${(adaptiveResult.elapsed / 1000).toFixed(2)}s (${adaptiveResult.maxIter} iters)`);

    if (!gpuzResult.timeout && !adaptiveResult.timeout) {
      const ratio = adaptiveResult.elapsed / gpuzResult.elapsed;
      if (ratio > 1) {
        console.log(`\n→ GpuZhuoranBoard is ${ratio.toFixed(2)}x faster`);
      } else {
        console.log(`\n→ GpuAdaptiveBoard is ${(1/ratio).toFixed(2)}x faster`);
      }
    }

  } finally {
    await closeBrowser(browser);
  }
}

main().catch(console.error);

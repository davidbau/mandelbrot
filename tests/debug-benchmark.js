/**
 * Board Benchmark Script - Measures effort components
 *
 * Separates and measures:
 * 1. Per-pixel-iteration effort (μs per pixel per iteration)
 * 2. Per-iteration/batch overhead (μs per iterate() call)
 * 3. Setup overhead (ms to create board)
 *
 * Run with: node tests/debug-benchmark.js
 */

const puppeteer = require('puppeteer');
const path = require('path');

// All 9 board types
const BOARD_TYPES = [
  { name: 'cpu', class: 'CpuBoard', minZoom: 1, maxZoom: 1e7 },
  { name: 'gpu', class: 'GpuBoard', minZoom: 1, maxZoom: 1e7 },
  { name: 'pert', class: 'PerturbationBoard', minZoom: 1e7, maxZoom: 1e30 },
  { name: 'ddz', class: 'DDZhuoranBoard', minZoom: 1e7, maxZoom: 1e30 },
  { name: 'gpuz', class: 'GpuZhuoranBoard', minZoom: 1e15, maxZoom: 1e30 },
  { name: 'qdpert', class: 'QDPerturbationBoard', minZoom: 1e15, maxZoom: 1e60 },
  { name: 'qdz', class: 'QDZhuoranBoard', minZoom: 1e15, maxZoom: 1e60 },
  { name: 'qdcpu', class: 'QDCpuBoard', minZoom: 1e15, maxZoom: 1e60 },
  { name: 'adaptive', class: 'AdaptiveGpuBoard', minZoom: 1e20, maxZoom: 1e60 },
];

// Test locations - one for each zoom regime
const TEST_LOCATIONS = [
  { zoom: '6.25e2', center: '-0.06091+0.66869i', name: 'shallow' },
  { zoom: '1e15', center: '-0.7436438870371587+0.1318259042561202i', name: 'medium' },
  { zoom: '1e29', center: '-0.022281337871859783996817861398-0.698493620179801136370805820785i', name: 'deep' },
];

// Grid sizes to test (affects pixel count)
// viewport 160x90 with grid=G gives roughly (160/G)*(90/G) pixels
const GRID_SIZES = [40, 20, 10];  // ~16, ~72, ~288 pixels

// Iteration counts to test
const ITER_COUNTS = [100, 500, 1000];

async function runBenchmark() {
  console.log('Board Benchmark - Measuring effort components\n');
  console.log('Model: time = setup + (perBatch * batches) + (perPixelIter * pixels * iters)\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const allResults = [];

  for (const location of TEST_LOCATIONS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Location: ${location.name} (z=${location.zoom})`);
    console.log('='.repeat(60));

    const zoom = parseFloat(location.zoom);
    const applicableBoards = BOARD_TYPES.filter(
      b => zoom >= b.minZoom && zoom <= b.maxZoom
    );

    for (const boardType of applicableBoards) {
      console.log(`\n--- ${boardType.class} ---`);
      const boardResults = [];

      for (const gridSize of GRID_SIZES) {
        for (const iters of ITER_COUNTS) {
          // Skip expensive combinations for slow boards
          const isCpu = !['gpu', 'gpuz', 'adaptive'].includes(boardType.name);
          if (isCpu && gridSize === 10 && iters > 500) continue;
          if (isCpu && iters > 500) continue;

          const result = await measureBoard(browser, boardType, location, gridSize, iters);
          if (result) {
            boardResults.push(result);
            console.log(
              `  grid=${gridSize.toString().padStart(2)} pixels=${result.pixels.toString().padStart(4)} ` +
              `iters=${iters.toString().padStart(4)} → ${result.iterateMs.toFixed(0).padStart(5)}ms ` +
              `(${result.perPixelIterUs.toFixed(3)} μs/px-iter, ${result.perBatchUs.toFixed(0)} μs/batch)`
            );
            allResults.push({ ...result, board: boardType.name, location: location.name });
          }
        }
      }

      // Fit model for this board
      if (boardResults.length >= 3) {
        const model = fitModel(boardResults);
        console.log(`  → Model: perPixelIter=${model.perPixelIterUs.toFixed(3)} μs, perBatch=${model.perBatchUs.toFixed(0)} μs`);
      }
    }
  }

  await browser.close();

  // Print summary
  printSummary(allResults);
}

async function measureBoard(browser, boardType, location, gridSize, targetIters) {
  const page = await browser.newPage();
  await page.setViewport({ width: 160, height: 90 });

  const params = new URLSearchParams({
    z: location.zoom,
    c: location.center,
    a: '16:9',
    grid: String(gridSize),
    pixelratio: '1',
    board: boardType.name,
    debug: 'w,s'
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  try {
    const setupStart = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.worker0?.boards?.size > 0, { timeout: 15000 });
    const setupEnd = Date.now();

    // Get initial state
    const initialState = await page.evaluate(() => {
      const board = Array.from(window.worker0.boards.values())[0];
      return { pixels: board.un, iter: board.it, batchSize: board.batchSize || 100 };
    });

    // Run iterations
    const iterStart = Date.now();
    await page.evaluate((target) => step(target), targetIters);
    await page.waitForFunction(() => window.worker0.stepsRequested === 0, { timeout: 30000 });
    const iterEnd = Date.now();

    // Get final state
    const finalState = await page.evaluate(() => {
      const board = Array.from(window.worker0.boards.values())[0];
      return { iter: board.it, batches: window.worker0.steps };
    });

    await page.evaluate(() => { if (window.worker0) window.worker0.terminate?.(); });
    await page.close();

    const iterations = finalState.iter - initialState.iter;
    const iterateMs = iterEnd - iterStart;
    const batches = finalState.batches || Math.ceil(iterations / (initialState.batchSize || 100));

    return {
      gridSize,
      pixels: initialState.pixels,
      iterations,
      batches,
      setupMs: setupEnd - setupStart,
      iterateMs,
      perPixelIterUs: (iterateMs * 1000) / (initialState.pixels * iterations),
      perBatchUs: (iterateMs * 1000) / batches
    };

  } catch (err) {
    await page.evaluate(() => { if (window.worker0) window.worker0.terminate?.(); }).catch(() => {});
    await page.close();
    return null;
  }
}

// Fit model: time = perBatch * batches + perPixelIter * pixels * iters
function fitModel(results) {
  // Simple linear regression using pixel-iterations as x, time as y
  // Assumes perBatch is relatively constant per batch
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0, n = results.length;

  for (const r of results) {
    const x = r.pixels * r.iterations;
    const y = r.iterateMs * 1000; // Convert to μs
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const perPixelIterUs = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - perPixelIterUs * sumX) / n;

  // Estimate per-batch from intercept
  const avgBatches = results.reduce((sum, r) => sum + r.batches, 0) / n;
  const perBatchUs = Math.max(0, intercept / avgBatches);

  return { perPixelIterUs: Math.max(0, perPixelIterUs), perBatchUs };
}

function printSummary(allResults) {
  console.log('\n\n' + '='.repeat(70));
  console.log('SUMMARY: Effort by Board Type');
  console.log('='.repeat(70));

  // Group by board
  const byBoard = {};
  for (const r of allResults) {
    if (!byBoard[r.board]) byBoard[r.board] = [];
    byBoard[r.board].push(r);
  }

  console.log('\nBoard               Type   Avg μs/px-iter  Avg μs/batch   Notes');
  console.log('-'.repeat(70));

  const cpuBoards = ['cpu', 'pert', 'ddz', 'qdpert', 'qdz', 'qdcpu'];
  const gpuBoards = ['gpu', 'gpuz', 'adaptive'];

  // CPU boards first
  console.log('CPU Boards:');
  for (const name of cpuBoards) {
    if (byBoard[name]) {
      const results = byBoard[name];
      const avgPixelIter = results.reduce((s, r) => s + r.perPixelIterUs, 0) / results.length;
      const avgBatch = results.reduce((s, r) => s + r.perBatchUs, 0) / results.length;
      const board = BOARD_TYPES.find(b => b.name === name);
      console.log(
        `  ${board.class.padEnd(22)} ${avgPixelIter.toFixed(3).padStart(12)}  ${avgBatch.toFixed(0).padStart(12)}`
      );
    }
  }

  // GPU boards
  console.log('\nGPU Boards:');
  for (const name of gpuBoards) {
    if (byBoard[name]) {
      const results = byBoard[name];
      const avgPixelIter = results.reduce((s, r) => s + r.perPixelIterUs, 0) / results.length;
      const avgBatch = results.reduce((s, r) => s + r.perBatchUs, 0) / results.length;
      const board = BOARD_TYPES.find(b => b.name === name);
      console.log(
        `  ${board.class.padEnd(22)} ${avgPixelIter.toFixed(3).padStart(12)}  ${avgBatch.toFixed(0).padStart(12)}`
      );
    }
  }

  // Compute CPU baseline and GPU speedup
  const cpuBaseline = byBoard['cpu']
    ? byBoard['cpu'].reduce((s, r) => s + r.perPixelIterUs, 0) / byBoard['cpu'].length
    : 8.0;

  console.log('\n\nEffort Ratios (relative to CpuBoard per-pixel-iter):');
  console.log('-'.repeat(70));
  for (const name of [...cpuBoards, ...gpuBoards]) {
    if (byBoard[name]) {
      const results = byBoard[name];
      const avgPixelIter = results.reduce((s, r) => s + r.perPixelIterUs, 0) / results.length;
      const ratio = avgPixelIter / cpuBaseline;
      const board = BOARD_TYPES.find(b => b.name === name);
      console.log(`  ${board.class.padEnd(22)} effort = ${ratio.toFixed(2)}`);
    }
  }
}

runBenchmark().catch(console.error);

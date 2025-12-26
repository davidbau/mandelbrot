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
  { name: 'gpua', class: 'GpuAdaptiveBoard', minZoom: 1e20, maxZoom: 1e60 },
];

// Test locations - one for each zoom regime
const TEST_LOCATIONS = [
  { zoom: '6.25e2', center: '-0.06091+0.66869i', name: 'shallow' },
  { zoom: '1e15', center: '-0.7436438870371587+0.1318259042561202i', name: 'medium' },
  { zoom: '1e29', center: '-0.022281337871859783996817861398-0.698493620179801136370805820785i', name: 'deep' },
];

// Viewport sizes to test (affects pixel count significantly)
// With grid=20, viewport WxH gives roughly (W/20)*(H/20) pixels
const VIEWPORT_SIZES = [
  { width: 80, height: 45 },    // ~8 pixels
  { width: 160, height: 90 },   // ~32 pixels
  { width: 320, height: 180 },  // ~128 pixels
  { width: 640, height: 360 },  // ~512 pixels
];
const GRID_SIZE = 20;  // Fixed grid size

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

      for (const viewport of VIEWPORT_SIZES) {
        for (const iters of ITER_COUNTS) {
          // Skip expensive combinations for slow boards
          const isCpu = !['gpu', 'gpuz', 'gpua'].includes(boardType.name);
          const isLargeViewport = viewport.width >= 640;
          if (isCpu && isLargeViewport && iters > 100) continue;
          if (isCpu && iters > 500) continue;

          const result = await measureBoard(browser, boardType, location, viewport, iters);
          if (result) {
            boardResults.push(result);
            console.log(
              `  ${viewport.width}x${viewport.height} pixels=${result.pixels.toString().padStart(4)} ` +
              `iters=${iters.toString().padStart(4)} → ${result.iterateMs.toFixed(0).padStart(5)}ms ` +
              `(${result.perPixelIterUs.toFixed(3)} μs/px-iter, ${result.perBatchUs.toFixed(0)} μs/batch)`
            );
            allResults.push({ ...result, board: boardType.name, location: location.name });
          }
        }
      }

      // Fit model for this board
      if (boardResults.length >= 4) {
        const model = fitModel(boardResults);
        const perIterStr = model.perIterUs > 0.1 ? `, perIter=${model.perIterUs.toFixed(1)} μs` : '';
        console.log(`  → Model: perPixelIter=${model.perPixelIterUs.toFixed(3)} μs${perIterStr}, perBatch=${model.perBatchUs.toFixed(0)} μs`);
      }
    }
  }

  await browser.close();

  // Print summary
  printSummary(allResults);
}

async function measureBoard(browser, boardType, location, viewport, targetIters) {
  const page = await browser.newPage();
  await page.setViewport(viewport);

  const params = new URLSearchParams({
    z: location.zoom,
    c: location.center,
    a: '16:9',
    grid: String(GRID_SIZE),
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
      viewport,
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

// Fit model: time = perBatch * batches + perIter * iters + perPixelIter * pixels * iters
// Uses multiple linear regression to separate per-iteration costs (reference orbit, threading)
// from per-pixel-iteration costs (the inner loop)
function fitModel(results) {
  if (results.length < 4) {
    // Fall back to simple model if not enough data points
    return fitSimpleModel(results);
  }

  // Multiple linear regression: y = b0 + b1*x1 + b2*x2 + b3*x3
  // where x1 = batches, x2 = iterations, x3 = pixels * iterations
  // We want to find perBatch (b1), perIter (b2), perPixelIter (b3)

  const n = results.length;

  // Build matrices for normal equations: (X'X)b = X'y
  // X has columns: [1, batches, iters, pixels*iters]
  // We'll solve using Cramer's rule for the 3-variable case (ignoring intercept)

  let sum_b = 0, sum_i = 0, sum_pi = 0, sum_y = 0;
  let sum_bb = 0, sum_ii = 0, sum_pipi = 0;
  let sum_bi = 0, sum_bpi = 0, sum_ipi = 0;
  let sum_by = 0, sum_iy = 0, sum_piy = 0;

  for (const r of results) {
    const b = r.batches;
    const i = r.iterations;
    const pi = r.pixels * r.iterations;
    const y = r.iterateMs * 1000; // Convert to μs

    sum_b += b; sum_i += i; sum_pi += pi; sum_y += y;
    sum_bb += b*b; sum_ii += i*i; sum_pipi += pi*pi;
    sum_bi += b*i; sum_bpi += b*pi; sum_ipi += i*pi;
    sum_by += b*y; sum_iy += i*y; sum_piy += pi*y;
  }

  // Solve 3x3 system using normal equations (centered to reduce intercept effect)
  // [sum_bb  sum_bi  sum_bpi ] [perBatch    ]   [sum_by ]
  // [sum_bi  sum_ii  sum_ipi ] [perIter     ] = [sum_iy ]
  // [sum_bpi sum_ipi sum_pipi] [perPixelIter]   [sum_piy]

  const A = [
    [sum_bb, sum_bi, sum_bpi],
    [sum_bi, sum_ii, sum_ipi],
    [sum_bpi, sum_ipi, sum_pipi]
  ];
  const B = [sum_by, sum_iy, sum_piy];

  // Solve using Gaussian elimination
  const solution = solveLinearSystem(A, B);

  if (solution) {
    return {
      perBatchUs: Math.max(0, solution[0]),
      perIterUs: Math.max(0, solution[1]),
      perPixelIterUs: Math.max(0, solution[2])
    };
  }

  // Fall back to simple model if system is singular
  return fitSimpleModel(results);
}

// Simple 2-variable model as fallback
function fitSimpleModel(results) {
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  const n = results.length;

  for (const r of results) {
    const x = r.pixels * r.iterations;
    const y = r.iterateMs * 1000;
    sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) {
    return { perBatchUs: 0, perIterUs: 0, perPixelIterUs: 0 };
  }

  const perPixelIterUs = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - perPixelIterUs * sumX) / n;
  const avgBatches = results.reduce((sum, r) => sum + r.batches, 0) / n;

  return {
    perBatchUs: Math.max(0, intercept / avgBatches),
    perIterUs: 0,  // Can't separate with simple model
    perPixelIterUs: Math.max(0, perPixelIterUs)
  };
}

// Gaussian elimination to solve Ax = B
function solveLinearSystem(A, B) {
  const n = A.length;
  const aug = A.map((row, i) => [...row, B[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-10) return null; // Singular

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }

  return x;
}

function printSummary(allResults) {
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY: Effort by Board Type (using 3-variable regression model)');
  console.log('='.repeat(80));

  // Group by board
  const byBoard = {};
  for (const r of allResults) {
    if (!byBoard[r.board]) byBoard[r.board] = [];
    byBoard[r.board].push(r);
  }

  console.log('\nModel: time = perBatch×batches + perIter×iters + perPixelIter×pixels×iters');
  console.log('\nBoard                  μs/px-iter   μs/iter   μs/batch   Notes');
  console.log('-'.repeat(80));

  const cpuBoards = ['cpu', 'pert', 'ddz', 'qdpert', 'qdz', 'qdcpu'];
  const gpuBoards = ['gpu', 'gpuz', 'gpua'];

  // Helper to print board stats
  function printBoardStats(name) {
    if (!byBoard[name]) return null;
    const results = byBoard[name];
    const model = fitModel(results);
    const board = BOARD_TYPES.find(b => b.name === name);

    // Notes about what contributes to per-iteration cost
    let notes = '';
    if (['pert', 'ddz', 'gpuz'].includes(name)) notes = 'DD ref orbit';
    if (['qdpert', 'qdz', 'qdcpu', 'gpua'].includes(name)) notes = 'QD ref orbit + threading';

    console.log(
      `  ${board.class.padEnd(20)} ` +
      `${model.perPixelIterUs.toFixed(3).padStart(10)}  ` +
      `${model.perIterUs.toFixed(1).padStart(8)}  ` +
      `${model.perBatchUs.toFixed(0).padStart(8)}   ${notes}`
    );
    return model;
  }

  // CPU boards first
  console.log('CPU Boards:');
  const cpuModels = {};
  for (const name of cpuBoards) {
    const model = printBoardStats(name);
    if (model) cpuModels[name] = model;
  }

  // GPU boards
  console.log('\nGPU Boards:');
  const gpuModels = {};
  for (const name of gpuBoards) {
    const model = printBoardStats(name);
    if (model) gpuModels[name] = model;
  }

  // Compute CPU baseline
  const cpuBaseline = cpuModels['cpu']?.perPixelIterUs || 8.0;

  console.log('\n\nEffort Ratios (relative to CpuBoard per-pixel-iter):');
  console.log('-'.repeat(80));
  for (const name of [...cpuBoards, ...gpuBoards]) {
    const model = cpuModels[name] || gpuModels[name];
    if (model) {
      const ratio = model.perPixelIterUs / cpuBaseline;
      const board = BOARD_TYPES.find(b => b.name === name);
      console.log(`  ${board.class.padEnd(22)} effort = ${ratio.toFixed(2)}`);
    }
  }

  // Per-iteration cost analysis
  console.log('\n\nPer-Iteration Overhead Analysis:');
  console.log('-'.repeat(80));
  console.log('This captures costs that scale with iteration count but not pixel count:');
  console.log('  - Reference orbit computation (one point per iteration)');
  console.log('  - Spatial hash threading (advancing thread pointers)');
  console.log('  - QD arithmetic for reference point updates\n');

  for (const name of [...cpuBoards, ...gpuBoards]) {
    const model = cpuModels[name] || gpuModels[name];
    if (model && model.perIterUs > 0.1) {
      const board = BOARD_TYPES.find(b => b.name === name);
      console.log(`  ${board.class.padEnd(22)} ${model.perIterUs.toFixed(1)} μs/iter`);
    }
  }
}

runBenchmark().catch(console.error);

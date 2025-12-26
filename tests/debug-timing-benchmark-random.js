/**
 * Board Timing Benchmark Script with Random Batch Sizes
 *
 * Uses debug=r,t to capture per-batch timing with randomized iteration counts.
 * This provides varied data for regression analysis to separate:
 * - per-batch overhead
 * - per-iteration overhead
 * - per-pixel-iteration cost
 *
 * Run with: node tests/debug-timing-benchmark-random.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// All 9 board types with their applicable zoom ranges
const BOARD_TYPES = [
  { name: 'cpu', class: 'CpuBoard', minZoom: 1, maxZoom: 1e7 },
  { name: 'gpu', class: 'GpuBoard', minZoom: 1, maxZoom: 1e7 },
  { name: 'pert', class: 'PerturbationBoard', minZoom: 1e7, maxZoom: 1e30 },
  { name: 'ddz', class: 'DDZhuoranBoard', minZoom: 1e7, maxZoom: 1e30 },
  { name: 'gpuz', class: 'GpuZhuoranBoard', minZoom: 1e15, maxZoom: 1e30 },
  { name: 'qdpert', class: 'QDPerturbationBoard', minZoom: 1e15, maxZoom: 1e60 },
  { name: 'qdz', class: 'QDZhuoranBoard', minZoom: 1e15, maxZoom: 1e60 },
  { name: 'qdcpu', class: 'QDCpuBoard', minZoom: 1e15, maxZoom: 1e60 },
  { name: 'gpua', class: 'GpuAdaptiveBoard', minZoom: 1, maxZoom: 1e60 },
];

// Test locations with good variety of divergence iterations
const TEST_LOCATIONS = [
  // Shallow zoom locations (z < 1e7) - for CpuBoard, GpuBoard, GpuAdaptiveBoard
  { zoom: '6.25e2', center: '-0.06091+0.66869i', name: 'shallow-1' },
  { zoom: '1.56e4', center: '0.3179693+0.4910749i', name: 'shallow-2' },
  { zoom: '6.25e2', center: '-0.151298-0.651081i', name: 'shallow-3' },
  { zoom: '6.25e2', center: '-1.274128+0.051835i', name: 'shallow-4' },
  { zoom: '7.81e4', center: '-1.25882413+0.37111806i', name: 'shallow-5' },
  { zoom: '2e3', center: '0.255', name: 'shallow-6' },

  // Medium zoom locations (1e7 < z < 1e15) - for perturbation boards
  { zoom: '4.88e7', center: '-1.27426238265+0.05287979093i', name: 'medium-1' },
  { zoom: '6.1e9', center: '-1.2742623828096+0.0528797924191i', name: 'medium-2' },
  { zoom: '4.88e7', center: '-0.15425198679+1.03090421475i', name: 'medium-3' },
  { zoom: '4.88e7', center: '-0.71421392803+0.34279063014i', name: 'medium-4' },
  { zoom: '1.22e9', center: '-0.053676395627-0.824478707782i', name: 'medium-5' },

  // Deep zoom locations (z > 1e15) - for QD boards
  { zoom: '5.96e16', center: '-1.76996758006287504637+0.060848954006235563i', name: 'deep-1' },
  { zoom: '1e29', center: '-0.022281337871859783996817861398-0.698493620179801136370805820785i', name: 'deep-2' },
  { zoom: '1.19e16', center: '-0.7063200108619434421-0.2632870302196468469i', name: 'deep-3' },
  { zoom: '2.98e17', center: '-1.788083360753351495505+0.004559577823447779574i', name: 'deep-4' },
  { zoom: '1.86e20', center: '-0.62058967561712049745596+0.6657707830868599902448i', name: 'deep-5' },
];

const VIEWPORT = { width: 640, height: 360 };
const GRID_SIZE = 20;
const TARGET_ITERS = 3000;  // Run until ~3000 iterations or done
const MAX_TIME_MS = 120000; // Safety timeout: 2 minutes per board/location
const NUM_RUNS = 3;

// Results directory
const RESULTS_DIR = path.join(__dirname, 'benchmark-results');

async function runBenchmark() {
  console.log('Board Timing Benchmark (Random Batch Sizes)');
  console.log('='.repeat(80));
  console.log(`Runs: ${NUM_RUNS}, Target iterations: ${TARGET_ITERS}`);
  console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}, Grid: ${GRID_SIZE}`);
  console.log('Using debug=r,t for random batch sizes with timing output');
  console.log('');

  // Create results directory
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const allResults = [];

  for (let run = 1; run <= NUM_RUNS; run++) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`RUN ${run} of ${NUM_RUNS}`);
    console.log('='.repeat(80));

    for (const location of TEST_LOCATIONS) {
      const zoom = parseFloat(location.zoom);

      // Find all boards applicable at this zoom level
      const applicableBoards = BOARD_TYPES.filter(
        b => zoom >= b.minZoom && zoom <= b.maxZoom
      );

      if (applicableBoards.length === 0) continue;

      console.log(`\n--- ${location.name} (z=${location.zoom}) ---`);

      for (const boardType of applicableBoards) {
        process.stdout.write(`  ${boardType.class.padEnd(22)} `);

        const timings = await measureBoard(browser, boardType, location);

        if (timings.length > 0) {
          // Compute statistics
          const values = timings.map(t => t.usPerPixelIter).filter(v => v > 0);
          const n = values.length;
          if (n === 0) {
            console.log('no valid samples');
            continue;
          }

          const avg = values.reduce((a, b) => a + b, 0) / n;
          const sorted = [...values].sort((a, b) => a - b);
          const median = sorted[Math.floor(n / 2)];

          // Aggregate stats
          const totalPixelIters = timings.reduce((s, t) => s + t.pixels * t.iters, 0);
          const totalTimeMs = timings.reduce((s, t) => s + t.timeMs, 0);
          const totalIters = timings.reduce((s, t) => s + t.iters, 0);
          const avgPixels = timings.reduce((s, t) => s + t.pixels, 0) / n;
          const avgIters = totalIters / n;

          // Iteration range for verifying randomization
          const iterRange = timings.map(t => t.iters);
          const minIters = Math.min(...iterRange);
          const maxIters = Math.max(...iterRange);

          const result = {
            run,
            timestamp,
            board: boardType.name,
            boardClass: boardType.class,
            location: location.name,
            zoom: location.zoom,
            samples: n,
            median,
            avg,
            totalPixelIters,
            totalTimeMs,
            totalIters,
            batches: n,
            avgPixels,
            avgIters,
            minIters,
            maxIters,
            timings  // Raw data
          };

          allResults.push(result);
          console.log(`${n} batches, iters ${minIters}-${maxIters}, total ${totalIters} iters`);
        } else {
          console.log('FAILED');
        }
      }
    }
  }

  await browser.close();

  // Save results to JSON
  const resultsFile = path.join(RESULTS_DIR, `timing-random-${timestamp}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to: ${resultsFile}`);

  // Analyze and print summary
  printAnalysis(allResults);
}

async function measureBoard(browser, boardType, location) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  const timings = [];
  let totalIters = 0;

  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[timing]')) {
      const match = text.match(/\[timing\] (\w+) k=(\d+): (\d+) px × (\d+) iters = ([\d.]+)ms \(([\d.]+) μs\/px-iter\)/);
      if (match) {
        const iters = parseInt(match[4]);
        totalIters += iters;
        timings.push({
          boardType: match[1],
          k: parseInt(match[2]),
          pixels: parseInt(match[3]),
          iters: iters,
          timeMs: parseFloat(match[5]),
          usPerPixelIter: parseFloat(match[6])
        });
      }
    }
  });

  const params = new URLSearchParams({
    z: location.zoom,
    c: location.center,
    a: '16:9',
    grid: String(GRID_SIZE),
    pixelratio: '1',
    board: boardType.name,
    debug: 'r,t'  // Random batching + timing output (on worker threads)
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  try {
    await page.goto(url, { waitUntil: 'load' });

    // Wait for board to be created
    await page.waitForFunction(() => {
      return document.querySelector('canvas') !== null;
    }, { timeout: 15000 });

    // Wait a moment for workers to start
    await new Promise(resolve => setTimeout(resolve, 500));

    // Poll until we reach target iterations or all pixels are done
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_TIME_MS) {
      // Check if we've reached target iterations
      if (totalIters >= TARGET_ITERS) {
        break;
      }

      // Check if computation is done (no more unfinished pixels)
      const done = await page.evaluate(() => {
        // Check if any board still has unfinished pixels
        const status = document.querySelector('.status');
        if (status && status.textContent.includes('done')) return true;
        return false;
      }).catch(() => false);

      if (done) break;

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Give a moment for any final timing logs to come through
    await new Promise(resolve => setTimeout(resolve, 300));

    await page.close();
    return timings;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    await page.close();
    return [];
  }
}

function printAnalysis(allResults) {
  console.log('\n\n' + '='.repeat(100));
  console.log('ANALYSIS SUMMARY');
  console.log('='.repeat(100));

  // Group by board type
  const byBoard = {};
  for (const r of allResults) {
    if (!byBoard[r.board]) byBoard[r.board] = [];
    byBoard[r.board].push(r);
  }

  // Per-board summary
  console.log('\nPer-Board Statistics:');
  console.log('-'.repeat(100));
  console.log('Board                  Samples   Batches   Iter Range      Total Iters   Throughput');
  console.log('-'.repeat(100));

  for (const [boardName, results] of Object.entries(byBoard)) {
    const totalBatches = results.reduce((s, r) => s + r.batches, 0);
    const totalIters = results.reduce((s, r) => s + r.totalIters, 0);
    const totalTimeMs = results.reduce((s, r) => s + r.totalTimeMs, 0);
    const allTimings = results.flatMap(r => r.timings || []);

    const iterRange = allTimings.map(t => t.iters);
    const minIters = Math.min(...iterRange);
    const maxIters = Math.max(...iterRange);

    // Throughput at full pixels
    const fullPixelTimings = allTimings.filter(t => t.pixels >= 500);
    let throughput = 'N/A';
    if (fullPixelTimings.length > 0) {
      const fpTotalWork = fullPixelTimings.reduce((s, t) => s + t.pixels * t.iters, 0);
      const fpTotalTime = fullPixelTimings.reduce((s, t) => s + t.timeMs, 0);
      throughput = (fpTotalWork / fpTotalTime / 1000).toFixed(1) + ' M/s';
    }

    const boardClass = BOARD_TYPES.find(b => b.name === boardName)?.class || boardName;
    console.log(
      `${boardClass.padEnd(22)} ${String(results.length).padStart(7)}   ` +
      `${String(totalBatches).padStart(7)}   ` +
      `${(minIters + '-' + maxIters).padStart(12)}   ` +
      `${String(totalIters).padStart(12)}   ` +
      `${throughput.padStart(12)}`
    );
  }

  // Regression analysis
  console.log('\n\nRegression Analysis (3-variable model):');
  console.log('Model: time_μs = perBatch + perIter×iters + perPixelIter×pixels×iters');
  console.log('-'.repeat(100));

  for (const [boardName, results] of Object.entries(byBoard)) {
    const allTimings = results.flatMap(r => r.timings || []);
    if (allTimings.length < 20) continue;

    // Only use samples with reasonable pixel counts for stable regression
    const filtered = allTimings.filter(t => t.pixels >= 100);
    if (filtered.length < 10) continue;

    // 3-variable regression: time = a + b*iters + c*pixels*iters
    const model = fitModel(filtered);
    if (model) {
      const boardClass = BOARD_TYPES.find(b => b.name === boardName)?.class || boardName;
      console.log(
        `${boardClass.padEnd(22)} ` +
        `perBatch=${model.perBatch.toFixed(0)}μs, ` +
        `perIter=${model.perIter.toFixed(3)}μs, ` +
        `perPixelIter=${model.perPixelIter.toFixed(4)}μs ` +
        `(n=${filtered.length})`
      );
    }
  }
}

// Fit 3-variable model: time = a + b*iters + c*pixels*iters
function fitModel(timings) {
  const n = timings.length;
  if (n < 10) return null;

  // Build sums for normal equations
  let s1 = 0, sI = 0, sPI = 0, sY = 0;
  let sII = 0, sIPI = 0, sPIPI = 0;
  let sIY = 0, sPIY = 0;

  for (const t of timings) {
    const i = t.iters;
    const pi = t.pixels * t.iters;
    const y = t.timeMs * 1000;  // Convert to μs

    s1 += 1;
    sI += i;
    sPI += pi;
    sY += y;
    sII += i * i;
    sIPI += i * pi;
    sPIPI += pi * pi;
    sIY += i * y;
    sPIY += pi * y;
  }

  // Solve 3x3 system
  const A = [
    [s1, sI, sPI],
    [sI, sII, sIPI],
    [sPI, sIPI, sPIPI]
  ];
  const B = [sY, sIY, sPIY];

  const sol = solve3x3(A, B);
  if (!sol) return null;

  return {
    perBatch: sol[0],
    perIter: sol[1],
    perPixelIter: sol[2]
  };
}

function solve3x3(A, B) {
  const n = 3;
  const aug = A.map((row, i) => [...row, B[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    if (Math.abs(aug[col][col]) < 1e-10) return null;

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i];
  }
  return x;
}

runBenchmark().catch(console.error);

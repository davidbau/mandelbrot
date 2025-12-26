/**
 * Board Timing Benchmark Script
 *
 * Uses debug=t,w to capture per-batch timing output from all board types.
 * Tests each board at all applicable zoom levels.
 * Saves results to JSON for accumulation across runs.
 *
 * Run with: node tests/debug-timing-benchmark.js
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
  { name: 'gpua', class: 'GpuAdaptiveBoard', minZoom: 1, maxZoom: 1e60 },  // Works at all zooms
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
const RUN_TIME_MS = 8000;  // 8 seconds per board/location combo
const NUM_RUNS = 3;

// Results directory
const RESULTS_DIR = path.join(__dirname, 'benchmark-results');

async function runBenchmark() {
  console.log('Board Timing Benchmark');
  console.log('='.repeat(80));
  console.log(`Runs: ${NUM_RUNS}, Time per test: ${RUN_TIME_MS/1000}s`);
  console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}, Grid: ${GRID_SIZE}`);
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
            timings  // Raw data
          };

          allResults.push(result);
          console.log(`${n} samples, median ${median.toFixed(3)} μs/px-iter, avg ${avg.toFixed(3)}`);
        } else {
          console.log('FAILED');
        }
      }
    }
  }

  await browser.close();

  // Save results to JSON
  const resultsFile = path.join(RESULTS_DIR, `timing-${timestamp}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to: ${resultsFile}`);

  // Analyze and print summary
  printAnalysis(allResults);
}

async function measureBoard(browser, boardType, location) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  const timings = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[timing]')) {
      const match = text.match(/\[timing\] (\w+) k=(\d+): (\d+) px × (\d+) iters = ([\d.]+)ms \(([\d.]+) μs\/px-iter\)/);
      if (match) {
        timings.push({
          boardType: match[1],
          k: parseInt(match[2]),
          pixels: parseInt(match[3]),
          iters: parseInt(match[4]),
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
    debug: 't,w'
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.worker0?.boards?.size > 0, { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, RUN_TIME_MS));
    await page.evaluate(() => { if (window.worker0) window.worker0.terminate?.(); });
    await page.close();
    return timings;
  } catch (err) {
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
  console.log('\nPer-Board Median μs/px-iter (across all runs and locations):');
  console.log('-'.repeat(100));
  console.log('Board                  Samples   Median     Avg        Min        Max        StdDev');
  console.log('-'.repeat(100));

  const boardStats = {};
  for (const [boardName, results] of Object.entries(byBoard)) {
    // Collect all median values from each test
    const medians = results.map(r => r.median);
    const n = medians.length;
    const avg = medians.reduce((a, b) => a + b, 0) / n;
    const sorted = [...medians].sort((a, b) => a - b);
    const median = sorted[Math.floor(n / 2)];
    const min = sorted[0];
    const max = sorted[n - 1];
    const variance = medians.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    const boardClass = BOARD_TYPES.find(b => b.name === boardName)?.class || boardName;
    boardStats[boardName] = { median, avg, min, max, stdDev, n, boardClass };

    console.log(
      `${boardClass.padEnd(22)} ${String(n).padStart(7)}   ` +
      `${median.toFixed(3).padStart(8)}   ` +
      `${avg.toFixed(3).padStart(8)}   ` +
      `${min.toFixed(3).padStart(8)}   ` +
      `${max.toFixed(3).padStart(8)}   ` +
      `${stdDev.toFixed(3).padStart(8)}`
    );
  }

  // Overhead estimation using regression
  console.log('\n\nOverhead Estimation (linear regression on raw timing data):');
  console.log('-'.repeat(100));
  console.log('Model: time_ms = overhead_ms + (μs/px-iter × pixels × iters) / 1000');
  console.log('');
  console.log('Board                  μs/px-iter   Overhead/batch   Effort (vs CPU=100)');
  console.log('-'.repeat(100));

  const cpuMedian = boardStats['cpu']?.median || 0.03;

  for (const [boardName, results] of Object.entries(byBoard)) {
    // Aggregate all raw timings for regression
    const allTimings = results.flatMap(r => r.timings || []);
    if (allTimings.length < 10) continue;

    // Simple linear regression: timeMs = a + b * (pixels * iters)
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    const n = allTimings.length;

    for (const t of allTimings) {
      const x = t.pixels * t.iters;
      const y = t.timeMs;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) continue;

    const slope = (n * sumXY - sumX * sumY) / denom;  // ms per pixel-iter
    const intercept = (sumY - slope * sumX) / n;      // ms overhead per batch

    const usPerPixelIter = slope * 1000;  // Convert to μs
    const overheadMs = intercept;
    const effort = Math.round((boardStats[boardName].median / cpuMedian) * 100);

    const boardClass = BOARD_TYPES.find(b => b.name === boardName)?.class || boardName;
    console.log(
      `${boardClass.padEnd(22)} ${usPerPixelIter.toFixed(4).padStart(10)}   ` +
      `${overheadMs.toFixed(3).padStart(12)} ms   ` +
      `${String(effort).padStart(8)}`
    );
  }

  // Effort table for code update
  console.log('\n\nRecommended effort values (for scheduler):');
  console.log('-'.repeat(60));

  for (const [boardName, stats] of Object.entries(boardStats)) {
    const effort = Math.round((stats.median / cpuMedian) * 100);
    console.log(`  ${stats.boardClass.padEnd(22)} effort = ${effort}`);
  }
}

runBenchmark().catch(console.error);

/**
 * Quick timing benchmark - tests each board type at one representative location
 * for 30 seconds each to get stable measurements.
 */

const puppeteer = require('puppeteer');
const path = require('path');

// All 9 board types with one representative location each
const TESTS = [
  { board: 'cpu', zoom: '6.25e2', center: '-0.06091+0.66869i', name: 'CpuBoard' },
  { board: 'gpu', zoom: '6.25e2', center: '-0.06091+0.66869i', name: 'GpuBoard' },
  { board: 'pert', zoom: '4.88e7', center: '-1.27426238265+0.05287979093i', name: 'PerturbationBoard' },
  { board: 'ddz', zoom: '4.88e7', center: '-1.27426238265+0.05287979093i', name: 'DDZhuoranBoard' },
  { board: 'gpuz', zoom: '5.96e16', center: '-1.76996758006287504637+0.060848954006235563i', name: 'GpuZhuoranBoard' },
  { board: 'qdpert', zoom: '5.96e16', center: '-1.76996758006287504637+0.060848954006235563i', name: 'QDPerturbationBoard' },
  { board: 'qdz', zoom: '5.96e16', center: '-1.76996758006287504637+0.060848954006235563i', name: 'QDZhuoranBoard' },
  { board: 'qdcpu', zoom: '5.96e16', center: '-1.76996758006287504637+0.060848954006235563i', name: 'QDCpuBoard' },
  { board: 'gpua', zoom: '1e29', center: '-0.022281337871859783996817861398-0.698493620179801136370805820785i', name: 'GpuAdaptiveBoard' },
];

const VIEWPORT = { width: 640, height: 360 };
const GRID_SIZE = 20;
const RUN_TIME_MS = 30000;  // 30 seconds per board

async function runBenchmark() {
  console.log('Stable Timing Benchmark (30s per board)');
  console.log('='.repeat(80));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const results = [];

  for (const test of TESTS) {
    process.stdout.write(`Testing ${test.name}... `);
    const timings = await measureBoard(browser, test);

    if (timings.length > 0) {
      // Compute statistics
      const values = timings.map(t => t.usPerPixelIter);
      const n = values.length;
      const avg = values.reduce((a, b) => a + b, 0) / n;
      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted[Math.floor(n / 2)];
      const p10 = sorted[Math.floor(n * 0.1)];
      const p90 = sorted[Math.floor(n * 0.9)];

      // Compute total work for regression
      const totalPixelIters = timings.reduce((s, t) => s + t.pixels * t.iters, 0);
      const totalTimeMs = timings.reduce((s, t) => s + t.timeMs, 0);
      const batches = timings.length;
      const totalIters = timings.reduce((s, t) => s + t.iters, 0);

      results.push({
        name: test.name,
        samples: n,
        avg,
        median,
        p10,
        p90,
        totalPixelIters,
        totalTimeMs,
        batches,
        totalIters
      });

      console.log(`${n} samples, median ${median.toFixed(3)} μs/px-iter`);
    } else {
      console.log('FAILED');
    }
  }

  await browser.close();

  // Print results table
  console.log('\n' + '='.repeat(100));
  console.log('RESULTS');
  console.log('='.repeat(100));
  console.log('Board                  Samples   Median     Avg        P10        P90        Total Time');
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      `${r.name.padEnd(22)} ${String(r.samples).padStart(7)}   ` +
      `${r.median.toFixed(3).padStart(8)}   ` +
      `${r.avg.toFixed(3).padStart(8)}   ` +
      `${r.p10.toFixed(3).padStart(8)}   ` +
      `${r.p90.toFixed(3).padStart(8)}   ` +
      `${(r.totalTimeMs/1000).toFixed(1).padStart(8)}s`
    );
  }

  // Estimate overhead using regression
  console.log('\n\nRegression Analysis:');
  console.log('-'.repeat(100));
  console.log('Model: totalTime = overhead*batches + perIter*totalIters + perPixelIter*totalPixelIters');
  console.log('');

  // For each board, estimate perPixelIter as median and compute implied overhead
  const cpuMedian = results.find(r => r.name === 'CpuBoard')?.median || 0.03;

  console.log('Board                  μs/px-iter   Overhead/batch   Effort (vs CPU)');
  console.log('-'.repeat(100));

  for (const r of results) {
    // Estimate overhead per batch: (totalTime - perPixelIter*totalPixelIters) / batches
    const perPixelIterUs = r.median;
    const overheadPerBatchUs = ((r.totalTimeMs * 1000) - (perPixelIterUs * r.totalPixelIters)) / r.batches;
    const effort = Math.round((r.median / cpuMedian) * 100);

    console.log(
      `${r.name.padEnd(22)} ${r.median.toFixed(3).padStart(10)}   ` +
      `${overheadPerBatchUs.toFixed(0).padStart(14)} μs   ` +
      `${String(effort).padStart(8)}`
    );
  }
}

async function measureBoard(browser, test) {
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
    z: test.zoom,
    c: test.center,
    a: '16:9',
    grid: String(GRID_SIZE),
    pixelratio: '1',
    board: test.board,
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
    console.error(`Error: ${err.message}`);
    await page.close();
    return [];
  }
}

runBenchmark().catch(console.error);

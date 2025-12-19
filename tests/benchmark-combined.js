/**
 * Combined Benchmark: Old boards (no perturbation) + new GPU/Sparse
 * Uses identical settings to benchmark-shallow.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Old boards (excluding perturbation types) + new GPU implementations
const BOARDS = ['cpu', 'ddz', 'gpuz', 'qdz', 'qdcpu', 'adaptive', 'gpu', 'sparse'];

// Same shallow zoom locations as benchmark-shallow.js
const LOCATIONS = [
  { zoom: '6.25e2', center: '-0.06091+0.66869i', name: 'shallow-1' },
  { zoom: '1.56e4', center: '0.3179693+0.4910749i', name: 'shallow-2' },
  { zoom: '2e3', center: '0.255', name: 'shallow-3' },
];

const VIEWPORT = { width: 800, height: 450 };
const GRID_SIZE = 1;
const TARGET_ITERS = 1000;
const MAX_TIME_MS = 60000;
const NUM_RUNS = 3;

const RESULTS_FILE = path.join(__dirname, 'benchmark-results',
  `combined-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

async function runBenchmark() {
  console.log('Combined Benchmark: Old boards + GPU/Sparse');
  console.log('='.repeat(60));
  console.log(`Output: ${RESULTS_FILE}`);
  console.log(`Runs: ${NUM_RUNS}, Locations: ${LOCATIONS.length}, Boards: ${BOARDS.length}`);
  console.log('');

  const dir = path.dirname(RESULTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const stream = fs.createWriteStream(RESULTS_FILE, { flags: 'a' });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  for (let run = 1; run <= NUM_RUNS; run++) {
    console.log(`\n=== RUN ${run} of ${NUM_RUNS} ===`);

    for (const loc of LOCATIONS) {
      console.log(`\n${loc.name} (z=${loc.zoom}):`);

      for (const board of BOARDS) {
        process.stdout.write(`  ${board.padEnd(10)} `);

        const result = await measureBoard(browser, board, loc, run);

        if (result && result.timings.length > 0) {
          stream.write(JSON.stringify(result) + '\n');

          const n = result.timings.length;
          const totalTime = result.timings.reduce((sum, t) => sum + t.timeUs, 0);
          const totalPixelIters = result.timings.reduce((sum, t) => sum + t.pixels * t.iters, 0);
          const avgNsPerPixelIter = (totalTime * 1000) / totalPixelIters;
          console.log(`${n} batches, ${result.totalIters} iters, ${avgNsPerPixelIter.toFixed(2)} ns/px-iter`);
        } else {
          console.log('FAILED (no timing data)');
        }
      }
    }
  }

  stream.end();
  await browser.close();
  console.log(`\nResults saved to: ${RESULTS_FILE}`);
}

async function measureBoard(browser, boardName, location, run) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  const timings = [];
  let lastIterCount = 0;
  let compactionCount = 0;

  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[timing]')) {
      // Format: [timing] BoardType k=N: X px × Y iters = Z.Zμs[ C]
      const match = text.match(/\[timing\] (\w+) k=(\d+): (\d+) px × (\d+) iters = ([\d.]+)μs( C)?/);
      if (match) {
        const compacted = !!match[6];
        timings.push({
          pixels: parseInt(match[3]),
          iters: parseInt(match[4]),
          timeUs: parseFloat(match[5]),
          compacted
        });
        lastIterCount += parseInt(match[4]);
        if (compacted) compactionCount++;
      }
    }
  });

  // GPU boards use higher pixelratio, CPU boards use 2
  const isGpuBoard = ['gpu', 'sparse', 'gpuz', 'adaptive'].includes(boardName);
  const pixelratio = isGpuBoard ? String(5 + run) : '2';

  const params = new URLSearchParams({
    z: location.zoom,
    c: location.center,
    a: '16:9',
    grid: String(GRID_SIZE),
    pixelratio,
    board: boardName,
    debug: 'r,t'
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));

    const startTime = Date.now();
    while (Date.now() - startTime < MAX_TIME_MS) {
      if (lastIterCount >= TARGET_ITERS) break;

      const done = await page.evaluate(() => {
        const s = document.querySelector('.status');
        return s && s.textContent.includes('done');
      }).catch(() => false);

      if (done) break;
      await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, 200));
    await page.close();

    return {
      run,
      board: boardName,
      location: location.name,
      zoom: location.zoom,
      pixelratio: parseInt(pixelratio),
      totalIters: lastIterCount,
      compactionCount,
      timings
    };
  } catch (err) {
    console.error(err.message);
    await page.close().catch(() => {});
    return null;
  }
}

runBenchmark().catch(console.error);

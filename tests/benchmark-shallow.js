/**
 * Shallow Zoom Benchmark - All boards at same locations
 * Streams JSON lines so partial results are saved if interrupted.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// All 9 board types - run ALL at shallow zoom
const BOARDS = [
  'cpu', 'gpu', 'pert', 'ddz', 'gpuz', 'qdpert', 'qdz', 'qdcpu', 'gpua'
];

// Shallow zoom locations only
const LOCATIONS = [
  { zoom: '6.25e2', center: '-0.06091+0.66869i', name: 'shallow-1' },
  { zoom: '1.56e4', center: '0.3179693+0.4910749i', name: 'shallow-2' },
  { zoom: '2e3', center: '0.255', name: 'shallow-3' },
];

const VIEWPORT = { width: 800, height: 450 };
const GRID_SIZE = 1;  // Maximum pixels: full viewport per board
const TARGET_ITERS = 1000;  // Fewer samples per board
const MAX_TIME_MS = 60000; // 1 minute max per board
const NUM_RUNS = 3;

const RESULTS_FILE = path.join(__dirname, 'benchmark-results',
  `shallow-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

async function runBenchmark() {
  console.log('Shallow Zoom Benchmark - All Boards');
  console.log('='.repeat(60));
  console.log(`Output: ${RESULTS_FILE}`);
  console.log(`Runs: ${NUM_RUNS}, Locations: ${LOCATIONS.length}, Boards: ${BOARDS.length}`);
  console.log('');

  // Ensure results directory exists
  const dir = path.dirname(RESULTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Open file for streaming writes
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
          // Write JSON line immediately
          stream.write(JSON.stringify(result) + '\n');

          const n = result.timings.length;
          const minI = Math.min(...result.timings.map(t => t.iters));
          const maxI = Math.max(...result.timings.map(t => t.iters));
          console.log(`${n} batches, iters ${minI}-${maxI}, ${result.totalIters} total`);
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

  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[timing]')) {
      // Format: [timing] BoardType k=N: X px × Y iters = Z.Zμs (W.WWWW μs/px-iter)
      const match = text.match(/\[timing\] (\w+) k=(\d+): (\d+) px × (\d+) iters = ([\d.]+)μs/);
      if (match) {
        timings.push({
          pixels: parseInt(match[3]),
          iters: parseInt(match[4]),
          timeUs: parseFloat(match[5])  // Now in microseconds
        });
        lastIterCount += parseInt(match[4]);
      }
    }
  });

  // GPU boards need more pixels to show their strength; CPU boards are slower
  // Vary pixelratio by run to get better regression data
  const isGpuBoard = ['gpu', 'gpuz', 'gpua'].includes(boardName);
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

      // Check if done
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
      totalIters: lastIterCount,
      timings
    };
  } catch (err) {
    console.error(err.message);
    await page.close().catch(() => {});
    return null;
  }
}

runBenchmark().catch(console.error);

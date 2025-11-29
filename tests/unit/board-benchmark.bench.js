/**
 * Benchmark tests comparing ZhuoranBoard vs PerturbationBoard performance
 *
 * These tests measure wall-clock time for deep zoom computation to determine
 * which board type should be used for CPU fallback.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Find system Chrome for better headless support
function findChrome() {
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',  // macOS
    '/usr/bin/google-chrome',  // Linux
    '/usr/bin/chromium-browser',  // Linux Chromium
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',  // Windows
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'  // Windows x86
  ];
  for (const p of chromePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;  // Fall back to Puppeteer's bundled Chrome
}

// Test parameters
const TEST_TIMEOUT = 300000; // 5 minutes for benchmarks
const BENCHMARK_GRID = { width: 480, height: 270 }; // Realistic view size (129,600 pixels)
const BENCHMARK_ITERATIONS = 5000; // Fixed iteration count for fair comparison

// Deep zoom locations that require perturbation theory
const BENCHMARK_LOCATIONS = {
  deepZoom1: {
    name: 'Deep zoom (1e-15)',
    center: [-0.743643887037158704752191506114774, 0.131825904205311970493132056385139],
    size: 1e-15,
    description: 'Seahorse valley at 1e-15 zoom'
  },
  deepZoom2: {
    name: 'Deep zoom (1e-18)',
    center: [-0.7436438870371587047521915061147745, 0.1318259042053119704931320563851385],
    size: 1e-18,
    description: 'Even deeper in seahorse valley'
  },
  deepZoom3: {
    name: 'Elephant valley (1e-16)',
    center: [0.2501, 0.0],
    size: 1e-16,
    description: 'Deep zoom in elephant valley'
  },
  deepZoom4: {
    name: 'Very deep zoom (1e-25)',
    center: [-0.7436438870371587047521915061147745238970989, 0.1318259042053119704931320563851385786438],
    size: 1e-25,
    description: 'Extreme depth in seahorse valley'
  }
};

describe('Board Performance Benchmarks', () => {
  let browser;
  let page;

  beforeAll(async () => {
    const chromePath = findChrome();
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ]
    };
    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }
    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();

    // Load index.html to get board class definitions
    const indexPath = path.join(__dirname, '..', '..', 'index.html');
    await page.goto(`file://${indexPath}`, { waitUntil: 'domcontentloaded' });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  // Benchmark a single board type at a location
  async function benchmarkBoard(boardType, location, iterations) {
    return await page.evaluate(async (boardType, location, iterations, gridSize) => {
      const config = {
        dimsWidth: gridSize.width,
        dimsHeight: gridSize.height,
        dimsArea: gridSize.width * gridSize.height,
        aspectRatio: gridSize.width / gridSize.height,
        exponent: 2
      };

      // Convert center to quad-double format
      const re = typeof location.center[0] === 'number'
        ? [location.center[0], 0]
        : location.center[0];
      const im = typeof location.center[1] === 'number'
        ? [location.center[1], 0]
        : location.center[1];

      // Create board
      let board;
      if (boardType === 'ZhuoranBoard') {
        board = new ZhuoranBoard(0, location.size, re, im, config, 1);
      } else if (boardType === 'PerturbationBoard') {
        board = new PerturbationBoard(0, location.size, re, im, config, 1);
      } else {
        throw new Error(`Unknown board type: ${boardType}`);
      }

      // Run iterations and measure time
      const startTime = performance.now();
      for (let i = 0; i < iterations && board.un > 0; i++) {
        board.iterate();
      }
      const endTime = performance.now();

      return {
        boardType,
        location: location.name,
        iterations: board.it,
        elapsed: endTime - startTime,
        diverged: board.di,
        converged: config.dimsArea - board.un - board.di,
        remaining: board.un,
        iterationsPerSecond: board.it / ((endTime - startTime) / 1000)
      };
    }, boardType, location, iterations, BENCHMARK_GRID);
  }

  // Run benchmarks for each location
  Object.entries(BENCHMARK_LOCATIONS).forEach(([key, location]) => {
    describe(`${location.name}`, () => {
      let zhuoranResult;
      let perturbationResult;

      test(`ZhuoranBoard benchmark`, async () => {
        zhuoranResult = await benchmarkBoard('ZhuoranBoard', location, BENCHMARK_ITERATIONS);
        console.log(`\n  ZhuoranBoard at ${location.name}:`);
        console.log(`    Time: ${zhuoranResult.elapsed.toFixed(1)}ms`);
        console.log(`    Iterations: ${zhuoranResult.iterations}`);
        console.log(`    Speed: ${zhuoranResult.iterationsPerSecond.toFixed(0)} iter/sec`);
        console.log(`    Diverged: ${zhuoranResult.diverged}, Converged: ${zhuoranResult.converged}`);
        expect(zhuoranResult.elapsed).toBeGreaterThan(0);
      }, TEST_TIMEOUT);

      test(`PerturbationBoard benchmark`, async () => {
        perturbationResult = await benchmarkBoard('PerturbationBoard', location, BENCHMARK_ITERATIONS);
        console.log(`\n  PerturbationBoard at ${location.name}:`);
        console.log(`    Time: ${perturbationResult.elapsed.toFixed(1)}ms`);
        console.log(`    Iterations: ${perturbationResult.iterations}`);
        console.log(`    Speed: ${perturbationResult.iterationsPerSecond.toFixed(0)} iter/sec`);
        console.log(`    Diverged: ${perturbationResult.diverged}, Converged: ${perturbationResult.converged}`);
        expect(perturbationResult.elapsed).toBeGreaterThan(0);
      }, TEST_TIMEOUT);

      test(`Performance comparison`, async () => {
        // Both results should exist from previous tests
        if (!zhuoranResult || !perturbationResult) {
          console.log('  Skipping comparison - missing results');
          return;
        }

        const speedup = perturbationResult.elapsed / zhuoranResult.elapsed;
        const faster = speedup > 1 ? 'ZhuoranBoard' : 'PerturbationBoard';

        console.log(`\n  Comparison at ${location.name}:`);
        console.log(`    ZhuoranBoard: ${zhuoranResult.elapsed.toFixed(1)}ms`);
        console.log(`    PerturbationBoard: ${perturbationResult.elapsed.toFixed(1)}ms`);
        console.log(`    Speedup: ${speedup.toFixed(2)}x`);
        console.log(`    Winner: ${faster}`);

        // Just log, don't fail test based on which is faster
        expect(true).toBe(true);
      }, TEST_TIMEOUT);
    });
  });

  // Summary test at the end
  test('Summary: overall recommendation', async () => {
    console.log('\n========================================');
    console.log('BENCHMARK SUMMARY');
    console.log('========================================');
    console.log('Run individual location tests above for detailed results.');
    console.log('ZhuoranBoard uses native doubles; PerturbationBoard uses quad-double reference.');
    console.log('If ZhuoranBoard is faster, it should replace PerturbationBoard for CPU fallback.');
    console.log('========================================\n');
    expect(true).toBe(true);
  }, TEST_TIMEOUT);
});

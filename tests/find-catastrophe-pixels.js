/**
 * Find pixels that diverge at iteration ~9997 (catastrophic failure)
 * Compare QDZ vs Adaptive to identify which pixels are affected
 */

const puppeteer = require('puppeteer');
const path = require('path');

const TEST_PARAMS = {
  z: '1e29',
  c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
  a: '16:9',
  grid: '20',
  pixelratio: '1',
  maxiter: '20000'
};

async function findCatastrophePixels() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Use debug=w,n to load boards on main thread
  const params = new URLSearchParams({ ...TEST_PARAMS, debug: 'w,n' });
  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  console.log('Loading URL...');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Verify board classes loaded
  const classesLoaded = await page.evaluate(() => ({
    hasQDZ: typeof QDZhuoranBoard !== 'undefined',
    hasAdaptive: typeof AdaptiveGpuBoard !== 'undefined'
  }));

  if (!classesLoaded.hasQDZ || !classesLoaded.hasAdaptive) {
    throw new Error('Board classes not loaded!');
  }

  console.log('Running boards to completion...\n');

  const result = await page.evaluate(async () => {
    const match = '-0.022281337871859783996817861398-0.698493620179801136370805820785i'.match(/^([-+]?[\d.]+)([-+]?[\d.]+)i$/);
    const c = { re: parseFloat(match[1]), im: parseFloat(match[2]) };
    const config = window.explorer.config;
    const zoom = 1e29;
    const size = config.firstsize / zoom;

    // Create both boards
    const qdzBoard = new QDZhuoranBoard(0, size, toQD(c.re), toQD(c.im), config, 'qdz-scan');
    const adaptiveBoard = new AdaptiveGpuBoard(0, size, toQD(c.re), toQD(c.im), config, 'adaptive-scan');

    await adaptiveBoard.initGPU();

    // Run both boards to completion
    console.log('Running QDZ...');
    while (qdzBoard.unfinished()) {
      qdzBoard.iterate();
    }
    console.log(`QDZ completed: it=${qdzBoard.it}`);

    console.log('Running Adaptive...');
    while (adaptiveBoard.unfinished()) {
      await adaptiveBoard.iterate();
    }
    console.log(`Adaptive completed: it=${adaptiveBoard.it}`);

    // Analyze results
    const pixelCount = qdzBoard.nn.length;
    const divergenceHist = {};
    const catastrophicPixels = [];
    let mismatches = 0;

    for (let i = 0; i < pixelCount; i++) {
      const qdzNN = qdzBoard.nn[i];
      const adaptiveNN = adaptiveBoard.nn[i];

      // Count divergence iterations
      if (adaptiveNN > 0) {
        divergenceHist[adaptiveNN] = (divergenceHist[adaptiveNN] || 0) + 1;
      }

      // Find pixels with large mismatches (QDZ converges, Adaptive diverges early)
      if (qdzNN < 0 && adaptiveNN > 0 && adaptiveNN < 15000) {
        mismatches++;

        // Catastrophic pixels: diverge around iteration 9990-10050
        if (adaptiveNN >= 9990 && adaptiveNN <= 10050) {
          catastrophicPixels.push({
            index: i,
            qdzNN,
            adaptiveNN
          });
        }
      }
    }

    // Cleanup
    if (adaptiveBoard.device) {
      adaptiveBoard.device.destroy();
    }

    return {
      pixelCount,
      qdzFinal: qdzBoard.it,
      adaptiveFinal: adaptiveBoard.it,
      refEscaped: adaptiveBoard.refOrbitEscaped,
      refIterations: adaptiveBoard.refIterations,
      divergenceHist,
      catastrophicPixels: catastrophicPixels.slice(0, 10), // First 10
      mismatchCount: mismatches
    };
  });

  await browser.close();
  return result;
}

async function main() {
  console.log('Scanning for catastrophic pixels at z=1e29...\n');

  const result = await findCatastrophePixels();

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total pixels: ${result.pixelCount}`);
  console.log(`QDZ final iteration: ${result.qdzFinal}`);
  console.log(`Adaptive final iteration: ${result.adaptiveFinal}`);
  console.log(`Reference orbit escaped: ${result.refEscaped}`);
  console.log(`Reference iterations: ${result.refIterations}`);
  console.log(`Pixels with QDZ/Adaptive mismatch: ${result.mismatchCount}`);

  console.log('\nDivergence iteration histogram (Adaptive):');
  const sortedIters = Object.keys(result.divergenceHist)
    .map(Number)
    .sort((a, b) => result.divergenceHist[b] - result.divergenceHist[a])
    .slice(0, 20);

  for (const iter of sortedIters) {
    const count = result.divergenceHist[iter];
    const bar = '█'.repeat(Math.min(50, count));
    console.log(`  ${String(iter).padStart(6)}: ${String(count).padStart(4)} ${bar}`);
  }

  if (result.catastrophicPixels.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('CATASTROPHIC PIXELS (diverge at ~9997, should converge)');
    console.log('='.repeat(80));
    console.log('Index  | QDZ nn     | Adaptive nn');
    console.log('-------|------------|------------');
    for (const p of result.catastrophicPixels) {
      console.log(
        `${String(p.index).padStart(6)} | ` +
        `${String(p.qdzNN).padStart(10)} | ` +
        `${String(p.adaptiveNN).padStart(11)}`
      );
    }
    console.log(`\n(Showing first 10 of ${result.catastrophicPixels.length} catastrophic pixels)`);
  } else {
    console.log('\nNo catastrophic pixels found.');
  }
}

main().catch(console.error);

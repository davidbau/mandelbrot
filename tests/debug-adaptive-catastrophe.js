/**
 * Debug the adaptive vs qdz difference at z=1e29
 * Many points diverge at 9997 and 9990 in adaptive but not qdz
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function debugCatastrophe() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Enable console logging
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React DevTools') && !text.includes('JSHandle')) {
      console.log(`[PAGE] ${text}`);
    }
  });

  const TEST_PARAMS = {
    z: '1e29',
    c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
    a: '16:9',
    grid: '20',
    pixelratio: '1',
    debug: 'w'  // Use debug mode to access boards directly
  };

  const url = `file://${path.join(process.cwd(), 'index.html')}?${new URLSearchParams(TEST_PARAMS)}`;

  console.log('Loading page with debug=w...\n');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait for board to be created
  await page.waitForFunction(
    () => window.worker0?.boards?.size > 0,
    { timeout: 10000 }
  );

  console.log('=== Comparing QDZ vs Adaptive at z=1e29 ===\n');

  const result = await page.evaluate(async () => {
    const config = window.explorer.config;
    const match = '-0.022281337871859783996817861398-0.698493620179801136370805820785i'
      .match(/^([-+]?[\d.]+)([-+]?[\d.]+)i$/);
    const c = { re: parseFloat(match[1]), im: parseFloat(match[2]) };
    const zoom = 1e29;
    const size = config.firstsize / zoom;

    // Create both board types
    const qdzBoard = new QDZhuoranBoard(0, size, toQD(c.re), toQD(c.im), config, 'qdz-test');
    const adaptiveBoard = new AdaptiveGpuBoard(1, size, toQD(c.re), toQD(c.im), config, 'adaptive-test');

    await adaptiveBoard.initGPU();

    // Run both to completion (max 10000 iterations)
    const maxIters = 10000;
    while (qdzBoard.unfinished() && qdzBoard.it < maxIters) {
      qdzBoard.iterate();
    }

    while (adaptiveBoard.unfinished() && adaptiveBoard.it < maxIters) {
      await adaptiveBoard.iterate();
    }

    // Analyze results
    const pixelCount = qdzBoard.nn.length;
    const divergenceHistogram = {};
    const mismatchPixels = [];

    for (let i = 0; i < pixelCount; i++) {
      const qdzNN = qdzBoard.nn[i];
      const adaptiveNN = adaptiveBoard.nn[i];

      // Track adaptive divergence iterations
      if (adaptiveNN > 0) {
        divergenceHistogram[adaptiveNN] = (divergenceHistogram[adaptiveNN] || 0) + 1;
      }

      // Find mismatches
      if (qdzNN !== adaptiveNN) {
        mismatchPixels.push({
          pixel: i,
          qdz: qdzNN,
          adaptive: adaptiveNN,
          type: qdzNN < 0 && adaptiveNN > 0 ? 'catastrophic' : 'other'
        });
      }
    }

    // Get top divergence iterations for adaptive
    const topDivergences = Object.entries(divergenceHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([iter, count]) => ({ iter: parseInt(iter), count }));

    // Sample a few catastrophic pixels for detailed inspection
    const catastrophicSamples = mismatchPixels
      .filter(p => p.type === 'catastrophic' && p.adaptive >= 9990)
      .slice(0, 5);

    // Cleanup
    if (adaptiveBoard.device) {
      adaptiveBoard.device.destroy();
    }

    return {
      pixelCount,
      qdzFinal: qdzBoard.it,
      adaptiveFinal: adaptiveBoard.it,
      qdzConverged: qdzBoard.nn.filter(n => n < 0).length,
      qdzDiverged: qdzBoard.nn.filter(n => n > 0).length,
      adaptiveConverged: adaptiveBoard.nn.filter(n => n < 0).length,
      adaptiveDiverged: adaptiveBoard.nn.filter(n => n > 0).length,
      totalMismatches: mismatchPixels.length,
      catastrophicMismatches: mismatchPixels.filter(p => p.type === 'catastrophic').length,
      topDivergences,
      catastrophicSamples,
      refEscaped: adaptiveBoard.refOrbitEscaped,
      refIterations: adaptiveBoard.refIterations
    };
  });

  console.log('Results:');
  console.log('--------');
  console.log(`Total pixels: ${result.pixelCount}`);
  console.log(`\nQDZ Board (iteration ${result.qdzFinal}):`);
  console.log(`  Converged: ${result.qdzConverged}`);
  console.log(`  Diverged: ${result.qdzDiverged}`);
  console.log(`\nAdaptive Board (iteration ${result.adaptiveFinal}):`);
  console.log(`  Converged: ${result.adaptiveConverged}`);
  console.log(`  Diverged: ${result.adaptiveDiverged}`);
  console.log(`  Reference escaped: ${result.refEscaped}`);
  console.log(`  Reference iterations: ${result.refIterations}`);

  console.log(`\nMismatches: ${result.totalMismatches}/${result.pixelCount} pixels`);
  console.log(`Catastrophic (QDZ converged, Adaptive diverged): ${result.catastrophicMismatches}`);

  console.log('\nTop 10 divergence iterations in Adaptive:');
  for (const { iter, count } of result.topDivergences) {
    console.log(`  ${iter}: ${count} pixels`);
  }

  if (result.catastrophicSamples.length > 0) {
    console.log('\nSample catastrophic pixels (QDZ converged, Adaptive diverged):');
    for (const sample of result.catastrophicSamples) {
      console.log(`  Pixel ${sample.pixel}: QDZ=${sample.qdz}, Adaptive=${sample.adaptive}`);
    }
  }

  await browser.close();
}

debugCatastrophe().catch(console.error);

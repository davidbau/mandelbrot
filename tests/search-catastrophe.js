/**
 * Search for locations where Adaptive fails but QDZ succeeds
 * Systematically test coordinates to find catastrophic behavior
 */

const puppeteer = require('puppeteer');
const path = require('path');

// Test various locations known to be interesting
const TEST_LOCATIONS = [
  // Original location
  { c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i', z: '1e29', name: 'Original deep' },

  // Variations with slightly different coordinates
  { c: '-0.0220-0.6985i', z: '1e29', name: 'Nearby 1' },
  { c: '-0.0225-0.6985i', z: '1e29', name: 'Nearby 2' },
  { c: '-0.0223-0.6980i', z: '1e29', name: 'Nearby 3' },
  { c: '-0.0223-0.6990i', z: '1e29', name: 'Nearby 4' },

  // Known converging regions at medium depth
  { c: '+0.1972+0.5798i', z: '1e29', name: 'Converging region 1' },
  { c: '-0.74543+0.11301i', z: '1e29', name: 'Converging region 2' },

  // Edge of main bulb
  { c: '-0.7500+0.0001i', z: '1e29', name: 'Main bulb edge 1' },
  { c: '-0.7499+0.0001i', z: '1e29', name: 'Main bulb edge 2' },

  // Near period-2 bulb
  { c: '-1.0000+0.0001i', z: '1e29', name: 'Period-2 near' },

  // Inside main cardioid
  { c: '-0.5000+0.0000i', z: '1e29', name: 'Inside cardioid 1' },
  { c: '-0.1000+0.6500i', z: '1e29', name: 'Inside cardioid 2' },
];

async function testLocation(location) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Set viewport to match typical browser window
  await page.setViewport({ width: 1280, height: 720 });

  const params = new URLSearchParams({
    z: location.z,
    c: location.c,
    a: '16:9',
    grid: '10',
    pixelratio: '1',
    maxiter: '20000',
    debug: 'w,n'
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  const result = await page.evaluate(async (testC) => {
    const match = testC.match(/^([-+]?[\d.]+)([-+]?[\d.]+)i$/);
    const c = { re: parseFloat(match[1]), im: parseFloat(match[2]) };
    const config = window.explorer.config;
    const zoom = parseFloat(new URLSearchParams(location.search).get('z') || '1e29');
    const size = config.firstsize / zoom;

    // Create both boards
    const qdzBoard = new QDZhuoranBoard(0, size, toQD(c.re), toQD(c.im), config, 'qdz');
    const adaptiveBoard = new AdaptiveGpuBoard(0, size, toQD(c.re), toQD(c.im), config, 'adaptive');

    await adaptiveBoard.initGPU();

    // Run to completion (with timeout)
    const maxIters = 15000;
    while (qdzBoard.unfinished() && qdzBoard.it < maxIters) {
      qdzBoard.iterate();
    }

    while (adaptiveBoard.unfinished() && adaptiveBoard.it < maxIters) {
      await adaptiveBoard.iterate();
    }

    // Analyze mismatches
    let catastrophicCount = 0;
    let earlyDivergenceCount = 0;
    let convergenceMismatch = 0;
    let totalMismatch = 0;

    const pixelCount = qdzBoard.nn.length;
    for (let i = 0; i < pixelCount; i++) {
      const qdzNN = qdzBoard.nn[i];
      const adaptiveNN = adaptiveBoard.nn[i];

      if (qdzNN !== adaptiveNN) {
        totalMismatch++;

        // QDZ converges but Adaptive diverges
        if (qdzNN < 0 && adaptiveNN > 0) {
          convergenceMismatch++;

          // Catastrophic: diverges at ~9997 (reference escape)
          if (adaptiveNN >= 9900 && adaptiveNN <= 10100) {
            catastrophicCount++;
          } else if (adaptiveNN < 5000) {
            earlyDivergenceCount++;
          }
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
      totalMismatch,
      convergenceMismatch,
      catastrophicCount,
      earlyDivergenceCount,
      qdzConverged: qdzBoard.nn.filter(n => n < 0).length,
      adaptiveConverged: adaptiveBoard.nn.filter(n => n < 0).length
    };
  }, location.c);

  await browser.close();
  return result;
}

async function main() {
  console.log('Searching for locations with catastrophic behavior...\n');
  console.log('Testing', TEST_LOCATIONS.length, 'locations\n');

  const results = [];

  for (const location of TEST_LOCATIONS) {
    process.stdout.write(`Testing ${location.name.padEnd(25)} ... `);

    try {
      const result = await testLocation(location);
      results.push({ location, result });

      // Summary on same line
      if (result.catastrophicCount > 0) {
        console.log(`🔴 CATASTROPHE! ${result.catastrophicCount} pixels`);
      } else if (result.convergenceMismatch > 0) {
        console.log(`⚠️  Mismatch: ${result.convergenceMismatch} pixels`);
      } else if (result.totalMismatch > 0) {
        console.log(`⚪ Minor mismatch: ${result.totalMismatch} pixels`);
      } else {
        console.log(`✓ Agreement (QDZ conv: ${result.qdzConverged}, Adp conv: ${result.adaptiveConverged})`);
      }
    } catch (e) {
      console.log(`❌ Error: ${e.message}`);
    }
  }

  // Show detailed results for catastrophic cases
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(80));

  const catastrophic = results.filter(r => r.result.catastrophicCount > 0);
  const mismatches = results.filter(r => r.result.convergenceMismatch > 0 && r.result.catastrophicCount === 0);

  if (catastrophic.length > 0) {
    console.log('\n🔴 CATASTROPHIC LOCATIONS (Adaptive fails at ~iteration 9997):');
    for (const { location, result } of catastrophic) {
      console.log(`\n  ${location.name}`);
      console.log(`    c=${location.c}, z=${location.z}`);
      console.log(`    Catastrophic pixels: ${result.catastrophicCount}/${result.pixelCount}`);
      console.log(`    QDZ converged: ${result.qdzConverged}, Adaptive converged: ${result.adaptiveConverged}`);
      console.log(`    Reference escaped: ${result.refEscaped}, ref iterations: ${result.refIterations}`);
    }
  }

  if (mismatches.length > 0) {
    console.log('\n⚠️  MISMATCH LOCATIONS (other types of disagreement):');
    for (const { location, result } of mismatches) {
      console.log(`\n  ${location.name}`);
      console.log(`    c=${location.c}, z=${location.z}`);
      console.log(`    Convergence mismatches: ${result.convergenceMismatch}/${result.pixelCount}`);
      console.log(`    Early divergence: ${result.earlyDivergenceCount}`);
      console.log(`    QDZ converged: ${result.qdzConverged}, Adaptive converged: ${result.adaptiveConverged}`);
    }
  }

  if (catastrophic.length === 0 && mismatches.length === 0) {
    console.log('\nNo catastrophic locations found in this test set.');
    console.log('The AdaptiveGpuBoard may have been fixed, or different parameters are needed.');
  }
}

main().catch(console.error);

/**
 * Debug AdaptiveGpuBoard on main thread using debug=w,n flag
 * Traces pixel 0 around iteration 9997 where catastrophe occurs
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function debugAdaptive() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Use debug=w,n to load boards on main thread and skip initial view
  const url = `file://${path.join(process.cwd(), 'index.html')}?debug=w,n`;

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Run the test on main thread with direct access to board classes
  const result = await page.evaluate(async () => {
    // Test parameters
    const TEST_PARAMS = {
      z: '1e29',
      c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i'
    };

    // Parse complex number
    const match = TEST_PARAMS.c.match(/^([-+]?[\d.]+)([-+]?[\d.]+)i$/);
    const c = { re: parseFloat(match[1]), im: parseFloat(match[2]) };

    const config = window.explorer.config;
    const zoom = parseFloat(TEST_PARAMS.z);
    const size = config.firstsize / zoom;

    // Create AdaptiveGpuBoard on main thread
    const board = new AdaptiveGpuBoard(
      0, // k
      size,
      toQD(c.re),
      toQD(c.im),
      config,
      'debug-adaptive'
    );

    await board.initGPU();

    const traces = [];
    const pixel0 = 0;

    // Run iterations until we reach 10000 or pixel finishes
    for (let batch = 0; batch < 200; batch++) {
      await board.iterateBatch(50);

      // Sample around iteration 9997
      if (board.it >= 9990 && board.it <= 10000) {
        // Read back GPU buffer to get pixel state
        const pixelData = await board.readBuffer(board.buffers.pixels, Uint8Array);

        // Parse pixel 0 state (60 bytes per pixel)
        const offset = pixel0 * 60;
        const pixelU32 = new Uint32Array(pixelData.buffer, offset, 15);
        const pixelF32 = new Float32Array(pixelData.buffer, offset, 15);

        const status = new Int32Array([pixelU32[0]])[0];
        const refIter = pixelU32[2];
        const scale = new Int32Array([pixelU32[4]])[0];
        const dzr = pixelF32[7];
        const dzi = pixelF32[8];

        // Get reference orbit value
        let refr = null, refi = null, refMag = null;
        if (refIter < board.refOrbit.length) {
          const ref = board.refOrbit[refIter];
          refr = ref[0] + ref[1] + ref[2] + ref[3];
          refi = ref[4] + ref[5] + ref[6] + ref[7];
          refMag = Math.sqrt(refr * refr + refi * refi);
        }

        // Compute actual delta (scaled)
        const dzr_actual = dzr * Math.pow(2, scale);
        const dzi_actual = dzi * Math.pow(2, scale);

        // Compute z = ref + dz_actual
        const zr = (refr || 0) + dzr_actual;
        const zi = (refi || 0) + dzi_actual;
        const zMag = Math.sqrt(zr * zr + zi * zi);

        // Compute norms for rebasing check
        const dzNorm = Math.max(Math.abs(dzr_actual), Math.abs(dzi_actual));
        const zNorm = Math.max(Math.abs(zr), Math.abs(zi));
        const shouldRebase = refIter > 0 && zNorm < dzNorm * 2.0 && zNorm > 1e-13;

        traces.push({
          it: board.it,
          refIter,
          scale,
          dzr,
          dzi,
          dzr_actual,
          dzi_actual,
          dzNorm,
          refr,
          refi,
          refMag,
          zr,
          zi,
          zMag,
          zNorm,
          shouldRebase,
          status,
          nn: board.nn[pixel0]
        });
      }

      // Stop if pixel finishes or we go past target range
      if (board.nn[pixel0] !== 0 || board.it > 10000) {
        break;
      }
    }

    // Clean up
    if (board.device) {
      board.device.destroy();
    }

    return {
      traces,
      finalIt: board.it,
      finalNn: board.nn[pixel0],
      refIterations: board.refIterations,
      refEscaped: board.refOrbitEscaped,
      initialScale: board.initialScale
    };
  });

  await browser.close();
  return result;
}

async function main() {
  console.log('Debugging AdaptiveGpuBoard on main thread...\n');

  const result = await debugAdaptive();

  console.log('='.repeat(160));
  console.log('PIXEL 0 TRACE (AdaptiveGpuBoard): Iterations 9990-10000');
  console.log('='.repeat(160));
  console.log();
  console.log('Iter   | refIter | scale | dzNorm        | zNorm         | refMag        | zMag          | Rebase? | Status | nn');
  console.log('-------|---------|-------|---------------|---------------|---------------|---------------|---------|--------|----');

  for (const t of result.traces) {
    const statusStr = t.status === 0 ? 'comp' : t.status === 1 ? 'DIV' : 'conv';
    const rebaseStr = t.shouldRebase ? 'YES' : 'no';
    console.log(
      `${String(t.it).padStart(6)} | ` +
      `${String(t.refIter).padStart(7)} | ` +
      `${String(t.scale).padStart(5)} | ` +
      `${t.dzNorm.toExponential(3).padStart(13)} | ` +
      `${t.zNorm.toExponential(3).padStart(13)} | ` +
      `${(t.refMag !== null ? t.refMag.toExponential(3) : 'n/a').padStart(13)} | ` +
      `${t.zMag.toExponential(3).padStart(13)} | ` +
      `${rebaseStr.padStart(7)} | ` +
      `${statusStr.padStart(6)} | ` +
      `${t.nn}`
    );
  }

  console.log('\n' + '='.repeat(160));
  console.log('SUMMARY');
  console.log('='.repeat(160));
  console.log(`Initial scale: ${result.initialScale}`);
  console.log(`Final iteration: ${result.finalIt}`);
  console.log(`Final nn[0]: ${result.finalNn}`);
  console.log(`Reference iterations: ${result.refIterations}`);
  console.log(`Reference escaped: ${result.refEscaped}`);

  if (result.refEscaped) {
    console.log('\n!!! Reference orbit DIVERGED !!!');
    console.log('Pixels should rebase when |z| < |dz| * 2');
  }

  // Check if rebasing happened
  const rebaseEvents = [];
  for (let i = 1; i < result.traces.length; i++) {
    if (result.traces[i].refIter < result.traces[i-1].refIter) {
      rebaseEvents.push({
        from: result.traces[i-1],
        to: result.traces[i]
      });
    }
  }

  if (rebaseEvents.length > 0) {
    console.log(`\n${rebaseEvents.length} rebasing events detected:`);
    for (const event of rebaseEvents) {
      console.log(`  it ${event.from.it} → ${event.to.it}: refIter ${event.from.refIter} → ${event.to.refIter}`);
    }
  } else {
    console.log('\nNo rebasing detected in this range.');
  }

  // Check if escape happened incorrectly
  const divergedTrace = result.traces.find(t => t.status === 1);
  if (divergedTrace) {
    console.log(`\n!!! DIVERGENCE DETECTED !!!`);
    console.log(`Pixel marked as diverged at iteration ${divergedTrace.it}:`);
    console.log(`  |z| = ${divergedTrace.zMag.toExponential(3)}`);
    console.log(`  |ref| = ${divergedTrace.refMag ? divergedTrace.refMag.toExponential(3) : 'n/a'}`);
    console.log(`  |dz| = ${divergedTrace.dzNorm.toExponential(3)}`);
    console.log(`  Should have rebased? ${divergedTrace.shouldRebase ? 'YES - but did not!' : 'NO'}`);
  }
}

main().catch(console.error);

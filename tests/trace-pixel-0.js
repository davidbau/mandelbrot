/**
 * Trace single pixel (index 0, top-left corner) through iterations 9990-9998
 * Compare QDZ vs Adaptive behavior in detail
 *
 * Uses debug=w,n to create boards on main thread for full state access
 *
 * Run with: node tests/trace-pixel-0.js
 */

const puppeteer = require('puppeteer');
const path = require('path');

const TEST_PARAMS = {
  z: '1e29',
  c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
  a: '16:9',
  grid: '20',
  pixelratio: '1'
};

async function traceBoards() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Use debug=w,n to load boards on main thread and skip initial view
  const params = new URLSearchParams({ ...TEST_PARAMS, debug: 'w,n' });
  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  console.log('Loading URL:', url);

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Verify worker code was loaded
  const classesLoaded = await page.evaluate(() => ({
    hasQDZ: typeof QDZhuoranBoard !== 'undefined',
    hasAdaptive: typeof AdaptiveGpuBoard !== 'undefined',
    hasBoard: typeof Board !== 'undefined',
    debug: window.explorer.config.debug
  }));

  console.log('Board classes loaded:', classesLoaded);
  if (!classesLoaded.hasQDZ || !classesLoaded.hasAdaptive) {
    throw new Error('Board classes not loaded! debug flag may not be working.');
  }

  // Run both boards on main thread and trace pixel 0
  const result = await page.evaluate(async () => {
    // Parse test params
    const match = '-0.022281337871859783996817861398-0.698493620179801136370805820785i'.match(/^([-+]?[\d.]+)([-+]?[\d.]+)i$/);
    const c = { re: parseFloat(match[1]), im: parseFloat(match[2]) };
    const config = window.explorer.config;
    const zoom = 1e29;
    const size = config.firstsize / zoom;

    // Create both boards
    const qdzBoard = new QDZhuoranBoard(0, size, toQD(c.re), toQD(c.im), config, 'qdz-trace');
    const adaptiveBoard = new AdaptiveGpuBoard(0, size, toQD(c.re), toQD(c.im), config, 'adaptive-trace');

    await adaptiveBoard.initGPU();

    const qdzTraces = [];
    const adaptiveTraces = [];
    const pixel0 = 0;

    // Run both boards in parallel until iteration 10000
    for (let batch = 0; batch < 10000; batch++) {
      // Iterate both boards (one iteration at a time)
      qdzBoard.iterate();
      await adaptiveBoard.iterate();

      // Trace QDZ state around 9990-9998
      if (qdzBoard.it >= 9990 && qdzBoard.it <= 9998 && qdzBoard.nn[pixel0] === 0) {
        const refIter = qdzBoard.refIter[pixel0];
        const dzr = qdzBoard.dz[pixel0 * 2];
        const dzi = qdzBoard.dz[pixel0 * 2 + 1];

        let refr = null, refi = null, refMag = null;
        if (refIter < qdzBoard.qdRefOrbit.length) {
          const ref = qdzBoard.qdRefOrbit[refIter];
          refr = ref[0] + ref[1] + ref[2] + ref[3];
          refi = ref[4] + ref[5] + ref[6] + ref[7];
          refMag = Math.sqrt(refr * refr + refi * refi);
        }

        const zr = refr + dzr;
        const zi = refi + dzi;
        const zMag = Math.sqrt(zr * zr + zi * zi);
        const dzNorm = Math.max(Math.abs(dzr), Math.abs(dzi));
        const zNorm = Math.max(Math.abs(zr), Math.abs(zi));
        const shouldRebase = refIter > 0 && zNorm < dzNorm * 2.0;

        qdzTraces.push({
          it: qdzBoard.it,
          refIter,
          dzr,
          dzi,
          dzNorm,
          refr,
          refi,
          refMag,
          zr,
          zi,
          zMag,
          zNorm,
          shouldRebase,
          nn: qdzBoard.nn[pixel0]
        });
      }

      // Trace Adaptive state around 9990-9998
      if (adaptiveBoard.it >= 9990 && adaptiveBoard.it <= 9998 && adaptiveBoard.nn[pixel0] === 0) {
        // Read GPU buffer
        const pixelData = await adaptiveBoard.readBuffer(adaptiveBoard.buffers.pixels, Uint8Array);
        const offset = pixel0 * 60;
        const pixelU32 = new Uint32Array(pixelData.buffer, offset, 15);
        const pixelF32 = new Float32Array(pixelData.buffer, offset, 15);

        const status = new Int32Array([pixelU32[0]])[0];
        const refIter = pixelU32[2];
        const scale = new Int32Array([pixelU32[4]])[0];
        const dzr = pixelF32[7];
        const dzi = pixelF32[8];

        let refr = null, refi = null, refMag = null;
        if (refIter < adaptiveBoard.refOrbit.length) {
          const ref = adaptiveBoard.refOrbit[refIter];
          refr = ref[0] + ref[1] + ref[2] + ref[3];
          refi = ref[4] + ref[5] + ref[6] + ref[7];
          refMag = Math.sqrt(refr * refr + refi * refi);
        }

        const dzr_actual = dzr * Math.pow(2, scale);
        const dzi_actual = dzi * Math.pow(2, scale);
        const zr = (refr || 0) + dzr_actual;
        const zi = (refi || 0) + dzi_actual;
        const zMag = Math.sqrt(zr * zr + zi * zi);
        const dzNorm = Math.max(Math.abs(dzr_actual), Math.abs(dzi_actual));
        const zNorm = Math.max(Math.abs(zr), Math.abs(zi));
        const shouldRebase = refIter > 0 && zNorm < dzNorm * 2.0 && zNorm > 1e-13;

        adaptiveTraces.push({
          it: adaptiveBoard.it,
          refIter,
          scale,
          dzr: dzr_actual,
          dzi: dzi_actual,
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
          nn: adaptiveBoard.nn[pixel0]
        });
      }

      // Stop if both pixels finished or both past target range
      if ((qdzBoard.nn[pixel0] !== 0 || qdzBoard.it > 10000) &&
          (adaptiveBoard.nn[pixel0] !== 0 || adaptiveBoard.it > 10000)) {
        break;
      }
    }

    // Cleanup
    if (adaptiveBoard.device) {
      adaptiveBoard.device.destroy();
    }

    return {
      qdzTraces,
      adaptiveTraces,
      qdzFinal: { it: qdzBoard.it, nn: qdzBoard.nn[pixel0] },
      adaptiveFinal: { it: adaptiveBoard.it, nn: adaptiveBoard.nn[pixel0] },
      refEscaped: adaptiveBoard.refOrbitEscaped
    };
  });

  await browser.close();
  return result;
}

async function main() {
  console.log('Tracing pixel 0 on main thread (QDZ vs Adaptive)...\n');

  const result = await traceBoards();

  console.log('='.repeat(160));
  console.log('PIXEL 0 TRACE: Iterations 9990-9998 (around catastrophe)');
  console.log('='.repeat(160));

  // QDZ traces
  console.log('\nQDZ:');
  console.log('Iter   | refIter | dzNorm        | zNorm         | refMag        | zMag          | Rebase? | nn');
  console.log('-------|---------|---------------|---------------|---------------|---------------|---------|----');

  if (result.qdzTraces.length === 0) {
    console.log('  (no samples in range 9990-9998)');
  } else {
    for (const t of result.qdzTraces) {
      const rebaseStr = t.shouldRebase ? 'YES' : 'no';
      console.log(
        `${String(t.it).padStart(6)} | ` +
        `${String(t.refIter).padStart(7)} | ` +
        `${t.dzNorm.toExponential(3).padStart(13)} | ` +
        `${t.zNorm.toExponential(3).padStart(13)} | ` +
        `${(t.refMag !== null ? t.refMag.toExponential(3) : 'n/a').padStart(13)} | ` +
        `${t.zMag.toExponential(3).padStart(13)} | ` +
        `${rebaseStr.padStart(7)} | ` +
        `${t.nn}`
      );
    }
  }

  // Adaptive traces
  console.log('\nAdaptive:');
  console.log('Iter   | refIter | scale | dzNorm        | zNorm         | refMag        | zMag          | Rebase? | status | nn');
  console.log('-------|---------|-------|---------------|---------------|---------------|---------------|---------|--------|----');

  if (result.adaptiveTraces.length === 0) {
    console.log('  (no samples in range 9990-9998)');
    console.log(`  Pixel finished at it=${result.adaptiveFinal.it}, nn=${result.adaptiveFinal.nn}`);
  } else {
    for (const t of result.adaptiveTraces) {
      const rebaseStr = t.shouldRebase ? 'YES' : 'no';
      const statusStr = t.status === 0 ? 'comp' : t.status === 1 ? 'DIV' : 'conv';
      console.log(
        `${String(t.it).padStart(6)} | ` +
        `${String(t.refIter).padStart(7)} | ` +
        `${String(t.scale || 'n/a').padStart(5)} | ` +
        `${t.dzNorm.toExponential(3).padStart(13)} | ` +
        `${t.zNorm.toExponential(3).padStart(13)} | ` +
        `${(t.refMag !== null ? t.refMag.toExponential(3) : 'n/a').padStart(13)} | ` +
        `${t.zMag.toExponential(3).padStart(13)} | ` +
        `${rebaseStr.padStart(7)} | ` +
        `${statusStr.padStart(6)} | ` +
        `${t.nn}`
      );
    }
  }

  console.log('\n' + '='.repeat(160));
  console.log('SUMMARY');
  console.log('='.repeat(160));
  console.log(`QDZ final: it=${result.qdzFinal.it}, nn=${result.qdzFinal.nn}`);
  console.log(`Adaptive final: it=${result.adaptiveFinal.it}, nn=${result.adaptiveFinal.nn}`);
  console.log(`Reference orbit escaped: ${result.refEscaped}`);

  // Analysis
  if (result.refEscaped) {
    console.log('\nReference orbit DIVERGED - pixels should rebase when getting close to it');
  }

  const adaptiveDiverged = result.adaptiveTraces.find(t => t.status === 1);
  if (adaptiveDiverged) {
    console.log(`\n!!! CATASTROPHE DETECTED at iteration ${adaptiveDiverged.it} !!!`);
    console.log(`Adaptive marked pixel as DIVERGED:`);
    console.log(`  |z| = ${adaptiveDiverged.zMag.toExponential(3)}`);
    console.log(`  |ref| = ${adaptiveDiverged.refMag ? adaptiveDiverged.refMag.toExponential(3) : 'n/a'}`);
    console.log(`  Should rebase: ${adaptiveDiverged.shouldRebase ? 'YES' : 'NO'}`);
  }
}

main().catch(console.error);

/**
 * Deep dive into a single catastrophic pixel
 * Compare QDZ vs Adaptive: dz, refiter, refz, rebasing, divergence checks
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function debugCatastrophicPixel() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React DevTools') && !text.includes('JSHandle')) {
      console.log(`[PAGE] ${text}`);
    }
  });

  const params = new URLSearchParams({
    z: '1e29',
    c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
    a: '16:9',
    grid: '20',
    pixelratio: '1',
    board: 'adaptive',
    debug: 'w'
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  console.log('Loading Adaptive board...\n');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
  await page.waitForFunction(() => window.worker0?.boards?.size > 0, { timeout: 10000 });

  // Wait for completion
  await page.waitForFunction(
    () => {
      const board = Array.from(window.worker0?.boards?.values() || [])[0];
      return board && board.un === 0;
    },
    { timeout: 120000 }
  );

  console.log('=== Finding and Tracing Catastrophic Pixel ===\n');

  const result = await page.evaluate(async () => {
    const config = window.explorer.config;
    const coordStr = '-0.022281337871859783996817861398-0.698493620179801136370805820785i';
    const parsed = parseComplexToQD(coordStr);
    if (!parsed) {
      return { error: `Failed to parse coordinates: ${coordStr}` };
    }
    const c = { re: qdToNumber(parsed.re), im: qdToNumber(parsed.im) };
    const zoom = 1e29;
    const size = config.firstsize / zoom;

    // Get completed adaptive board
    const adaptiveBoard = Array.from(window.worker0.boards.values())[0];

    // Find catastrophic pixel
    let pixel = -1;
    for (let i = 0; i < adaptiveBoard.nn.length; i++) {
      if (adaptiveBoard.nn[i] === 9997 || adaptiveBoard.nn[i] === 9990) {
        pixel = i;
        break;
      }
    }

    if (pixel === -1) {
      return { error: 'No catastrophic pixel found' };
    }

    console.log(`Pixel ${pixel} diverges at ${adaptiveBoard.nn[pixel]} in Adaptive`);

    // Get adaptive final state
    const adaptiveData = await adaptiveBoard.readBuffer(adaptiveBoard.buffers.pixels, Uint8Array);
    const offset = pixel * 60;
    const pixelU32 = new Uint32Array(adaptiveData.buffer, offset, 15);
    const pixelF32 = new Float32Array(adaptiveData.buffer, offset, 15);

    const adaptiveFinal = {
      nn: adaptiveBoard.nn[pixel],
      status: new Int32Array([pixelU32[0]])[0],
      refIter: pixelU32[2],
      scale: new Int32Array([pixelU32[4]])[0],
      dzr: pixelF32[7],
      dzi: pixelF32[8],
      dzr_scaled: pixelF32[7] * Math.pow(2, new Int32Array([pixelU32[4]])[0]),
      dzi_scaled: pixelF32[8] * Math.pow(2, new Int32Array([pixelU32[4]])[0])
    };
    adaptiveFinal.dzMag = Math.sqrt(adaptiveFinal.dzr_scaled**2 + adaptiveFinal.dzi_scaled**2);

    // Create QDZ board and trace
    console.log('Creating and tracing QDZ board...');
    const qdz = new QDZhuoranBoard(1, size, toQD(c.re), toQD(c.im), config, 'qdz-trace');

    const snapshots = [];
    const traceIters = [1, 100, 1000, 5000, 9000, 9300, 9335, 9338, 9339, 9340,
                        9800, 9900, 9980, 9990, 9995, 9997, 10000, 15000, 20000, 50000, 100000];

    for (const targetIter of traceIters) {
      while (qdz.it < targetIter && qdz.nn[pixel] === 0) {
        qdz.iterate();
      }

      if (qdz.nn[pixel] === 0 || qdz.it === targetIter) {
        const offset = pixel * 2;
        const refIter = qdz.refIter[pixel];
        const refOrbit = qdz.qdRefOrbit[refIter];
        snapshots.push({
          iteration: qdz.it,
          nn: qdz.nn[pixel],
          dzr: qdz.dz[offset],
          dzi: qdz.dz[offset + 1],
          dzMag: Math.sqrt(qdz.dz[offset]**2 + qdz.dz[offset + 1]**2),
          refIter,
          refOrbitRe: refOrbit ? refOrbit[0] : null,
          refOrbitIm: refOrbit ? refOrbit[4] : null,
        });
      }

      if (qdz.nn[pixel] !== 0) break;
    }

    return {
      pixel,
      adaptiveFinal,
      qdzSnapshots: snapshots,
      qdzFinal: qdz.nn[pixel],
      refEscapeIter: adaptiveBoard.refIterations
    };
  });

  if (result.error) {
    console.error(result.error);
    await browser.close();
    return;
  }

  console.log(`\n=== Pixel ${result.pixel} Analysis ===`);
  console.log(`Reference escaped at iteration: ${result.refEscapeIter}`);
  console.log(`\nAdaptive: diverged at ${result.adaptiveFinal.nn}`);
  console.log(`  Final state: refIter=${result.adaptiveFinal.refIter}, scale=${result.adaptiveFinal.scale}`);
  console.log(`  dz_scaled: (${result.adaptiveFinal.dzr_scaled.toExponential(3)}, ${result.adaptiveFinal.dzi_scaled.toExponential(3)})`);
  console.log(`  |dz|: ${result.adaptiveFinal.dzMag.toExponential(3)}`);

  console.log(`\nQDZ: ${result.qdzFinal < 0 ? 'CONVERGED' : 'diverged at ' + result.qdzFinal}`);

  console.log('\n=== QDZ Trace ===');
  console.log('Iter\tNN\tRefIter\tdzr\t\tdzi\t\t|dz|\t\tRefZ_re\t\tRefZ_im');
  for (const snap of result.qdzSnapshots) {
    console.log(
      `${snap.iteration}\t${snap.nn}\t${snap.refIter}\t` +
      `${snap.dzr.toExponential(2)}\t${snap.dzi.toExponential(2)}\t` +
      `${snap.dzMag.toExponential(2)}\t` +
      `${snap.refOrbitRe ? snap.refOrbitRe.toExponential(2) : 'null'}\t` +
      `${snap.refOrbitIm ? snap.refOrbitIm.toExponential(2) : 'null'}`
    );
  }

  console.log('\n=== Key Findings ===');
  const near9997 = result.qdzSnapshots.find(s => s.iteration >= 9997);
  if (near9997) {
    console.log(`\nQDZ at iteration ${near9997.iteration}:`);
    console.log(`  refIter: ${near9997.refIter}`);
    console.log(`  |dz|: ${near9997.dzMag.toExponential(3)}`);
    console.log(`  Status: ${near9997.nn === 0 ? 'still computing' : near9997.nn < 0 ? 'converged' : 'diverged'}`);
  }

  const refEscape = result.qdzSnapshots.find(s => s.iteration >= result.refEscapeIter);
  if (refEscape) {
    console.log(`\nQDZ near reference escape (iter ${refEscape.iteration}):`);
    console.log(`  refIter: ${refEscape.refIter} (ref escaped at ${result.refEscapeIter})`);
    console.log(`  |dz|: ${refEscape.dzMag.toExponential(3)}`);
  }

  await browser.close();
}

debugCatastrophicPixel().catch(console.error);

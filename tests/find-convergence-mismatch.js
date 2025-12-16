/**
 * Find pixels where QDZ converges but Adaptive diverges at 9990/9997
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function findMismatch() {
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

  console.log('Adaptive board complete. Creating QDZ board...\n');

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

    // Count adaptive catastrophes
    let adaptive9997 = 0;
    let adaptive9990 = 0;
    const catastrophicPixels = [];

    for (let i = 0; i < adaptiveBoard.nn.length; i++) {
      if (adaptiveBoard.nn[i] === 9997) {
        adaptive9997++;
        catastrophicPixels.push(i);
      } else if (adaptiveBoard.nn[i] === 9990) {
        adaptive9990++;
        catastrophicPixels.push(i);
      }
    }

    console.log(`Adaptive: ${adaptive9997} pixels at 9997, ${adaptive9990} pixels at 9990`);
    console.log(`Total catastrophic pixels: ${catastrophicPixels.length}`);

    // Create QDZ board and run to completion
    console.log('Creating and running QDZ board...');
    const qdz = new QDZhuoranBoard(1, size, toQD(c.re), toQD(c.im), config, 'qdz-compare');

    // Iterate until all pixels are done
    while (qdz.un > 0 && qdz.it < 100000) {
      qdz.iterate();
    }

    console.log(`QDZ completed at iteration ${qdz.it}, ${qdz.un} unfinished`);

    // Find mismatches: QDZ converged (nn < 0) but Adaptive diverged at 9990/9997
    const mismatches = [];
    for (const pixelIdx of catastrophicPixels) {
      const qdzNN = qdz.nn[pixelIdx];
      const adaptiveNN = adaptiveBoard.nn[pixelIdx];

      if (qdzNN < 0) {
        // QDZ says it converged, but Adaptive says it diverged!
        mismatches.push({
          pixel: pixelIdx,
          adaptiveNN,
          qdzNN,
          qdzConvergenceIter: -qdzNN
        });
      }
    }

    return {
      adaptive9997,
      adaptive9990,
      qdzConverged: Array.from({length: qdz.nn.length}, (_, i) => i).filter(i => qdz.nn[i] < 0).length,
      qdzDiverged: qdz.di,
      qdzUnfinished: qdz.un,
      qdzFinalIter: qdz.it,
      mismatches
    };
  });

  if (result.error) {
    console.error(result.error);
    await browser.close();
    return;
  }

  console.log(`\n=== Results ===`);
  console.log(`Adaptive board:`);
  console.log(`  ${result.adaptive9997} pixels diverged at 9997`);
  console.log(`  ${result.adaptive9990} pixels diverged at 9990`);
  console.log(`  Total catastrophic: ${result.adaptive9997 + result.adaptive9990}`);

  console.log(`\nQDZ board:`);
  console.log(`  ${result.qdzConverged} pixels converged`);
  console.log(`  ${result.qdzDiverged} pixels diverged`);
  console.log(`  ${result.qdzUnfinished} pixels unfinished`);
  console.log(`  Final iteration: ${result.qdzFinalIter}`);

  console.log(`\n=== CONVERGENCE MISMATCHES ===`);
  console.log(`Pixels where QDZ converged but Adaptive diverged at 9990/9997: ${result.mismatches.length}\n`);

  if (result.mismatches.length > 0) {
    console.log('Pixel\tAdaptive\tQDZ (converged at)');
    for (const m of result.mismatches.slice(0, 20)) {
      console.log(`${m.pixel}\t${m.adaptiveNN}\t\t${m.qdzConvergenceIter}`);
    }
    if (result.mismatches.length > 20) {
      console.log(`... and ${result.mismatches.length - 20} more`);
    }
  }

  await browser.close();
}

findMismatch().catch(console.error);

/**
 * Load the actual page and inspect what board is created
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function inspectLivePage() {
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

  // Test both boards separately
  for (const board of ['adaptive', 'qdz']) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing board=${board}`);
    console.log('='.repeat(80));

    const params = new URLSearchParams({
      z: '1e29',
      c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
      a: '16:9',
      grid: '20',
      pixelratio: '1',
      board: board,
      debug: 'w'
    });

    const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

    // Wait for board to be created
    await page.waitForFunction(
      () => window.worker0?.boards?.size > 0,
      { timeout: 10000 }
    );

    // Wait for completion or 60 seconds
    await page.waitForFunction(
      () => {
        const board = Array.from(window.worker0?.boards?.values() || [])[0];
        return board && board.un === 0;
      },
      { timeout: 60000 }
    ).catch(() => console.log('Timeout waiting for completion'));

    const result = await page.evaluate(() => {
      const board = Array.from(window.worker0.boards.values())[0];
      const nn = Array.from(board.nn);

      // Count diverged/converged
      let diverged = 0, converged = 0, computing = 0;
      for (const n of nn) {
        if (n > 0) diverged++;
        else if (n < 0) converged++;
        else computing++;
      }

      // Histogram of divergence iterations
      const divHist = {};
      for (const n of nn) {
        if (n > 0) {
          divHist[n] = (divHist[n] || 0) + 1;
        }
      }

      // Top 10 divergence iterations
      const topDivs = Object.entries(divHist)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([iter, count]) => ({ iter: parseInt(iter), count }));

      // Get specific iterations mentioned by user (9997, 9990)
      const at9997 = divHist[9997] || 0;
      const at9990 = divHist[9990] || 0;

      // Reference orbit info for adaptive boards
      const refInfo = board.refOrbitEscaped !== undefined ? {
        refEscaped: board.refOrbitEscaped,
        refIterations: board.refIterations
      } : null;

      return {
        boardType: board.constructor.name,
        it: board.it,
        un: board.un,
        diverged,
        converged,
        computing,
        total: nn.length,
        topDivergences: topDivs,
        at9997,
        at9990,
        refInfo
      };
    });

    console.log(`\nBoard type: ${result.boardType}`);
    console.log(`Iteration: ${result.it}`);
    console.log(`Unfinished: ${result.un}`);
    console.log(`\nPixels: ${result.total} total`);
    console.log(`  Diverged: ${result.diverged}`);
    console.log(`  Converged: ${result.converged}`);
    console.log(`  Computing: ${result.computing}`);

    if (result.refInfo) {
      console.log(`\nReference orbit:`);
      console.log(`  Escaped: ${result.refInfo.refEscaped}`);
      console.log(`  Iterations: ${result.refInfo.refIterations}`);
    }

    console.log(`\nTop divergence iterations:`);
    for (const { iter, count } of result.topDivergences) {
      console.log(`  ${iter}: ${count} pixels`);
    }

    console.log(`\nSpecific iterations:`);
    console.log(`  9997: ${result.at9997} pixels`);
    console.log(`  9990: ${result.at9990} pixels`);
  }

  await browser.close();
}

inspectLivePage().catch(console.error);

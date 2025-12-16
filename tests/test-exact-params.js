/**
 * Test exact parameters that user reports showing different behavior
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function testBothBoards() {
  console.log('Testing with exact user parameters...\n');

  for (const board of ['qdz', 'adaptive']) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const params = new URLSearchParams({
      z: '1e29',
      a: '16:9',
      board: board,
      c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
      grid: '10',
      pixelratio: '1'
    });

    const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

    console.log(`Testing ${board.toUpperCase()}...`);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

    // Wait for board to be created
    await page.waitForFunction(
      () => window.explorer?.grid?.views?.[0] !== undefined,
      { timeout: 10000 }
    );

    // Wait for completion or timeout after 60 seconds
    const startTime = Date.now();
    await page.waitForFunction(
      () => {
        const view = window.explorer?.grid?.views?.[0];
        return (view && view.un === 0) || (Date.now() - startTime > 60000);
      },
      { timeout: 65000 }
    );

    const result = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = Array.from(view.nn);

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

      return {
        boardType: view.boardType,
        it: view.it,
        un: view.un,
        diverged,
        converged,
        computing,
        total: nn.length,
        topDivergences: topDivs
      };
    });

    console.log(`  Board type: ${result.boardType}`);
    console.log(`  Iteration: ${result.it}`);
    console.log(`  Unfinished: ${result.un}`);
    console.log(`  Pixels: ${result.total} total`);
    console.log(`    Diverged: ${result.diverged}`);
    console.log(`    Converged: ${result.converged}`);
    console.log(`    Computing: ${result.computing}`);
    console.log(`  Top divergence iterations:`);
    for (const { iter, count } of result.topDivergences) {
      console.log(`    ${iter}: ${count} pixels`);
    }
    console.log();

    await browser.close();
  }
}

testBothBoards().catch(console.error);

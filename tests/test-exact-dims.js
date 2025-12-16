const puppeteer = require('puppeteer');
const path = require('path');

async function testExactDims(boardType) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();
  // Set viewport to match user's setup (1470 wide produces 52x29 dims)
  await page.setViewport({ width: 1470, height: 827 });

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
    board: boardType
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;
  
  console.log(`\n=== Testing ${boardType.toUpperCase()} ===`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.worker0?.boards?.size > 0, { timeout: 10000 });

  // Wait for computation to finish or reach 20000 iterations
  await page.waitForFunction(() => {
    const board = Array.from(window.worker0.boards.values())[0];
    return board.it >= 20000 || !board.unfinished();
  }, { timeout: 120000 });

  const status = await page.evaluate(() => {
    const board = Array.from(window.worker0.boards.values())[0];
    const unknown = board.nn.filter(n => n === 0).length;
    const diverged = board.nn.filter(n => n > 0).length;
    const converged = board.nn.filter(n => n < 0).length;

    // Get histogram of divergence iterations
    const histogram = {};
    board.nn.forEach(nn => {
      if (nn > 0) {
        histogram[nn] = (histogram[nn] || 0) + 1;
      }
    });
    const topDivergences = Object.entries(histogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([iter, count]) => ({ iter: parseInt(iter), count }));

    return {
      type: board.constructor.name,
      iteration: board.it,
      finished: !board.unfinished(),
      total: board.nn.length,
      unknown,
      diverged,
      converged,
      dimsWidth: board.config.dimsWidth,
      dimsHeight: board.config.dimsHeight,
      topDivergences
    };
  });

  console.log(`Board: ${status.type}`);
  console.log(`Dims: ${status.dimsWidth}x${status.dimsHeight} = ${status.total} pixels`);
  console.log(`Iteration: ${status.iteration} (finished: ${status.finished})`);
  console.log(`Unknown: ${status.unknown}`);
  console.log(`Diverged: ${status.diverged}`);
  console.log(`Converged: ${status.converged}`);
  console.log('Top divergence iterations:');
  status.topDivergences.forEach(({iter, count}) => {
    console.log(`  ${iter}: ${count} pixels`);
  });

  await browser.close();
  return status;
}

async function compare() {
  const qdz = await testExactDims('qdz');
  const adaptive = await testExactDims('adaptive');
  
  console.log('\n=== COMPARISON ===');
  console.log(`QDZ: ${qdz.unknown} unknown, ${qdz.diverged} diverged, ${qdz.converged} converged at iter ${qdz.iteration}`);
  console.log(`Adaptive: ${adaptive.unknown} unknown, ${adaptive.diverged} diverged, ${adaptive.converged} converged at iter ${adaptive.iteration}`);
}

compare().catch(console.error);

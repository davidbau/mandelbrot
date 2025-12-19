const puppeteer = require('puppeteer');
const path = require('path');

async function benchmark() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const results = [];

  for (const board of ['gpu', 'sparse']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 450 });

    let compactCount = 0, normalCount = 0;
    let totalTime = 0, totalPxIters = 0;
    let lastIters = 0;

    page.on('console', msg => {
      const text = msg.text();
      if (text.startsWith('[timing]')) {
        const match = text.match(/\[timing\] (\w+) k=(\d+): (\d+) px × (\d+) iters = ([\d.]+)μs( C)?/);
        if (match) {
          totalTime += parseFloat(match[5]);
          totalPxIters += parseInt(match[3]) * parseInt(match[4]);
          lastIters += parseInt(match[4]);
          if (match[6]) compactCount++;
          else normalCount++;
        }
      }
    });

    // Use maxiter=1000 to cap iterations
    const params = `z=6.25e2&c=-0.06091+0.66869i&a=16:9&grid=1&pixelratio=6&board=${board}&debug=r,t&maxiter=1000`;
    const url = 'file://' + path.join(process.cwd(), 'index.html') + '?' + params;

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    // Wait for done
    await page.waitForFunction(() => {
      const s = document.querySelector('.status');
      return s && s.textContent.includes('done');
    }, { timeout: 60000 }).catch(() => {});

    await new Promise(r => setTimeout(r, 200));
    await page.close();

    const nsPerPxIter = (totalTime * 1000) / totalPxIters;
    results.push({
      board,
      compactCount,
      normalCount,
      totalBatches: compactCount + normalCount,
      totalIters: lastIters,
      nsPerPxIter: nsPerPxIter.toFixed(3)
    });

    console.log(`${board}: ${compactCount + normalCount} batches, ${lastIters} iters, ${nsPerPxIter.toFixed(3)} ns/px-iter`);
    if (board === 'sparse') {
      console.log(`  Compaction batches: ${compactCount}`);
    }
  }

  await browser.close();

  const gpu = results.find(r => r.board === 'gpu');
  const sparse = results.find(r => r.board === 'sparse');
  console.log(`\nSpeedup: ${(parseFloat(gpu.nsPerPxIter) / parseFloat(sparse.nsPerPxIter)).toFixed(2)}x`);
}

benchmark().catch(console.error);

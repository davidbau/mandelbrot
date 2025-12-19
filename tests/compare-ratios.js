const puppeteer = require('puppeteer');
const path = require('path');

async function testRatio(browser, ratio) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });

  let compactCount = 0, normalCount = 0;
  let totalTime = 0, totalPxIters = 0;

  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[timing]')) {
      const match = text.match(/\[timing\] (\w+) k=(\d+): (\d+) px × (\d+) iters = ([\d.]+)μs( C)?/);
      if (match) {
        totalTime += parseFloat(match[5]);
        totalPxIters += parseInt(match[3]) * parseInt(match[4]);
        if (match[6]) compactCount++;
        else normalCount++;
      }
    }
  });

  // Inject ratio change before navigation
  await page.evaluateOnNewDocument((r) => {
    window.__testCompactionRatio = r;
  }, ratio);

  const params = `z=6.25e2&c=-0.06091+0.66869i&a=16:9&grid=1&pixelratio=6&board=sparse&debug=r,t&maxiter=1000`;
  const url = 'file://' + path.join(process.cwd(), 'index.html') + '?' + params;

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });

  // Override ratio after board is created
  await page.evaluate((r) => {
    const view = window.explorer?.grid?.views?.[0];
    if (view?.compactionCostRatio !== undefined) {
      view.compactionCostRatio = r;
    }
  }, ratio);

  await page.waitForFunction(() => {
    const s = document.querySelector('.status');
    return s && s.textContent.includes('done');
  }, { timeout: 60000 }).catch(() => {});

  await new Promise(r => setTimeout(r, 200));
  await page.close();

  return {
    ratio,
    compactCount,
    normalCount,
    totalBatches: compactCount + normalCount,
    nsPerPxIter: (totalTime * 1000) / totalPxIters
  };
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  console.log('Testing compaction ratios...\n');

  for (const ratio of [1.0, 5.0]) {
    const r = await testRatio(browser, ratio);
    console.log(`Ratio ${ratio}:`);
    console.log(`  Compactions: ${r.compactCount}`);
    console.log(`  Normal: ${r.normalCount}`);
    console.log(`  ns/px-iter: ${r.nsPerPxIter.toFixed(3)}`);
    console.log('');
  }

  await browser.close();
}

main().catch(console.error);

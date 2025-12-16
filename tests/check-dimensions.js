/**
 * Check what dimensions are being used
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function checkDimensions() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Test with our current viewport
  await page.setViewport({ width: 1280, height: 720 });

  const params = new URLSearchParams({
    z: '1e29',
    c: '-0.022281337871859783996817861398-0.698493620179801136370805820785i',
    a: '16:9',
    grid: '20',
    pixelratio: '1',
    board: 'qdz'
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  const dims1280 = await page.evaluate(() => {
    const config = window.explorer.config;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dimsWidth: config.dimsWidth,
      dimsHeight: config.dimsHeight,
      dimsArea: config.dimsArea,
      gridSize: window.explorer.grid.views.length
    };
  });

  console.log('1280x720 viewport:');
  console.log(`  Browser inner: ${dims1280.viewport.width}x${dims1280.viewport.height}`);
  console.log(`  Pixel grid: ${dims1280.dimsWidth}x${dims1280.dimsHeight} = ${dims1280.dimsArea} pixels`);
  console.log(`  Grid views: ${dims1280.gridSize}\n`);

  // Test with 500px wide viewport (matching user's browser)
  await page.setViewport({ width: 500, height: 281 }); // 16:9 aspect ratio
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  const dims500 = await page.evaluate(() => {
    const config = window.explorer.config;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dimsWidth: config.dimsWidth,
      dimsHeight: config.dimsHeight,
      dimsArea: config.dimsArea,
      gridSize: window.explorer.grid.views.length
    };
  });

  console.log('500x281 viewport (16:9):');
  console.log(`  Browser inner: ${dims500.viewport.width}x${dims500.viewport.height}`);
  console.log(`  Pixel grid: ${dims500.dimsWidth}x${dims500.dimsHeight} = ${dims500.dimsArea} pixels`);
  console.log(`  Grid views: ${dims500.gridSize}\n`);

  console.log('Difference:');
  console.log(`  Pixel count ratio: ${dims1280.dimsArea / dims500.dimsArea}x`);
  console.log(`  We are testing ${dims1280.dimsArea} pixels, user sees ${dims500.dimsArea} pixels`);

  await browser.close();
}

checkDimensions().catch(console.error);

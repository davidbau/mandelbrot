const puppeteer = require('puppeteer');
const path = require('path');

async function test() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Listen to console
  page.on('console', msg => console.log('[PAGE]', msg.text()));

  const url = `file://${path.join(process.cwd(), 'index.html')}`;
  console.log('Loading:', url);

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait for first view to have some data
  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && !view.uninteresting();
  }, { timeout: 10000 });

  // Wait a bit more for URL to update
  await new Promise(r => setTimeout(r, 1000));

  const finalUrl = await page.url();
  console.log('\nFinal URL:', finalUrl);
  console.log('Has ?: ', finalUrl.includes('?'));

  // Also check what currenturl() returns
  const currentUrlResult = await page.evaluate(() => {
    return window.explorer.urlHandler.currenturl();
  });
  console.log('currenturl() returns:', currentUrlResult);

  await browser.close();
}

test().catch(console.error);

/**
 * Test that debug flags are preserved in the URL
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function testDebugUrlPreservation() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  const params = new URLSearchParams({
    debug: 'w,s',
    z: '1e20',
    c: '-0.74543+0.11301i',
    grid: '10'
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?${params}`;

  console.log('Loading page with debug=w,s...\n');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait a moment for URL to be updated
  await new Promise(r => setTimeout(r, 1000));

  const currentUrl = await page.evaluate(() => {
    return window.location.search;
  });

  console.log('Current URL search params:', currentUrl);

  const hasDebug = currentUrl.includes('debug=w,s') || currentUrl.includes('debug=w%2Cs');

  console.log('\n✓ Debug flags preserved in URL:', hasDebug);

  if (!hasDebug) {
    console.error('ERROR: Debug flags not preserved!');
    console.error('Expected: debug=w,s or debug=w%2Cs');
    console.error('Got:', currentUrl);
  } else {
    console.log('SUCCESS: Debug flags are preserved in the URL');
  }

  await browser.close();

  process.exit(hasDebug ? 0 : 1);
}

testDebugUrlPreservation().catch(console.error);

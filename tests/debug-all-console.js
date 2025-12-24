const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1470, height: 827 });

  const events = [];

  // Capture ALL console messages
  page.on('console', msg => {
    const text = msg.text();
    events.push({ time: Date.now(), msg: text.slice(0, 150) });
  });

  const startTime = Date.now();
  await page.goto(`file://${process.cwd()}/index.html?board=gpu&debug=t`);

  // Wait for first paint
  await page.waitForFunction(() => window.explorer?.grid?._firstPaintLogged, { timeout: 20000 });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('             ALL CONSOLE OUTPUT');
  console.log('══════════════════════════════════════════════════════════\n');

  for (const event of events.slice(0, 30)) {
    const elapsed = event.time - startTime;
    console.log(`  ${elapsed.toString().padStart(5)}ms: ${event.msg}`);
  }

  console.log(`\n  ... (${events.length} total messages)`);
  console.log('\n══════════════════════════════════════════════════════════\n');

  await browser.close();
})();

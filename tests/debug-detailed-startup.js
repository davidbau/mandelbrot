const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1470, height: 827 });

  const events = [];

  page.on('console', msg => {
    const text = msg.text();
    // Capture all timing/startup events
    if (text.includes('[startup]') || text.includes('[timing]') ||
        text.includes('First paint') || text.includes('Board') ||
        text.includes('Worker') || text.includes('GPU')) {
      events.push({ time: Date.now(), msg: text.slice(0, 120) });
    }
  });

  const startTime = Date.now();
  await page.goto(`file://${process.cwd()}/index.html?board=gpu&debug=t`);
  const navTime = Date.now() - startTime;

  // Wait for first paint
  await page.waitForFunction(() => window.explorer?.grid?._firstPaintLogged, { timeout: 20000 });
  const firstPaintTime = Date.now() - startTime;

  // Wait for completion
  await page.waitForFunction(() => {
    const grid = window.explorer?.grid;
    return grid && Object.values(grid.views).every(v => v.un === 0);
  }, { timeout: 30000 });
  const completionTime = Date.now() - startTime;

  // Get internal timing
  const timing = await page.evaluate(() => {
    const grid = window.explorer.grid;
    return {
      workerCount: grid.scheduler.workers.length,
      viewCount: Object.keys(grid.views).length,
      firstPaintMs: grid._firstPaintTime
    };
  });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('             DETAILED STARTUP TIMELINE');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log('MILESTONES:');
  console.log(`  Navigation complete: ${navTime}ms`);
  console.log(`  First paint:         ${firstPaintTime}ms`);
  console.log(`  Full completion:     ${completionTime}ms`);
  console.log(`  Workers created:     ${timing.workerCount}`);

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('EVENT LOG:');

  let lastEventTime = startTime;
  for (const event of events) {
    const elapsed = event.time - startTime;
    const delta = event.time - lastEventTime;
    const deltaStr = delta > 5 ? ` (+${delta}ms)` : '';
    console.log(`  ${elapsed.toString().padStart(5)}ms: ${event.msg}${deltaStr}`);
    lastEventTime = event.time;
  }

  console.log('\n══════════════════════════════════════════════════════════\n');

  await browser.close();
})();

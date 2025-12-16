/**
 * Test debug flags w (worker code on main thread) and n (no initial view)
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function testFlags() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  console.log('Testing debug flags w and n...\n');

  // Test flag 'w' - worker code on main thread
  const page1 = await browser.newPage();

  // Collect console logs (set up before page load)
  const logs = [];
  const errors = [];
  page1.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page1.on('pageerror', err => {
    errors.push(err.toString());
    logs.push(`[pageerror] ${err.toString()}`);
  });

  const url1 = `file://${path.join(process.cwd(), 'index.html')}?debug=w`;
  await page1.goto(url1, { waitUntil: 'load' });
  await page1.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait for a view to be created (which triggers worker creation and the 'w' flag logic)
  await page1.waitForFunction(() => window.explorer.grid.views.length > 0, { timeout: 10000 });

  const result1 = await page1.evaluate(() => {
    // Manual test of the condition
    const testCondition = window.explorer && window.explorer.config &&window.explorer.config.hasDebugFlag && window.explorer.config.hasDebugFlag('w');

    return {
      hasCpuBoard: typeof CpuBoard !== 'undefined',
      hasBoard: typeof Board !== 'undefined',
      hasQDZhuoranBoard: typeof QDZhuoranBoard !== 'undefined',
      debugFlag: window.explorer.config.debug,
      hasDebugW: window.explorer.config.hasDebugFlag('w'),
      testCondition,
      explorerExists: !!window.explorer,
      configExists: !!window.explorer?.config
    };
  });

  console.log('  Debug flag value:', result1.debugFlag);
  console.log('  hasDebugFlag("w"):', result1.hasDebugW);
  console.log('  Test condition in startApp:', result1.testCondition);
  console.log('  Explorer exists:', result1.explorerExists);
  console.log('  Config exists:', result1.configExists);
  console.log('  Errors:', errors);
  console.log('  All console logs:');
  logs.slice(0, 30).forEach(log => console.log('   ', log));

  console.log('Flag w (worker code on main thread):');
  console.log(`  CpuBoard class available: ${result1.hasCpuBoard}`);
  console.log(`  Board class available: ${result1.hasBoard}`);
  console.log(`  QDZhuoranBoard class available: ${result1.hasQDZhuoranBoard}`);

  if (result1.hasCpuBoard && result1.hasBoard && result1.hasQDZhuoranBoard) {
    console.log('  ✓ Worker code successfully loaded on main thread!');
  } else {
    console.log('  ✗ Worker code NOT loaded on main thread');
    await browser.close();
    process.exit(1);
  }

  await page1.close();

  // Test flag 'n' - no initial view
  const page2 = await browser.newPage();
  const url2 = `file://${path.join(process.cwd(), 'index.html')}?debug=n`;

  await page2.goto(url2, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait a bit to ensure views would have been created if not suppressed
  await new Promise(r => setTimeout(r, 1000));

  const result2 = await page2.evaluate(() => {
    return {
      viewCount: window.explorer.grid.views.length
    };
  });

  console.log('\nFlag n (no initial view):');
  console.log(`  View count: ${result2.viewCount}`);

  if (result2.viewCount === 0) {
    console.log('  ✓ Initial view creation successfully suppressed!');
  } else {
    console.log('  ✗ Initial view was created (expected 0 views)');
    await browser.close();
    process.exit(1);
  }

  await page2.close();

  // Test combined flags 'w,n'
  const page3 = await browser.newPage();
  const url3 = `file://${path.join(process.cwd(), 'index.html')}?debug=w,n`;

  await page3.goto(url3, { waitUntil: 'load' });
  await page3.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  await new Promise(r => setTimeout(r, 1000));

  const result3 = await page3.evaluate(() => {
    return {
      hasBoard: typeof Board !== 'undefined',
      viewCount: window.explorer.grid.views.length
    };
  });

  console.log('\nFlags w,n (combined):');
  console.log(`  Board class available: ${result3.hasBoard}`);
  console.log(`  View count: ${result3.viewCount}`);

  if (result3.hasBoard && result3.viewCount === 0) {
    console.log('  ✓ Both flags work together!');
  } else {
    console.log('  ✗ Combined flags failed');
    await browser.close();
    process.exit(1);
  }

  await page3.close();
  await browser.close();

  console.log('\n✓ All debug flag tests passed!');
}

testFlags().catch(console.error);

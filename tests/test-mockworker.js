/**
 * Test that MockWorker runs boards on main thread with debug=w flag
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function testMockWorker() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Load with debug=w flag (without 'n' so initial view is created)
  const url = `file://${path.join(process.cwd(), 'index.html')}?debug=w&z=1e20&c=-0.74543+0.11301i&grid=20`;

  console.log('Loading with debug=w flag...');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait a moment for board to be created
  await new Promise(r => setTimeout(r, 1000));

  const result = await page.evaluate(() => {
    // Check that MockWorker was used
    const hasMockWorker = typeof MockWorker !== 'undefined';
    const worker0 = window.worker0;
    const isMockWorker = worker0 && worker0.constructor.name === 'MockWorker';

    // Access board directly from worker (only possible on main thread)
    let boardAccessible = false;
    let boardType = null;
    if (worker0 && worker0.boards) {
      const boards = Array.from(worker0.boards.values());
      if (boards.length > 0) {
        boardAccessible = true;
        boardType = boards[0].constructor.name;
      }
    }

    return {
      hasMockWorker,
      isMockWorker,
      boardAccessible,
      boardType,
      workerCount: window.explorer?.scheduler?.workers?.length || 0
    };
  });

  await browser.close();

  console.log('\n=== MockWorker Test Results ===');
  console.log(`MockWorker defined: ${result.hasMockWorker}`);
  console.log(`Worker is MockWorker: ${result.isMockWorker}`);
  console.log(`Board accessible on main thread: ${result.boardAccessible}`);
  console.log(`Board type: ${result.boardType}`);
  console.log(`Worker count: ${result.workerCount}`);

  if (result.hasMockWorker && result.isMockWorker && result.boardAccessible) {
    console.log('\n✓ MockWorker test PASSED - boards running on main thread');
    return true;
  } else {
    console.log('\n✗ MockWorker test FAILED');
    return false;
  }
}

testMockWorker().catch(console.error);

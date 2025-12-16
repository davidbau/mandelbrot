/**
 * Test debug=s step mode for single-stepping through iterations
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function testStepMode() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React DevTools') && !text.includes('JSHandle')) {
      console.log(`[PAGE] ${text}`);
    }
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?debug=w,s&z=1e20&c=-0.74543+0.11301i&grid=10`;

  console.log('Loading with debug=w,s (step mode)...\n');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait for board to be created
  await page.waitForFunction(
    () => window.worker0?.boards?.size > 0,
    { timeout: 5000 }
  );

  console.log('\n=== Testing Step Mode ===\n');

  // Test 1: Check initial state (should be paused)
  await new Promise(r => setTimeout(r, 1000));
  const initialState = await page.evaluate(() => {
    const board = Array.from(window.worker0.boards.values())[0];
    return {
      stepMode: window.worker0.stepMode,
      iteration: board.it,
      un: board.un
    };
  });

  console.log(`Initial state (should be paused):`);
  console.log(`  Step mode: ${initialState.stepMode}`);
  console.log(`  Iteration: ${initialState.iteration}`);
  console.log(`  Unfinished: ${initialState.un}`);

  // Test 2: Single step
  console.log('\nCalling step()...');
  await page.evaluate(() => window.step());
  await new Promise(r => setTimeout(r, 500));

  const afterStep1 = await page.evaluate(() => {
    const board = Array.from(window.worker0.boards.values())[0];
    return { iteration: board.it, un: board.un };
  });

  console.log(`After step():`);
  console.log(`  Iteration: ${afterStep1.iteration}`);
  console.log(`  Unfinished: ${afterStep1.un}`);

  // Test 3: Step multiple times
  console.log('\nCalling step(5)...');
  await page.evaluate(() => window.step(5));
  await new Promise(r => setTimeout(r, 1000));

  const afterStep5 = await page.evaluate(() => {
    const board = Array.from(window.worker0.boards.values())[0];
    return { iteration: board.it, un: board.un };
  });

  console.log(`After step(5):`);
  console.log(`  Iteration: ${afterStep5.iteration}`);
  console.log(`  Unfinished: ${afterStep5.un}`);

  // Test 4: Inspect board
  console.log('\nCalling inspectBoard(0)...');
  const boardInfo = await page.evaluate(() => window.inspectBoard(0));
  console.log('Board info:', boardInfo);

  // Test 5: Trace pixel
  console.log('\nCalling tracePixel(0, 0)...');
  const pixelInfo = await page.evaluate(() => window.tracePixel(0, 0));
  console.log('Pixel 0 info:', pixelInfo);

  // Test 6: Resume continuous iteration
  console.log('\nCalling stepAll() to resume...');
  await page.evaluate(() => window.stepAll());
  await new Promise(r => setTimeout(r, 2000));

  const afterResume = await page.evaluate(() => {
    const board = Array.from(window.worker0.boards.values())[0];
    return board ? { iteration: board.it, un: board.un } : { completed: true };
  });

  console.log(`After stepAll():`);
  if (afterResume.completed) {
    console.log('  Board completed');
  } else {
    console.log(`  Iteration: ${afterResume.iteration}`);
    console.log(`  Unfinished: ${afterResume.un}`);
  }

  await browser.close();

  console.log('\n✓ Step mode test completed');
}

testStepMode().catch(console.error);

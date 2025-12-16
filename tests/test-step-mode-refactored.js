/**
 * Test step mode after FractalWorker refactoring
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function testStepMode() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  page.on('console', msg => console.log(`[PAGE] ${msg.text()}`));

  const url = `file://${path.join(process.cwd(), 'index.html')}?debug=w,s`;

  console.log('Loading page with debug=w,s...\n');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Wait for board to be created
  await page.waitForFunction(() => {
    const worker = window.worker0;
    return worker && worker.boards && worker.boards.size > 0;
  }, { timeout: 10000 });

  const initialState = await page.evaluate(() => {
    const worker = window.worker0;
    const boards = Array.from(worker.boards.values());
    const board = boards[0];

    return {
      workerExists: !!worker,
      stepMode: worker.stepMode,
      stepsRequested: worker.stepsRequested,
      boardCount: boards.length,
      boardExists: !!board,
      boardIt: board?.it,
      boardUn: board?.un,
      timerActive: worker.timer !== null,
      stepFunctionExists: typeof window.step === 'function'
    };
  });

  console.log('Initial state:', initialState);

  if (!initialState.stepMode) {
    console.error('ERROR: Step mode not enabled!');
    await browser.close();
    return;
  }

  if (!initialState.stepFunctionExists) {
    console.error('ERROR: step() function not defined!');
    await browser.close();
    return;
  }

  // Test step(1)
  console.log('\nCalling step(1)...');
  await page.evaluate(() => window.step(1));

  // Wait for iteration
  await new Promise(r => setTimeout(r, 500));

  const afterStep1 = await page.evaluate(() => {
    const worker = window.worker0;
    const board = Array.from(worker.boards.values())[0];

    return {
      stepsRequested: worker.stepsRequested,
      boardIt: board?.it || 0
    };
  });

  console.log('After step(1):', afterStep1);
  console.log(`Iteration changed from ${initialState.boardIt} to ${afterStep1.boardIt}`);

  if (afterStep1.boardIt === initialState.boardIt) {
    console.error('ERROR: Board did not iterate!');
  } else if (afterStep1.boardIt === initialState.boardIt + 1) {
    console.log('✓ SUCCESS: Board advanced exactly 1 iteration');
  } else {
    console.error(`ERROR: Board advanced ${afterStep1.boardIt - initialState.boardIt} iterations instead of 1`);
  }

  // Test step(5)
  console.log('\nCalling step(5)...');
  await page.evaluate(() => window.step(5));

  // Wait for iterations
  await new Promise(r => setTimeout(r, 2000));

  const afterStep5 = await page.evaluate(() => {
    const worker = window.worker0;
    const board = Array.from(worker.boards.values())[0];

    return {
      stepsRequested: worker.stepsRequested,
      boardIt: board?.it || 0
    };
  });

  console.log('After step(5):', afterStep5);
  console.log(`Iteration changed from ${afterStep1.boardIt} to ${afterStep5.boardIt}`);

  const expectedIt = afterStep1.boardIt + 5;
  if (afterStep5.boardIt === expectedIt) {
    console.log('✓ SUCCESS: Board advanced exactly 5 iterations');
  } else {
    console.error(`ERROR: Expected iteration ${expectedIt}, got ${afterStep5.boardIt}`);
  }

  await browser.close();
}

testStepMode().catch(console.error);

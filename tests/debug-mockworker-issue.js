/**
 * Debug MockWorker to see what's not working
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function debugMockWorker() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();

  // Enable console logging from page
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React DevTools')) {
      console.log(`[PAGE] ${text}`);
    }
  });

  const url = `file://${path.join(process.cwd(), 'index.html')}?debug=w,n&z=1e20&c=-0.74543+0.11301i&grid=10`;

  console.log('Loading with debug=w,n (no initial view)...\n');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

  // Create a board manually via the page console
  const manualBoardResult = await page.evaluate(async () => {
    const config = window.explorer.config;
    const c = { re: -0.74543, im: 0.11301 };
    const zoom = 1e20;
    const size = config.firstsize / zoom;

    // Create board directly
    const board = new GpuZhuoranBoard(99, size, toQD(c.re), toQD(c.im), config, 'manual-test');
    await board.initGPU();

    // Store in global for inspection
    window.testBoard = board;

    // Iterate a few times
    for (let i = 0; i < 10; i++) {
      await board.iterate();
    }

    return {
      created: true,
      type: board.constructor.name,
      it: board.it,
      un: board.un
    };
  });

  console.log('Manual board test:', manualBoardResult);

  // Wait a bit
  await new Promise(r => setTimeout(r, 1000));

  const result = await page.evaluate(() => {
    const worker = window.worker0;
    const explorer = window.explorer;
    const view = explorer?.grid?.views?.[0];

    return {
      // Worker state
      workerExists: !!worker,
      workerType: worker?.constructor?.name,
      workerBoards: worker?.boards ? Array.from(worker.boards.keys()) : null,
      workerBoardCount: worker?.boards?.size || 0,

      // First board state (if exists)
      boardState: worker?.boards?.size > 0 ? (() => {
        const board = Array.from(worker.boards.values())[0];
        return {
          type: board.constructor.name,
          k: board.k,
          it: board.it,
          un: board.un,
          unfinished: board.unfinished()
        };
      })() : null,

      // View state
      viewExists: !!view,
      viewIt: view?.it,
      viewUn: view?.un,
      viewBoardType: view?.boardType,

      // Scheduler state
      schedulerWorkerCount: explorer?.scheduler?.workers?.length || 0
    };
  });

  console.log('\n=== MockWorker Debug Info ===');
  console.log('Worker exists:', result.workerExists);
  console.log('Worker type:', result.workerType);
  console.log('Worker has boards:', result.workerBoardCount);
  console.log('Board keys:', result.workerBoards);

  if (result.boardState) {
    console.log('\nFirst board state:');
    console.log('  Type:', result.boardState.type);
    console.log('  k:', result.boardState.k);
    console.log('  it:', result.boardState.it);
    console.log('  un:', result.boardState.un);
    console.log('  unfinished:', result.boardState.unfinished);
  }

  console.log('\nView state:');
  console.log('  Exists:', result.viewExists);
  console.log('  it:', result.viewIt);
  console.log('  un:', result.viewUn);
  console.log('  boardType:', result.viewBoardType);

  console.log('\nScheduler:');
  console.log('  Worker count:', result.schedulerWorkerCount);

  await browser.close();
}

debugMockWorker().catch(console.error);

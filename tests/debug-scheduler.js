const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  page.on('pageerror', err => console.log('Page error:', err.message));
  page.on('requestfailed', req => console.log('Request failed:', req.url()));

  const params = 'z=1e14&a=16:9&debug=nogpu&c=-0.5425060105393306400515387573956+0.5082791199098461776529578942116i,,,,,,,,,,,&grid=12&pixelratio=1';
  const url = 'file://' + path.join(__dirname, '..', 'index.html') + '?' + params;
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

  // Wait and collect scheduler logs
  await new Promise(r => setTimeout(r, 10000));

  // Check scheduler state
  const schedulerState = await page.evaluate(() => {
    const exp = window.explorer;
    if (!exp) return { error: 'no explorer' };
    const sched = exp.grid?.scheduler;
    if (!sched) return { error: 'no scheduler', gridKeys: Object.keys(exp.grid || {}).slice(0, 20) };
    const workerLoads = sched.workers.map((_, i) => sched.getWorkerLoad(i));
    const efforts = Array.from(sched.boardEfforts.entries());
    const lowLoad = Math.min(...workerLoads);
    const highEffort = Math.max(...efforts.map(e => e[1]));
    // Check boards per worker
    const boardsPerWorker = sched.workers.map((_, i) => sched.getWorkerBoards(i).length);
    return {
      numWorkers: sched.workers.length,
      workerLoads,
      boardsPerWorker,
      lowLoad,
      highEffort,
      condition: `${lowLoad} * 2 < ${highEffort} = ${lowLoad * 2 < highEffort}`,
      innerCondition: workerLoads.map((load, i) =>
        `w${i}: load=${load} > ${2*lowLoad}? ${load > 2*lowLoad}, boards=${boardsPerWorker[i]}`
      ),
      assignments: Object.keys(sched.assignments).length,
      boardTypes: window.explorer.grid.views.map(v => v.boardType)
    };
  });
  console.log('\nScheduler state:', JSON.stringify(schedulerState, null, 2));

  await new Promise(r => setTimeout(r, 10000));

  // Show all logs to debug
  console.log('Total logs:', logs.length);
  logs.slice(0, 50).forEach(l => console.log(l));

  // Show scheduler-related logs
  const relevant = logs.filter(l => l.includes('worker') || l.includes('transfer') || l.includes('effort') || l.includes('load'));
  console.log('\nRelevant logs:', relevant.length);
  relevant.slice(0, 30).forEach(l => console.log(l));

  // Check if any transfers happened
  const transfers = logs.filter(l => l.includes('transferred'));
  console.log('\nTransfers:', transfers.length);
  transfers.forEach(l => console.log(l));

  await browser.close();
})();

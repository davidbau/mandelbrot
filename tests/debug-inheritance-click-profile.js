const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

(async () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1470, height: 900 });

  await page.goto(`http://localhost:${port}?grid=2&board=gpu&debug=w`, {
    waitUntil: 'domcontentloaded'
  });

  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && view.unfinished() === 0;
  }, { timeout: 120000 });

  await page.waitForFunction(() => !window.explorer?.grid?.currentUpdateProcess, { timeout: 30000 });

  const results = await page.evaluate(async () => {
    const grid = window.explorer.grid;
    const targets = [
      { re: -0.75, im: 0, label: '-0.75+0i' },
      { re: 0, im: 1, label: '0+1i' }
    ];

    const originalAssign = grid.scheduler.assignBoardToWorker.bind(grid.scheduler);
    const originalCompute = grid.computeInheritance.bind(grid);
    const workers = grid.scheduler.workers || [];
    const worker = workers[0] || window.worker0;
    const originalAssignBoard = worker?.assignBoardToWorker?.bind(worker);
    let precomputedCtor = null;
    const runs = [];

    let lastAssignDuration = null;
    grid.scheduler.assignBoardToWorker = function(...args) {
      const start = performance.now();
      const result = originalAssign(...args);
      lastAssignDuration = performance.now() - start;
      return result;
    };
    if (originalAssignBoard) {
      worker.assignBoardToWorker = function(...args) {
        const start = performance.now();
        const result = originalAssignBoard(...args);
        lastAssignDuration = performance.now() - start;
        return result;
      };
    }

    let lastPrecomputedDuration = null;

    for (const target of targets) {
      const parent = grid.views[0];
      const size = parent.size / grid.config.zoomfactor;

      grid.computeInheritance = originalCompute;
      const startInherit = performance.now();
      const inherited = grid.computeInheritance(parent, {
        size,
        re: parent.re,
        im: parent.im
      });
      let zBytes = 0;
      if (inherited.packed) {
        zBytes = (inherited.cIndices?.length || 0) * (inherited.zStride || 0) * 8;
      } else if (inherited.converged && inherited.converged.length) {
        const sample = inherited.converged[0]?.z;
        const zStride = sample ? sample.length : 0;
        zBytes = inherited.converged.length * zStride * 8;
      }
      const inheritMs = performance.now() - startInherit;

      grid.computeInheritance = () => inherited;
      const startAssign = performance.now();
      grid.scheduler.assignBoardToWorker(1, size, parent.re, parent.im, grid.config, parent.id + Math.random(), inherited);
      const assignMs = performance.now() - startAssign;
      await new Promise(resolve => setTimeout(resolve, 0));
      const board1 = worker?.boards?.get(1);
      precomputedCtor = board1?.precomputed?.constructor || null;
      let precomputedCtorMs = null;
      if (precomputedCtor) {
        const startCtor = performance.now();
        new precomputedCtor(inherited);
        precomputedCtorMs = performance.now() - startCtor;
      }

      runs.push({
        label: target.label,
        inheritMs,
        assignMs,
        assignWrappedMs: lastAssignDuration,
        precomputedMs: precomputedCtorMs,
        workerStats: {
          hasWorker: !!worker,
          hasBoard: !!board1,
          hasPrecomputed: !!board1?.precomputed,
          workerCount: workers.length,
          workerTypes: workers.map(w => w?.constructor?.name || 'unknown')
        },
        inheritedStats: {
          diverged: inherited.packed ? (inherited.dIndices?.length || 0) : (inherited.diverged?.length || 0),
          converged: inherited.packed ? (inherited.cIndices?.length || 0) : (inherited.converged?.length || 0),
          zBytes
        }
      });

      grid.removeView(1);
      worker?.boards?.delete(1);
    }

    grid.scheduler.assignBoardToWorker = originalAssign;
    grid.computeInheritance = originalCompute;
    if (originalAssignBoard) {
      worker.assignBoardToWorker = originalAssignBoard;
    }

    return runs;
  });

  for (const run of results) {
    console.log(run.label);
    console.log(`  computeInheritance: ${run.inheritMs.toFixed(2)} ms`);
    console.log(`  assignBoardToWorker: ${run.assignMs.toFixed(2)} ms (wrapped ${run.assignWrappedMs?.toFixed(2)} ms)`);
    console.log(`  PrecomputedPoints: ${run.precomputedMs?.toFixed(2)} ms`);
    console.log(`  worker stats: worker=${run.workerStats?.hasWorker}, board=${run.workerStats?.hasBoard}, precomputed=${run.workerStats?.hasPrecomputed}, workers=${run.workerStats?.workerCount}, types=${(run.workerStats?.workerTypes || []).join(',')}`);
    console.log(`  precomputed payload: diverged=${run.inheritedStats?.diverged}, converged=${run.inheritedStats?.converged}, zBytes=${run.inheritedStats?.zBytes}`);
  }

  await browser.close();
  server.close();
})();

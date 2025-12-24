const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1470, height: 827 });

  const batchTimings = [];
  let domReadyTime = null;
  let firstPaintInfo = null;
  let instrumented = false;

  page.on('console', async msg => {
    const text = msg.text();

    // Hook instrumentation at the very first console.log
    if (!instrumented && msg.type() === 'log') {
      instrumented = true;
      await page.evaluate(() => {
        window._timingStart = performance.now();
        window._stats = {
          processTime: 0,
          canvasTime: 0,
          schedulerTime: 0,
          gpuInitTime: 0,
          rafDelays: [],
          batchGaps: [],
          lastBatchEnd: null,
          firstPaint: {}
        };

        // Track scheduler iteration time
        if (typeof WorkScheduler !== 'undefined') {
          const origIterate = WorkScheduler.prototype.iterate;
          WorkScheduler.prototype.iterate = async function(...args) {
            const t0 = performance.now();
            const result = await origIterate.apply(this, args);
            window._stats.schedulerTime += performance.now() - t0;

            // Track gap between batches
            if (window._stats.lastBatchEnd) {
              window._stats.batchGaps.push(t0 - window._stats.lastBatchEnd);
            }
            window._stats.lastBatchEnd = performance.now();
            return result;
          };
        }

        // Track GPU board initialization
        if (typeof GpuBoard !== 'undefined' && GpuBoard.prototype.initGpu) {
          const origGpuInit = GpuBoard.prototype.initGpu;
          GpuBoard.prototype.initGpu = async function(...args) {
            const t0 = performance.now();
            const result = await origGpuInit.apply(this, args);
            window._stats.gpuInitTime += performance.now() - t0;
            return result;
          };
        }

        // Track View.updateFromWorkerResult
        if (typeof View !== 'undefined') {
          const origUpdate = View.prototype.updateFromWorkerResult;
          View.prototype.updateFromWorkerResult = function(data) {
            const t0 = performance.now();
            const result = origUpdate.call(this, data);
            window._stats.processTime += performance.now() - t0;
            return result;
          };
        }

        // Track Grid.updateCanvas
        if (typeof Grid !== 'undefined') {
          const origCanvas = Grid.prototype.updateCanvas;
          let firstPaintDone = false;
          Grid.prototype.updateCanvas = function(k, data) {
            const t0 = performance.now();
            const result = origCanvas.call(this, k, data);
            window._stats.canvasTime += performance.now() - t0;

            if (!firstPaintDone && this._firstPaintLogged) {
              firstPaintDone = true;
              window._stats.firstPaint = {
                processTime: window._stats.processTime,
                canvasTime: window._stats.canvasTime,
                schedulerTime: window._stats.schedulerTime,
                gpuInitTime: window._stats.gpuInitTime,
                batchGaps: [...window._stats.batchGaps]
              };
            }
            return result;
          };
        }

        // Track requestAnimationFrame delays
        const origRAF = window.requestAnimationFrame;
        window.requestAnimationFrame = function(cb) {
          const requestTime = performance.now();
          return origRAF.call(window, (ts) => {
            window._stats.rafDelays.push(performance.now() - requestTime);
            cb(ts);
          });
        };
      });
    }

    // Parse batch timing
    if (text.includes('[timing] GpuBoard')) {
      const match = text.match(/(\d+) px × (\d+) iters = ([\d.]+)μs/);
      if (match) {
        batchTimings.push({
          pixels: parseInt(match[1]),
          iters: parseInt(match[2]),
          timeMs: parseFloat(match[3]) / 1000
        });
      }
    }

    // Parse first paint
    if (text.includes('First paint:')) {
      const match = text.match(/First paint: (\d+) px at (\d+)ms/);
      if (match) {
        firstPaintInfo = {
          pixels: parseInt(match[1]),
          time: parseInt(match[2])
        };
      }
    }
  });

  await page.goto(`file://${process.cwd()}/index.html?board=gpu&debug=t`);

  domReadyTime = await page.evaluate(() =>
    performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart);

  await page.waitForFunction(() => window.explorer?.grid?._firstPaintLogged, { timeout: 20000 });

  await page.waitForFunction(() => {
    const grid = window.explorer?.grid;
    return grid && Object.values(grid.views).every(v => v.un === 0);
  }, { timeout: 30000 });

  const stats = await page.evaluate(() => {
    const s = window._stats;
    const view = Object.values(window.explorer.grid.views)[0];

    // Calculate RAF delay stats
    const rafDelays = s.rafDelays;
    const avgRaf = rafDelays.length ? rafDelays.reduce((a,b) => a+b, 0) / rafDelays.length : 0;
    const totalRaf = rafDelays.reduce((a,b) => a+b, 0);

    // Calculate batch gap stats
    const gaps = s.batchGaps;
    const avgGap = gaps.length ? gaps.reduce((a,b) => a+b, 0) / gaps.length : 0;
    const totalGaps = gaps.reduce((a,b) => a+b, 0);

    return {
      completionTime: performance.now() - window._timingStart,
      processTime: s.processTime,
      canvasTime: s.canvasTime,
      schedulerTime: s.schedulerTime,
      gpuInitTime: s.gpuInitTime,
      rafCount: rafDelays.length,
      avgRafDelay: avgRaf,
      totalRafDelay: totalRaf,
      batchGapCount: gaps.length,
      avgBatchGap: avgGap,
      totalBatchGaps: totalGaps,
      firstPaint: s.firstPaint,
      converged: view?.convergedData?.size || 0,
      diverged: view?.di || 0,
      total: view?.config?.dimsArea || 0
    };
  });

  const totalBatchTime = batchTimings.reduce((sum, b) => sum + b.timeMs, 0);

  // Print report
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('                    TIMING REPORT');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log('MILESTONES:');
  console.log(`  DOM ready:       ${domReadyTime}ms`);
  console.log(`  First paint:     ${firstPaintInfo?.time || 'N/A'}ms (${firstPaintInfo?.pixels?.toLocaleString() || 0} pixels)`);
  console.log(`  Full completion: ${(domReadyTime + stats.completionTime).toFixed(0)}ms`);
  console.log(`  Total batches:   ${batchTimings.length}`);

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('BATCH TIMING (first 8):');
  for (let i = 0; i < Math.min(8, batchTimings.length); i++) {
    const b = batchTimings[i];
    const flag = i === 1 ? ' ← shader compile' : '';
    console.log(`    ${(i+1).toString().padStart(2)}: ${b.pixels.toLocaleString().padStart(10)} px × ${b.iters.toString().padStart(3)} iters = ${b.timeMs.toFixed(1).padStart(6)}ms${flag}`);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('BREAKDOWN AT FIRST PAINT:');
  const fp = stats.firstPaint;
  const fpTime = firstPaintInfo?.time || 0;
  const fpBatchTime = batchTimings.slice(0, 10).reduce((s,b) => s+b.timeMs, 0); // estimate
  console.log(`  Wall clock:              ${fpTime}ms`);
  console.log(`  ├─ DOM load:             ${domReadyTime}ms`);
  console.log(`  ├─ GPU init:             ${(fp.gpuInitTime || 0).toFixed(0)}ms`);
  console.log(`  ├─ GPU batches:          ~${fpBatchTime.toFixed(0)}ms`);
  console.log(`  ├─ Result processing:    ${(fp.processTime || 0).toFixed(0)}ms`);
  console.log(`  ├─ Canvas drawing:       ${(fp.canvasTime || 0).toFixed(0)}ms`);
  console.log(`  ├─ Scheduler overhead:   ${(fp.schedulerTime || 0).toFixed(0)}ms`);
  const fpGaps = fp.batchGaps?.reduce((a,b) => a+b, 0) || 0;
  console.log(`  ├─ Batch gaps (idle):    ${fpGaps.toFixed(0)}ms (${fp.batchGaps?.length || 0} gaps)`);
  const fpAccounted = domReadyTime + (fp.gpuInitTime||0) + fpBatchTime + (fp.processTime||0) + (fp.canvasTime||0);
  console.log(`  └─ Unaccounted:          ${(fpTime - fpAccounted).toFixed(0)}ms`);

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('BREAKDOWN AT COMPLETION:');
  const compTime = domReadyTime + stats.completionTime;
  console.log(`  Wall clock:              ${compTime.toFixed(0)}ms`);
  console.log(`  ├─ DOM load:             ${domReadyTime}ms`);
  console.log(`  ├─ GPU init:             ${stats.gpuInitTime.toFixed(0)}ms`);
  console.log(`  ├─ GPU batches:          ${totalBatchTime.toFixed(0)}ms (${batchTimings.length} batches)`);
  console.log(`  ├─ Result processing:    ${stats.processTime.toFixed(0)}ms`);
  console.log(`  ├─ Canvas drawing:       ${stats.canvasTime.toFixed(0)}ms`);
  console.log(`  ├─ Scheduler overhead:   ${stats.schedulerTime.toFixed(0)}ms`);
  console.log(`  ├─ Batch gaps (idle):    ${stats.totalBatchGaps.toFixed(0)}ms (${stats.batchGapCount} gaps, avg ${stats.avgBatchGap.toFixed(1)}ms)`);
  console.log(`  ├─ RAF delays:           ${stats.totalRafDelay.toFixed(0)}ms (${stats.rafCount} calls, avg ${stats.avgRafDelay.toFixed(1)}ms)`);
  const accounted = domReadyTime + stats.gpuInitTime + totalBatchTime + stats.processTime + stats.canvasTime;
  console.log(`  └─ Unaccounted:          ${(compTime - accounted).toFixed(0)}ms`);

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('OVERHEAD ANALYSIS:');
  console.log(`  Scheduler time includes batch timing but also:`);
  console.log(`    - Worker message passing`);
  console.log(`    - Board state management`);
  console.log(`    - Update throttling logic`);
  console.log(`  Batch gaps are idle time between scheduler iterations`);
  console.log(`  RAF delays are requestAnimationFrame wait times`);

  console.log('\n══════════════════════════════════════════════════════════\n');

  await browser.close();
})();

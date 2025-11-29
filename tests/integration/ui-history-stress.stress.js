/**
 * Stress/fuzzing tests for browser history - finding race conditions
 *
 * Run with: npm run test:stress
 *
 * They are designed to expose race conditions by simulating realistic user behavior:
 * - ~1 action per second for 20-30 seconds
 * - Random mix of back, forward, hide, and click operations
 *
 * These tests check for:
 * - Forward history being destroyed after back navigation
 * - "Skeleton views" where early iterations are missing (only high-iteration pixels visible)
 * - "Paused views" where computation has stopped after hide/unhide cycles
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage } = require('./test-utils');

// Extended timeout for stress tests (2 minutes)
const STRESS_TIMEOUT = 120000;

describe('History Fuzzing Stress Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {}, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  }, TEST_TIMEOUT);

  /**
   * Helper to check view health - detects skeleton/paused views
   * Returns array of view status objects
   */
  async function checkViewHealth(page) {
    return await page.evaluate(() => {
      if (!window.explorer || !window.explorer.grid) {
        return [{ index: 0, error: 'explorer not available' }];
      }
      const views = window.explorer.grid.views;
      return views.map((v, i) => {
        if (!v) return { index: i, error: 'null view' };
        // Count diverged pixels and find min/max without spreading (avoids stack overflow)
        let divergedCount = 0;
        let minIter = Infinity;
        let maxIter = 0;
        for (let j = 0; j < v.nn.length; j++) {
          const n = v.nn[j];
          if (n > 0) {
            divergedCount++;
            if (n < minIter) minIter = n;
            if (n > maxIter) maxIter = n;
          }
        }
        if (divergedCount === 0) {
          minIter = 0;
          maxIter = 0;
        }
        return {
          index: i,
          di: v.di,
          divergedCount,
          minIter,
          maxIter,
          hasEarlyIterations: minIter > 0 && minIter < 50,
          isSkeleton: divergedCount > 0 && minIter > 100,
          isPaused: v.di === 0 && divergedCount === 0
        };
      });
    });
  }

  /**
   * Helper to get current history state
   */
  async function getHistoryState(page) {
    return await page.evaluate(() => {
      if (!window.explorer || !window.explorer.grid) {
        return { url: location.href, hasHidden: false, viewCount: 0, updateInProgress: false, explorerLost: true };
      }
      return {
        url: location.href,
        hasHidden: location.search.includes('h='),
        viewCount: window.explorer.grid.views.length,
        updateInProgress: !!window.explorer.grid.currentUpdateProcess
      };
    });
  }

  /**
   * Helper to check URL/view count invariant:
   * The number of views should equal the number of coordinates in the URL's 'c' parameter + 1
   * (or just 1 if no 'c' parameter)
   */
  async function checkUrlViewCountInvariant(page) {
    return await page.evaluate(() => {
      if (!window.explorer || !window.explorer.grid) {
        return { valid: false, error: 'explorer not available' };
      }
      const grid = window.explorer.grid;

      // Don't check during updates
      if (grid.currentUpdateProcess) {
        return { valid: true, skipped: true, reason: 'update in progress' };
      }

      const url = new URL(location.href);
      const cParam = url.searchParams.get('c');

      // Count coordinates in 'c' parameter
      // Format is like "c=-0.5+0i,-0.6+0.2i" - count commas + 1
      let expectedViews;
      if (!cParam) {
        expectedViews = 1;  // Default single view
      } else {
        // Count the number of coordinate pairs (comma-separated)
        expectedViews = (cParam.match(/,/g) || []).length + 1;
      }

      const actualViews = grid.views.length;

      return {
        valid: actualViews === expectedViews,
        expectedViews,
        actualViews,
        cParam: cParam || '(none)',
        url: location.href
      };
    });
  }

  /**
   * 30-second stress test: Random back/forward navigation
   * Tests for forward history destruction
   */
  test('30 seconds of back/forward navigation', async () => {
    // Start with 3 views
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 });

    // Wait for views to have some computed pixels
    await page.waitForFunction(() =>
      window.explorer.grid.views.every(v => v && v.di > 100),
      { timeout: 15000 });

    // Set up lastCenters
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = '';
    });

    // Hide view 1 to create a history entry
    await page.click('#b_1 .closebox');
    await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 5000 });

    let historyDepth = 1;  // We have one "back" entry
    let atHiddenState = true;
    let forwardAvailable = false;
    let failureCount = 0;
    const failures = [];

    // Run for 30 seconds, ~1 action per second
    const startTime = Date.now();
    const duration = 30000;
    let actionCount = 0;

    while (Date.now() - startTime < duration) {
      actionCount++;
      const action = Math.random();

      try {
        if (action < 0.5 && historyDepth > 0) {
          // Go back (50% chance if possible)
          await page.evaluate(() => history.back());
          await page.waitForTimeout(800);  // Wait ~1 second between actions

          const state = await getHistoryState(page);
          if (state.explorerLost) {
            // Navigated away from app - go forward to recover
            await page.evaluate(() => history.forward());
            await page.waitForTimeout(500);
            continue;
          }
          if (atHiddenState && !state.hasHidden) {
            // Successfully went back
            atHiddenState = false;
            forwardAvailable = true;
          }
        } else if (forwardAvailable) {
          // Go forward
          const wentForward = await page.evaluate(() => {
            return new Promise(resolve => {
              const beforeUrl = location.href;
              history.forward();
              setTimeout(() => resolve(location.href !== beforeUrl), 300);
            });
          });

          if (!wentForward && !atHiddenState) {
            // Forward history was lost!
            failureCount++;
            failures.push({
              action: actionCount,
              type: 'forward_lost',
              time: Date.now() - startTime
            });
          } else if (wentForward) {
            atHiddenState = true;
            forwardAvailable = false;
          }

          await page.waitForTimeout(700);
        } else {
          // Just wait
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        failureCount++;
        failures.push({
          action: actionCount,
          type: 'error',
          message: e.message,
          time: Date.now() - startTime
        });
      }
    }

    // Final health check - wait for update to complete (may timeout if stuck)
    try {
      await page.waitForFunction(() =>
        !window.explorer || !window.explorer.grid || !window.explorer.grid.currentUpdateProcess,
        { timeout: 10000 });
    } catch (e) {
      failures.push({ type: 'update_stuck', message: 'currentUpdateProcess never completed' });
    }

    // Check URL/view count invariant now that state has settled
    const urlViewCheck = await checkUrlViewCountInvariant(page);
    if (!urlViewCheck.valid && !urlViewCheck.skipped) {
      failures.push({
        type: 'url_view_mismatch',
        expectedViews: urlViewCheck.expectedViews,
        actualViews: urlViewCheck.actualViews,
        cParam: urlViewCheck.cParam,
        url: urlViewCheck.url
      });
    }

    // Wait for computation to start on all views (di > 0)
    try {
      await page.waitForFunction(() =>
        window.explorer && window.explorer.grid &&
        window.explorer.grid.views.every(v => v && v.di > 0),
        { timeout: 5000 });
    } catch (e) {
      // Don't fail immediately - let the health check provide details
    }

    const viewHealth = await checkViewHealth(page);

    for (const vh of viewHealth) {
      if (vh.error) {
        failures.push({ type: 'null_view', index: vh.index });
      }
      if (vh.isSkeleton) {
        failures.push({ type: 'skeleton_view', index: vh.index, minIter: vh.minIter });
      }
      // Only flag as paused if it's been more than a few seconds with no progress
      // A brand new view might have di=0 briefly
      if (vh.isPaused) {
        failures.push({ type: 'paused_view', index: vh.index, di: vh.di });
      }
    }

    // Report results
    console.log(`Completed ${actionCount} actions over ${(Date.now() - startTime) / 1000}s`);
    if (failures.length > 0) {
      console.log(`FAILURES (${failures.length}):`, JSON.stringify(failures, null, 2));
      // Fail the test with a clear message about what went wrong
      const forwardLost = failures.filter(f => f.type === 'forward_lost').length;
      const explorerLost = failures.some(f => f.error && f.error.includes('explorer'));
      if (forwardLost > 0) {
        throw new Error(
          `Forward history lost ${forwardLost} times! ` +
          `First failure at action ${failures[0]?.action || 'unknown'}, time ${failures[0]?.time || 'unknown'}ms. ` +
          `This indicates a race condition in history handling.`
        );
      } else if (explorerLost) {
        throw new Error(
          `Explorer became unavailable during test. ` +
          `This may indicate navigation went too far back in history.`
        );
      } else {
        throw new Error(`Stress test failed: ${JSON.stringify(failures[0])}`);
      }
    }
  }, STRESS_TIMEOUT);

  /**
   * 30-second stress test: Hide/unhide cycling
   * Tests for paused computation and skeleton views
   */
  test('30 seconds of hide/unhide cycling', async () => {
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 });

    // Wait for good initial computation
    await page.waitForFunction(() =>
      window.explorer.grid.views.every(v => v && v.di > 500),
      { timeout: 20000 });

    // Record initial health
    const initialHealth = await checkViewHealth(page);

    // Set up lastCenters
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = '';
    });

    const failures = [];
    const startTime = Date.now();
    const duration = 30000;
    let cycleCount = 0;

    while (Date.now() - startTime < duration) {
      cycleCount++;

      try {
        // Hide view 1
        await page.click('#b_1 .closebox');
        await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 5000 });

        // Wait ~1 second
        await page.waitForTimeout(1000);

        // Unhide (go back)
        await page.evaluate(() => history.back());
        await page.waitForFunction(() => !location.search.includes('h='), { timeout: 5000 });

        // Wait for update to complete
        await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

        // Check health after each cycle
        const health = await checkViewHealth(page);
        for (const vh of health) {
          if (vh.error) {
            failures.push({ cycle: cycleCount, type: 'null_view', index: vh.index });
          }
          if (vh.isSkeleton && initialHealth[vh.index]?.hasEarlyIterations) {
            failures.push({
              cycle: cycleCount,
              type: 'skeleton_view',
              index: vh.index,
              minIter: vh.minIter,
              initialMinIter: initialHealth[vh.index].minIter
            });
          }
        }

        // Wait a bit before next cycle
        await page.waitForTimeout(500);
      } catch (e) {
        failures.push({
          cycle: cycleCount,
          type: 'error',
          message: e.message
        });
      }
    }

    // Wait for any pending updates to complete
    try {
      await page.waitForFunction(() =>
        !window.explorer.grid.currentUpdateProcess,
        { timeout: 10000 });
    } catch (e) {
      failures.push({ type: 'update_stuck', message: 'currentUpdateProcess never completed' });
    }

    // Check URL/view count invariant now that state has settled
    const urlViewCheck = await checkUrlViewCountInvariant(page);
    if (!urlViewCheck.valid && !urlViewCheck.skipped) {
      failures.push({
        type: 'url_view_mismatch',
        expectedViews: urlViewCheck.expectedViews,
        actualViews: urlViewCheck.actualViews,
        cParam: urlViewCheck.cParam,
        url: urlViewCheck.url
      });
    }

    // Final health check - verify computation is still progressing (or legitimately complete)
    const beforeDi = await page.evaluate(() =>
      window.explorer.grid.views.map(v => v ? v.di : 0)
    );
    await page.waitForTimeout(2000);
    const afterDi = await page.evaluate(() =>
      window.explorer.grid.views.map(v => v ? v.di : 0)
    );

    // Check if views have unfinished work (using the view's unfinished() method)
    const unfinishedCounts = await page.evaluate(() => {
      return window.explorer.grid.views.map(v => v ? v.unfinished() : 0);
    });
    const hasUnfinishedWork = unfinishedCounts.some(c => c > 0);

    const anyProgressed = beforeDi.some((b, i) => afterDi[i] > b);
    // Only report as stalled if there was unfinished work but no progress
    if (!anyProgressed && hasUnfinishedWork) {
      // Gather diagnostic info
      const diagnostics = await page.evaluate(() => {
        const views = window.explorer.grid.views;
        const scheduler = window.explorer.grid.scheduler;
        return {
          viewIds: views.map(v => v ? v.id : null),
          viewUn: views.map(v => v ? v.un : null),  // Raw un count
          viewCh: views.map(v => v ? v.ch : null),  // Chaotic count
          viewIt: views.map(v => v ? v.it : null),  // Max iteration
          schedulerBoardIds: Array.from(scheduler.boardIds.entries()),
          schedulerBoardEfforts: Array.from(scheduler.boardEfforts.entries()),
          hiddenViews: window.explorer.grid.getHiddenViews(),
          viewsLength: views.length
        };
      });
      failures.push({ type: 'computation_stalled', beforeDi, afterDi, unfinishedCounts, diagnostics });
    }

    console.log(`Completed ${cycleCount} hide/unhide cycles over ${(Date.now() - startTime) / 1000}s`);
    if (failures.length > 0) {
      console.log(`FAILURES (${failures.length}):`, JSON.stringify(failures, null, 2));
      const skeletonCount = failures.filter(f => f.type === 'skeleton_view').length;
      const stalledCount = failures.filter(f => f.type === 'computation_stalled').length;
      const mismatchCount = failures.filter(f => f.type === 'url_view_mismatch').length;
      throw new Error(
        `Hide/unhide stress test failed! ` +
        `Skeleton views: ${skeletonCount}, Computation stalled: ${stalledCount}, URL/view mismatch: ${mismatchCount}. ` +
        `Total failures: ${failures.length}`
      );
    }
  }, STRESS_TIMEOUT);

  /**
   * 30-second stress test: Mixed operations
   * Randomly chooses between back, forward, hide, and click
   */
  test('30 seconds of mixed random operations', async () => {
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i,-0.6+0.2i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 2 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 });

    // Wait for initial computation
    await page.waitForFunction(() =>
      window.explorer.grid.views.every(v => v && v.di > 100),
      { timeout: 15000 });

    // Set up lastCenters
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = '';
    });

    const failures = [];
    const startTime = Date.now();
    const duration = 30000;
    let actionCount = 0;

    while (Date.now() - startTime < duration) {
      actionCount++;
      const action = Math.random();

      try {
        const state = await getHistoryState(page);

        if (action < 0.3) {
          // Go back (30% chance)
          await page.evaluate(() => history.back());
          await page.waitForTimeout(800);
          // Check if we navigated away from the app
          const stateAfterBack = await getHistoryState(page);
          if (stateAfterBack.explorerLost) {
            // Navigate forward to get back to the app
            await page.evaluate(() => history.forward());
            await page.waitForTimeout(500);
          }
        } else if (action < 0.6) {
          // Go forward (30% chance)
          const wentForward = await page.evaluate(() => {
            return new Promise(resolve => {
              const beforeUrl = location.href;
              history.forward();
              setTimeout(() => resolve(location.href !== beforeUrl), 300);
            });
          });
          // Note: Not going forward is OK if we're at the end of history
          await page.waitForTimeout(700);
        } else if (action < 0.8 && state.viewCount > 1) {
          // Hide a view (20% chance if we have views to hide)
          const viewToHide = Math.floor(Math.random() * state.viewCount);
          const closeButton = await page.$(`#b_${viewToHide} .closebox`);
          if (closeButton) {
            await closeButton.click();
          }
          await page.waitForTimeout(800);
        } else {
          // Click to zoom (20% chance)
          const canvas = await page.$('#grid canvas');
          if (canvas) {
            const box = await canvas.boundingBox();
            if (box) {
              await page.mouse.click(
                box.x + Math.random() * box.width,
                box.y + Math.random() * box.height
              );
            }
          }
          await page.waitForTimeout(800);
        }

        // Periodic health check (every 10 actions)
        if (actionCount % 10 === 0) {
          await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 }).catch(() => {});
          const health = await checkViewHealth(page);
          for (const vh of health) {
            if (vh.error) {
              failures.push({ action: actionCount, type: 'null_view', index: vh.index });
            }
            if (vh.isPaused && actionCount > 10) {
              failures.push({ action: actionCount, type: 'paused_view', index: vh.index });
            }
          }
          // Check URL/view count invariant
          const urlViewCheck = await checkUrlViewCountInvariant(page);
          if (!urlViewCheck.valid && !urlViewCheck.skipped) {
            failures.push({
              action: actionCount,
              type: 'url_view_mismatch',
              expectedViews: urlViewCheck.expectedViews,
              actualViews: urlViewCheck.actualViews,
              cParam: urlViewCheck.cParam,
              url: urlViewCheck.url
            });
          }
        }
      } catch (e) {
        // Errors during random operations are expected sometimes
        // Only log if it's a real problem
        if (!e.message.includes('Execution context was destroyed')) {
          failures.push({
            action: actionCount,
            type: 'error',
            message: e.message.substring(0, 100)
          });
        }
      }
    }

    // Final check
    await page.waitForTimeout(1000);
    try {
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
      const finalHealth = await checkViewHealth(page);
      for (const vh of finalHealth) {
        if (vh.error) {
          failures.push({ type: 'final_null_view', index: vh.index });
        }
      }
      // Final URL/view count check
      const finalUrlViewCheck = await checkUrlViewCountInvariant(page);
      if (!finalUrlViewCheck.valid && !finalUrlViewCheck.skipped) {
        failures.push({
          type: 'final_url_view_mismatch',
          expectedViews: finalUrlViewCheck.expectedViews,
          actualViews: finalUrlViewCheck.actualViews,
          cParam: finalUrlViewCheck.cParam,
          url: finalUrlViewCheck.url
        });
      }
    } catch (e) {
      failures.push({ type: 'final_check_error', message: e.message });
    }

    console.log(`Completed ${actionCount} mixed actions over ${(Date.now() - startTime) / 1000}s`);
    if (failures.length > 0) {
      console.log(`FAILURES (${failures.length}):`, JSON.stringify(failures, null, 2));
    }

    // This test is more tolerant - some errors are expected with random operations
    // But we should have no null views, paused views, or URL/view mismatches at the end
    const criticalFailures = failures.filter(f =>
      f.type === 'null_view' || f.type === 'final_null_view' ||
      f.type === 'paused_view' || f.type === 'computation_stalled' ||
      f.type === 'url_view_mismatch' || f.type === 'final_url_view_mismatch'
    );
    if (criticalFailures.length > 0) {
      throw new Error(
        `Mixed operations stress test found ${criticalFailures.length} critical failures: ` +
        JSON.stringify(criticalFailures)
      );
    }
  }, STRESS_TIMEOUT);

}, TEST_TIMEOUT);

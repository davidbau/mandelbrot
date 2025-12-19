/**
 * Tests that views correctly report completion when all remaining pixels are chaotic.
 * With grid=25, the view completes quickly because all pixels either escape or are
 * marked as chaotic (in the spike region). After MAX_CHAOTIC_ITERATIONS (100k),
 * chaotic pixels are considered "done" and unfinished() should return 0.
 */

const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToUrl, getAppUrl, closeBrowser } = require('./test-utils');

describe('Chaotic pixel completion', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, { width: 1470, height: 827 }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  test('CpuBoard with grid=25 completes when chaotic pixels reach 100k iterations', async () => {
    await navigateToUrl(page, getAppUrl('?board=cpu&grid=25'));
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });

    // Wait for completion - should be < 2 seconds with grid=25
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const maxWait = 10000; // 10 second timeout

        const check = () => {
          const view = window.explorer?.grid?.views?.[0];
          if (!view) {
            if (Date.now() - startTime < maxWait) {
              setTimeout(check, 100);
            } else {
              resolve({ error: 'View not found' });
            }
            return;
          }

          const unfinished = view.unfinished();
          const elapsed = Date.now() - startTime;

          if (unfinished === 0) {
            resolve({
              success: true,
              elapsed,
              it: view.it,
              un: view.un,
              ch: view.ch,
              di: view.di,
              unfinished
            });
          } else if (elapsed > maxWait) {
            resolve({
              error: 'Timeout waiting for completion',
              elapsed,
              it: view.it,
              un: view.un,
              ch: view.ch,
              unfinished
            });
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.unfinished).toBe(0);
    // un should equal ch (all remaining are chaotic)
    expect(result.un).toBe(result.ch);
    // Should complete in < 5 seconds
    expect(result.elapsed).toBeLessThan(5000);
    // Should have reached >= 100k iterations
    expect(result.it).toBeGreaterThanOrEqual(100000);

    console.log(`Completed in ${result.elapsed}ms at ${result.it} iterations, un=${result.un}, ch=${result.ch}`);
  }, TEST_TIMEOUT);
});

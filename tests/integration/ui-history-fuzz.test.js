/**
 * Quick fuzzing tests for browser history - basic race condition checks
 * For thorough stress testing, run: npx jest tests/integration/ui-history-fuzz.bench.js
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToUrl, getAppUrl, closeBrowser } = require('./test-utils');

describe('History Fuzzing Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {});
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('Forward history should be preserved after going back', async () => {
    // Start with 3 views
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i'));

    // Wait for 3 views to be created
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 });

    // Set up lastCenters
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = '';
    });

    // Hide view 1 - this should push history
    // Wait for no update before clicking closebox (click is ignored during updates)
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
    await page.click('#b_1 .closebox');
    await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 10000 });

    // Go back
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !location.search.includes('h='), { timeout: 10000 });

    // Wait for any update to complete
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Now try to go forward - this should work
    const canGoForward = await page.evaluate(() => {
      return new Promise(resolve => {
        const beforeUrl = location.href;
        history.forward();
        // Small delay to let popstate fire
        setTimeout(() => {
          resolve(location.href !== beforeUrl);
        }, 200);
      });
    });

    expect(canGoForward).toBe(true);

    // Should be back at the hidden state
    const currentUrl = await page.url();
    expect(currentUrl).toContain('h=1');
  }, TEST_TIMEOUT);

  test('Rapid back/forward should not destroy forward history', async () => {
    // Start with 3 views
    await navigateToUrl(page, getAppUrl('?c=-0.5+0i,-0.6+0.2i,-0.65+0.25i'));

    // Wait for 3 views to be created
    await page.waitForFunction(() =>
      window.explorer.grid.views.length === 3 &&
      !window.explorer.grid.currentUpdateProcess,
      { timeout: 15000 });

    // Set up lastCenters
    await page.evaluate(() => {
      window.explorer.urlHandler.lastCenters = window.explorer.urlHandler.extractCenters(
        window.explorer.urlHandler.currenturl()
      );
      window.explorer.urlHandler.lastHidden = '';
    });

    // Create history: hide view 1
    // Wait for no update before clicking closebox (click is ignored during updates)
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
    await page.click('#b_1 .closebox');
    await page.waitForFunction(() => location.search.includes('h=1'), { timeout: 10000 });

    // Rapid back/forward without waiting (3 quick cycles)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => history.back());
      await page.waitForTimeout(20);
      await page.evaluate(() => history.forward());
      await page.waitForTimeout(20);
    }

    // Wait for things to settle
    await page.waitForTimeout(300);
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Now do a clean back
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !location.search.includes('h='), { timeout: 10000 });
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Forward should still work
    const canGoForward = await page.evaluate(() => {
      return new Promise(resolve => {
        const beforeUrl = location.href;
        history.forward();
        setTimeout(() => resolve(location.href !== beforeUrl), 300);
      });
    });

    expect(canGoForward).toBe(true);
  }, TEST_TIMEOUT);

});

/**
 * Micro integration test for coverage line number verification.
 * Exercises coverageTestDummy() via the actual browser/worker.
 */

const {
  setupBrowser,
  setupPage,
  navigateToApp,
  TEST_TIMEOUT
} = require('./test-utils');

describe('Coverage Micro Test - Integration', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  beforeEach(async () => {
    page = await setupPage(browser);
  });

  afterEach(async () => {
    if (page) await page.close();
  });

  test('exercise coverageTestDummy positive branch via page', async () => {
    await navigateToApp(page);

    // The coverageTestDummy function is in workerCode, which is loaded
    // as a blob worker. We need to call it from the main thread context.
    // Since it's defined in the worker blob source, we can eval it in page.
    const result = await page.evaluate(() => {
      // The function is defined in the worker blob, not main thread.
      // But we can access the source and eval it for this test.
      const workerCode = document.getElementById('workerCode').textContent;
      const funcMatch = workerCode.match(
        /function coverageTestDummy\(x\) \{[\s\S]*?\n\}/
      );
      if (!funcMatch) return { error: 'function not found' };
      // eslint-disable-next-line no-eval
      const fn = eval('(' + funcMatch[0] + ')');
      return { positive: fn(7), negative: fn(-2), zero: fn(0) };
    });

    expect(result.positive).toBe(14); // 7 * 2
    expect(result.negative).toBe(-6); // -2 * 3
    expect(result.zero).toBe(0);      // 0 * 3
  }, TEST_TIMEOUT);
});

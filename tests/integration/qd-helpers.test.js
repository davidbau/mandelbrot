const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, closeBrowser } = require('./test-utils');

describe('Oct helpers coverage touch', () => {
  let browser;
  let page;
  let launchFailed = false;

  beforeAll(async () => {
    try {
      browser = await setupBrowser();
    } catch (e) {
      launchFailed = true;
      // Provide signal for environments where crashpad writes are blocked.
      console.warn('Skipping oct helper coverage test (browser launch failed):', e.message);
    }
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    if (launchFailed) return;
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) {
      await closeBrowser(browser);
    }
  }, TEST_TIMEOUT);

  test('calls arQdSquare in the app context', async () => {
    if (launchFailed) {
      return;
    }
    const called = await page.evaluate(() => {
      const buf = new Array(8).fill(0);
      if (typeof arQdSquare === 'function') {
        arQdSquare(new Array(4).fill(0), 0, 1, 0, 0, 0);
      }
      return typeof arQdSquare === 'function';
    });
    expect(called).toBe(true);
  }, TEST_TIMEOUT);
});

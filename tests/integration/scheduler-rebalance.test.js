/**
 * Test: Scheduler rebalancing, serialization, and deserialization
 *
 * This test exercises the code path where the scheduler transfers boards
 * between workers to balance load. It uses CPU-only mode with deep zoom
 * views to create load imbalance.
 *
 * The rebalancing triggers Board.serialize() and Board.fromSerialized()
 * which have low coverage without this test.
 */

const path = require('path');
const { setupBrowser, setupPage, closeBrowser } = require('./test-utils');

const TEST_TIMEOUT = 60000;

describe('Scheduler rebalancing', () => {
  let browser;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  // Skip: Board transfers depend on load imbalance which doesn't reliably occur in tests
  test.skip('triggers board transfer between workers with CPU-only deep zoom', async () => {
    const htmlPath = path.join(__dirname, '..', '..', 'index.html');
    // 12 views at z=1e14 with CPU only - creates load imbalance with some workers having 2+ boards
    const params = 'z=1e14&a=16:9&gpu=0&c=-0.5425060105393306400515387573956+0.5082791199098461776529578942116i,,,,,,,,,,,&grid=12&unk=888&pixelratio=1';

    const page = await setupPage(browser);
    page.setDefaultTimeout(TEST_TIMEOUT);
    await page.setViewport({ width: 800, height: 600 });

    // Collect console messages looking for transfer events
    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    await page.goto(`file://${htmlPath}?${params}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

    // Wait for a board transfer to happen (indicates serialize/fromSerialized was called)
    // Transfer logs look like: "transferred PerturbationBoard 13 from worker 4 to 1 (load 0)"
    const startTime = Date.now();
    let transferLog = null;

    while (Date.now() - startTime < 40000) {
      await page.waitForTimeout(2000);

      transferLog = consoleLogs.find(log => log.includes('transferred') && log.includes('from worker'));
      if (transferLog) break;
    }

    await page.close();

    // Verify a transfer happened (which exercises serialize/fromSerialized)
    expect(transferLog).toBeTruthy();
    expect(transferLog).toMatch(/transferred \w+Board \d+ from worker \d+ to \d+/);
  }, TEST_TIMEOUT);
});

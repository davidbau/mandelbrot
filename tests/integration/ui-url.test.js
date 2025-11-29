/**
 * Integration tests for URL parameters
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('URL Parameter Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {});
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) await page.close();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  }, TEST_TIMEOUT);

  test('Should load with zoom, center, and scientific notation parameters', async () => {
    // Test 1: z parameter with center (Feigenbaum point)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-1.401155+0i&z=100`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const viewData = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      return { size: view.sizes[0], center_re: view.sizes[1][0], center_im: view.sizes[2][0] };
    });
    expect(viewData.size).toBeCloseTo(3.0 / 100, 3);
    expect(viewData.center_re).toBeCloseTo(-1.401155, 4);
    expect(viewData.center_im).toBeCloseTo(0.0, 5);

    // Test 2: Scientific notation in z parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i&z=1e3`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const sizeWithSciNotation = await page.evaluate(() => window.explorer.grid.views[0].sizes[0]);
    expect(sizeWithSciNotation).toBeCloseTo(3.0 / 1000, 4);
  }, TEST_TIMEOUT);

  test('Should load with theme, grid, and aspect ratio parameters', async () => {
    // Test 1: Theme parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?theme=neon`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const theme = await page.evaluate(() => window.explorer.config.theme);
    expect(theme).toBe('neon');

    // Test 2: Grid parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?grid=3`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const gridcols = await page.evaluate(() => window.explorer.config.gridcols);
    expect(gridcols).toBe(3);

    // Test 3: Aspect ratio parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?a=16:9`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const aspectRatio = await page.evaluate(() => window.explorer.config.aspectRatio);
    expect(aspectRatio).toBeCloseTo(16/9, 5);
    const canvasDims = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      if (!view || !view.canvas) return null;
      return { width: view.canvas.width, height: view.canvas.height };
    });
    if (canvasDims) {
      expect(canvasDims.width / canvasDims.height).toBeCloseTo(16/9, 1);
    }
  }, TEST_TIMEOUT);

  test('centersWereLost should detect when center points are removed or replaced', async () => {
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Test centersWereLost logic directly (it's now a standalone function)
    const testResults = await page.evaluate(() => {
      return {
        // Same centers - no loss
        sameExact: centersWereLost('-0.5+0i', '-0.5+0i'),
        // Adding centers (zooming deeper) - no loss
        addingCenters: centersWereLost('-0.5+0i', '-0.5+0i,-0.6+0.2i'),
        // Removing centers - loss
        removingCenters: centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i'),
        // Replacing center - loss
        replacingCenter: centersWereLost('-0.5+0i', '-0.7+0.1i'),
        // Empty to something - no loss
        emptyToSomething: centersWereLost('', '-0.5+0i'),
        // Something to empty - loss
        somethingToEmpty: centersWereLost('-0.5+0i', ''),
        // Changing deeper center - loss
        changingDeeper: centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i,-0.7+0.3i'),
      };
    });

    expect(testResults.sameExact).toBe(false);
    expect(testResults.addingCenters).toBe(false);
    expect(testResults.removingCenters).toBe(true);
    expect(testResults.replacingCenter).toBe(true);
    expect(testResults.emptyToSomething).toBe(false);
    expect(testResults.somethingToEmpty).toBe(true);
    expect(testResults.changingDeeper).toBe(true);
  }, TEST_TIMEOUT);

  test('Should use pushState when centers are replaced via updateurl', async () => {
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Get initial history length and current centers from URL
    const { initialLength, currentCenters } = await page.evaluate(() => ({
      initialLength: history.length,
      currentCenters: window.explorer.urlHandler.extractCenters(window.explorer.urlHandler.currenturl())
    }));

    // Initialize lastCenters to match current URL
    await page.evaluate((centers) => {
      window.explorer.urlHandler.lastCenters = centers;
    }, currentCenters);

    // Trigger a URL update - since centers haven't changed, should use replaceState
    await page.evaluate(() => {
      window.explorer.grid.notifyurl();
    });
    await page.waitForTimeout(100);

    const afterSameLength = await page.evaluate(() => history.length);
    // Same centers should NOT push (replaceState)
    expect(afterSameLength).toBe(initialLength);

    // Now simulate that we previously had more centers (user will lose them)
    await page.evaluate((centers) => {
      window.explorer.urlHandler.lastCenters = centers + ',-0.6+0.2i,-0.7+0.3i';
      window.explorer.grid.notifyurl();
    }, currentCenters);
    await page.waitForTimeout(100);

    const afterReplaceLength = await page.evaluate(() => history.length);
    // Removing centers should push to history
    expect(afterReplaceLength).toBeGreaterThan(initialLength);
  }, TEST_TIMEOUT);
});

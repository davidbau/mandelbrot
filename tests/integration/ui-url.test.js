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
});

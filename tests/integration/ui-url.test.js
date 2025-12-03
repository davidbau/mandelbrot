/**
 * Integration tests for URL parameters
 * Tests parsing and applying URL parameters for view configuration
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
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  }, TEST_TIMEOUT);

  test('Should load with zoom, center, and scientific notation parameters', async () => {
    // Test 1: z parameter with center (Feigenbaum point)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-1.401155+0i&z=100`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(300);
    const viewData = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      return { size: view.sizes[0], center_re: view.sizes[1][0], center_im: view.sizes[2][0] };
    }, TEST_TIMEOUT);
    expect(viewData.size).toBeCloseTo(3.0 / 100, 3);
    expect(viewData.center_re).toBeCloseTo(-1.401155, 4);
    expect(viewData.center_im).toBeCloseTo(0.0, 5);

    // Test 2: Scientific notation in z parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i&z=1e3`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(300);
    const sizeWithSciNotation = await page.evaluate(() => window.explorer.grid.views[0].sizes[0]);
    expect(sizeWithSciNotation).toBeCloseTo(3.0 / 1000, 4);
  }, TEST_TIMEOUT);

  test('Should load with theme, grid, and aspect ratio parameters', async () => {
    // Test 1: Theme parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?theme=neon`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(300);
    const theme = await page.evaluate(() => window.explorer.config.theme);
    expect(theme).toBe('neon');

    // Test 2: Grid parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?grid=3`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(300);
    const gridcols = await page.evaluate(() => window.explorer.config.gridcols);
    expect(gridcols).toBe(3);

    // Test 3: Aspect ratio parameter (widescreen 16:9)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?a=16:9`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(300);
    const aspectRatio = await page.evaluate(() => window.explorer.config.aspectRatio);
    expect(aspectRatio).toBeCloseTo(16/9, 5);
    const canvasDims = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      if (!view || !view.canvas) return null;
      return { width: view.canvas.width, height: view.canvas.height };
    }, TEST_TIMEOUT);
    if (canvasDims) {
      expect(canvasDims.width / canvasDims.height).toBeCloseTo(16/9, 1);
    }

    // Test 4: Non-standard aspect ratio (4:3)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?a=4:3`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(300);
    const aspectRatio43 = await page.evaluate(() => window.explorer.config.aspectRatio);
    expect(aspectRatio43).toBeCloseTo(4/3, 5);
    const canvasDims43 = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      if (!view || !view.canvas) return null;
      return { width: view.canvas.width, height: view.canvas.height };
    }, TEST_TIMEOUT);
    if (canvasDims43) {
      expect(canvasDims43.width / canvasDims43.height).toBeCloseTo(4/3, 1);
    }
  }, TEST_TIMEOUT);

  test('URL encoding: z parameter uses scientific notation format', async () => {
    // Load page with a high zoom level
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i&z=1e10`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Trigger URL update
    await page.evaluate(() => window.explorer.urlHandler.updateurl());

    // Check that the URL uses scientific notation with 3 significant digits
    const url = await page.evaluate(() => location.search);
    expect(url).toMatch(/z=\d\.\d{2}e[+-]\d+/);  // Format like 1.00e+10

    // Also test with a different zoom level to verify consistent formatting
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i&z=12500`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
    await page.evaluate(() => window.explorer.urlHandler.updateurl());

    const url2 = await page.evaluate(() => location.search);
    expect(url2).toMatch(/z=\d\.\d{2}e[+-]\d+/);  // Format like 1.25e+4
  }, TEST_TIMEOUT);

  test('Should load with additional color themes (iceblue, tiedye)', async () => {
    // Test iceblue theme
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?theme=iceblue`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const iceblueTheme = await page.evaluate(() => window.explorer.config.theme);
    expect(iceblueTheme).toBe('iceblue');

    // Test tiedye theme
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?theme=tiedye`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const tiedyeTheme = await page.evaluate(() => window.explorer.config.theme);
    expect(tiedyeTheme).toBe('tiedye');
  }, TEST_TIMEOUT);

  test('Should load with exponent, gpu, board, and pixelratio parameters', async () => {
    // Test exponent parameter (z³ instead of z²)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?exponent=3`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const exponent = await page.evaluate(() => window.explorer.config.exponent);
    expect(exponent).toBe(3);

    // Test gpu=0 parameter (disable GPU)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?gpu=0`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const gpuDisabled = await page.evaluate(() => window.explorer.config.enableGPU);
    expect(gpuDisabled).toBe(false);

    // Test board parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?board=cpu`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const forceBoard = await page.evaluate(() => window.explorer.config.forceBoard);
    expect(forceBoard).toBe('cpu');

    // Test pixelratio parameter
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?pixelratio=2`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const pixelRatio = await page.evaluate(() => window.explorer.config.pixelRatio);
    expect(pixelRatio).toBe(2);
  }, TEST_TIMEOUT);

  test('Should load with unknown color (unk) parameter', async () => {
    // Test hex color without #
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?unk=888`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const hexColor = await page.evaluate(() => window.explorer.config.unknowncolor);
    expect(hexColor).toBe('#888');

    // Test named color
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?unk=yellow`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
    const namedColor = await page.evaluate(() => window.explorer.config.unknowncolor);
    expect(namedColor).toBe('yellow');
  }, TEST_TIMEOUT);

  test('URL encoding: c parameter correctly represents view centers', async () => {
    // Test 1: c=-0.6+0.2i means SINGLE view at that location (not default + zoomed)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.6+0.2i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(200);

    const singleViewData = await page.evaluate(() => ({
      viewCount: window.explorer.grid.views.length,
      view0Re: window.explorer.grid.views[0].sizes[1][0],
      view0Im: window.explorer.grid.views[0].sizes[2][0]
    }));
    expect(singleViewData.viewCount).toBe(1);
    expect(singleViewData.view0Re).toBeCloseTo(-0.6, 5);
    expect(singleViewData.view0Im).toBeCloseTo(0.2, 5);

    // Test 2: c=,-0.6+0.2i means TWO views - first at default (comma=inherit), second explicit
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=,-0.6+0.2i`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    // Wait for 2nd view to be created
    await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 }, TEST_TIMEOUT);

    const twoViewData = await page.evaluate(() => {
      const views = window.explorer.grid.views;
      return {
        viewCount: views.length,
        view0Re: views[0] ? views[0].sizes[1][0] : null,
        view0Im: views[0] ? views[0].sizes[2][0] : null,
        view1Re: views[1] ? views[1].sizes[1][0] : null,
        view1Im: views[1] ? views[1].sizes[2][0] : null
      };
    }, TEST_TIMEOUT);
    expect(twoViewData.viewCount).toBe(2);
    // View 0 inherits from default (firstr=-0.5, firstj=0)
    expect(twoViewData.view0Re).toBeCloseTo(-0.5, 5);
    expect(twoViewData.view0Im).toBeCloseTo(0.0, 5);
    // View 1 is at explicit center
    expect(twoViewData.view1Re).toBeCloseTo(-0.6, 5);
    expect(twoViewData.view1Im).toBeCloseTo(0.2, 5);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

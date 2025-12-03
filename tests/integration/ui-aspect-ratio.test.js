const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, closeBrowser } = require('./test-utils');

describe('Aspect Ratio Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser);
    // page.on('console', msg => console.log('PAGE LOG:', msg.text())); // Removed debug log
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  test('Zoom box should be positioned correctly on a 16:9 aspect ratio', async () => {
    // Navigate to a URL with a 16:9 aspect ratio and two views.
    // The second view is centered at (re=0.5, im=0.4), vertically off-center from the first view.
    // The first view is at the default center (-0.5, 0).
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?a=16:9&c=-0.5+0i,0.5+0.4i&s=3,0.6`);

    // Wait for the second view to be rendered, which ensures the zoom rect on the first is also rendered.
    await page.waitForSelector('#grid #b_1 canvas', { timeout: 10000 });
    // Wait for zoom rect to be styled (it should have a non-empty style.top)
    await page.waitForFunction(
      () => {
        const rect = document.querySelector('#b_0 .rect');
        return rect && rect.style.top !== '';
      },
      { timeout: 5000 }
    );

    // Get the dimensions of the first view's container for calculation.
    const view0_dims = await page.evaluate(() => {
        const div = document.querySelector('#b_0');
        return {
            height: div.clientHeight,
            width: div.clientWidth,
        };
    });

    // Get the zoom rectangle's style properties.
    const zoomRectTop = await page.evaluate(() => {
      const rect = document.querySelector('#b_0 .rect');
      return parseFloat(rect.style.top);
    });

    // --- Calculate the expected 'top' position ---
    // These values correspond to the state in the URL.
    const prevCenterIm = 0;
    const currCenterIm = 0.4;
    // prevSize is NOT 3.0 because of aspect ratio override in Config.initSizes
    // it will be Math.max(3.0, 2.5 * aspectRatio)
    const aspectRatio = 16 / 9;
    const prevSize = Math.max(3.0, 2.5 * aspectRatio); // Corrected prevSize
    
    const zoomFactor = 5; // s=3, s=0.6 -> zf=5

    // The correct 'y' fraction calculation, accounting for aspect ratio.
    const y_fraction = 0.5 - (currCenterIm - prevCenterIm) / (prevSize / aspectRatio);

    const border = 1;
    const expectedTop = y_fraction * view0_dims.height - view0_dims.height / 2 / zoomFactor - border;

    // console.log('--- TEST DEBUG ---'); // Removed debug logs
    // console.log('View 0 Height (pixels):', view0_dims.height);
    // console.log('Previous Imaginary Center:', prevCenterIm);
    // console.log('Current Imaginary Center:', currCenterIm);
    // console.log('Previous Size (width):', prevSize);
    // console.log('Aspect Ratio:', aspectRatio);
    // console.log('Calculated Y Fraction:', y_fraction);
    // console.log('Expected Top (pixels):', expectedTop);
    // console.log('Received Top (pixels):', zoomRectTop);
    // console.log('--- END TEST DEBUG ---');

    expect(zoomRectTop).toBeCloseTo(expectedTop, 1);
  });

  test('A key toggles aspect ratio between 1:1 and 16:9', async () => {
    // Navigate to default page (1:1 aspect ratio)
    await navigateToApp(page);

    // Verify initial aspect ratio is 1:1
    const initialRatio = await page.evaluate(() => window.explorer.config.aspectRatio);
    expect(initialRatio).toBe(1.0);

    // Press 'a' to toggle to 16:9
    await page.keyboard.press('a');
    await page.waitForFunction(
      () => Math.abs(window.explorer.config.aspectRatio - 16/9) < 0.001,
      { timeout: 5000 }
    );

    const afterFirstPress = await page.evaluate(() => window.explorer.config.aspectRatio);
    expect(afterFirstPress).toBeCloseTo(16/9, 5);

    // Wait for any layout update to complete before second toggle
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

    // Press 'a' again to toggle back to 1:1
    await page.keyboard.press('a');
    await page.waitForFunction(
      () => window.explorer.config.aspectRatio === 1.0,
      { timeout: 5000 }
    );

    const afterSecondPress = await page.evaluate(() => window.explorer.config.aspectRatio);
    expect(afterSecondPress).toBe(1.0);
  }, TEST_TIMEOUT);
});
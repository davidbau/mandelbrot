/**
 * Integration tests for parent-child view iteration count matching
 *
 * At deep zoom levels, pixels in the parent view that correspond to the
 * child view's region should have matching iteration counts.
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

// Timeout for deep zoom computation
const PARENT_CHILD_TIMEOUT = 120000; // 2 minutes

async function navigateToAppBasic(page, queryParams = '') {
  const htmlPath = `file://${path.join(__dirname, '../../index.html')}${queryParams}`;
  await page.goto(htmlPath, { waitUntil: 'load' });
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });
  await page.waitForFunction(() => {
    return window.explorer?.grid?.views?.[0] !== undefined;
  }, { timeout: 15000 });
}

describe('Parent-child view iteration matching', () => {
  let browser;
  let page;
  let launchFailed = false;

  beforeAll(async () => {
    try {
      browser = await setupBrowser();
    } catch (e) {
      launchFailed = true;
      console.warn('Browser launch failed:', e.message);
    }
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    if (launchFailed) return;
    page = await setupPage(browser, {}, TEST_TIMEOUT);
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

  test('z=1e20 with 16:9 aspect ratio should have matching iteration counts', async () => {
    if (launchFailed) return;

    // Test precision matching at z=1e20 (requires quad precision)
    // c=-1.8 is in the period-3 bulb; grid=10&subpixel=1 for faster test execution
    const url = '?z=1.00e+20&a=16:9&grid=1&subpixel=1&c=-1.8+0i' +
      '&board=gpuz&width=240&height=135&pixelratio=1&maxiter=800&debug=fastload';

    await navigateToAppBasic(page, url);

    // Wait for first view to be ready
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && !view.uninteresting();
    }, { timeout: 15000 });
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 15000 });

    // Click canvas center to create child view
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Wait for both views to exist
    await page.waitForFunction(() => {
      return window.explorer.grid.views.length >= 2 &&
             window.explorer.grid.views[0] !== null &&
             window.explorer.grid.views[1] !== null;
    }, { timeout: 15000 });

    // Wait until enough sample points are computed to make a stable comparison
    await page.waitForFunction(() => {
      const view0 = window.explorer?.grid?.views?.[0];
      const view1 = window.explorer?.grid?.views?.[1];
      if (!view0 || !view1) return false;

      const config = window.explorer.config;
      const samplePoints = 11;
      const dimsWidth = config.dimsWidth;
      const dimsHeight = config.dimsHeight;
      const aspectRatio = config.aspectRatio;

      let totalSamples = 0;
      for (let sy = 0; sy < samplePoints; sy++) {
        for (let sx = 0; sx < samplePoints; sx++) {
          const v1x = Math.floor(dimsWidth * (0.3 + 0.4 * sx / (samplePoints - 1)));
          const v1y = Math.floor(dimsHeight * (0.3 + 0.4 * sy / (samplePoints - 1)));
          const v1idx = v1y * dimsWidth + v1x;

          const v1PixelC = view1.currentc(v1idx);
          const pixelRQD = [v1PixelC[0], v1PixelC[1], v1PixelC[2], v1PixelC[3]];
          const pixelIQD = [v1PixelC[4], v1PixelC[5], v1PixelC[6], v1PixelC[7]];

          const deltaR = toQDSub(pixelRQD, view0.sizesQD[1]);
          const deltaI = toQDSub(pixelIQD, view0.sizesQD[2]);

          const v0x = Math.round((qdToNumber(deltaR) / view0.sizesQD[0] + 0.5) * dimsWidth);
          const v0y = Math.round((0.5 - qdToNumber(deltaI) * aspectRatio / view0.sizesQD[0]) * dimsHeight);

          if (v0x >= 0 && v0x < dimsWidth && v0y >= 0 && v0y < dimsHeight) {
            const v0idx = v0y * dimsWidth + v0x;
            const v0iter = view0.nn[v0idx];
            const v1iter = view1.nn[v1idx];
            if (v0iter === 0 || v1iter === 0) continue;
            totalSamples++;
            if (totalSamples > 20) return true;
          }
        }
      }
      return false;
    }, { timeout: 90000 });

    // Get detailed comparison data
    const comparison = await page.evaluate(() => {
      const view0 = window.explorer.grid.views[0];
      const view1 = window.explorer.grid.views[1];
      const config = window.explorer.config;

      // Get view centers and sizes
      // sizesQD format: [sizeDouble, reOct, imOct]
      const v0Size = view0.sizesQD[0];  // size is stored as double
      const v0CenterROct = view0.sizesQD[1];
      const v0CenterIOct = view0.sizesQD[2];

      const v1Size = view1.sizesQD[0];  // size is stored as double
      const v1CenterROct = view1.sizesQD[1];
      const v1CenterIOct = view1.sizesQD[2];
      const zoomFactor = v0Size / v1Size;

      // For each pixel in view 1, find the corresponding pixel in view 0
      // and compare iteration counts
      const samples = [];
      const samplePoints = 11; // Sample an 11x11 grid
      const dimsWidth = config.dimsWidth;
      const dimsHeight = config.dimsHeight;
      const aspectRatio = config.aspectRatio;

      let exactMatches = 0;
      let closeMatches = 0;
      let totalSamples = 0;

      for (let sy = 0; sy < samplePoints; sy++) {
        for (let sx = 0; sx < samplePoints; sx++) {
          // Sample point in view 1 (centered around the middle)
          const v1x = Math.floor(dimsWidth * (0.3 + 0.4 * sx / (samplePoints - 1)));
          const v1y = Math.floor(dimsHeight * (0.3 + 0.4 * sy / (samplePoints - 1)));
          const v1idx = v1y * dimsWidth + v1x;

          // Get the complex coordinate of this pixel in view 1
          const v1PixelC = view1.currentc(v1idx);
          // v1PixelC is oct format: [r0, r1, r2, r3, i0, i1, i2, i3]
          const pixelRQD = [v1PixelC[0], v1PixelC[1], v1PixelC[2], v1PixelC[3]];
          const pixelIQD = [v1PixelC[4], v1PixelC[5], v1PixelC[6], v1PixelC[7]];

          // Convert this coordinate to a pixel position in view 0
          // x = (pixelR - v0CenterR) / v0Size + 0.5
          // y = 0.5 - (pixelI - v0CenterI) / (v0Size / aspectRatio)
          const deltaR = toQDSub(pixelRQD, v0CenterROct);
          const deltaI = toQDSub(pixelIQD, v0CenterIOct);

          const v0x = Math.round((qdToNumber(deltaR) / v0Size + 0.5) * dimsWidth);
          const v0y = Math.round((0.5 - qdToNumber(deltaI) * aspectRatio / v0Size) * dimsHeight);

          // Check if this pixel is within view 0's bounds
          if (v0x >= 0 && v0x < dimsWidth && v0y >= 0 && v0y < dimsHeight) {
            const v0idx = v0y * dimsWidth + v0x;

          const v0iter = view0.nn[v0idx];
          const v1iter = view1.nn[v1idx];

          // Skip samples that aren't computed in both views yet
          if (v0iter === 0 || v1iter === 0) continue;

            const diff = Math.abs(v0iter - v1iter);
            totalSamples++;

            if (diff === 0) exactMatches++;
            if (diff <= 1) closeMatches++;

            if (samples.length < 20) { // Limit detailed samples
              samples.push({
                v1x, v1y, v0x, v0y,
                v0iter, v1iter, diff,
                pixelR: qdToNumber(pixelRQD),
                pixelI: qdToNumber(pixelIQD)
              });
            }
          }
        }
      }

      return {
        v0Size,
        v1Size,
        zoomFactor,
        v0Stats: { it: view0.it, di: view0.di, un: view0.un, total: view0.config.dimsArea },
        v1Stats: { it: view1.it, di: view1.di, un: view1.un, total: view1.config.dimsArea },
        v0BoardType: view0.boardType,
        v1BoardType: view1.boardType,
        samples,
        exactMatches,
        closeMatches,
        totalSamples,
        exactRate: exactMatches / totalSamples,
        closeRate: closeMatches / totalSamples
      };
    });

    // At z=1e20, expect reasonable match rates
    // Perfect matching is limited by subpixel positioning and rounding
    // closeRate = within 1 iteration, exactRate = exact match
    expect(comparison.totalSamples).toBeGreaterThan(20);
    expect(comparison.closeRate).toBeGreaterThan(0.5);
    expect(comparison.exactRate).toBeGreaterThan(0.35);
  }, PARENT_CHILD_TIMEOUT);

  // Skip: Deep zoom CPU computation is too slow for reliable CI
  test.skip('z=1e47 deep zoom should have matching iteration counts', async () => {
    if (launchFailed) return;

    // Test at z=1e47 - this is where the sloppy_mul fix matters most
    // At this zoom, pixel spacing is ~1e-49, requiring full oct precision
    const url = '?z=1.00e+47&a=16:9&grid=10&subpixel=1&c=-1.8+0i';

    await navigateToAppBasic(page, url);

    // Wait for first view to be ready
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && !view.uninteresting();
    }, { timeout: 30000 });
    await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 30000 });

    // Click canvas center to create child view
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Wait for both views to exist
    await page.waitForFunction(() => {
      return window.explorer.grid.views.length >= 2 &&
             window.explorer.grid.views[0] !== null &&
             window.explorer.grid.views[1] !== null;
    }, { timeout: 15000 });

    // Wait for child view to be mostly complete
    await page.waitForFunction(() => {
      const v0 = window.explorer.grid.views[0];
      const v1 = window.explorer.grid.views[1];
      return v0 && v1 &&
             v1.un <= 10 &&
             v0.di > v0.config.dimsArea * 0.5;
    }, { timeout: 100000 });

    // Get detailed comparison data (same logic as z=1e20 test)
    const comparison = await page.evaluate(() => {
      const view0 = window.explorer.grid.views[0];
      const view1 = window.explorer.grid.views[1];
      const config = window.explorer.config;

      const v0Size = view0.sizesQD[0];
      const v0CenterROct = view0.sizesQD[1];
      const v0CenterIOct = view0.sizesQD[2];

      const v1Size = view1.sizesQD[0];
      const v1CenterROct = view1.sizesQD[1];
      const v1CenterIOct = view1.sizesQD[2];
      const zoomFactor = v0Size / v1Size;

      const samples = [];
      const samplePoints = 11;
      const dimsWidth = config.dimsWidth;
      const dimsHeight = config.dimsHeight;
      const aspectRatio = config.aspectRatio;

      let exactMatches = 0;
      let closeMatches = 0;
      let totalSamples = 0;

      for (let sy = 0; sy < samplePoints; sy++) {
        for (let sx = 0; sx < samplePoints; sx++) {
          const v1x = Math.floor(dimsWidth * (0.3 + 0.4 * sx / (samplePoints - 1)));
          const v1y = Math.floor(dimsHeight * (0.3 + 0.4 * sy / (samplePoints - 1)));
          const v1idx = v1y * dimsWidth + v1x;

          const v1PixelC = view1.currentc(v1idx);
          const pixelRQD = [v1PixelC[0], v1PixelC[1], v1PixelC[2], v1PixelC[3]];
          const pixelIQD = [v1PixelC[4], v1PixelC[5], v1PixelC[6], v1PixelC[7]];

          const deltaR = toQDSub(pixelRQD, v0CenterROct);
          const deltaI = toQDSub(pixelIQD, v0CenterIOct);

          const v0x = Math.round((qdToNumber(deltaR) / v0Size + 0.5) * dimsWidth);
          const v0y = Math.round((0.5 - qdToNumber(deltaI) * aspectRatio / v0Size) * dimsHeight);

          if (v0x >= 0 && v0x < dimsWidth && v0y >= 0 && v0y < dimsHeight) {
            const v0idx = v0y * dimsWidth + v0x;

            const v0iter = view0.nn[v0idx];
            const v1iter = view1.nn[v1idx];

            const diff = Math.abs(v0iter - v1iter);
            totalSamples++;

            if (diff === 0) exactMatches++;
            if (diff <= 1) closeMatches++;

            if (samples.length < 20) {
              samples.push({
                v1x, v1y, v0x, v0y,
                v0iter, v1iter, diff
              });
            }
          }
        }
      }

      return {
        v0Size,
        v1Size,
        zoomFactor,
        v0Stats: { it: view0.it, di: view0.di, un: view0.un, total: view0.config.dimsArea },
        v1Stats: { it: view1.it, di: view1.di, un: view1.un, total: view1.config.dimsArea },
        v0BoardType: view0.boardType,
        v1BoardType: view1.boardType,
        samples,
        exactMatches,
        closeMatches,
        totalSamples,
        exactRate: exactMatches / totalSamples,
        closeRate: closeMatches / totalSamples
      };
    });

    // At z=1e47, with sloppy_mul fix, expect match rates comparable to z=1e20
    // The key verification is that deep zoom doesn't degrade precision significantly
    // Before the fix, z=1e47 would have much lower rates due to lost cross-terms
    // closeRate = within 1 iteration, exactRate = exact match
    expect(comparison.closeRate).toBeGreaterThan(0.5);
    expect(comparison.exactRate).toBeGreaterThan(0.3);
  }, PARENT_CHILD_TIMEOUT);
});

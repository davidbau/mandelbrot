/**
 * Integration tests for keyboard navigation and grid commands
 * Tests T, U, I, C, H, G keys
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady, closeBrowser } = require('./test-utils');

describe('Keyboard Navigation Tests', () => {
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
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  describe('Theme and Color Commands', () => {
    test('T key should cycle through color themes', async () => {
      // Wait for no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
      const initialTheme = await page.evaluate(() => window.explorer.config.theme);
      await page.keyboard.press('t');
      // Wait for theme to change
      await page.waitForFunction(
        (init) => window.explorer.config.theme !== init,
        { timeout: 5000 },
        initialTheme
      );
      const newTheme = await page.evaluate(() => window.explorer.config.theme);
      expect(newTheme).not.toBe(initialTheme);
    }, TEST_TIMEOUT);

    test('Shift+T should cycle themes backward', async () => {
      // Wait for no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
      const initialTheme = await page.evaluate(() => window.explorer.config.theme);
      await page.keyboard.down('Shift');
      await page.keyboard.press('t');
      await page.keyboard.up('Shift');
      await page.waitForFunction(
        (init) => window.explorer.config.theme !== init,
        { timeout: 5000 },
        initialTheme
      );
      const newTheme = await page.evaluate(() => window.explorer.config.theme);
      expect(newTheme).not.toBe(initialTheme);
    }, TEST_TIMEOUT);

    test('T key should actually redraw the canvas with new colors', async () => {
      // Wait for substantial computation so we have many colored pixels
      await waitForViewReady(page);
      await page.waitForFunction(() => {
        const view = window.explorer.grid.views[0];
        return view && view.di > 1000;  // Need more pixels for reliable color comparison
      }, { timeout: 15000 });

      // Sample DIVERGED pixels (nn > 0) - these are colored by theme
      // Converged pixels (nn < 0) are always black regardless of theme
      const sampleDivergedPixels = async () => {
        return await page.evaluate(() => {
          const view = window.explorer.grid.views[0];
          const config = window.explorer.config;
          const canvas = window.explorer.grid.canvas(0);
          const ctx = canvas.getContext('2d');
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Find diverged pixel positions (nn > 0)
          const samples = [];
          const dimsWidth = config.dimsWidth;
          for (let i = 0; i < view.nn.length && samples.length < 10; i++) {
            if (view.nn[i] > 0) {  // Diverged pixel - will be colored by theme
              // Convert nn index to canvas pixel position
              const x = i % dimsWidth;
              const y = Math.floor(i / dimsWidth);
              const pixelIdx = (y * canvas.width + x) * 4;
              if (pixelIdx >= 0 && pixelIdx < imageData.data.length - 3) {
                samples.push([
                  imageData.data[pixelIdx],
                  imageData.data[pixelIdx + 1],
                  imageData.data[pixelIdx + 2],
                  pixelIdx
                ]);
              }
            }
          }
          return samples;
        });
      };

      const beforePixels = await sampleDivergedPixels();
      expect(beforePixels.length).toBeGreaterThan(0);  // Ensure we have diverged pixels

      // Change theme and wait for redraw
      const themeBefore = await page.evaluate(() => window.explorer.config.theme);
      await page.keyboard.press('t');
      await page.waitForFunction(
        (init) => window.explorer.config.theme !== init,
        { timeout: 5000 },
        themeBefore
      );
      const themeAfter = await page.evaluate(() => window.explorer.config.theme);

      // Force a redraw - the theme change already calls redrawProcess.start() but we want to ensure
      // the redraw is complete before sampling pixels
      await page.evaluate(() => {
        window.explorer.redrawProcess.start();
      });
      // Wait for redraw to complete
      await page.waitForTimeout(100);

      // Sample the same pixel positions after theme change
      const afterPixels = await page.evaluate((positions) => {
        const canvas = window.explorer.grid.canvas(0);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return positions.map(pos => [
          imageData.data[pos],
          imageData.data[pos + 1],
          imageData.data[pos + 2]
        ]);
      }, beforePixels.map(p => p[3]));

      // At least some pixels should have changed color
      let changedCount = 0;
      for (let i = 0; i < beforePixels.length; i++) {
        const before = beforePixels[i];
        const after = afterPixels[i];
        if (before[0] !== after[0] || before[1] !== after[1] || before[2] !== after[2]) {
          changedCount++;
        }
      }
      // Log diagnostics on failure
      if (changedCount === 0) {
        const dims = await page.evaluate(() => ({
          dimsWidth: window.explorer.config.dimsWidth,
          dimsHeight: window.explorer.config.dimsHeight,
          canvasWidth: window.explorer.grid.canvas(0)?.width,
          canvasHeight: window.explorer.grid.canvas(0)?.height
        }));
        console.log(`Theme: ${themeBefore} -> ${themeAfter}`);
        console.log(`Dims: config=${dims.dimsWidth}x${dims.dimsHeight}, canvas=${dims.canvasWidth}x${dims.canvasHeight}`);
        console.log(`Before pixels (${beforePixels.length}):`, beforePixels.slice(0, 3));
        console.log(`After pixels:`, afterPixels.slice(0, 3));
      }
      expect(changedCount).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    test('U key should cycle unknown color', async () => {
      // Wait for no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
      const initialColor = await page.evaluate(() => window.explorer.config.unknowncolor);
      await page.keyboard.press('u');
      await page.waitForFunction(
        (init) => window.explorer.config.unknowncolor !== init,
        { timeout: 5000 },
        initialColor
      );
      const newColor = await page.evaluate(() => window.explorer.config.unknowncolor);
      expect(newColor).not.toBe(initialColor);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Navigation Commands', () => {
    test('I key should zoom in at current position', async () => {
      await waitForViewReady(page);
      // Wait for no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);

      await page.keyboard.press('i');
      await page.waitForFunction(
        (before) => window.explorer.grid.views.length > before,
        { timeout: 5000 },
        viewsBefore
      );

      const viewsAfter = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsAfter).toBe(viewsBefore + 1);

      const sizes = await page.evaluate(() => {
        const views = window.explorer.grid.views;
        return { firstSize: views[0].size, lastSize: views[views.length - 1].size };
      }, TEST_TIMEOUT);
      expect(sizes.lastSize).toBeLessThan(sizes.firstSize);
    }, TEST_TIMEOUT);

    test('C key should center views when multiple views exist', async () => {
      await waitForViewReady(page);
      // Wait for no update in progress before clicking
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      // Create second view by clicking off-center
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });

      // Get the off-center position of view 1
      const beforeCenter = await page.evaluate(() => ({
        view0_re: window.explorer.grid.views[0].re[0],
        view1_re: window.explorer.grid.views[1].re[0],
        viewCount: window.explorer.grid.views.length
      }));

      // Press C to center views (without Ctrl, so view 0 stays put)
      await page.keyboard.press('c');
      // Wait for centering animation/recompute
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      const afterCenter = await page.evaluate(() => ({
        view0_re: window.explorer.grid.views[0].re[0],
        view1_re: window.explorer.grid.views[1].re[0],
        viewCount: window.explorer.grid.views.length
      }));

      // View count should remain the same
      expect(afterCenter.viewCount).toBe(beforeCenter.viewCount);
      // View 0 should stay in place (without Ctrl)
      expect(afterCenter.view0_re).toBeCloseTo(beforeCenter.view0_re, 5);
    }, TEST_TIMEOUT);

    test('Ctrl+C should center ALL views including the first view', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?debug=fastload&width=240&height=240&pixelratio=1`);
      await waitForViewReady(page);
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      // Create view 2 by calling cellclick directly (more stable than mouse events)
      await page.evaluate(() => {
        const { zoomManager, config } = window.explorer;
        const cx = Math.floor(config.dimsWidth * 0.3);
        const cy = Math.floor(config.dimsHeight * 0.3);
        zoomManager.cellclick(0, cy * config.dimsWidth + cx, false);
      });
      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 10000 });
      await page.waitForFunction(() => {
        const view = window.explorer.grid.views[1];
        return view && !view.uninteresting() && !window.explorer.grid.currentUpdateProcess;
      }, { timeout: 10000 });

      // Create view 3 by clicking off-center on view 2
      await page.evaluate(() => {
        const { zoomManager, config } = window.explorer;
        const cx = Math.floor(config.dimsWidth * 0.6);
        const cy = Math.floor(config.dimsHeight * 0.4);
        zoomManager.cellclick(1, cy * config.dimsWidth + cx, false);
      });
      await page.waitForFunction(() => window.explorer.grid.views.length >= 3, { timeout: 10000 });
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      // Get positions before centering
      const before = await page.evaluate(() => ({
        view0_re: window.explorer.grid.views[0].re[0],
        view0_im: window.explorer.grid.views[0].im[0],
        view2_re: window.explorer.grid.views[2].re[0],
        view2_im: window.explorer.grid.views[2].im[0],
        viewCount: window.explorer.grid.views.length
      }));
      expect(before.viewCount).toBe(3);

      // Press Ctrl+C to center ALL views including first
      await page.keyboard.down('Control');
      await page.keyboard.press('c');
      await page.keyboard.up('Control');

      // Wait for centering
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      const after = await page.evaluate(() => ({
        view0_re: window.explorer.grid.views[0].re[0],
        view0_im: window.explorer.grid.views[0].im[0],
        view2_re: window.explorer.grid.views[2].re[0],
        view2_im: window.explorer.grid.views[2].im[0],
        viewCount: window.explorer.grid.views.length
      }));

      // View count should remain the same
      expect(after.viewCount).toBe(3);
      // With Ctrl, view 0 should have moved to deepest view center
      expect(after.view0_re).toBeCloseTo(after.view2_re, 6);
      expect(after.view0_im).toBeCloseTo(after.view2_im, 6);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Grid Commands', () => {
    test('H key should increase grid columns', async () => {
      // Wait for no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);
      await page.keyboard.press('h');
      await page.waitForFunction(
        (init) => window.explorer.config.gridcols === init + 1,
        { timeout: 5000 },
        initialCols
      );
      const newCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(newCols).toBe(initialCols + 1);
    }, TEST_TIMEOUT);

    test('G key should decrease grid columns', async () => {
      // Wait for no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
      const startCols = await page.evaluate(() => window.explorer.config.gridcols);
      await page.keyboard.press('h');
      await page.waitForFunction(
        (init) => window.explorer.config.gridcols === init + 1,
        { timeout: 5000 },
        startCols
      );
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);

      await page.keyboard.press('g');
      await page.waitForFunction(
        (init) => window.explorer.config.gridcols === init - 1,
        { timeout: 5000 },
        initialCols
      );
      const newCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(newCols).toBe(initialCols - 1);
    }, TEST_TIMEOUT);

    test('H key should work repeatedly during relayout', async () => {
      // Wait for no update in progress before keypress
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);
      await page.keyboard.press('h');
      await page.keyboard.press('h');
      await page.keyboard.press('h');
      await page.waitForFunction(
        (init) => window.explorer.config.gridcols === init + 3,
        { timeout: 5000 },
        initialCols
      );
      const finalCols = await page.evaluate(() => window.explorer.config.gridcols);
      expect(finalCols).toBe(initialCols + 3);
    }, TEST_TIMEOUT);

    test('H key should resize canvases correctly', async () => {
      // Wait for initial layout to complete
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      // Get initial canvas dimensions
      const initialState = await page.evaluate(() => ({
        gridcols: window.explorer.config.gridcols,
        cssDimsWidth: window.explorer.config.cssDimsWidth,
        canvasWidth: window.explorer.grid.canvas(0)?.width,
        canvasStyleWidth: window.explorer.grid.canvas(0)?.style.width
      }));

      // Press H to increase grid columns
      await page.keyboard.press('h');
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      // Get new canvas dimensions
      const newState = await page.evaluate(() => ({
        gridcols: window.explorer.config.gridcols,
        cssDimsWidth: window.explorer.config.cssDimsWidth,
        canvasWidth: window.explorer.grid.canvas(0)?.width,
        canvasStyleWidth: window.explorer.grid.canvas(0)?.style.width
      }));

      // Grid columns should have increased
      expect(newState.gridcols).toBe(initialState.gridcols + 1);

      // Canvas should have shrunk (more columns = smaller individual canvases)
      expect(newState.cssDimsWidth).toBeLessThan(initialState.cssDimsWidth);

      // Canvas element dimensions should match config
      expect(newState.canvasStyleWidth).toBe(newState.cssDimsWidth + 'px');
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

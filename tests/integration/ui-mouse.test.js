/**
 * Integration tests for mouse UI interactions
 * Tests mouse clicks, view creation/deletion, hidden views, and R key restore
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady, closeBrowser } = require('./test-utils');

describe('Mouse UI Tests', () => {
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
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  describe('View Creation', () => {
    test('Click should zoom in and create child view', async () => {
      await waitForViewReady(page);
      // Wait for no update before clicking to create new view
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });
      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);

      const canvas = await page.$('#grid canvas');
      expect(canvas).toBeTruthy();
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();

      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      await page.waitForFunction(
        (prevCount) => window.explorer.grid.views.length > prevCount,
        { timeout: 5000 },
        viewsBefore
      );

      const viewsAfter = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsAfter).toBe(viewsBefore + 1);

      const sizes = await page.evaluate(() => {
        return window.explorer.grid.views.map(v => v ? v.sizes[0] : null);
      }, TEST_TIMEOUT);
      expect(sizes[1]).toBeLessThan(sizes[0]);
    }, TEST_TIMEOUT);

    test('Click X button should delete view', async () => {
      await waitForViewReady(page);
      // Wait for no update before clicking to create second view
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });

      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });
      // Wait for update to complete - closebox click is blocked during updates
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsBefore).toBeGreaterThanOrEqual(2);

      // Get the last view's bounding box
      const lastViewIdx = viewsBefore - 1;
      const viewBox = await page.evaluate((idx) => {
        const div = document.getElementById(`b_${idx}`);
        if (!div) return null;
        const rect = div.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }, lastViewIdx);

      // Hover over the view to make closebox visible (removes hidemarks class)
      await page.mouse.move(viewBox.x + viewBox.width / 2, viewBox.y + viewBox.height / 2);
      await page.waitForFunction(() => !document.body.classList.contains('hidemarks'), { timeout: 2000 });

      // Wait for no update process before clicking closebox
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 5000 });

      // Click the closebox
      const closebox = await page.$(`#b_${lastViewIdx} .closebox`);
      await closebox.click();

      // Wait for the view count to decrease
      await page.waitForFunction(
        (before) => window.explorer.grid.views.filter(v => v !== null).length < before,
        { timeout: 5000 },
        viewsBefore
      );

      const viewsAfter = await page.evaluate(() => {
        return window.explorer.grid.views.filter(v => v !== null).length;
      });

      expect(viewsAfter).toBeLessThan(viewsBefore);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('View Hiding and Restore', () => {
    test('Ctrl+Click hides view, R key restores, closebox hides, R restores again', async () => {
      await waitForViewReady(page);

      // Initially no hidden views
      const initialHidden = await page.evaluate(() => window.explorer.grid.getHiddenViews());
      expect(initialHidden.length).toBe(0);

      // Test 1: Ctrl+click to zoom and hide the current view
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.keyboard.down('Control');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.up('Control');

      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 }, TEST_TIMEOUT);
      await page.waitForTimeout(300);

      // Verify first view is hidden and tracked
      const afterCtrlClick = await page.evaluate(() => ({
        canvasHidden: document.querySelector('#grid > div')?.style.display === 'none',
        hiddenViaMethod: window.explorer.grid.hiddencanvas(0),
        hiddenViews: window.explorer.grid.getHiddenViews()
      }));
      expect(afterCtrlClick.canvasHidden).toBe(true);
      expect(afterCtrlClick.hiddenViaMethod).toBe(true);
      expect(afterCtrlClick.hiddenViews).toContain(0);

      // Test 2: R key restores hidden views
      await page.keyboard.press('r');
      await page.waitForTimeout(300);
      const afterRestore1 = await page.evaluate(() => ({
        hiddenViaMethod: window.explorer.grid.hiddencanvas(0),
        hiddenViews: window.explorer.grid.getHiddenViews()
      }));
      expect(afterRestore1.hiddenViaMethod).toBe(false);
      expect(afterRestore1.hiddenViews.length).toBe(0);

      // Test 3: Closebox click hides view
      const closeboxes = await page.$$('#grid .closebox');
      expect(closeboxes.length).toBeGreaterThan(0);
      await closeboxes[0].click();
      await page.waitForTimeout(300);
      const afterClosebox = await page.evaluate(() => window.explorer.grid.hiddencanvas(0));
      expect(afterClosebox).toBe(true);

      // Test 4: R key restores views hidden by closebox
      await page.keyboard.press('r');
      await page.waitForTimeout(300);
      const afterRestore2 = await page.evaluate(() => window.explorer.grid.hiddencanvas(0));
      expect(afterRestore2).toBe(false);
    }, TEST_TIMEOUT);

    test('Click after hiding middle view should compute new view', async () => {
      // This test reproduces a bug where hiding a view and then clicking to create
      // a new view at the same index would fail to compute because the hidden board
      // index was still in the worker's hiddenBoards set.

      // Start with 3 views
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i,-1.4012+0i,-1.40120+0i`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForFunction(() => window.explorer.grid.views.length >= 3, { timeout: 15000 });
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 15000 });

      // Wait for initial computation to make progress
      await page.waitForFunction(() => {
        const view = window.explorer.grid.views[0];
        return view && view.di > 100;
      }, { timeout: 15000 });

      // Hide the middle view (index 1) via closebox
      const closeboxes = await page.$$('#grid .closebox');
      expect(closeboxes.length).toBeGreaterThanOrEqual(2);
      await closeboxes[1].click();  // Click closebox on view 1
      await page.waitForTimeout(300);

      // Verify view 1 is hidden
      const isHidden = await page.evaluate(() => window.explorer.grid.hiddencanvas(1));
      expect(isHidden).toBe(true);

      // Click on view 0 to create a new view - this will truncate and create at index 1
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      // Wait for new view to be created
      await page.waitForFunction(() => {
        const grid = window.explorer.grid;
        // Should have 2 views now (0 and the new 1)
        return grid.views.length === 2 && grid.views[1] !== null;
      }, { timeout: 5000 });

      // The critical check: the new view at index 1 should compute
      // If the bug exists, di will stay at 0 because the worker thinks board 1 is hidden
      const computeResult = await page.evaluate(async () => {
        const view = window.explorer.grid.views[1];
        if (!view) return { error: 'No view at index 1' };

        const startDi = view.di;
        const startTime = Date.now();
        const timeout = 5000;

        // Wait for some computation to happen
        while (view.di === startDi && (Date.now() - startTime) < timeout) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        return {
          startDi,
          endDi: view.di,
          computed: view.di > startDi,
          hiddenBoards: window.explorer.grid.getHiddenViews()
        };
      });

      // New view should have started computing (di should increase)
      expect(computeResult.error).toBeUndefined();
      expect(computeResult.computed).toBe(true);
      // There should be no hidden views after the click
      expect(computeResult.hiddenBoards.length).toBe(0);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Computation and URL', () => {
    test('Should complete computation and verify pixel values', async () => {
      // Use grid=5 for a small but meaningful computation
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?grid=5`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);

      const result = await page.evaluate(async () => {
        const view = window.explorer.grid.views[0];
        if (!view) return { error: 'No view found' };

        const startTime = Date.now();
        const timeout = 15000;

        // Wait for computation to complete
        while (view.unfinished() > 0 && (Date.now() - startTime) < timeout) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Get view dimensions and pixel data
        const width = view.config.dimsWidth;
        const height = view.config.dimsHeight;
        const size = view.sizes[0];  // Size of view in complex plane
        const centerRe = view.sizes[1][0];  // High part of quad-double
        const centerIm = view.sizes[2][0];  // High part of quad-double

        // Helper to convert pixel coords to complex coords
        const pixelToComplex = (px, py) => {
          const re = centerRe + (px - width / 2) * size / width;
          const im = centerIm - (py - height / 2) * size / height;
          return { re, im };
        };

        // Helper to convert complex coords to pixel index
        const complexToPixel = (re, im) => {
          const px = Math.round((re - centerRe) * width / size + width / 2);
          const py = Math.round((centerIm - im) * height / size + height / 2);
          if (px < 0 || px >= width || py < 0 || py >= height) return null;
          return py * width + px;
        };

        // Test specific points (view is centered at -0.5, 0 with size 3)
        const testPoints = {
          // Main cardioid center (period 1, converges quickly)
          mainBulb: { re: -0.25, im: 0 },
          // Period-2 bulb center (period 2, converges very quickly)
          period2Bulb: { re: -1.0, im: 0 },
          // Clearly outside the set (diverges quickly) - top right
          outside: { re: 0.5, im: 0.5 },
          // Another point outside (diverges) - left side
          outsideLeft: { re: -1.8, im: 0.3 }
        };

        const results = {};
        for (const [name, point] of Object.entries(testPoints)) {
          const index = complexToPixel(point.re, point.im);
          if (index !== null && index >= 0 && index < view.nn.length) {
            results[name] = {
              nn: view.nn[index],
              period: view.currentp(index),
              diverged: view.nn[index] > 0,
              converged: view.nn[index] < 0
            };
          } else {
            results[name] = { error: 'Point outside view', index };
          }
        }

        return {
          completed: view.unfinished() === 0,
          unfinished: view.unfinished(),
          width,
          height,
          pixelCount: width * height,
          size,
          centerRe,
          centerIm,
          testResults: results
        };
      }, TEST_TIMEOUT);

      expect(result.error).toBeUndefined();
      expect(result.completed).toBe(true);
      expect(result.pixelCount).toBeGreaterThan(0);

      // Verify main cardioid (period 1) - should converge
      // Period 1 means it converges to a fixed point very quickly
      expect(result.testResults.mainBulb.converged).toBe(true);
      expect(result.testResults.mainBulb.period).toBeLessThan(50);  // Converges fast

      // Verify period-2 bulb - should converge
      // The center of the period-2 bulb (-1, 0) converges with period 2
      expect(result.testResults.period2Bulb.converged).toBe(true);

      // Verify outside point (0.5, 0.5) - should diverge quickly
      expect(result.testResults.outside.diverged).toBe(true);
      expect(result.testResults.outside.nn).toBeLessThan(20);  // Diverges fast

      // Verify outside left point (-1.8, 0.3) - should diverge
      expect(result.testResults.outsideLeft.diverged).toBe(true);
      expect(result.testResults.outsideLeft.nn).toBeLessThan(20);  // Diverges fast
    }, TEST_TIMEOUT);

    test('Should update URL after computation', async () => {
      await page.waitForFunction(() => {
        const view = window.explorer.grid.views[0];
        return view && !view.uninteresting();
      }, { timeout: 10000 }, TEST_TIMEOUT);

      const url = await page.url();
      expect(url).toContain('?');
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Error Handling', () => {
    test('Should handle WebGPU unavailable gracefully', async () => {
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'gpu', {
          get: () => undefined
        }, TEST_TIMEOUT);
      }, TEST_TIMEOUT);

      await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
      await page.waitForTimeout(500);

      const hasViews = await page.evaluate(() => window.explorer.grid.views.length > 0);
      expect(hasViews).toBe(true);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);

  describe('Tooltip on Anchor Hover', () => {
    test('Hovering over zoom anchor shows tooltip with coordinates and progress', async () => {
      await waitForViewReady(page);

      // Create a second view so we have an anchor to hover over
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });
      await page.waitForTimeout(500);

      // Find the anchor element (zoomnum) in the second view
      const anchors = await page.$$('#grid a.zoomnum');
      expect(anchors.length).toBeGreaterThan(0);

      // Get the bounding box of the last anchor
      const anchorBox = await anchors[anchors.length - 1].boundingBox();
      expect(anchorBox).toBeTruthy();

      // Hover over the anchor
      await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
      await page.waitForTimeout(500);

      // Check that the status div has content
      const statusContent = await page.evaluate(() => {
        const statusDivs = document.querySelectorAll('#grid .status');
        for (const div of statusDivs) {
          if (div.textContent && div.textContent.length > 0) {
            return div.textContent;
          }
        }
        return null;
      });

      // Status should contain center coordinates and progress percentage
      expect(statusContent).toBeTruthy();
      expect(statusContent).toMatch(/center|%/i);
    }, TEST_TIMEOUT);

    test('Ctrl/Meta+hover shows debug tooltip with extra info', async () => {
      await waitForViewReady(page);

      // Create a second view
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });
      await page.waitForTimeout(500);

      // Find the anchor element
      const anchors = await page.$$('#grid a.zoomnum');
      expect(anchors.length).toBeGreaterThan(0);
      const anchorBox = await anchors[anchors.length - 1].boundingBox();

      // First, hover without Ctrl to get baseline status
      await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
      await page.waitForTimeout(300);

      const normalStatus = await page.evaluate(() => {
        const statusDivs = document.querySelectorAll('#grid .status');
        for (const div of statusDivs) {
          if (div.innerHTML && div.innerHTML.length > 0) {
            return div.innerHTML;
          }
        }
        return null;
      });

      // Trigger a mouseover with ctrlKey set by dispatching event directly
      // Since Puppeteer keyboard.down('Control') doesn't propagate to mouse events
      const debugStatus = await page.evaluate(() => {
        const anchors = document.querySelectorAll('#grid a.zoomnum');
        const anchor = anchors[anchors.length - 1];
        if (!anchor) return null;

        // Manually set showDebug and trigger updateProgress
        const viewIndex = parseInt(anchor.id.match(/b_(\d+)/)?.[1] || '0');
        anchor.showDebug = true;
        window.explorer.grid.updateProgress(anchor, viewIndex);

        // Wait a bit for the status to update
        return new Promise(resolve => {
          setTimeout(() => {
            const statusDiv = anchor.querySelector('.status');
            resolve(statusDiv ? statusDiv.innerHTML : null);
          }, 100);
        });
      });

      expect(normalStatus).toBeTruthy();
      expect(debugStatus).toBeTruthy();
      // Debug status should have more content (includes board type and other debug info)
      expect(debugStatus.length).toBeGreaterThan(normalStatus.length);
    }, TEST_TIMEOUT);
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

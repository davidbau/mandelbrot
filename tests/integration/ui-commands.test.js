/**
 * Integration tests for all UI commands
 * Tests keyboard shortcuts, mouse interactions, and UI state changes
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Find system Chrome for better headless support
function findChrome() {
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',  // macOS
    '/usr/bin/google-chrome',  // Linux
    '/usr/bin/chromium-browser',  // Linux Chromium
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',  // Windows
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'  // Windows x86
  ];
  for (const p of chromePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;  // Fall back to Puppeteer's bundled Chrome
}

const TEST_TIMEOUT = 60000; // 60 seconds for integration tests

describe('UI Command Integration Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    const chromePath = findChrome();
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Enable WebGPU support
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=metal',  // Use Metal on macOS
      ]
    };
    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }
    browser = await puppeteer.launch(launchOptions);
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await browser.newPage();

    // Capture all console messages
    page.on('console', msg => {
      console.log(`Browser console [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    page.on('pageerror', error => {
      console.error('Browser page error:', error.message, error.stack);
    });

    const htmlPath = `file://${path.join(__dirname, '../../index.html')}`;
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });

    // Check what's actually available on the window
    const debugInfo = await page.evaluate(() => {
      return {
        hasExplorer: typeof window.explorer !== 'undefined',
        windowKeys: Object.keys(window).filter(k => !k.startsWith('webkit') && !k.startsWith('chrome')).slice(0, 20),
        errors: window.__test_errors || []
      };
    });
    console.log('Debug info:', debugInfo);

    // Wait for the explorer to be initialized
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForTimeout(500); // Give it a bit more time to settle
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  describe('Keyboard Commands - Navigation', () => {
    test('T key should cycle through color themes', async () => {
      const initialTheme = await page.evaluate(() => window.explorer.config.theme);

      // Press T
      await page.keyboard.press('t');
      await page.waitForTimeout(100);

      const newTheme = await page.evaluate(() => window.explorer.config.theme);

      expect(newTheme).not.toBe(initialTheme);
    }, TEST_TIMEOUT);

    test('Shift+T should cycle themes backward', async () => {
      const initialTheme = await page.evaluate(() => window.explorer.config.theme);

      // Press Shift+T
      await page.keyboard.down('Shift');
      await page.keyboard.press('t');
      await page.keyboard.up('Shift');
      await page.waitForTimeout(100);

      const newTheme = await page.evaluate(() => window.explorer.config.theme);

      expect(newTheme).not.toBe(initialTheme);
    }, TEST_TIMEOUT);

    test('U key should cycle unknown color', async () => {
      const initialColor = await page.evaluate(() => window.explorer.config.unknowncolor);

      await page.keyboard.press('u');
      await page.waitForTimeout(100);

      const newColor = await page.evaluate(() => window.explorer.config.unknowncolor);

      expect(newColor).not.toBe(initialColor);
    }, TEST_TIMEOUT);

    test('H key should increase grid columns', async () => {
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);

      await page.keyboard.press('h');
      await page.waitForTimeout(500); // Wait for relayout

      const newCols = await page.evaluate(() => window.explorer.config.gridcols);

      expect(newCols).toBe(initialCols + 1);
    }, TEST_TIMEOUT);

    test('G key should decrease grid columns', async () => {
      // First increase to make sure we can decrease
      await page.keyboard.press('h');
      await page.waitForTimeout(500);

      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);

      await page.keyboard.press('g');
      await page.waitForTimeout(500);

      const newCols = await page.evaluate(() => window.explorer.config.gridcols);

      expect(newCols).toBe(initialCols - 1);
    }, TEST_TIMEOUT);

    test('H key should work repeatedly during relayout', async () => {
      const initialCols = await page.evaluate(() => window.explorer.config.gridcols);

      // Press H multiple times quickly
      await page.keyboard.press('h');
      await page.keyboard.press('h');
      await page.keyboard.press('h');
      await page.waitForTimeout(1000); // Wait for all relayouts

      const finalCols = await page.evaluate(() => window.explorer.config.gridcols);

      expect(finalCols).toBe(initialCols + 3);
    }, TEST_TIMEOUT);
  });

  describe('Keyboard Commands - Zoom and Exponent', () => {
    test('X key should increase exponent', async () => {
      const initialExp = await page.evaluate(() => window.explorer.config.exponent);

      await page.keyboard.press('x');
      await page.waitForTimeout(500);

      const newExp = await page.evaluate(() => window.explorer.config.exponent);

      expect(newExp).toBe(initialExp + 1);
    }, TEST_TIMEOUT);

    test('Z key should decrease exponent', async () => {
      // First increase so we can decrease
      await page.keyboard.press('x');
      await page.waitForTimeout(500);

      const initialExp = await page.evaluate(() => window.explorer.config.exponent);

      await page.keyboard.press('z');
      await page.waitForTimeout(500);

      const newExp = await page.evaluate(() => window.explorer.config.exponent);

      expect(newExp).toBe(initialExp - 1);
    }, TEST_TIMEOUT);

    test('Exponent should not go below 2', async () => {
      // Try to press Z when already at 2
      await page.keyboard.press('z');
      await page.waitForTimeout(500);

      const exp = await page.evaluate(() => window.explorer.config.exponent);

      expect(exp).toBe(2);
    }, TEST_TIMEOUT);
  });

  describe('Keyboard Commands - Resolution', () => {
    test('F key should increase pixel ratio', async () => {
      const initialRatio = await page.evaluate(() => window.explorer.config.pixelRatio);

      await page.keyboard.press('f');
      await page.waitForTimeout(500);

      const newRatio = await page.evaluate(() => window.explorer.config.pixelRatio);

      expect(newRatio).toBe(initialRatio + 1);
    }, TEST_TIMEOUT);

    test('D key should decrease pixel ratio', async () => {
      // First increase so we can decrease
      await page.keyboard.press('f');
      await page.waitForTimeout(500);

      const initialRatio = await page.evaluate(() => window.explorer.config.pixelRatio);

      await page.keyboard.press('d');
      await page.waitForTimeout(500);

      const newRatio = await page.evaluate(() => window.explorer.config.pixelRatio);

      expect(newRatio).toBe(initialRatio - 1);
    }, TEST_TIMEOUT);
  });

  describe('Mouse Interactions', () => {
    test('Click should zoom in and create child view', async () => {
      // Wait for initial view to be ready
      await page.waitForTimeout(1000);

      // Wait for the view to have some computed pixels (not "uninteresting")
      await page.waitForFunction(() => {
        const view = window.explorer.grid.views[0];
        return view && !view.uninteresting();
      }, { timeout: 10000 });

      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);

      // Find the first canvas element in the grid
      const canvas = await page.$('#grid canvas');
      expect(canvas).toBeTruthy();

      // Click in the center of the canvas
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();

      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      // Wait for view creation (cellclick has setTimeout delays)
      await page.waitForFunction(
        (prevCount) => window.explorer.grid.views.length > prevCount,
        { timeout: 5000 },
        viewsBefore
      );

      const viewsAfter = await page.evaluate(() => window.explorer.grid.views.length);

      // Should have created a new view
      expect(viewsAfter).toBe(viewsBefore + 1);

      // The new view should have a smaller size (zoomed in)
      const sizes = await page.evaluate(() => {
        return window.explorer.grid.views.map(v => v ? v.sizes[0] : null);
      });
      expect(sizes[1]).toBeLessThan(sizes[0]);
    }, TEST_TIMEOUT);

    test('Click X button should delete view', async () => {
      // Wait for initial view to be ready
      await page.waitForTimeout(1000);

      await page.waitForFunction(() => {
        const view = window.explorer.grid.views[0];
        return view && !view.uninteresting();
      }, { timeout: 10000 });

      // First zoom in to create a child view
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      // Wait for second view to be created
      await page.waitForFunction(
        () => window.explorer.grid.views.length >= 2,
        { timeout: 5000 }
      );

      const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);
      expect(viewsBefore).toBeGreaterThanOrEqual(2);

      // Find and click the closebox (X button) on the second view
      // The closebox is inside #grid > div elements
      const closeboxes = await page.$$('#grid .closebox');
      expect(closeboxes.length).toBeGreaterThan(0);

      // Click the last (most recent) closebox
      const lastClosebox = closeboxes[closeboxes.length - 1];
      await lastClosebox.click();

      // Wait for view to be hidden/removed
      await page.waitForTimeout(500);

      // Check that views were truncated
      const viewsAfter = await page.evaluate(() => {
        // Count non-null, visible views
        return window.explorer.grid.views.filter(v => v !== null).length;
      });

      expect(viewsAfter).toBeLessThan(viewsBefore);
    }, TEST_TIMEOUT);

    test('Ctrl+Click should hide current view when zooming', async () => {
      // Wait for initial view
      await page.waitForTimeout(1000);

      await page.waitForFunction(() => {
        const view = window.explorer.grid.views[0];
        return view && !view.uninteresting();
      }, { timeout: 10000 });

      // Ctrl+click to zoom and hide the current view
      const canvas = await page.$('#grid canvas');
      const box = await canvas.boundingBox();

      await page.keyboard.down('Control');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.up('Control');

      // Wait for new view
      await page.waitForFunction(
        () => window.explorer.grid.views.length >= 2,
        { timeout: 5000 }
      );

      // Check that the first view's canvas is hidden
      const firstCanvasHidden = await page.evaluate(() => {
        const gridDiv = document.querySelector('#grid > div');
        return gridDiv && gridDiv.style.display === 'none';
      });

      expect(firstCanvasHidden).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe('URL Parameters', () => {
    test('Should load with z parameter at Feigenbaum point', async () => {
      // Use Feigenbaum point with z=100 zoom
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-1.401155+0i&z=100`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForTimeout(500);

      const viewData = await page.evaluate(() => {
        const view = window.explorer.grid.views[0];
        return {
          size: view.sizes[0],
          center_re: view.sizes[1][0],
          center_im: view.sizes[2][0]
        };
      });

      // z=100 means zoom factor is 100, so actual size should be 3.0/100 = 0.03
      const expectedSize = 3.0 / 100;
      expect(viewData.size).toBeCloseTo(expectedSize, 3);
      // Center should be at Feigenbaum point
      expect(viewData.center_re).toBeCloseTo(-1.401155, 4);
      expect(viewData.center_im).toBeCloseTo(0.0, 5);
    }, TEST_TIMEOUT);

    test('Should load with scientific notation in z parameter', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i&z=1e3`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForTimeout(500);

      const actualSize = await page.evaluate(() => {
        const view = window.explorer.grid.views[0];
        return view.sizes[0];
      });

      // z=1e3 means zoom factor is 1000, so actual size should be 3.0/1000 = 0.003
      const expectedSize = 3.0 / 1000;
      expect(actualSize).toBeCloseTo(expectedSize, 4);
    }, TEST_TIMEOUT);

    test('Should load with theme parameter', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?theme=neon`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForTimeout(500);

      const theme = await page.evaluate(() => window.explorer.config.theme);

      expect(theme).toBe('neon');
    }, TEST_TIMEOUT);

    test('Should load with center coordinate', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForTimeout(500);

      const center = await page.evaluate(() => {
        const view = window.explorer.grid.views[0];
        return [view.sizes[1][0], view.sizes[2][0]];
      });

      expect(center[0]).toBeCloseTo(-0.5, 5);
      expect(center[1]).toBeCloseTo(0.0, 5);
    }, TEST_TIMEOUT);

    test('Should load with grid parameter', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?grid=3`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForTimeout(500);

      const gridcols = await page.evaluate(() => window.explorer.config.gridcols);

      expect(gridcols).toBe(3);
    }, TEST_TIMEOUT);

    test('Should load with aspect ratio parameter', async () => {
      await page.goto(`file://${path.join(__dirname, '../../index.html')}?a=16:9`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForTimeout(500);

      // Check the config aspect ratio
      const aspectRatio = await page.evaluate(() => window.explorer.config.aspectRatio);
      expect(aspectRatio).toBeCloseTo(16/9, 5);

      // Also verify the canvas dimensions reflect the aspect ratio
      const canvasDims = await page.evaluate(() => {
        const view = window.explorer.grid.views[0];
        if (!view || !view.canvas) return null;
        return {
          width: view.canvas.width,
          height: view.canvas.height
        };
      });

      if (canvasDims) {
        const canvasAspect = canvasDims.width / canvasDims.height;
        expect(canvasAspect).toBeCloseTo(16/9, 1);
      }
    }, TEST_TIMEOUT);
  });

  describe('Computation Completion', () => {
    test('Should complete computation on simple view', async () => {
      // Wait for initial view to complete computation
      // With WebGPU enabled, this should complete relatively quickly
      const result = await page.evaluate(async () => {
        const view = window.explorer.grid.views[0];
        if (!view) return { error: 'No view found' };

        const startTime = Date.now();
        const timeout = 30000; // 30 second timeout

        // Poll for completion
        while (view.unfinished() > 0 && (Date.now() - startTime) < timeout) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        return {
          completed: view.unfinished() === 0,
          unfinished: view.unfinished(),
          elapsed: Date.now() - startTime
        };
      });

      if (result.error) {
        console.log('Computation test error:', result.error);
      }

      expect(result.completed).toBe(true);
    }, TEST_TIMEOUT);

    test('Should update URL after computation', async () => {
      // Wait for computation
      await page.waitForTimeout(3000);

      const url = await page.url();

      // URL should contain parameters
      expect(url).toContain('?');
    }, TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    test('Should handle WebGPU unavailable gracefully', async () => {
      // Override WebGPU availability
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'gpu', {
          get: () => undefined
        });
      });

      await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
      await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
      await page.waitForTimeout(500);

      // Should still load and use CPU boards
      const hasViews = await page.evaluate(() => window.explorer.grid.views.length > 0);

      expect(hasViews).toBe(true);
    }, TEST_TIMEOUT);
  });
});

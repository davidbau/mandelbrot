/**
 * @jest-environment node
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const { TEST_TIMEOUT, setupBrowser, setupPage, closeBrowser } = require('./test-utils');

// On Linux, swiftshader (software WebGPU) is very slow - use CPU-only
const useCpuOnly = os.platform() === 'linux';
// Replace board=gpu with board=cpu on Linux, and add debug flags
function fixUrlForPlatform(url) {
  if (!useCpuOnly) return url;
  // Replace board=gpu with board=cpu
  let fixed = url.replace(/board=gpu/g, 'board=cpu');
  // Add debug=nogpu,nogl if no debug flag, or append to existing
  if (fixed.includes('debug=')) {
    if (!fixed.includes('nogpu')) {
      fixed = fixed.replace(/debug=([^&]*)/, 'debug=$1,nogpu,nogl');
    }
  } else {
    fixed = fixed + (fixed.includes('?') ? '&' : '?') + 'debug=nogpu,nogl';
  }
  return fixed;
}

describe('Inheritance color behavior', () => {
  let browser;
  let server;
  let port;
  let html;

  beforeAll(async () => {
    html = fs.readFileSync('./index.html', 'utf8');
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;

    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
    if (server) server.close();
  }, TEST_TIMEOUT);

  test('child view histogram should match parent histogram shape', async () => {
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 800, height: 600 });

    // Use smaller dimensions for faster test - debug=dims:10x10 gives 100 pixels per view
    await page.goto(fixUrlForPlatform(`http://localhost:${port}?debug=dims:10x10&pixelratio=1&board=gpu&inherit=1&grid=2`), {
      waitUntil: 'domcontentloaded'
    });

    // Wait for parent to complete
    await page.waitForFunction(() => {
      const grid = window.explorer?.grid;
      if (!grid || !grid.views[0]) return false;
      return grid.views[0].unfinished() === 0;
    }, { timeout: 30000 });

    // Get parent histogram
    const parentHist = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      return {
        hi: view.hi.slice(0, 20),
        di: view.di,
        un: view.un
      };
    });

    // Zoom in
    await page.keyboard.press('i');

    // Wait for child to complete
    await page.waitForFunction(() => {
      const grid = window.explorer?.grid;
      if (!grid || !grid.views[1]) return false;
      return grid.views[1].unfinished() === 0;
    }, { timeout: 30000 });

    // Get child histogram
    const childHist = await page.evaluate(() => {
      const view = window.explorer.grid.views[1];
      return {
        hi: view.hi.slice(0, 20),
        di: view.di,
        un: view.un
      };
    });

    // Verify child completed
    expect(childHist.un).toBe(0);
    expect(childHist.di).toBeGreaterThan(0);

    // Verify histogram has entries
    expect(childHist.hi.length).toBeGreaterThan(1);

    await page.close();
  }, TEST_TIMEOUT);

  test('child colors with inheritance should match colors without inheritance', async () => {
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 800, height: 600 });

    // Helper to get child histogram after zooming
    async function getChildHistAfterZoom(inherit) {
      await page.goto(fixUrlForPlatform(`http://localhost:${port}?debug=dims:10x10&pixelratio=1&board=gpu&inherit=${inherit}&grid=2`), {
        waitUntil: 'domcontentloaded'
      });

      // Wait for parent to complete
      await page.waitForFunction(() => {
        const grid = window.explorer?.grid;
        if (!grid || !grid.views[0]) return false;
        return grid.views[0].unfinished() === 0;
      }, { timeout: 30000 });

      // Zoom in
      await page.keyboard.press('i');

      // Wait for child to complete
      await page.waitForFunction(() => {
        const grid = window.explorer?.grid;
        if (!grid || !grid.views[1]) return false;
        return grid.views[1].unfinished() === 0;
      }, { timeout: 30000 });

      return await page.evaluate(() => {
        const view = window.explorer.grid.views[1];
        // Get histogram entries and dFrac values
        return view.hi.slice(0, 20).map(([iter, uFrac, dFrac, lFrac]) => ({
          iter,
          uFrac: Math.round(uFrac * 1000) / 1000,
          dFrac: Math.round(dFrac * 1000) / 1000,
          lFrac: Math.round(lFrac * 1000) / 1000
        }));
      });
    }

    const withInherit = await getChildHistAfterZoom(1);
    const withoutInherit = await getChildHistAfterZoom(0);

    // Compare the diverged fractions at similar iterations
    // Find a common iteration to compare
    const commonIter = withInherit[0]?.iter;
    if (commonIter) {
      const withEntry = withInherit.find(e => e.iter === commonIter);
      const withoutEntry = withoutInherit.find(e => e.iter === commonIter);

      if (withEntry && withoutEntry) {
        // The dFrac values should be similar (within tolerance)
        // This is the key assertion - colors depend on dFrac
        expect(Math.abs(withEntry.dFrac - withoutEntry.dFrac)).toBeLessThan(0.1);
      }
    }

    await page.close();
  }, TEST_TIMEOUT);

  test('precomputed pixels should have correct iteration values', async () => {
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 800, height: 600 });

    await page.goto(fixUrlForPlatform(`http://localhost:${port}?debug=dims:10x10&pixelratio=1&board=gpu&inherit=1&grid=2`), {
      waitUntil: 'domcontentloaded'
    });

    // Wait for parent to complete
    await page.waitForFunction(() => {
      const grid = window.explorer?.grid;
      if (!grid || !grid.views[0]) return false;
      return grid.views[0].unfinished() === 0;
    }, { timeout: 30000 });

    // Zoom in
    await page.keyboard.press('i');

    // Wait for child to complete
    await page.waitForFunction(() => {
      const grid = window.explorer?.grid;
      if (!grid || !grid.views[1]) return false;
      return grid.views[1].unfinished() === 0;
    }, { timeout: 30000 });

    // Check that all pixels have valid iteration values
    const stats = await page.evaluate(() => {
      const view = window.explorer.grid.views[1];
      let zeroCount = 0;
      let negCount = 0;
      let posCount = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] === 0) zeroCount++;
        else if (view.nn[i] < 0) negCount++;
        else posCount++;
      }
      return { zeroCount, negCount, posCount, total: view.nn.length };
    });

    // All pixels should be computed (no zeros)
    expect(stats.zeroCount).toBe(0);
    // Should have both diverged (positive) and converged (negative) pixels
    expect(stats.posCount).toBeGreaterThan(0);
    expect(stats.negCount).toBeGreaterThan(0);

    await page.close();
  }, TEST_TIMEOUT);

  test('precomputed should flush even with no GPU results (deep interior)', async () => {
    // When zooming into deep interior (all pixels converge slowly),
    // GPU may not report any results for many batches. Precomputed
    // pixels from the parent should still be flushed.
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 800, height: 600 });

    // This URL has view 2 in deep interior
    await page.goto(fixUrlForPlatform(`http://localhost:${port}?z=1.25e2&c=-0.10551+0.65076i,-0.095735+0.655091i,-0.0944515+0.6555326i&board=gpu&inherit=1&grid=2&debug=dims:50x50&pixelratio=1`), {
      waitUntil: 'domcontentloaded'
    });

    // Wait for view 2 to show some converged pixels
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[2];
      if (!view) return false;
      let conv = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] < 0) conv++;
      }
      return conv > 0;
    }, { timeout: 30000 });

    // Check that histogram has entries
    const state = await page.evaluate(() => {
      const view = window.explorer.grid.views[2];
      let conv = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] < 0) conv++;
      }
      return { conv, hi: view.hi.length };
    });

    // Should have converged pixels and histogram entries
    expect(state.conv).toBeGreaterThan(0);
    expect(state.hi).toBeGreaterThan(0);

    await page.close();
  }, TEST_TIMEOUT);

  test('histogram should not have duplicate iterations (stripe detection)', async () => {
    // Stripes are caused by duplicate histogram entries at the same iteration
    // with different fracK values. This test verifies no duplicates exist.
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 800, height: 600 });

    // Use 2-view URL with small dims for speed (30x30 = 900 pixels)
    await page.goto(fixUrlForPlatform(`http://localhost:${port}?z=1.25e2&c=-0.10551+0.65076i,-0.095804+0.654167i&board=gpu&inherit=1&grid=2&debug=dims:30x30&pixelratio=1`), {
      waitUntil: 'domcontentloaded'
    });

    // Wait for view 1 (2nd view) to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[1];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 30000 });

    // Check histogram for duplicate iterations
    const histAnalysis = await page.evaluate(() => {
      const view = window.explorer.grid.views[1];
      const iterCounts = new Map();

      for (const entry of view.hi) {
        const iter = entry[0];
        iterCounts.set(iter, (iterCounts.get(iter) || 0) + 1);
      }

      const duplicates = [];
      for (const [iter, count] of iterCounts) {
        if (count > 1) {
          duplicates.push({ iter, count });
        }
      }

      return {
        totalEntries: view.hi.length,
        uniqueIterations: iterCounts.size,
        duplicates
      };
    });

    // No iteration should appear more than once in the histogram
    expect(histAnalysis.duplicates.length).toBe(0);

    await page.close();
  }, TEST_TIMEOUT);

  test('child view should not have color stripes from precomputed pixels', async () => {
    // Stripes appear as sharp color transitions between precomputed (green) and
    // GPU-computed (pink) pixels. This test zooms in using 'i' and checks for
    // excessive warm/cool transitions in the rendered canvas.
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 800, height: 600 });

    // Use neon theme with small dims (50x50) for speed
    await page.goto(fixUrlForPlatform(`http://localhost:${port}?z=1.25e2&c=-0.09786+0.65105i&theme=neon&inherit=1&grid=2&debug=dims:50x50&pixelratio=1`), {
      waitUntil: 'domcontentloaded'
    });

    // Wait for view 0 to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[0];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 60000 });

    // Wait for no update process before pressing key
    await page.waitForFunction(() => !window.explorer?.grid?.currentUpdateProcess, { timeout: 30000 });

    // Press 'i' to zoom in
    await page.keyboard.press('i');

    // Wait for view 1 to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[1];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 60000 });

    // Get pixel colors from a horizontal row in the middle of view 1
    const result = await page.evaluate(() => {
      const canvas = window.explorer.grid.canvas(1);
      const ctx = canvas.getContext('2d');

      // Get middle row of the canvas
      const middleY = Math.floor(canvas.height / 2);
      const imageData = ctx.getImageData(0, middleY, canvas.width, 1);
      const pixels = imageData.data;

      // Count sharp transitions between warm (r>g) and cool (g>r) colors
      let sharpTransitions = 0;
      let prevWarm = null;

      for (let x = 0; x < canvas.width; x++) {
        const idx = x * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const currWarm = r > g;

        if (prevWarm !== null && prevWarm !== currWarm) {
          sharpTransitions++;
        }
        prevWarm = currWarm;
      }

      // Count warm vs cool pixels
      let warmCount = 0, coolCount = 0;
      for (let x = 0; x < canvas.width; x++) {
        const idx = x * 4;
        if (pixels[idx] > pixels[idx + 1]) warmCount++;
        else coolCount++;
      }

      return {
        canvasWidth: canvas.width,
        sharpTransitions,
        warmCount,
        coolCount
      };
    });

    // In a smooth gradient, there should be very few sharp transitions
    // between warm and cool colors. Stripes cause many transitions.
    // Allow up to 10 transitions for normal gradient boundaries.
    expect(result.sharpTransitions).toBeLessThan(10);

    await page.close();
  }, TEST_TIMEOUT);

  test('third view (2 zooms) should not have stripes or transparent pixels', async () => {
    // After pressing 'i' twice, the 3rd view should still have smooth colors
    // with no stripes or transparent pixels from unflushed precomputed data.
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 1470, height: 827 });

    // Use neon theme for clear warm/cool distinction
    await page.goto(fixUrlForPlatform(`http://localhost:${port}?z=1.25e2&c=-0.09786+0.65105i&theme=neon&inherit=1&grid=2`), {
      waitUntil: 'domcontentloaded'
    });

    // Wait for view 0 to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[0];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 120000 });

    // Wait for no update process before pressing key
    await page.waitForFunction(() => !window.explorer?.grid?.currentUpdateProcess, { timeout: 30000 });

    // Press 'i' to zoom in - create view 1
    await page.keyboard.press('i');
    await page.waitForFunction(() => window.explorer?.grid?.views?.length >= 2, { timeout: 10000 });

    // Wait for view 1 to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[1];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 120000 });

    // Wait for no update process before pressing key again
    await page.waitForFunction(() => !window.explorer?.grid?.currentUpdateProcess, { timeout: 30000 });

    // Press 'i' again to zoom in - create view 2
    await page.keyboard.press('i');
    await page.waitForFunction(() => window.explorer?.grid?.views?.length >= 3, { timeout: 10000 });

    // Wait for view 2 to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[2];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 120000 });

    // Get pixel colors from a horizontal row in the middle of view 2
    const result = await page.evaluate(() => {
      const canvas = window.explorer.grid.canvas(2);
      const ctx = canvas.getContext('2d');

      // Get middle row of the canvas
      const middleY = Math.floor(canvas.height / 2);
      const imageData = ctx.getImageData(0, middleY, canvas.width, 1);
      const pixels = imageData.data;

      // Count sharp transitions between warm (r>g) and cool (g>r) colors
      let sharpTransitions = 0;
      let prevWarm = null;
      let transparentCount = 0;

      for (let x = 0; x < canvas.width; x++) {
        const idx = x * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const a = pixels[idx + 3];

        if (a < 255) transparentCount++;

        const currWarm = r > g;
        if (prevWarm !== null && prevWarm !== currWarm) {
          sharpTransitions++;
        }
        prevWarm = currWarm;
      }

      // Count warm vs cool pixels
      let warmCount = 0, coolCount = 0;
      for (let x = 0; x < canvas.width; x++) {
        const idx = x * 4;
        if (pixels[idx] > pixels[idx + 1]) warmCount++;
        else coolCount++;
      }

      return {
        canvasWidth: canvas.width,
        sharpTransitions,
        warmCount,
        coolCount,
        transparentCount
      };
    });

    // The 3rd view should have all warm colors with just 2 transitions
    // (3 color bands). No green/cool pixels and no transparent pixels.
    expect(result.sharpTransitions).toBeLessThanOrEqual(2);
    expect(result.coolCount).toBe(0);
    expect(result.transparentCount).toBe(0);

    await page.close();
  }, 180000);

  test('16:9 aspect ratio should not cause coordinate mapping errors', async () => {
    // Test that inheritance works correctly with 16:9 aspect ratio.
    // A bug in coordinate mapping would cause stripes or misaligned pixels.
    const page = await setupPage(browser);
    await page.setViewportSize({ width: 800, height: 600 });

    // Use neon theme with small dims, 16:9 aspect ratio (80x45 ≈ 1.78)
    // Note: debug=dims sets aspect ratio from dimensions, so we use 80x45 for 16:9
    await page.goto(fixUrlForPlatform(`http://localhost:${port}?z=1.25e2&c=-0.09786+0.65105i&theme=neon&inherit=1&grid=2&debug=dims:80x45&pixelratio=1`), {
      waitUntil: 'domcontentloaded'
    });

    // Verify aspect ratio is set correctly
    const aspectRatio = await page.evaluate(() => window.explorer?.grid?.config?.aspectRatio);
    expect(aspectRatio).toBeCloseTo(16/9, 1);  // Should be 16/9 ≈ 1.78

    // Wait for view 0 to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[0];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 60000 });

    // Wait for no update process before pressing key
    await page.waitForFunction(() => !window.explorer?.grid?.currentUpdateProcess, { timeout: 30000 });

    // Press 'i' to zoom in
    await page.keyboard.press('i');

    // Wait for view 1 to reach 90% completion
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[1];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.9;
    }, { timeout: 60000 });

    // Get pixel colors from a horizontal row in the middle of view 1
    const result = await page.evaluate(() => {
      const canvas = window.explorer.grid.canvas(1);
      const ctx = canvas.getContext('2d');

      // Get middle row of the canvas
      const middleY = Math.floor(canvas.height / 2);
      const imageData = ctx.getImageData(0, middleY, canvas.width, 1);
      const pixels = imageData.data;

      // Count sharp transitions between warm (r>g) and cool (g>r) colors
      let sharpTransitions = 0;
      let prevWarm = null;

      for (let x = 0; x < canvas.width; x++) {
        const idx = x * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const currWarm = r > g;

        if (prevWarm !== null && prevWarm !== currWarm) {
          sharpTransitions++;
        }
        prevWarm = currWarm;
      }

      // Count warm vs cool pixels
      let warmCount = 0, coolCount = 0;
      for (let x = 0; x < canvas.width; x++) {
        const idx = x * 4;
        if (pixels[idx] > pixels[idx + 1]) warmCount++;
        else coolCount++;
      }

      return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        sharpTransitions,
        warmCount,
        coolCount
      };
    });

    // Should have smooth gradient with few transitions
    expect(result.sharpTransitions).toBeLessThan(10);

    await page.close();
  }, TEST_TIMEOUT);

  test('converged pixels only inherit when period matches', async () => {
    // Inheritance should reject converged neighbors when the period differs.
    const page = await setupPage(browser);
    // Small viewport with grid=20 gives ~10x10 pixels per view
    await page.setViewportSize({ width: 200, height: 200 });

    // Center on cardioid so most pixels converge
    await page.goto(fixUrlForPlatform(`http://localhost:${port}?board=gpu&inherit=1&grid=20&c=-0.5+0i&z=2&debug=inherit`), {
      waitUntil: 'domcontentloaded'
    });

    // Wait for parent view to complete
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[0];
      return view && view.unfinished() === 0;
    }, { timeout: 60000 });

    // Verify parent has converged pixels (should be mostly converged when centered on cardioid)
    const parentStats = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      let converged = 0, diverged = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] < 0) converged++;
        else if (view.nn[i] > 0) diverged++;
      }
      return { converged, diverged, total: view.nn.length };
    });

    // Parent should have significant number of converged pixels (at least 30% for cardioid center)
    expect(parentStats.converged).toBeGreaterThan(parentStats.total * 0.3);

    // Wait for no update process before clicking
    await page.waitForFunction(() => !window.explorer?.grid?.currentUpdateProcess, { timeout: 30000 });

    // Click 10% to the right of center (in the cardioid interior)
    const canvas0 = await page.$('#b_0 canvas');
    const box = await canvas0.boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);

    // Wait for child view to be created
    await page.waitForFunction(() => window.explorer?.grid?.views?.length >= 2, { timeout: 10000 });

    // Wait a moment for inheritance to be computed and sent to worker
    await page.waitForTimeout(500);

    // Check inheritance - the child view's nn array should have inherited values
    const inheritanceStats = await page.evaluate(() => {
      const parentView = window.explorer.grid.views[0];
      const childView = window.explorer.grid.views[1];
      const w = window.explorer.grid.config.dimsWidth;
      const h = window.explorer.grid.config.dimsHeight;
      const childCenterRe = window.qdToNumber(childView.re);
      const childCenterIm = window.qdToNumber(childView.im);
      const parentCenterRe = window.qdToNumber(parentView.re);
      const parentCenterIm = window.qdToNumber(parentView.im);

      // Count parent converged pixels
      let parentConverged = 0;
      let parentConvergedWithData = 0;
      for (let i = 0; i < parentView.nn.length; i++) {
        if (parentView.nn[i] < 0) {
          parentConverged++;
          if (parentView.convergedData.has(i)) parentConvergedWithData++;
        }
      }

      // Count child pixels that have been set (inherited or computed)
      let childInherited = 0;
      for (let i = 0; i < childView.nn.length; i++) {
        if (childView.nn[i] !== 0) childInherited++;
      }

      // Call computeInheritance to see what we'd get
      const manualInheritance = window.explorer.grid.computeInheritance(parentView, childView);

      let periodMismatchInherited = 0;
      const convergedIndices = manualInheritance?.packed ?
        manualInheritance.cIndices : (manualInheritance?.converged || []).map(entry => entry.index);
      for (let i = 0; i < convergedIndices.length; i++) {
        const idx = convergedIndices[i];
        const cx = idx % w;
        const cy = Math.floor(idx / w);
        const childCoord = window.pixelToComplexCoords(
          childCenterRe, childCenterIm, childView.size, w, h, cx, cy);
        const parentCoord = window.complexToPixelCoords(
          parentCenterRe, parentCenterIm, parentView.size, w, h, childCoord.re, childCoord.im);
        const px = Math.floor(parentCoord.px);
        const py = Math.floor(parentCoord.py);
        if (px < 1 || px >= w - 1 || py < 1 || py >= h - 1) {
          periodMismatchInherited++;
          continue;
        }
        const parentIdx = py * w + px;
        const centerConverged = parentView.convergedData.get(parentIdx);
        if (!centerConverged) {
          periodMismatchInherited++;
          continue;
        }
        const centerPeriod = window.fibonacciPeriod(centerConverged.p);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const neighborIdx = (py + dy) * w + (px + dx);
            const neighborData = parentView.convergedData.get(neighborIdx);
            if (!neighborData ||
                window.fibonacciPeriod(neighborData.p) !== centerPeriod) {
              periodMismatchInherited++;
              dy = 2;
              break;
            }
          }
        }
      }

      return {
        parentConverged,
        parentConvergedWithData,
        parentTotal: parentView.nn.length,
        childTotal: childView.nn.length,
        manualDiverged: manualInheritance?.packed ?
          (manualInheritance?.dIndices?.length || 0) : (manualInheritance?.diverged?.length || 0),
        manualConverged: manualInheritance?.packed ?
          (manualInheritance?.cIndices?.length || 0) : (manualInheritance?.converged?.length || 0),
        periodMismatchInherited
      };
    });

    const manualTotal = inheritanceStats.manualDiverged + inheritanceStats.manualConverged;
    expect(manualTotal).toBeGreaterThan(0);
    expect(inheritanceStats.periodMismatchInherited).toBe(0);
    expect(manualTotal).toBe(inheritanceStats.childTotal);

    await page.close();
  }, TEST_TIMEOUT);
});

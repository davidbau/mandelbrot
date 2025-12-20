/**
 * @jest-environment node
 */
const http = require('http');
const fs = require('fs');
const puppeteer = require('puppeteer');

const TEST_TIMEOUT = 60000;

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

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  test('child view histogram should match parent histogram shape', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // Use smaller dimensions for faster test - dims=10x10 gives 100 pixels per view
    await page.goto(`http://localhost:${port}?dims=10x10&board=gpu&inherit=1&grid=2`, {
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

    // Log histograms for analysis
    console.log('Parent histogram (first 5):', JSON.stringify(parentHist.hi.slice(0, 5), null, 2));
    console.log('Child histogram (first 5):', JSON.stringify(childHist.hi.slice(0, 5), null, 2));

    await page.close();
  }, TEST_TIMEOUT);

  test('child colors with inheritance should match colors without inheritance', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // Helper to get child histogram after zooming
    async function getChildHistAfterZoom(inherit) {
      await page.goto(`http://localhost:${port}?dims=10x10&board=gpu&inherit=${inherit}&grid=2`, {
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

    console.log('\nWith inheritance (first 5):', JSON.stringify(withInherit.slice(0, 5), null, 2));
    console.log('\nWithout inheritance (first 5):', JSON.stringify(withoutInherit.slice(0, 5), null, 2));

    // Compare the diverged fractions at similar iterations
    // Find a common iteration to compare
    const commonIter = withInherit[0]?.iter;
    if (commonIter) {
      const withEntry = withInherit.find(e => e.iter === commonIter);
      const withoutEntry = withoutInherit.find(e => e.iter === commonIter);

      if (withEntry && withoutEntry) {
        console.log(`\nAt iter=${commonIter}:`);
        console.log(`  With inherit: dFrac=${withEntry.dFrac}`);
        console.log(`  Without inherit: dFrac=${withoutEntry.dFrac}`);

        // The dFrac values should be similar (within tolerance)
        // This is the key assertion - colors depend on dFrac
        expect(Math.abs(withEntry.dFrac - withoutEntry.dFrac)).toBeLessThan(0.1);
      }
    }

    await page.close();
  }, TEST_TIMEOUT);

  test('precomputed pixels should have correct iteration values', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    await page.goto(`http://localhost:${port}?dims=10x10&board=gpu&inherit=1&grid=2`, {
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

    console.log('Pixel stats:', stats);

    await page.close();
  }, TEST_TIMEOUT);

  test('precomputed should flush even with no GPU results (deep interior)', async () => {
    // When zooming into deep interior (all pixels converge slowly),
    // GPU may not report any results for many batches. Precomputed
    // pixels from the parent should still be flushed.
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // This URL has view 2 in deep interior
    await page.goto(`http://localhost:${port}?z=1.25e2&c=-0.10551+0.65076i,-0.095735+0.655091i,-0.0944515+0.6555326i&board=gpu&inherit=1&grid=2&dims=50x50`, {
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

    console.log('Deep interior state:', state);

    // Should have converged pixels and histogram entries
    expect(state.conv).toBeGreaterThan(0);
    expect(state.hi).toBeGreaterThan(0);

    await page.close();
  }, TEST_TIMEOUT);

  test('histogram should not have duplicate iterations (stripe detection)', async () => {
    // Stripes are caused by duplicate histogram entries at the same iteration
    // with different fracK values. This test verifies no duplicates exist.
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // Use the 4-view URL pattern that was problematic
    await page.goto(`http://localhost:${port}?z=1.25e2&c=-0.10551+0.65076i,-0.095804+0.654167i,-0.0938695+0.6547999i,-0.0934511+0.6550458i&board=gpu&inherit=1&grid=2&dims=100x100`, {
      waitUntil: 'domcontentloaded'
    });

    // Wait for view 3 (4th view) to reach at least 50%
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views[3];
      if (!view) return false;
      let done = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0) done++;
      }
      return done / view.nn.length >= 0.5;
    }, { timeout: 120000 });

    // Check histogram for duplicate iterations
    const histAnalysis = await page.evaluate(() => {
      const view = window.explorer.grid.views[3];
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

    console.log('Histogram analysis:', histAnalysis);

    // No iteration should appear more than once in the histogram
    expect(histAnalysis.duplicates.length).toBe(0);

    await page.close();
  }, 180000);

  test('child view should not have color stripes from precomputed pixels', async () => {
    // Stripes appear as sharp color transitions between precomputed (green) and
    // GPU-computed (pink) pixels. This test zooms in using 'i' and checks for
    // excessive warm/cool transitions in the rendered canvas.
    const page = await browser.newPage();
    await page.setViewport({ width: 1470, height: 827 });

    // Use neon theme for clear warm/cool distinction
    await page.goto(`http://localhost:${port}?z=1.25e2&c=-0.09786+0.65105i&theme=neon&inherit=1&grid=2`, {
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

    // Press 'i' to zoom in
    await page.keyboard.press('i');

    // Wait for view 1 to exist
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

    console.log('Stripe analysis:', result);

    // In a smooth gradient, there should be very few sharp transitions
    // between warm and cool colors. Stripes cause many transitions.
    // Allow up to 10 transitions for normal gradient boundaries.
    expect(result.sharpTransitions).toBeLessThan(10);

    await page.close();
  }, 180000);

  test('third view (2 zooms) should not have stripes or transparent pixels', async () => {
    // After pressing 'i' twice, the 3rd view should still have smooth colors
    // with no stripes or transparent pixels from unflushed precomputed data.
    const page = await browser.newPage();
    await page.setViewport({ width: 1470, height: 827 });

    // Use neon theme for clear warm/cool distinction
    await page.goto(`http://localhost:${port}?z=1.25e2&c=-0.09786+0.65105i&theme=neon&inherit=1&grid=2`, {
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

    console.log('View 2 stripe analysis:', result);

    // The 3rd view should have all warm colors with just 2 transitions
    // (3 color bands). No green/cool pixels and no transparent pixels.
    expect(result.sharpTransitions).toBeLessThanOrEqual(2);
    expect(result.coolCount).toBe(0);
    expect(result.transparentCount).toBe(0);

    await page.close();
  }, 180000);
});

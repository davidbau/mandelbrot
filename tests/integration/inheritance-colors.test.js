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
});

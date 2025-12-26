/**
 * @jest-environment node
 */
const http = require('http');
const fs = require('fs');
const puppeteer = require('puppeteer');

const TEST_TIMEOUT = 60000;

describe('Transparent pixel stripe bug', () => {
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

  test('second view should not have transparent stripes after completion', async () => {
    // This reproduces the bug where the second view has transparent pixel stripes
    // when using unk=transparent and the fast pixel cache path
    const page = await browser.newPage();
    await page.setViewport({ width: 1470, height: 827 });

    // Load the URL that triggers the bug
    await page.goto(`http://localhost:${port}?c=,0.319-0.5176i&unk=transparent`, {
      waitUntil: 'domcontentloaded'
    });

    // Wait for both views to exist
    await page.waitForFunction(() => {
      return window.explorer?.grid?.views?.length >= 2;
    }, { timeout: 30000 });

    // Wait for both views to complete (unfinished() === 0)
    await page.waitForFunction(() => {
      const grid = window.explorer?.grid;
      if (!grid || grid.views.length < 2) return false;
      return grid.views[0].unfinished() === 0 && grid.views[1].unfinished() === 0;
    }, { timeout: 30000 });

    // Check for transparent pixels in both canvases
    const result = await page.evaluate(() => {
      const results = [];

      for (let k = 0; k < 2; k++) {
        const canvas = window.explorer.grid.canvas(k);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;

        let transparentCount = 0;
        let transparentRows = new Set();

        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const idx = (y * canvas.width + x) * 4;
            const alpha = pixels[idx + 3];
            if (alpha < 255) {
              transparentCount++;
              transparentRows.add(y);
            }
          }
        }

        results.push({
          view: k,
          width: canvas.width,
          height: canvas.height,
          totalPixels: canvas.width * canvas.height,
          transparentCount,
          transparentRowCount: transparentRows.size,
          transparentRows: Array.from(transparentRows).sort((a, b) => a - b).slice(0, 20)
        });
      }

      return results;
    });

    // Both views should have no transparent pixels when fully completed
    expect(result[0].transparentCount).toBe(0);
    expect(result[1].transparentCount).toBe(0);

    await page.close();
  }, TEST_TIMEOUT);
});

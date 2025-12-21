const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

(async () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1470, height: 900 });

  await page.goto(`http://localhost:${port}?grid=2&board=gpu`, {
    waitUntil: 'domcontentloaded'
  });

  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && view.unfinished() === 0;
  }, { timeout: 120000 });

  await page.waitForFunction(() => !window.explorer?.grid?.currentUpdateProcess, { timeout: 30000 });

  const clickTargets = [
    { re: -0.75, im: 0, label: '-0.75+0i' },
    { re: 0, im: 1, label: '0+1i' }
  ];

  for (const target of clickTargets) {
    const timing = await page.evaluate(({ re, im }) => {
      const view = window.explorer.grid.views[0];
      const grid = window.explorer.grid;
      const size = view.size / grid.config.zoomfactor;
      const child = grid.makeView(1, size, re, im, true);
      const start = performance.now();
      grid.computeInheritance(view, child);
      const elapsed = performance.now() - start;
      grid.removeView(1);
      view.childView = null;
      return elapsed;
    }, target);
    console.log(`${target.label}: ${timing.toFixed(2)} ms`);
  }

  await browser.close();
  server.close();
})();

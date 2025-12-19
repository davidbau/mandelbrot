/**
 * Debug script to test SparseGpuBoard prototype
 */

const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-webgpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[sparse]') || text.includes('ERROR')) {
      console.log('Console:', text);
    }
  });

  page.on('pageerror', err => console.log('Page error:', err.message));

  // Test the sparse gpu board
  const url = 'file://' + path.join(process.cwd(), 'index.html') +
    '?board=sparse&z=6.25e2&c=-0.06091+0.66869i&grid=1&width=100&height=56';

  console.log('Loading sparse gpu board...');
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });

  // Wait for GPU init
  await page.waitForFunction(() => window.explorer !== undefined, { timeout: 15000 });

  // Wait for some computation
  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && view.di > 100;
  }, { timeout: 30000 });

  const stats = await page.evaluate(() => {
    const view = window.explorer.grid.views[0];
    return {
      boardType: view.boardType,
      di: view.di,
      un: view.un,
      it: view.it
    };
  });

  console.log('Stats:', JSON.stringify(stats, null, 2));

  // Wait for more computation to trigger compaction
  console.log('Waiting for compaction trigger...');
  await page.waitForFunction(() => {
    const view = window.explorer?.grid?.views?.[0];
    return view && view.di > 1000;
  }, { timeout: 30000 }).catch(() => {});

  const finalStats = await page.evaluate(() => {
    const view = window.explorer.grid.views[0];
    return {
      boardType: view.boardType,
      di: view.di,
      un: view.un,
      it: view.it
    };
  });

  console.log('Final stats:', JSON.stringify(finalStats, null, 2));

  await browser.close();
  console.log('SUCCESS: GpuBoard (without sparsity) works');
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

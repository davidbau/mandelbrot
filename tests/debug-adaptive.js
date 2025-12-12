/**
 * Debug script for AdaptiveGpuBoard
 * Run with: node tests/debug-adaptive.js
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function debug() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=metal',
    ]
  });

  try {
    const page = await browser.newPage();

    // Capture console output
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[${type}] ${text}`);
    });

    // Capture errors
    page.on('pageerror', err => {
      console.error('[pageerror]', err.message);
    });

    const cwd = process.cwd();
    const zoom = '1e20';
    const center = '-0.74543+0.11301i';
    const url = `file://${path.join(cwd, 'index.html')}?z=${zoom}&c=${center}&board=adaptive&grid=1&maxiter=500&width=32&height=32`;

    console.log(`Loading: ${url}`);
    await page.goto(url, { waitUntil: 'load' });

    console.log('Waiting for explorer...');
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });

    // Wait for board to initialize
    await new Promise(r => setTimeout(r, 2000));

    // The board runs in a worker, so we can only inspect view properties
    const orbitInfo = await page.evaluate(() => {
      const view = window.explorer?.grid?.views?.[0];
      if (!view) return { error: 'No view' };

      // List available view properties
      const props = Object.keys(view);

      return {
        boardType: view.boardType,
        it: view.it,
        un: view.un,
        di: view.di,
        initialScale: view.initialScale,
        availableProps: props.slice(0, 30),
        // Check if refOrbit exists (it won't, since board is in worker)
        hasRefOrbit: !!view.refOrbit,
        hasRefIterations: view.refIterations !== undefined
      };
    });

    console.log('Reference orbit info:', JSON.stringify(orbitInfo, null, 2));

    // Monitor progress briefly
    const startTime = Date.now();
    const maxWait = 20000; // 20 seconds

    while (Date.now() - startTime < maxWait) {
      const status = await page.evaluate(() => {
        const view = window.explorer?.grid?.views?.[0];
        if (!view) return { error: 'No view' };

        return {
          boardType: view.boardType,
          un: view.un,
          di: view.di,
          it: view.it,
          refIterations: view.refIterations,
          refOrbitEscaped: view.refOrbitEscaped,
          total: view.config?.dimsArea
        };
      });

      console.log(`[${Math.round((Date.now() - startTime) / 1000)}s] Status:`, JSON.stringify(status));

      if (status.un === 0) {
        console.log('Computation complete!');
        break;
      }

      await new Promise(r => setTimeout(r, 3000));
    }

  } finally {
    await browser.close();
  }
}

debug().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

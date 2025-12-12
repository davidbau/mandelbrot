/**
 * Debug script for convergence detection in AdaptiveGpuBoard
 * Run with: node tests/debug-convergence.js
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
      if (type === 'error' || text.includes('Adaptive') || text.includes('convergence')) {
        console.log(`[${type}] ${text}`);
      }
    });

    const cwd = process.cwd();
    const zoom = '5.00e+0';
    const center = '+0.1972+0.5798i';

    // Test with adaptive board
    console.log('=== Testing AdaptiveGpuBoard ===');
    const adaptiveUrl = `file://${path.join(cwd, 'index.html')}?z=${zoom}&c=${center}&board=adaptive&grid=1&maxiter=1000&width=64&height=64`;
    console.log(`Loading: ${adaptiveUrl}`);

    await page.goto(adaptiveUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });

    // Monitor progress with timeout
    const startTime = Date.now();
    const maxWait = 30000;
    let completed = false;

    while (Date.now() - startTime < maxWait) {
      const status = await page.evaluate(() => {
        const view = window.explorer?.grid?.views?.[0];
        if (!view) return { error: 'No view' };
        return {
          boardType: view.boardType,
          un: view.un,
          di: view.di,
          it: view.it,
          total: view.config?.dimsArea,
          refOrbitEscaped: view.refOrbitEscaped,
          refIterations: view.refIterations
        };
      });

      console.log(`[${Math.round((Date.now() - startTime) / 1000)}s] Status:`, JSON.stringify(status));

      if (status.un === 0) {
        completed = true;
        console.log('Computation complete!');
        break;
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    if (!completed) {
      console.log('WARNING: Computation did not complete in time!');
    }

    const adaptiveResult = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = Array.from(view.nn);
      const pp = view.pp ? Array.from(view.pp) : null;

      let diverged = 0, converged = 0;
      const convergentPixels = [];
      const divergentPixels = [];

      for (let i = 0; i < nn.length; i++) {
        if (nn[i] > 0) {
          diverged++;
          if (divergentPixels.length < 5) {
            divergentPixels.push({ i, nn: nn[i], pp: pp ? pp[i] : null });
          }
        } else if (nn[i] < 0) {
          converged++;
          if (convergentPixels.length < 10) {
            convergentPixels.push({ i, nn: nn[i], pp: pp ? pp[i] : null });
          }
        }
      }

      return {
        boardType: view.boardType,
        diverged,
        converged,
        total: nn.length,
        convergentPixels,
        divergentPixels,
        it: view.it
      };
    });

    console.log('Adaptive result:');
    console.log(`  Board type: ${adaptiveResult.boardType}`);
    console.log(`  Diverged: ${adaptiveResult.diverged}/${adaptiveResult.total}`);
    console.log(`  Converged: ${adaptiveResult.converged}/${adaptiveResult.total}`);
    console.log(`  Iterations: ${adaptiveResult.it}`);
    if (adaptiveResult.convergentPixels.length > 0) {
      console.log('  Sample convergent pixels:', JSON.stringify(adaptiveResult.convergentPixels));
    }
    if (adaptiveResult.divergentPixels.length > 0) {
      console.log('  Sample divergent pixels:', JSON.stringify(adaptiveResult.divergentPixels));
    }

    // Test with octzhuoran for comparison
    console.log('\n=== Testing OctZhuoranBoard (reference) ===');
    const octUrl = `file://${path.join(cwd, 'index.html')}?z=${zoom}&c=${center}&board=octzhuoran&grid=1&maxiter=1000&width=64&height=64`;
    console.log(`Loading: ${octUrl}`);

    await page.goto(octUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });

    // Wait for OctZhuoranBoard to complete (may take longer)
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.un === 0;
    }, { timeout: 120000 });

    const octResult = await page.evaluate(() => {
      const view = window.explorer.grid.views[0];
      const nn = Array.from(view.nn);
      const pp = view.pp ? Array.from(view.pp) : null;

      let diverged = 0, converged = 0;
      const convergentPixels = [];
      const divergentPixels = [];

      for (let i = 0; i < nn.length; i++) {
        if (nn[i] > 0) {
          diverged++;
          if (divergentPixels.length < 5) {
            divergentPixels.push({ i, nn: nn[i], pp: pp ? pp[i] : null });
          }
        } else if (nn[i] < 0) {
          converged++;
          if (convergentPixels.length < 10) {
            convergentPixels.push({ i, nn: nn[i], pp: pp ? pp[i] : null });
          }
        }
      }

      return {
        boardType: view.boardType,
        diverged,
        converged,
        total: nn.length,
        convergentPixels,
        divergentPixels,
        it: view.it
      };
    });

    console.log('OctZhuoran result:');
    console.log(`  Board type: ${octResult.boardType}`);
    console.log(`  Diverged: ${octResult.diverged}/${octResult.total}`);
    console.log(`  Converged: ${octResult.converged}/${octResult.total}`);
    console.log(`  Iterations: ${octResult.it}`);
    if (octResult.convergentPixels.length > 0) {
      console.log('  Sample convergent pixels:', JSON.stringify(octResult.convergentPixels));
    }
    if (octResult.divergentPixels.length > 0) {
      console.log('  Sample divergent pixels:', JSON.stringify(octResult.divergentPixels));
    }

    // Compare results
    console.log('\n=== Comparison ===');
    console.log(`Adaptive converged: ${adaptiveResult.converged}, Oct converged: ${octResult.converged}`);
    console.log(`Difference: ${Math.abs(adaptiveResult.converged - octResult.converged)} pixels`);

  } finally {
    await browser.close();
  }
}

debug().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

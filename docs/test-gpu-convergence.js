#!/usr/bin/env node

/**
 * Test script to compare CPU vs GPU convergence behavior
 * Usage: node test-gpu-convergence.js
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function testConvergence() {
  const testUrl = 'file://' + path.resolve(__dirname, 'index.html');
  const testCoords = '?s=1.2288e-8&c=-0.16593473772+1.03996411419i&grid=2&zhuoran=1';

  console.log('Testing convergence at:', testCoords);

  // Launch browser with WebGPU support
  const browser = await puppeteer.launch({
    headless: false, // Set to true for headless mode
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan'
    ]
  });

  try {
    // Test CPU version
    console.log('\n=== Testing CPU (gpu=0) ===');
    const cpuPage = await browser.newPage();
    await cpuPage.goto(testUrl + testCoords + '&gpu=0', { waitUntil: 'networkidle0' });

    // Wait for computation to complete
    await cpuPage.waitForFunction(() => {
      return window.explorer && window.explorer.grid &&
             window.explorer.grid.views.every(view => view && view.un === 0);
    }, { timeout: 120000 });

    const cpuResults = await cpuPage.evaluate(() => {
      const view = window.explorer.grid.views[0];
      if (!view) return null;

      const dims = view.config.dims;
      const dims2 = dims * dims;
      let converged = 0;
      let diverged = 0;
      let unfinished = 0;

      for (let i = 0; i < dims2; i++) {
        if (view.nn[i] < 0) converged++;
        else if (view.nn[i] > 0) diverged++;
        else unfinished++;
      }

      return {
        boardType: view.constructor.name,
        converged,
        diverged,
        unfinished,
        totalIterations: view.it
      };
    });

    console.log('CPU Results:', cpuResults);
    await cpuPage.close();

    // Test GPU version
    console.log('\n=== Testing GPU (gpu=1) ===');
    const gpuPage = await browser.newPage();
    await gpuPage.goto(testUrl + testCoords + '&gpu=1', { waitUntil: 'networkidle0' });

    // Wait for computation to complete
    await gpuPage.waitForFunction(() => {
      return window.explorer && window.explorer.grid &&
             window.explorer.grid.views.every(view => view && view.un === 0);
    }, { timeout: 120000 });

    const gpuResults = await gpuPage.evaluate(() => {
      const view = window.explorer.grid.views[0];
      if (!view) return null;

      const dims = view.config.dims;
      const dims2 = dims * dims;
      let converged = 0;
      let diverged = 0;
      let unfinished = 0;

      for (let i = 0; i < dims2; i++) {
        if (view.nn[i] < 0) converged++;
        else if (view.nn[i] > 0) diverged++;
        else unfinished++;
      }

      return {
        boardType: view.constructor.name,
        converged,
        diverged,
        unfinished,
        totalIterations: view.it
      };
    });

    console.log('GPU Results:', gpuResults);
    await gpuPage.close();

    // Compare results
    console.log('\n=== Comparison ===');
    const convergedDiff = Math.abs(cpuResults.converged - gpuResults.converged);
    const divergedDiff = Math.abs(cpuResults.diverged - gpuResults.diverged);

    console.log(`Converged: CPU=${cpuResults.converged}, GPU=${gpuResults.converged}, Diff=${convergedDiff}`);
    console.log(`Diverged: CPU=${cpuResults.diverged}, GPU=${gpuResults.diverged}, Diff=${divergedDiff}`);

    if (convergedDiff === 0 && divergedDiff === 0) {
      console.log('\n✅ PASS: CPU and GPU results match!');
    } else {
      console.log('\n❌ FAIL: CPU and GPU results differ!');
      process.exit(1);
    }

  } finally {
    await browser.close();
  }
}

testConvergence().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

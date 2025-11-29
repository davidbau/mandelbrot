#!/usr/bin/env node

// Test to reproduce period detection bug in GPU board
// Points in main bulb should have correct period values

const fs = require('fs');
const { JSDOM } = require('jsdom');

// Load the HTML file
const html = fs.readFileSync('index.html', 'utf-8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true
});

const window = dom.window;
const document = window.document;

// Wait for scripts to load
setTimeout(async () => {
  try {
    const config = {
      dims: 32,  // Small board for testing
      exponent: 2,
      batchSize: 100
    };

    // Test point in main cardioid (period 1 region)
    // Point near center: c = -0.5 + 0i (should converge with period 1)
    const testRe = -0.5;
    const testIm = 0.0;
    const size = 0.5;  // Small region around this point

    console.log(`Testing period detection at c = ${testRe} + ${testIm}i`);
    console.log(`Region size: ${size}, dims: ${config.dims}`);
    console.log('');

    // Create CPU board
    console.log('Creating CpuBoard...');
    const cpuBoard = new window.CpuBoard(0, size, testRe, testIm, config, 'cpu-test');

    // Run CPU board to convergence
    let cpuIter = 0;
    while (cpuBoard.unfinished() > 0 && cpuIter < 10000) {
      cpuBoard.iterate();
      cpuIter++;
    }

    console.log(`CPU board finished after ${cpuIter} iterations`);
    console.log(`  Converged: ${cpuBoard.config.dims * cpuBoard.config.dims - cpuBoard.di - cpuBoard.un}`);
    console.log(`  Diverged: ${cpuBoard.di}`);
    console.log(`  Unfinished: ${cpuBoard.un}`);

    // Check period values for converged points
    const cpuPeriods = [];
    for (let i = 0; i < cpuBoard.pp.length; i++) {
      if (cpuBoard.nn[i] < 0 && cpuBoard.pp[i]) {  // Converged
        const p = cpuBoard.pp[i];
        const period = window.figurePeriod(p);
        cpuPeriods.push({ index: i, p, period });
      }
    }

    console.log(`\nCPU Board periods (first 10):`);
    for (let i = 0; i < Math.min(10, cpuPeriods.length); i++) {
      const { index, p, period } = cpuPeriods[i];
      console.log(`  Pixel ${index}: p=${p}, period=${period}`);
    }

    // Get period distribution for CPU
    const cpuPeriodCounts = {};
    cpuPeriods.forEach(({ period }) => {
      cpuPeriodCounts[period] = (cpuPeriodCounts[period] || 0) + 1;
    });
    console.log(`\nCPU Period distribution:`, cpuPeriodCounts);

    // Create GPU board
    console.log('\n\nCreating GpuBoard...');
    const gpuBoard = new window.GpuBoard(0, size, testRe, testIm, config, 'gpu-test');

    // Wait for GPU initialization
    await gpuBoard.gpuInitPromise;

    // Run GPU board to convergence
    let gpuIter = 0;
    while (gpuBoard.unfinished() > 0 && gpuIter < 10000) {
      await gpuBoard.iterate();
      gpuIter++;

      // Give it time to process
      if (gpuIter % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    console.log(`GPU board finished after ${gpuIter} iterations`);
    console.log(`  Converged: ${gpuBoard.config.dims * gpuBoard.config.dims - gpuBoard.di - gpuBoard.un}`);
    console.log(`  Diverged: ${gpuBoard.di}`);
    console.log(`  Unfinished: ${gpuBoard.un}`);

    // Check period values for converged points
    const gpuPeriods = [];
    for (let i = 0; i < gpuBoard.pp.length; i++) {
      if (gpuBoard.nn[i] < 0 && gpuBoard.pp[i]) {  // Converged
        const p = gpuBoard.pp[i];
        const period = window.figurePeriod(p);
        gpuPeriods.push({ index: i, p, period });
      }
    }

    console.log(`\nGPU Board periods (first 10):`);
    for (let i = 0; i < Math.min(10, gpuPeriods.length); i++) {
      const { index, p, period } = gpuPeriods[i];
      console.log(`  Pixel ${index}: p=${p}, period=${period}`);
    }

    // Get period distribution for GPU
    const gpuPeriodCounts = {};
    gpuPeriods.forEach(({ period }) => {
      gpuPeriodCounts[period] = (gpuPeriodCounts[period] || 0) + 1;
    });
    console.log(`\nGPU Period distribution:`, gpuPeriodCounts);

    // Compare
    console.log(`\n\n=== COMPARISON ===`);
    console.log(`CPU periods:`, cpuPeriodCounts);
    console.log(`GPU periods:`, gpuPeriodCounts);

    // Check for differences
    const allPeriods = new Set([...Object.keys(cpuPeriodCounts), ...Object.keys(gpuPeriodCounts)]);
    let hasDifferences = false;
    for (const period of allPeriods) {
      const cpuCount = cpuPeriodCounts[period] || 0;
      const gpuCount = gpuPeriodCounts[period] || 0;
      if (cpuCount !== gpuCount) {
        console.log(`DIFFERENCE: period ${period}: CPU has ${cpuCount}, GPU has ${gpuCount}`);
        hasDifferences = true;
      }
    }

    if (!hasDifferences) {
      console.log('No differences found!');
    }

    process.exit(0);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}, 1000);

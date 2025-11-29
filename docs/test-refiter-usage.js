#!/usr/bin/env node

// Test to measure actual ref_iter usage vs reference orbit length
// This helps determine if we're wasting CPU work extending the reference orbit

const { GpuZhuoranBoard } = require('./index.html');

async function testRefIterUsage() {
  // Board 0 configuration from user's question
  const c_re = -0.6652323;
  const c_im = 0.4601837;
  const dims = 1402;  // This will be large, but let's start with something manageable
  const pixel = 1.369e-7;
  const size = pixel * dims;

  console.log(`Testing ref_iter usage for:`);
  console.log(`  Board 0: GpuZhuoranBoard @ (${c_re.toExponential(9)}, ${c_im.toExponential(9)})`);
  console.log(`  dims=${dims}, pixel=${pixel.toExponential(3)}`);
  console.log('');

  // For testing, use smaller dims to avoid GPU issues
  const testDims = 32;
  console.log(`Note: Using dims=${testDims} for testing (full ${dims}x${dims} would be too large)`);
  console.log('');

  const config = {
    dims: testDims,
    dims2: testDims * testDims,
    exponent: 2,
    batchSize: 100
  };

  const board = new GpuZhuoranBoard(0, size, c_re, c_im, config, 'test');

  // Initialize GPU (would need WebGPU context in real implementation)
  // For now, let's create a modified version that logs the data we need

  console.log('This test requires browser WebGPU context.');
  console.log('Instead, let me create a diagnostic version that can be run in the browser console.');
  console.log('');
  console.log('To measure ref_iter usage in the browser, add this to GpuZhuoranBoard.compute():');
  console.log('');
  console.log('```javascript');
  console.log('// After reading refIterAndCheckpoint buffer:');
  console.log('if (refIterData && this.it > 0 && this.it % 10000 === 0) {');
  console.log('  let maxRefIter = 0;');
  console.log('  for (let i = 0; i < dims2; i++) {');
  console.log('    if (!this.nn[i]) {  // Only check active pixels');
  console.log('      const refIter = refIterData[i * 2];');
  console.log('      maxRefIter = Math.max(maxRefIter, refIter);');
  console.log('    }');
  console.log('  }');
  console.log('  const efficiency = ((maxRefIter / this.refIterations) * 100).toFixed(1);');
  console.log('  console.log(`RefIter usage at it=${this.it}: max=${maxRefIter}, total=${this.refIterations}, efficiency=${efficiency}%`);');
  console.log('}');
  console.log('```');
}

testRefIterUsage();

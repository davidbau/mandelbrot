// Test to verify iteration count discrepancies between board implementations
// At point -0.7501512+0.0845409i:
// - CpuBoard should report 38 iterations
// - GpuBoard reports 39 iterations (off by +1)
// - GpuZhuoranBoard reports 37 iterations (off by -1)

const fs = require('fs');
const { JSDOM } = require('jsdom');

// Load and setup the HTML environment
const html = fs.readFileSync('./index.html', 'utf-8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
const window = dom.window;
global.document = window.document;
global.window = window;
global.navigator = window.navigator;

// Evaluate the script content
const scriptContent = html.match(/<script>([\s\S]*?)<\/script>/)[1];
eval(scriptContent);

async function testIterationCounts() {
  const testPoint = { re: -0.7501512, im: 0.0845409 };
  const size = 0.0001;  // Small region around the point
  const dims = 3;  // Small board for testing
  const config = { dims, dims2: dims * dims, exponent: 2 };

  console.log(`Testing iteration counts at point ${testPoint.re} + ${testPoint.im}i`);
  console.log('Expected: CpuBoard = 38 iterations\n');

  // Test CpuBoard
  console.log('Testing CpuBoard...');
  const cpuBoard = new CpuBoard(0, size, testPoint.re, testPoint.im, config, 'cpu-test');

  // Run until center pixel converges or diverges
  const centerIdx = Math.floor(dims / 2) * dims + Math.floor(dims / 2);
  let maxIter = 100;
  while (cpuBoard.nn[centerIdx] === 0 && cpuBoard.it < maxIter) {
    cpuBoard.iterate();
  }

  const cpuResult = cpuBoard.nn[centerIdx];
  console.log(`CpuBoard: ${cpuResult} iterations`);
  console.log(`  (it=${cpuBoard.it}, converged=${cpuResult < 0 ? 'yes' : 'no'})`);

  // Test GpuBoard
  console.log('\nTesting GpuBoard...');
  const gpuBoard = new GpuBoard(0, size, testPoint.re, testPoint.im, config, 'gpu-test');

  // Wait for GPU initialization
  await gpuBoard.gpuInitPromise;

  // Run until center pixel finishes
  maxIter = 100;
  while (gpuBoard.un > 0 && gpuBoard.it < maxIter) {
    await gpuBoard.compute();
    gpuBoard.it += gpuBoard.effort;
  }

  const gpuResult = gpuBoard.nn[centerIdx];
  console.log(`GpuBoard: ${gpuResult} iterations`);
  console.log(`  (it=${gpuBoard.it}, converged=${gpuResult < 0 ? 'yes' : 'no'})`);

  // Test GpuZhuoranBoard
  console.log('\nTesting GpuZhuoranBoard...');
  const zhuoranBoard = new GpuZhuoranBoard(0, size, testPoint.re, testPoint.im, config, 'zhuoran-test');

  // Wait for GPU initialization
  await zhuoranBoard.gpuInitPromise;

  // Run until center pixel finishes
  maxIter = 100;
  while (zhuoranBoard.un > 0 && zhuoranBoard.it < maxIter) {
    await zhuoranBoard.compute();
    zhuoranBoard.it += zhuoranBoard.effort;
  }

  const zhuoranResult = zhuoranBoard.nn[centerIdx];
  console.log(`GpuZhuoranBoard: ${zhuoranResult} iterations`);
  console.log(`  (it=${zhuoranBoard.it}, converged=${zhuoranResult < 0 ? 'yes' : 'no'})`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`CpuBoard:        ${cpuResult} iterations`);
  console.log(`GpuBoard:        ${gpuResult} iterations (diff: ${gpuResult - cpuResult})`);
  console.log(`GpuZhuoranBoard: ${zhuoranResult} iterations (diff: ${zhuoranResult - cpuResult})`);

  process.exit(0);
}

testIterationCounts().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

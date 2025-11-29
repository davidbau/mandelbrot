#!/usr/bin/env node

// Test that convergence detection works across rebases
// Tests the user-reported region: s=3.072e-7&c=-0.1666193416+1.0423928039i,-0.1666193570+1.0423928116i&grid=8

const fs = require('fs');
const { JSDOM } = require('jsdom');

// Read index.html
const html = fs.readFileSync('./index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only' });
const window = dom.window;

// Extract ZhuoranBoard class from the page
const scriptContent = Array.from(dom.window.document.scripts)
  .map(s => s.textContent)
  .join('\n');

// Create a minimal execution context
const contextCode = `
${scriptContent}

// Export the classes we need
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ZhuoranBoard, CpuBoard };
}
`;

// Execute in a new context
const vm = require('vm');
const sandbox = {
  console,
  Math,
  Array,
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint32Array,
  module: { exports: {} },
  require
};
vm.createContext(sandbox);
vm.runInContext(contextCode, sandbox);

const { ZhuoranBoard, CpuBoard } = sandbox.module.exports;

// Test parameters from user report
const size = 3.072e-7;
const centerRe1 = -0.1666193416;
const centerIm1 = 1.0423928039;
const centerRe2 = -0.1666193570;
const centerIm2 = 1.0423928116;
const gridSize = 8;

const config = {
  exponent: 2,
  dims: gridSize,
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

console.log('='.repeat(80));
console.log('Testing Rebase Convergence Fix');
console.log('='.repeat(80));
console.log(`Region: s=${size}, center=${centerRe1}+${centerIm1}i to ${centerRe2}+${centerIm2}i`);
console.log(`Grid: ${gridSize}x${gridSize} = ${gridSize * gridSize} pixels\n`);

// Function to test a board
function testBoard(BoardClass, name, centerRe, centerIm) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${name} - Center: ${centerRe}+${centerIm}i`);
  console.log('='.repeat(80));

  const board = new BoardClass(0, size, centerRe, centerIm, config, 'test');
  const maxIters = 10000;

  for (let i = 0; i < maxIters && board.un > 0; i++) {
    board.iterate();
  }

  const convergedCount = board.nn.filter(n => n < 0).length;
  const divergedCount = board.nn.filter(n => n > 0).length;
  const unfinishedCount = board.un;

  console.log(`\nResults after ${maxIters} iterations:`);
  console.log(`  Converged:  ${convergedCount} pixels (${(convergedCount/64*100).toFixed(1)}%)`);
  console.log(`  Diverged:   ${divergedCount} pixels (${(divergedCount/64*100).toFixed(1)}%)`);
  console.log(`  Unfinished: ${unfinishedCount} pixels`);

  // Analyze pixel distribution
  const pixelTypes = new Map();
  for (let i = 0; i < gridSize * gridSize; i++) {
    const x = i % gridSize;
    const y = Math.floor(i / gridSize);
    const type = board.nn[i] < 0 ? 'CONV' : board.nn[i] > 0 ? 'DIV' : 'UNF';
    if (!pixelTypes.has(type)) pixelTypes.set(type, []);
    pixelTypes.get(type).push({ i, x, y, nn: board.nn[i] });
  }

  // Show spatial distribution
  console.log('\nSpatial distribution:');
  for (let y = 0; y < gridSize; y++) {
    let row = '';
    for (let x = 0; x < gridSize; x++) {
      const i = y * gridSize + x;
      const nn = board.nn[i];
      row += nn < 0 ? 'C' : nn > 0 ? 'D' : '?';
      row += ' ';
    }
    console.log(`  ${row}`);
  }
  console.log('  (C=Converged, D=Diverged, ?=Unfinished)\n');

  return { convergedCount, divergedCount, unfinishedCount };
}

// Test CpuBoard (reference - should work perfectly)
const cpuResult = testBoard(CpuBoard, 'CpuBoard (Reference)', centerRe1, centerIm1);

// Test ZhuoranBoard at reference point (should work - small dz)
const zhuoran1 = testBoard(ZhuoranBoard, 'ZhuoranBoard Near Reference', centerRe1, centerIm1);

// Test ZhuoranBoard far from reference (this is where the bug was!)
const zhuoran2 = testBoard(ZhuoranBoard, 'ZhuoranBoard Far From Reference', centerRe2, centerIm2);

// Analysis
console.log('\n' + '='.repeat(80));
console.log('ANALYSIS');
console.log('='.repeat(80));

console.log('\n1. CpuBoard (Reference - uses quad precision):');
console.log(`   Converged: ${cpuResult.convergedCount}/64 pixels`);
console.log('   Status: This is our ground truth - should detect convergence everywhere');

console.log('\n2. ZhuoranBoard Near Reference Point:');
console.log(`   Converged: ${zhuoran1.convergedCount}/64 pixels`);
if (zhuoran1.convergedCount >= cpuResult.convergedCount * 0.8) {
  console.log('   ✅ GOOD: Detects convergence near reference point');
} else {
  console.log('   ❌ PROBLEM: Should match CpuBoard near reference');
}

console.log('\n3. ZhuoranBoard Far From Reference Point:');
console.log(`   Converged: ${zhuoran2.convergedCount}/64 pixels`);
if (zhuoran2.convergedCount >= cpuResult.convergedCount * 0.8) {
  console.log('   ✅ FIX VERIFIED: Convergence now works far from reference!');
  console.log('   The checkpoint preservation across rebases is working correctly.');
} else {
  console.log('   ❌ BUG STILL PRESENT: Convergence lost far from reference');
  console.log('   Pixels far from reference rebase frequently and lose checkpoint history.');
}

console.log('\n' + '='.repeat(80));
console.log('CONCLUSION');
console.log('='.repeat(80));

const fixWorks = zhuoran2.convergedCount >= cpuResult.convergedCount * 0.8;
if (fixWorks) {
  console.log('✅ SUCCESS: The rebase convergence fix is working!');
  console.log('   - Checkpoints are preserved across rebases');
  console.log('   - Convergence detection resumes when |dz| shrinks back to small values');
  console.log('   - Periodic orbits detected everywhere, not just near reference point');
} else {
  console.log('❌ FAILURE: The fix did not resolve the issue.');
  console.log('   Further investigation needed.');
}

console.log('\n');

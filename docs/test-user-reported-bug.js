#!/usr/bin/env node

// Test the exact scenario the user reported
// s=6.144e-8&c=-0.1666193570+1.0423928116i&grid=8

const { CpuBoard, ZhuoranBoard } = require('./test-convergence.js');

const size = 6.144e-8;
const centerRe = -0.1666193570;
const centerIm = 1.0423928116;
const gridSize = 8;  // This creates an 8x8 grid = 64 pixels

const config = {
  exponent: 2,
  dims: gridSize,
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

console.log('Testing user-reported bug scenario');
console.log(`Region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}`);
console.log(`Total pixels: ${gridSize * gridSize}\n`);

// Test ZhuoranBoard (CPU perturbation - matches browser's cpu=1&zhuoran=1)
console.log('='.repeat(80));
console.log('ZhuoranBoard (CPU perturbation with float32):');
console.log('='.repeat(80));

const board = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'test');
const maxIters = 10000;

for (let i = 0; i < maxIters && board.un > 0; i++) {
  board.iterate();
}

const convergedCount = board.nn.filter(n => n < 0).length;
const divergedCount = board.nn.filter(n => n > 0).length;
const unfinishedCount = board.un;

console.log(`\nFinal results after ${maxIters} iterations:`);
console.log(`  Converged:  ${convergedCount} pixels`);
console.log(`  Diverged:   ${divergedCount} pixels`);
console.log(`  Unfinished: ${unfinishedCount} pixels`);

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS:');
console.log('='.repeat(80));

if (divergedCount === 0) {
  console.log('❌ BUG REPRODUCED: No divergence detected!');
  console.log('   This matches the user\'s report that the browser shows no divergent pixels.');
} else {
  console.log(`✅ Divergence IS being detected (${divergedCount} pixels)`);
  console.log('   The browser issue must be something else.');
}

if (convergedCount === 0) {
  console.log('❌ PROBLEM: No convergence detected!');
} else {
  console.log(`✅ Convergence is working (${convergedCount} pixels)`);
}

console.log('\n' + '='.repeat(80));
console.log('Sample pixels:');
console.log('='.repeat(80));

// Show a sample of each type
const converged = [];
const diverged = [];
const unfinished = [];

for (let i = 0; i < gridSize * gridSize; i++) {
  if (board.nn[i] < 0) converged.push(i);
  else if (board.nn[i] > 0) diverged.push(i);
  else unfinished.push(i);
}

console.log(`\nConverged pixels (showing first 5 of ${converged.length}):`);
converged.slice(0, 5).forEach(i => {
  const x = i % gridSize;
  const y = Math.floor(i / gridSize);
  console.log(`  Pixel ${i} (${x},${y}): nn=${board.nn[i]} (converged at iter ${-board.nn[i]})`);
});

console.log(`\nDiverged pixels (showing first 5 of ${diverged.length}):`);
diverged.slice(0, 5).forEach(i => {
  const x = i % gridSize;
  const y = Math.floor(i / gridSize);
  console.log(`  Pixel ${i} (${x},${y}): nn=${board.nn[i]} (diverged at iter ${board.nn[i]})`);
});

console.log(`\nUnfinished pixels (showing all ${unfinished.length}):`);
unfinished.forEach(i => {
  const x = i % gridSize;
  const y = Math.floor(i / gridSize);
  console.log(`  Pixel ${i} (${x},${y}): nn=${board.nn[i]} (still computing)`);
});

console.log('\n' + '='.repeat(80));

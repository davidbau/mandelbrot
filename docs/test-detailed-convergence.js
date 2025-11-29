#!/usr/bin/env node

// Test with detailed logging to see what's actually happening

const { CpuBoard, ZhuoranBoard } = require('./test-convergence.js');

const size = 6.144e-8;
const centerRe = -0.1666193570;
const centerIm = 1.0423928116;
const gridSize = 8;

const config = {
  exponent: 2,
  dims: gridSize,
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

console.log('Testing with detailed convergence logging');
console.log(`Region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}\n`);

// Run CpuBoard with detailed logging
console.log('='.repeat(80));
console.log('CpuBoard (naive double-precision):');
console.log('='.repeat(80));

const cpuBoard = new CpuBoard(0, size, centerRe, centerIm, config, 'cpu');
const maxIters = 10000;

let cpuConvergedCount = 0;
let cpuDivergedCount = 0;

for (let i = 0; i < maxIters && cpuBoard.un > 0; i++) {
  const prevConverged = cpuBoard.nn.filter(n => n < 0).length;
  const prevDiverged = cpuBoard.nn.filter(n => n > 0).length;

  cpuBoard.iterate();

  const newConverged = cpuBoard.nn.filter(n => n < 0).length;
  const newDiverged = cpuBoard.nn.filter(n => n > 0).length;

  if (newConverged > prevConverged || newDiverged > prevDiverged) {
    console.log(`  Iter ${i}: converged=${newConverged} (+${newConverged - prevConverged}), diverged=${newDiverged} (+${newDiverged - prevDiverged}), unfinished=${cpuBoard.un}`);
  }

  cpuConvergedCount = newConverged;
  cpuDivergedCount = newDiverged;
}

console.log(`\nFinal CPU: converged=${cpuConvergedCount}, diverged=${cpuDivergedCount}, unfinished=${cpuBoard.un}\n`);

// Show sample pixels
console.log('Sample CPU pixels (first 10):');
for (let i = 0; i < Math.min(10, gridSize * gridSize); i++) {
  const status = cpuBoard.nn[i] < 0 ? 'converged' : cpuBoard.nn[i] > 0 ? 'diverged' : 'unfinished';
  console.log(`  Pixel ${i}: nn=${cpuBoard.nn[i]} (${status})`);
}

// Run ZhuoranBoard with detailed logging
console.log('\n' + '='.repeat(80));
console.log('ZhuoranBoard (CPU perturbation with float32):');
console.log('='.repeat(80));

const zhuoranBoard = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'zhuoran');

let zhuoranConvergedCount = 0;
let zhuoranDivergedCount = 0;

for (let i = 0; i < maxIters && zhuoranBoard.un > 0; i++) {
  const prevConverged = zhuoranBoard.nn.filter(n => n < 0).length;
  const prevDiverged = zhuoranBoard.nn.filter(n => n > 0).length;

  zhuoranBoard.iterate();

  const newConverged = zhuoranBoard.nn.filter(n => n < 0).length;
  const newDiverged = zhuoranBoard.nn.filter(n => n > 0).length;

  if (newConverged > prevConverged || newDiverged > prevDiverged) {
    console.log(`  Iter ${i}: converged=${newConverged} (+${newConverged - prevConverged}), diverged=${newDiverged} (+${newDiverged - prevDiverged}), unfinished=${zhuoranBoard.un}`);
  }

  zhuoranConvergedCount = newConverged;
  zhuoranDivergedCount = newDiverged;
}

console.log(`\nFinal Zhuoran: converged=${zhuoranConvergedCount}, diverged=${zhuoranDivergedCount}, unfinished=${zhuoranBoard.un}\n`);

// Show sample pixels
console.log('Sample Zhuoran pixels (first 10):');
for (let i = 0; i < Math.min(10, gridSize * gridSize); i++) {
  const status = zhuoranBoard.nn[i] < 0 ? 'converged' : zhuoranBoard.nn[i] > 0 ? 'diverged' : 'unfinished';
  console.log(`  Pixel ${i}: nn=${zhuoranBoard.nn[i]} (${status})`);
}

// Compare
console.log('\n' + '='.repeat(80));
console.log('COMPARISON:');
console.log('='.repeat(80));

let mismatches = 0;
const totalPixels = gridSize * gridSize;

for (let i = 0; i < totalPixels; i++) {
  const cpuStatus = cpuBoard.nn[i] < 0 ? 'converged' : cpuBoard.nn[i] > 0 ? 'diverged' : 'unfinished';
  const zhuoranStatus = zhuoranBoard.nn[i] < 0 ? 'converged' : zhuoranBoard.nn[i] > 0 ? 'diverged' : 'unfinished';

  if (cpuStatus !== zhuoranStatus) {
    mismatches++;
    const x = i % gridSize;
    const y = Math.floor(i / gridSize);
    console.log(`Pixel ${i} (${x},${y}): CPU=${cpuStatus}, Zhuoran=${zhuoranStatus}`);
    console.log(`  CPU nn=${cpuBoard.nn[i]}, Zhuoran nn=${zhuoranBoard.nn[i]}`);
  }
}

console.log('\n' + '='.repeat(80));
if (mismatches === 0) {
  console.log('✅ PASS: All pixels match!');
  console.log(`   CPU:     Converged=${cpuConvergedCount}, Diverged=${cpuDivergedCount}`);
  console.log(`   Zhuoran: Converged=${zhuoranConvergedCount}, Diverged=${zhuoranDivergedCount}`);
} else {
  console.log(`❌ FAIL: ${mismatches} pixels differ`);
  process.exit(1);
}
console.log('='.repeat(80));

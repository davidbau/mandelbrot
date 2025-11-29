#!/usr/bin/env node

// Test that ZhuoranBoard (float32) matches CpuBoard (double) pixel-by-pixel

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

console.log('Testing pixel-by-pixel match between CpuBoard and ZhuoranBoard');
console.log(`Region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}\n`);

// Run CpuBoard
const cpuBoard = new CpuBoard(0, size, centerRe, centerIm, config, 'cpu');
const maxIters = 10000;
for (let i = 0; i < maxIters && cpuBoard.un > 0; i++) {
  cpuBoard.iterate();
}

// Run ZhuoranBoard
const zhuoranBoard = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'zhuoran');
for (let i = 0; i < maxIters && zhuoranBoard.un > 0; i++) {
  zhuoranBoard.iterate();
}

// Compare pixel by pixel
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
  console.log('✅ PASS: All pixels match between CpuBoard and ZhuoranBoard!');
  console.log(`   Converged: ${cpuBoard.nn.filter(n => n < 0).length}`);
  console.log(`   Diverged: ${cpuBoard.nn.filter(n => n > 0).length}`);
  console.log(`   Unfinished: ${cpuBoard.nn.filter(n => n === 0).length}`);
} else {
  console.log(`❌ FAIL: ${mismatches} pixels differ between CpuBoard and ZhuoranBoard`);
  process.exit(1);
}
console.log('='.repeat(80));

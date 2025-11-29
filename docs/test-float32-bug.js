#!/usr/bin/env node

// Test script to reproduce the "crazy convergence" bug
// Tests the problematic region: s=6.144e-8&c=-0.1666193570+1.0423928116i&grid=8

// Import Board classes from existing test script
const { CpuBoard, ZhuoranBoard, Board } = require('./test-convergence.js');

// Test configuration for the problematic region
const size = 6.144e-8;
const centerRe = -0.1666193570;
const centerIm = 1.0423928116;
const gridSize = 8;

const config = {
  exponent: 2,
  dims: gridSize,
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

console.log('='.repeat(80));
console.log('FLOAT32 CONVERGENCE BUG TEST');
console.log('='.repeat(80));
console.log(`Testing region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}`);
console.log('');

// Test with CpuBoard (double precision, correct)
console.log('Running CpuBoard (double precision, should be correct)...');
const cpuBoard = new CpuBoard(0, size, centerRe, centerIm, config, 'cpu');

const maxIters = 10000;
for (let i = 0; i < maxIters && cpuBoard.un > 0; i++) {
  cpuBoard.iterate();
}

console.log(`CpuBoard after ${maxIters} iterations:`);
console.log(`  Unfinished: ${cpuBoard.un}`);
console.log(`  Diverged: ${cpuBoard.di}`);
console.log(`  Converged: ${gridSize * gridSize - cpuBoard.un - cpuBoard.di}`);

// Count converged pixels
let cpuConvergedCount = 0;
const cpuConvergedPixels = [];
for (let i = 0; i < cpuBoard.nn.length; i++) {
  if (cpuBoard.nn[i] < 0) {
    cpuConvergedCount++;
    cpuConvergedPixels.push(i);
  }
}

console.log(`  Converged pixels: ${cpuConvergedCount}`);

// Test with ZhuoranBoard (float32 via Math.fround(), reproduces GPU bug)
console.log('\nRunning ZhuoranBoard (float32 via Math.fround(), reproduces GPU bug)...');
const zhuoranBoard = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'zhuoran');

for (let i = 0; i < maxIters && zhuoranBoard.un > 0; i++) {
  zhuoranBoard.iterate();
}

console.log(`ZhuoranBoard after ${maxIters} iterations:`);
console.log(`  Unfinished: ${zhuoranBoard.un}`);
console.log(`  Diverged: ${zhuoranBoard.di}`);
console.log(`  Converged: ${gridSize * gridSize - zhuoranBoard.un - zhuoranBoard.di}`);

// Count converged pixels
let zhuoranConvergedCount = 0;
const zhuoranConvergedPixels = [];
for (let i = 0; i < zhuoranBoard.nn.length; i++) {
  if (zhuoranBoard.nn[i] < 0) {
    zhuoranConvergedCount++;
    zhuoranConvergedPixels.push(i);
  }
}

console.log(`  Converged pixels: ${zhuoranConvergedCount}`);

// Compare results
console.log('\n' + '='.repeat(80));
console.log('COMPARISON');
console.log('='.repeat(80));

const falseConvergence = zhuoranConvergedCount - cpuConvergedCount;
if (falseConvergence > 0) {
  console.log(`\nBUG CONFIRMED: ${falseConvergence} pixels falsely converged in ZhuoranBoard!`);
  console.log(`Expected: ${cpuConvergedCount} converged`);
  console.log(`Got: ${zhuoranConvergedCount} converged`);

  // Find which pixels falsely converged
  const falsePixels = zhuoranConvergedPixels.filter(i => !cpuConvergedPixels.includes(i));
  console.log(`\nFalsely converged pixels: ${falsePixels.join(', ')}`);

  // Analyze a few false convergence cases
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED ANALYSIS OF FALSE CONVERGENCES');
  console.log('='.repeat(80));

  const samplesToAnalyze = Math.min(3, falsePixels.length);
  for (let s = 0; s < samplesToAnalyze; s++) {
    const pixelIndex = falsePixels[s];
    const x = pixelIndex % gridSize;
    const y = Math.floor(pixelIndex / gridSize);
    const xFrac = (x / gridSize - 0.5);
    const yFrac = (0.5 - y / gridSize);
    const cr = centerRe + xFrac * size;
    const ci = centerIm + yFrac * size;

    console.log(`\nPixel ${pixelIndex} at grid (${x}, ${y}), c = ${cr} + ${ci}i:`);
    console.log(`  CpuBoard: ${cpuBoard.nn[pixelIndex] > 0 ? 'diverged' : cpuBoard.nn[pixelIndex] < 0 ? 'converged' : 'unfinished'} at iter ${Math.abs(cpuBoard.nn[pixelIndex])}`);
    console.log(`  ZhuoranBoard: converged at iter ${-zhuoranBoard.nn[pixelIndex]}`);
    console.log(`  Period detected: ${zhuoranBoard.pp[pixelIndex]}`);

    // Get checkpoint values
    const index2 = pixelIndex * 2;
    const ckptR = zhuoranBoard.bb[index2];
    const ckptI = zhuoranBoard.bb[index2 + 1];
    const ckptMag = Math.sqrt(ckptR * ckptR + ckptI * ckptI);

    console.log(`  Checkpoint: [${ckptR}, ${ckptI}]`);
    console.log(`  Checkpoint magnitude: ${ckptMag}`);
    console.log(`  Checkpoint set at iter: ${zhuoranBoard.checkpointIter[pixelIndex]}`);

    // Estimate precision loss
    const float32Precision = 1.0 / (1 << 23);  // ~1.2e-7
    const expectedError = ckptMag * float32Precision;
    console.log(`  Float32 expected error: ~${expectedError.toExponential(2)}`);
    console.log(`  Epsilon threshold: ${zhuoranBoard.epsilon.toExponential(2)}`);

    if (expectedError >= zhuoranBoard.epsilon) {
      console.log(`  *** DIAGNOSIS: Float32 precision error (${expectedError.toExponential(2)}) exceeds epsilon! ***`);
    }
  }
} else {
  console.log('\nNo false convergences detected. The bug may not reproduce in this region.');
}

console.log('\n' + '='.repeat(80));

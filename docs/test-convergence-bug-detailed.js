#!/usr/bin/env node

// Comprehensive test to demonstrate the float32 convergence bug
// Tests the region where checkpoints have large magnitudes

// Import Board classes
const { CpuBoard, ZhuoranBoard } = require('./test-convergence.js');

console.log('='.repeat(80));
console.log('FLOAT32 CONVERGENCE BUG - DETAILED ANALYSIS');
console.log('='.repeat(80));

// Test configuration for a region where |z| grows large
// s=6.144e-8&c=-0.1666193570+1.0423928116i is in a period bulb
const size = 6.144e-8;
const centerRe = -0.1666193570;
const centerIm = 1.0423928116;

const config = {
  exponent: 2,
  dims: 1,  // Single pixel test
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

// Test a point in the center
const pixelRe = centerRe;
const pixelIm = centerIm;

console.log(`\nTest point: c = ${pixelRe} + ${pixelIm}i`);
console.log(`Region size: ${size}`);

// Test with CpuBoard (double precision, should find convergence correctly)
console.log('\n' + '-'.repeat(80));
console.log('Testing with CpuBoard (double precision, correct)');
console.log('-'.repeat(80));

const cpuBoard = new CpuBoard(0, size, pixelRe, pixelIm, config, 'cpu');

// Run with instrumentation
let cpuCheckpointIters = [];
let cpuCheckpointMagnitudes = [];
let cpuConvergenceIter = null;

const maxIters = 10000;
for (let i = 0; i < maxIters && cpuBoard.un > 0; i++) {
  // Check if checkpoint was updated (before iterate)
  const iter = cpuBoard.it;
  if (i > 0 && cpuBoard.bb[0] !== undefined) {
    const bbr = cpuBoard.bb[0];
    const bbi = cpuBoard.bb[1];
    const bbMag = Math.sqrt(bbr * bbr + bbi * bbi);
    if (cpuCheckpointMagnitudes.length === 0 ||
        Math.abs(bbr - cpuCheckpointMagnitudes[cpuCheckpointMagnitudes.length - 1].bbr) > 1e-10) {
      cpuCheckpointIters.push(iter);
      cpuCheckpointMagnitudes.push({ iter, bbr, bbi, mag: bbMag });
    }
  }

  cpuBoard.iterate();

  if (cpuBoard.nn[0] < 0 && !cpuConvergenceIter) {
    cpuConvergenceIter = -cpuBoard.nn[0];
  }
}

console.log(`\nCpuBoard results:`);
console.log(`  Converged: ${cpuBoard.nn[0] < 0 ? 'YES' : 'NO'}`);
if (cpuBoard.nn[0] < 0) {
  console.log(`  Convergence iteration: ${cpuConvergenceIter}`);
  console.log(`  Period: ${cpuBoard.pp[0]}`);
}
console.log(`  Checkpoints set: ${cpuCheckpointMagnitudes.length}`);

if (cpuCheckpointMagnitudes.length > 0) {
  console.log(`\n  Last 5 checkpoints:`);
  const lastCheckpoints = cpuCheckpointMagnitudes.slice(-5);
  lastCheckpoints.forEach((ckpt, i) => {
    console.log(`    [${cpuCheckpointMagnitudes.length - 5 + i}] iter=${ckpt.iter}, mag=${ckpt.mag.toExponential(3)}`);
  });

  const maxMag = Math.max(...cpuCheckpointMagnitudes.map(c => c.mag));
  console.log(`\n  Maximum checkpoint magnitude: ${maxMag.toExponential(3)}`);

  // Analyze precision requirements
  const float32Precision = 1.0 / (1 << 23);
  const precisionAtMaxMag = maxMag * float32Precision;
  console.log(`\n  Float32 precision at max magnitude:`);
  console.log(`    Absolute precision: ${precisionAtMaxMag.toExponential(3)}`);
  console.log(`    Epsilon threshold: ${cpuBoard.epsilon.toExponential(3)}`);
  console.log(`    Precision vs epsilon: ${(precisionAtMaxMag / cpuBoard.epsilon).toFixed(2)}x`);

  if (precisionAtMaxMag > cpuBoard.epsilon) {
    console.log(`\n  *** WARNING: Float32 precision (${precisionAtMaxMag.toExponential(2)}) exceeds epsilon! ***`);
    console.log(`      This will cause FALSE CONVERGENCE with float32!`);
  }
}

// Now test with ZhuoranBoard (which may or may not have Math.fround)
console.log('\n' + '-'.repeat(80));
console.log('Testing with ZhuoranBoard');
console.log('-'.repeat(80));

const zhuoranBoard = new ZhuoranBoard(0, size, pixelRe, pixelIm, config, 'zhuoran');

let zhuoranCheckpointIters = [];
let zhuoranCheckpointMagnitudes = [];
let zhuoranConvergenceIter = null;

for (let i = 0; i < maxIters && zhuoranBoard.un > 0; i++) {
  // Check if checkpoint was updated
  const iter = zhuoranBoard.it;
  if (i > 0 && zhuoranBoard.bb && zhuoranBoard.bb[0] !== undefined) {
    const bbr = zhuoranBoard.bb[0];
    const bbi = zhuoranBoard.bb[1];
    const bbMag = Math.sqrt(bbr * bbr + bbi * bbi);
    const lastCkpt = zhuoranCheckpointMagnitudes[zhuoranCheckpointMagnitudes.length - 1];
    if (zhuoranCheckpointMagnitudes.length === 0 ||
        Math.abs(bbr - (lastCkpt ? lastCkpt.bbr : 0)) > 1e-10) {
      zhuoranCheckpointIters.push(iter);
      zhuoranCheckpointMagnitudes.push({ iter, bbr, bbi, mag: bbMag });
    }
  }

  zhuoranBoard.iterate();

  if (zhuoranBoard.nn[0] < 0 && !zhuoranConvergenceIter) {
    zhuoranConvergenceIter = -zhuoranBoard.nn[0];
  }
}

console.log(`\nZhuoranBoard results:`);
console.log(`  Converged: ${zhuoranBoard.nn[0] < 0 ? 'YES' : 'NO'}`);
if (zhuoranBoard.nn[0] < 0) {
  console.log(`  Convergence iteration: ${zhuoranConvergenceIter}`);
  console.log(`  Period: ${zhuoranBoard.pp[0]}`);
}
console.log(`  Checkpoints set: ${zhuoranCheckpointMagnitudes.length}`);

if (zhuoranCheckpointMagnitudes.length > 0) {
  console.log(`\n  Last 5 checkpoints:`);
  const lastCheckpoints = zhuoranCheckpointMagnitudes.slice(-5);
  lastCheckpoints.forEach((ckpt, i) => {
    console.log(`    [${zhuoranCheckpointMagnitudes.length - 5 + i}] iter=${ckpt.iter}, mag=${ckpt.mag.toExponential(3)}`);
  });

  const maxMag = Math.max(...zhuoranCheckpointMagnitudes.map(c => c.mag));
  console.log(`\n  Maximum checkpoint magnitude: ${maxMag.toExponential(3)}`);
}

// Compare results
console.log('\n' + '='.repeat(80));
console.log('COMPARISON');
console.log('='.repeat(80));

const bothConverged = cpuBoard.nn[0] < 0 && zhuoranBoard.nn[0] < 0;
const neitherConverged = cpuBoard.nn[0] >= 0 && zhuoranBoard.nn[0] >= 0;
const cpuOnlyConverged = cpuBoard.nn[0] < 0 && zhuoranBoard.nn[0] >= 0;
const zhuoranOnlyConverged = cpuBoard.nn[0] >= 0 && zhuoranBoard.nn[0] < 0;

if (bothConverged) {
  console.log(`\n✓ Both boards converged (GOOD)`);
  console.log(`  CpuBoard: iter=${cpuConvergenceIter}, period=${cpuBoard.pp[0]}`);
  console.log(`  ZhuoranBoard: iter=${zhuoranConvergenceIter}, period=${zhuoranBoard.pp[0]}`);
} else if (neitherConverged) {
  console.log(`\n✓ Neither board converged (GOOD)`);
} else if (cpuOnlyConverged) {
  console.log(`\n? CpuBoard converged but ZhuoranBoard did not`);
  console.log(`  This suggests ZhuoranBoard missed convergence (false negative)`);
} else if (zhuoranOnlyConverged) {
  console.log(`\n✗ ZhuoranBoard converged but CpuBoard did not`);
  console.log(`  This is FALSE CONVERGENCE - the bug we're looking for!`);
  console.log(`  ZhuoranBoard iter: ${zhuoranConvergenceIter}, period: ${zhuoranBoard.pp[0]}`);
}

console.log('\n' + '='.repeat(80));
console.log('CONCLUSION');
console.log('='.repeat(80));

if (cpuCheckpointMagnitudes.length > 0) {
  const maxMag = Math.max(...cpuCheckpointMagnitudes.map(c => c.mag));
  const float32Precision = 1.0 / (1 << 23);
  const precisionAtMaxMag = maxMag * float32Precision;

  if (precisionAtMaxMag > cpuBoard.epsilon) {
    console.log(`\nThe checkpoint magnitudes (max=${maxMag.toExponential(2)}) are too large for float32!`);
    console.log(`Float32 precision at this magnitude: ${precisionAtMaxMag.toExponential(2)}`);
    console.log(`Epsilon threshold: ${cpuBoard.epsilon.toExponential(2)}`);
    console.log(`\nWhen using Math.fround() (simulating GPU float32), the subtraction:`);
    console.log(`  delta = z_current - z_checkpoint`);
    console.log(`loses too much precision, resulting in delta ≈ 0 even when points are different.`);
    console.log(`This causes FALSE CONVERGENCE.`);
  } else {
    console.log(`\nCheckpoint magnitudes are small enough for float32 precision.`);
    console.log(`The bug may not reproduce at this zoom level.`);
  }
}

console.log('\n' + '='.repeat(80));

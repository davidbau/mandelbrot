#!/usr/bin/env node

// Test to understand why we're detecting half-period instead of full period

const { ZhuoranBoard } = require('./zhuoran-threading.js');

// Problematic case that should have period 30
const testRe = -0.6652323;
const testIm = 0.4601837;
const dims = 32;
const pixel = 1.369e-7;
const size = pixel * dims;

const config = {
  dims: dims,
  dims2: dims * dims,
  exponent: 2,
  batchSize: 100
};

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

console.log('Testing half-period hypothesis');
console.log(`size = ${size.toExponential(3)}`);
console.log(`epsilon  = ${Math.min(1e-12, size / 10).toExponential(3)}`);
console.log(`epsilon2 = ${Math.min(1e-9, size * 10).toExponential(3)}`);
console.log('');

// Extend reference orbit to a checkpoint
while (!board.refOrbitEscaped && board.refIterations < 20000) {
  board.extendReferenceOrbit();
}

console.log(`Extended to ${board.refIterations} iterations`);

// Find the most recent power-of-2 checkpoint
let checkpointIter = 1;
while (checkpointIter * 2 <= board.refIterations) {
  checkpointIter *= 2;
}

console.log(`Most recent checkpoint at iteration ${checkpointIter}`);

// Get checkpoint z value
const ckptRe = board.refOrbit[checkpointIter * 2];
const ckptIm = board.refOrbit[checkpointIter * 2 + 1];
console.log(`Checkpoint z: (${ckptRe.toExponential(6)}, ${ckptIm.toExponential(6)})`);
console.log('');

// Measure distances at various offsets from checkpoint
console.log('Distance from checkpoint at various iteration offsets:');
for (let offset = 1; offset <= 100; offset++) {
  const iter = checkpointIter + offset;
  if (iter >= board.refIterations) break;

  const re = board.refOrbit[iter * 2];
  const im = board.refOrbit[iter * 2 + 1];
  const deltaRe = re - ckptRe;
  const deltaIm = im - ckptIm;
  const dist = Math.max(Math.abs(deltaRe), Math.abs(deltaIm));

  const epsilon = Math.min(1e-12, size / 10);
  const epsilon2 = Math.min(1e-9, size * 10);

  let marker = '';
  if (dist <= epsilon) marker = ' *** WITHIN EPSILON ***';
  else if (dist <= epsilon2) marker = ' *** WITHIN EPSILON2 ***';

  if (offset <= 35 || dist <= epsilon2) {
    console.log(`  offset ${offset.toString().padStart(3)}: dist = ${dist.toExponential(6)}${marker}`);
  }
}

console.log('');
console.log('If we see epsilon2 trigger at offset ~15 and ~30, that explains the half-period detection.');

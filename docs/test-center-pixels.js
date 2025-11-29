#!/usr/bin/env node

// Test just the center pixels where the problem is occurring
// This should be much faster than testing the entire 1402x1402 board

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = -0.6652323;
const testIm = 0.4601837;

// Small board centered on the problematic location
const dims = 32;
const pixel = 1.369e-7;  // Same pixel size as the browser
const size = pixel * dims;

console.log('Testing CPU threading convergence - center pixels only');
console.log(`Location: c = ${testRe} + ${testIm}i`);
console.log(`dims = ${dims}, pixel = ${pixel.toExponential(3)}, size = ${size.toExponential(3)}`);
console.log('');

const config = {
  dims: dims,
  dims2: dims * dims,
  exponent: 2,
  batchSize: 100
};

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

console.log(`epsilon = ${board.epsilon.toExponential(3)}`);
console.log(`epsilon2 = ${board.epsilon2.toExponential(3)}`);
console.log(`epsilon3 = ${board.threading.epsilon3.toExponential(3)}`);
console.log('');

// Iterate up to 20000 iterations
console.log('Iterating...');
let iter = 0;
const maxIter = 20000;
let lastReport = 0;

while (board.unfinished() > 0 && iter < maxIter) {
  board.iterate();
  iter++;

  // Report every 1000 iterations
  if (iter - lastReport >= 1000) {
    const unfinished = board.unfinished();
    const converged = config.dims2 - unfinished - board.di;
    console.log(`  Iter ${iter}: unfinished=${unfinished}, converged=${converged}, diverged=${board.di}, refIter=${board.refIterations}`);
    lastReport = iter;
  }
}

const unfinished = board.unfinished();
const converged = config.dims2 - unfinished - board.di;

console.log('');
console.log('Final results:');
console.log(`  Iterations: ${iter}`);
console.log(`  Unfinished: ${unfinished}, Converged: ${converged}, Diverged: ${board.di}`);
console.log(`  Reference orbit iterations: ${board.refIterations}`);

// Analyze threading
const stats = board.threading.getStats();
console.log(`  Threading: ${stats.threadingRate.toFixed(1)}% threaded, avg jump: ${stats.avgJump.toFixed(1)}, max jump: ${stats.maxJump}`);
console.log('');

if (unfinished > 0) {
  console.log(`✗ Problem reproduced! ${unfinished} pixels remain unfinished after ${iter} iterations`);

  // Show some details about unfinished pixels
  console.log('\nAnalyzing unfinished pixels:');
  let count = 0;
  for (let i = 0; i < config.dims2 && count < 5; i++) {
    if (!board.nn[i]) {
      console.log(`  Pixel ${i}: refIter=${board.refIter[i]}, dz=(${board.dz[i*2].toExponential(3)}, ${board.dz[i*2+1].toExponential(3)})`);
      if (board.hasCheckpoint[i]) {
        console.log(`    Checkpoint: refIter=${board.checkpointIter[i]}, dz=(${board.bb[i*2].toExponential(3)}, ${board.bb[i*2+1].toExponential(3)})`);
      }
      count++;
    }
  }
} else {
  console.log(`✓ All pixels converged successfully!`);
}

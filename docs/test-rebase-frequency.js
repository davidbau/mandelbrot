#!/usr/bin/env node

// Test whether pixels near the reference actually rebase
// If they don't rebase, ref_iter never cycles and convergence can't be detected

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = -0.6652323;
const testIm = 0.4601837;
const size = 0.01;

const config = {
  dims: 32,
  dims2: 1024,
  exponent: 2,
  batchSize: 100
};

console.log('Testing rebase frequency for pixels near reference');
console.log(`Location: c = ${testRe} + ${testIm}i`);
console.log('');

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

// Track rebase events for sample pixels
const trackedPixels = [256, 384, 512, 640, 768];
const rebaseCount = {};
const refIterAtCheckpoint = {};

for (const px of trackedPixels) {
  rebaseCount[px] = 0;
}

let iter = 0;
const maxIter = 30000;

// Track ref_iter values to detect rebasing
const lastRefIter = new Array(config.dims2).fill(0);

while (board.unfinished() > 0 && iter < maxIter) {
  // Save old ref_iter values before iteration
  for (const px of trackedPixels) {
    if (board.nn[px] === 0) {  // Still iterating
      lastRefIter[px] = board.refIter[px];
    }
  }

  board.iterate();
  iter++;

  // Check for rebases after iteration
  for (const px of trackedPixels) {
    if (board.nn[px] === 0) {  // Still iterating
      const newRefIter = board.refIter[px];
      if (newRefIter < lastRefIter[px] - 1) {
        rebaseCount[px]++;
      }

      // Record checkpoint ref_iter when convergence first detected
      if (refIterAtCheckpoint[px] === undefined && board.pp[px] > 0) {
        refIterAtCheckpoint[px] = newRefIter;
      }
    }
  }

  if (iter % 5000 === 0) {
    console.log(`Iteration ${iter}: ${board.unfinished()} unfinished`);
  }
}

console.log('');
console.log(`Finished after ${iter} iterations`);
console.log('');

// Report rebase statistics
for (const px of trackedPixels) {
  console.log(`Pixel ${px}:`);
  console.log(`  Status: ${board.nn[px] < 0 ? 'Converged' : board.nn[px] > 0 ? 'Diverged' : 'Unfinished'}`);
  console.log(`  Rebases: ${rebaseCount[px]}`);
  console.log(`  Final ref_iter: ${board.refIter[px]}`);

  if (refIterAtCheckpoint[px] !== undefined) {
    console.log(`  Checkpoint ref_iter: ${refIterAtCheckpoint[px]}`);
  }

  if (board.nn[px] === 0 && rebaseCount[px] === 0) {
    console.log(`  ⚠️  UNFINISHED with ZERO rebases - ref_iter never cycled!`);
  }
  console.log('');
}

console.log('Analysis:');
console.log('Pixels with 0 rebases cannot have ref_iter cycle back to checkpoint.');
console.log('Without fallback, these pixels will never detect convergence!');

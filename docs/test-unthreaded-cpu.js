#!/usr/bin/env node

// Test with unthreaded CPU version to understand the issue
// This mimics GpuZhuoranBoard behavior (no threading, no fallback)

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

console.log('Testing UNTHREADED CPU ZhuoranBoard (mimics GPU without fallback)');
console.log(`Location: c = ${testRe} + ${testIm}i`);
console.log('');

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

// DISABLE threading: Set a flag and modify the convergence check
board.DISABLE_THREADING_FOR_TEST = true;

// Track rebasing
const rebaseCount = new Array(config.dims2).fill(0);
const lastRefIter = new Array(config.dims2).fill(0);

let iter = 0;
const maxIter = 30000;

while (board.unfinished() > 0 && iter < maxIter) {
  // Track rebases
  for (let px = 0; px < config.dims2; px++) {
    if (board.nn[px] === 0) {
      const oldRefIter = lastRefIter[px];
      lastRefIter[px] = board.refIter[px];
      if (oldRefIter > 0 && board.refIter[px] < oldRefIter - 1) {
        rebaseCount[px]++;
      }
    }
  }

  board.iterate();
  iter++;

  if (iter % 5000 === 0) {
    console.log(`Iteration ${iter}: ${board.unfinished()} unfinished, ${board.di} diverged`);
  }
}

console.log('');
console.log(`Finished after ${iter} iterations`);
console.log(`Unfinished: ${board.unfinished()}`);
console.log(`Converged: ${config.dims2 - board.unfinished() - board.di}`);
console.log(`Diverged: ${board.di}`);
console.log('');

// Analyze unfinished pixels
if (board.unfinished() > 0) {
  console.log('⚠️  UNFINISHED PIXELS DETECTED!');
  console.log('This confirms the issue exists without threading/fallback.');
  console.log('');

  const unfinishedPixels = [];
  for (let px = 0; px < config.dims2; px++) {
    if (board.nn[px] === 0) {
      unfinishedPixels.push(px);
    }
  }

  console.log(`Total unfinished: ${unfinishedPixels.length}`);
  console.log('');

  // Rebase statistics
  console.log('Rebase statistics for unfinished pixels:');
  const rebaseCounts = {};
  for (const px of unfinishedPixels) {
    const count = rebaseCount[px];
    rebaseCounts[count] = (rebaseCounts[count] || 0) + 1;
  }

  for (const count of Object.keys(rebaseCounts).sort((a, b) => parseInt(a) - parseInt(b))) {
    console.log(`  ${count} rebases: ${rebaseCounts[count]} pixels`);
  }

  console.log('');

  if (rebaseCounts['0']) {
    console.log('ROOT CAUSE: Lack of rebasing');
    console.log(`  ${rebaseCounts['0']} pixels never rebased, so ref_iter never cycled back.`);
  } else {
    console.log('ROOT CAUSE: Nonperiodic rebasing');
    console.log('  All pixels rebased, but ref_iter never returned to checkpoint values.');
  }
} else {
  console.log('✓ All pixels finished (converged or diverged)');
  console.log('No unfinished pixels - issue not reproduced.');
}

#!/usr/bin/env node

// Analyze unfinished pixels to understand why they don't converge

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

console.log('Analyzing unfinished pixels');
console.log(`Location: c = ${testRe} + ${testIm}i`);
console.log('');

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

// Track rebasing for all pixels
const rebaseCount = new Array(config.dims2).fill(0);
const lastRefIter = new Array(config.dims2).fill(0);

let iter = 0;
const maxIter = 30000;

while (board.unfinished() > 0 && iter < maxIter) {
  // Track ref_iter changes
  for (let px = 0; px < config.dims2; px++) {
    if (board.nn[px] === 0) {
      const oldRefIter = lastRefIter[px];
      lastRefIter[px] = board.refIter[px];

      // Detect rebase (ref_iter decreased significantly)
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
  console.log('UNFINISHED PIXELS FOUND!');
  console.log('');

  const unfinishedPixels = [];
  for (let px = 0; px < config.dims2; px++) {
    if (board.nn[px] === 0) {
      unfinishedPixels.push(px);
    }
  }

  console.log(`Total unfinished: ${unfinishedPixels.length}`);
  console.log('');

  // Show sample of unfinished pixels
  console.log('Sample unfinished pixels:');
  for (let i = 0; i < Math.min(10, unfinishedPixels.length); i++) {
    const px = unfinishedPixels[i];
    console.log(`  Pixel ${px}:`);
    console.log(`    Rebases: ${rebaseCount[px]}`);
    console.log(`    Final ref_iter: ${board.refIter[px]}`);
    console.log(`    Period detected: ${board.pp[px] > 0 ? board.pp[px] : 'none'}`);
  }

  console.log('');
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
  console.log('Analysis:');
  if (rebaseCounts['0'] > 0) {
    console.log(`⚠️  ${rebaseCounts['0']} pixels with ZERO rebases!`);
    console.log('   These pixels never cycle ref_iter back, so convergence cannot be detected');
    console.log('   without fallback.');
  } else {
    console.log('All unfinished pixels have rebased, so the problem is likely');
    console.log('"nonperiodic rebasing" - ref_iter cycles but never returns to checkpoint value.');
  }
}

#!/usr/bin/env node

// Test whether ref_iter cycles back in periodic orbits
// This determines if convergence detection without fallback can work

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = -0.6652323;
const testIm = 0.4601837;
const size = 0.01;

const config = {
  dims: 32,  // Larger board to test multiple pixels
  dims2: 1024,
  exponent: 2,
  batchSize: 100
};

console.log('Testing ref_iter cycling in periodic orbit');
console.log(`Location: c = ${testRe} + ${testIm}i`);
console.log('');

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

// Track a few specific pixels from different parts of the board
const trackedPixels = [256, 512, 768];  // Different locations

console.log('Iterating board and tracking ref_iter for sample pixels...');
console.log('');

let iter = 0;
const maxIter = 30000;
const refIterHistory = {};
const checkpointRefIter = {};

for (const px of trackedPixels) {
  refIterHistory[px] = [];
  checkpointRefIter[px] = null;
}

while (board.unfinished() > 0 && iter < maxIter) {
  board.iterate();
  iter++;

  // Sample ref_iter values periodically
  if (iter % 100 === 0) {
    for (const px of trackedPixels) {
      if (board.nn[px] === 0) {  // Still iterating
        const ri = board.ri[px];
        refIterHistory[px].push({ iter, refIter: ri });

        // Record checkpoint ref_iter (when pixel first enters potential convergence)
        if (checkpointRefIter[px] === null && board.pp[px] > 0) {
          checkpointRefIter[px] = ri;
          console.log(`Pixel ${px}: Checkpoint taken at iter=${iter}, ref_iter=${ri}`);
        }
      }
    }
  }
}

console.log('');
console.log(`Finished after ${iter} iterations`);
console.log(`Unfinished pixels: ${board.unfinished()}`);
console.log(`Converged: ${config.dims2 - board.unfinished() - board.di}`);
console.log(`Diverged: ${board.di}`);
console.log('');

// Analyze ref_iter patterns
for (const px of trackedPixels) {
  const history = refIterHistory[px];
  if (history.length === 0) {
    console.log(`Pixel ${px}: No history recorded`);
    continue;
  }

  console.log(`Pixel ${px}:`);
  console.log(`  Status: ${board.nn[px] < 0 ? 'Converged' : board.nn[px] > 0 ? 'Diverged' : 'Unfinished'}`);
  console.log(`  Period: ${board.pp[px]}`);

  if (checkpointRefIter[px] !== null) {
    const ckptRefIter = checkpointRefIter[px];
    console.log(`  Checkpoint ref_iter: ${ckptRefIter}`);

    // Check if ref_iter ever cycles back to checkpoint value
    let cycledBack = false;
    let closestReturn = Infinity;

    for (let i = 0; i < history.length; i++) {
      if (history[i].iter > checkpointRefIter[px] && history[i].refIter === ckptRefIter) {
        cycledBack = true;
        console.log(`  ✓ ref_iter cycled back to ${ckptRefIter} at iter=${history[i].iter}`);
        break;
      }
      const diff = Math.abs(history[i].refIter - ckptRefIter);
      if (diff > 0 && diff < closestReturn) {
        closestReturn = diff;
      }
    }

    if (!cycledBack) {
      console.log(`  ✗ ref_iter NEVER cycled back to checkpoint value`);
      console.log(`  Closest return: ${closestReturn} iterations away`);

      // Show ref_iter range
      const refIters = history.map(h => h.refIter);
      const minRefIter = Math.min(...refIters);
      const maxRefIter = Math.max(...refIters);
      console.log(`  ref_iter range: ${minRefIter} to ${maxRefIter}`);
    }
  }
  console.log('');
}

console.log('Analysis:');
console.log('If ref_iter never cycles back, convergence detection without fallback FAILS!');

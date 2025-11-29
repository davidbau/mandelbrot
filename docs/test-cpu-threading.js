#!/usr/bin/env node

// Test CPU threading with the exact parameters from the browser issue
// Board 0: ZhuoranBoard @ (-6.652323000e-1, 4.601837000e-1), dims=1402, pixel=1.369e-7

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = -0.6652323;
const testIm = 0.4601837;
const dims = 1402;
const pixel = 1.369e-7;
const size = pixel * dims;

console.log('Testing CPU threading convergence issue');
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
    console.log(`  Iter ${iter}: unfinished=${unfinished}, converged=${converged}, diverged=${board.di}`);
    lastReport = iter;
  }
}

const unfinished = board.unfinished();
const converged = config.dims2 - unfinished - board.di;

console.log('');
console.log('Final results:');
console.log(`  Iterations: ${iter}`);
console.log(`  Unfinished: ${unfinished}, Converged: ${converged}, Diverged: ${board.di}`);

// Analyze threading
const stats = board.threading.getStats();
console.log(`  Threading: ${stats.threadingRate.toFixed(1)}% threaded, avg jump: ${stats.avgJump.toFixed(1)}, max jump: ${stats.maxJump}`);
console.log('');

if (unfinished > 0) {
  console.log(`Problem reproduced! ${unfinished} pixels remain unfinished after ${iter} iterations`);
} else {
  console.log(`All pixels converged successfully!`);
}

#!/usr/bin/env node

// Debug threading to understand why pixel test shows 1% but stats test shows good threading

const { ZhuoranBoard } = require('./zhuoran-threading.js');

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

console.log('Debugging threading computation');
console.log(`size = ${size.toExponential(3)}`);
console.log(`epsilon3 = ${board.threading.epsilon3.toExponential(3)}`);
console.log('');

// Extend reference orbit to various lengths and check threading at each point
const checkPoints = [1000, 2000, 3000, 5000, 10000, 15000, 20000];

for (const target of checkPoints) {
  // Extend reference orbit to target
  while (!board.refOrbitEscaped && board.refIterations < target) {
    board.extendReferenceOrbit();
  }

  // Get threading statistics
  const stats = board.threading.getStats();

  console.log(`After ${board.refIterations} ref iterations: ${stats.threadingRate.toFixed(1)}% threaded ` +
              `(${stats.withThreads} with, ${stats.withoutThreads} without), ` +
              `avg jump: ${stats.avgJump.toFixed(1)}, max: ${stats.maxJump}`);

  // Check threading in last 1000 iterations
  if (board.refIterations >= 1000) {
    const start = board.refIterations - 1000;
    let withThreads = 0;
    let withoutThreads = 0;
    for (let i = start; i < board.refIterations; i++) {
      const thread = board.threading.refThreading[i];
      if (thread && thread.next >= 0) {
        withThreads++;
      } else {
        withoutThreads++;
      }
    }
    const rate = withThreads / (withThreads + withoutThreads) * 100;
    console.log(`  Last 1000 iterations: ${rate.toFixed(1)}% threaded (${withThreads} with, ${withoutThreads} without)`);
  }
}

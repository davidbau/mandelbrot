#!/usr/bin/env node

// Test script for threaded reference orbit implementation

const { ZhuoranBoard, figurePeriod } = require('./zhuoran-threading.js');

// Test configuration
const config = {
  dims: 8,  // Small board for testing
  dims2: 64,  // dims * dims
  exponent: 2,
  batchSize: 100
};

// Test point INSIDE main cardioid (period 1, converges to 0)
// Reference orbit should have many near-returns
const testRe = -0.5;
const testIm = 0.0;
const size = 0.3;

console.log('Testing ZhuoranBoard with threading support');
console.log(`Test region: c = ${testRe} + ${testIm}i, size = ${size}`);
console.log(`Board dimensions: ${config.dims} x ${config.dims}`);
console.log('');

// Create board
const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

console.log(`Initial state:`);
console.log(`  epsilon = ${board.epsilon.toExponential(3)}`);
console.log(`  epsilon2 = ${board.epsilon2.toExponential(3)}`);
console.log(`  epsilon3 = ${board.epsilon3.toExponential(3)}`);
console.log(`  bucketSize = ${board.bucketSize.toExponential(3)}`);
console.log(`  threadingWindowSize = ${board.threadingWindowSize}`);

// Check some actual distances in reference orbit
console.log('\n  Sample reference orbit distances:');
for (let i = 10; i < Math.min(30, board.refOrbit.length - 10); i += 10) {
  const p1 = board.refOrbit[i];
  const p2 = board.refOrbit[i + 10];
  const re1 = p1[0] + p1[1];
  const im1 = p1[2] + p1[3];
  const re2 = p2[0] + p2[1];
  const im2 = p2[2] + p2[3];
  const dist = Math.max(Math.abs(re2 - re1), Math.abs(im2 - im1));
  console.log(`    [${i}] -> [${i+10}]: distance = ${dist.toExponential(3)}`);
}
console.log('');

// Iterate until some pixels converge or diverge
console.log('Starting iterations...');
let maxIter = 10000;
let iter = 0;

while (board.unfinished() > 0 && iter < maxIter) {
  board.iterate();
  iter++;

  if (iter % 100 === 0) {
    console.log(`  Iteration ${iter}: unfinished=${board.unfinished()}, diverged=${board.di}, refOrbit length=${board.refIterations}`);
  }
}

console.log('');
console.log(`Finished after ${iter} iterations`);
console.log(`  Unfinished: ${board.unfinished()}`);
console.log(`  Diverged: ${board.di}`);
console.log(`  Converged: ${config.dims2 - board.unfinished() - board.di}`);
console.log(`  Reference orbit length: ${board.refIterations}`);
console.log('');

// Check threading data
console.log('Threading statistics:');
let threadsFound = 0;
let maxThreadJump = 0;
const threadJumps = [];
const jumpHistogram = {};

for (let i = 0; i < board.refThreading.length; i++) {
  const thread = board.refThreading[i];
  if (thread.next >= 0) {
    threadsFound++;
    const jump = thread.next - i;
    maxThreadJump = Math.max(maxThreadJump, jump);
    threadJumps.push(jump);

    // Histogram with bins: 10, 20, 50, 100, 200, 500, 1000+
    let bin;
    if (jump <= 10) bin = '10';
    else if (jump <= 20) bin = '20';
    else if (jump <= 50) bin = '50';
    else if (jump <= 100) bin = '100';
    else if (jump <= 200) bin = '200';
    else if (jump <= 500) bin = '500';
    else bin = '1000+';
    jumpHistogram[bin] = (jumpHistogram[bin] || 0) + 1;
  }
}

console.log(`  Spatial buckets: ${board.spatialBuckets.size} buckets`);
let totalPointsInBuckets = 0;
for (const [key, points] of board.spatialBuckets) {
  totalPointsInBuckets += points.length;
}
console.log(`  Total points in buckets: ${totalPointsInBuckets}`);

console.log(`  Total reference orbit points: ${board.refThreading.length}`);
console.log(`  Points with threads: ${threadsFound} (${(threadsFound / board.refThreading.length * 100).toFixed(1)}%)`);
console.log(`  Max thread jump: ${maxThreadJump}`);

if (threadJumps.length > 0) {
  const avgJump = threadJumps.reduce((a, b) => a + b, 0) / threadJumps.length;
  const sortedJumps = threadJumps.slice().sort((a, b) => a - b);
  const medianJump = sortedJumps[Math.floor(sortedJumps.length / 2)];
  console.log(`  Average thread jump: ${avgJump.toFixed(1)}`);
  console.log(`  Median thread jump: ${medianJump}`);

  console.log('\n  Thread jump histogram:');
  const bins = ['10', '20', '50', '100', '200', '500', '1000+'];
  for (const bin of bins) {
    if (jumpHistogram[bin]) {
      const label = (bin + '      ').substring(0, 6);
      console.log(`    ${label}: ${jumpHistogram[bin]} threads`);
    }
  }
}
console.log('');

// Show some example threads
console.log('Example threads (first 20 with threads):');
let shown = 0;
for (let i = 0; i < board.refThreading.length && shown < 20; i++) {
  const thread = board.refThreading[i];
  if (thread.next >= 0) {
    const ref = board.refOrbit[i];
    const refRe = ref[0] + ref[1];
    const refIm = ref[2] + ref[3];
    const nextRef = board.refOrbit[thread.next];
    const nextRe = nextRef[0] + nextRef[1];
    const nextIm = nextRef[2] + nextRef[3];
    const actualDeltaRe = nextRe - refRe;
    const actualDeltaIm = nextIm - refIm;
    const deltaError = Math.max(
      Math.abs(actualDeltaRe - thread.deltaRe),
      Math.abs(actualDeltaIm - thread.deltaIm)
    );
    console.log(`  [${i}] -> [${thread.next}] (jump ${thread.next - i}): delta=(${thread.deltaRe.toExponential(2)}, ${thread.deltaIm.toExponential(2)}) error=${deltaError.toExponential(2)}`);
    shown++;
  }
}
console.log('');

// Check convergence periods
const periods = {};
for (let i = 0; i < board.nn.length; i++) {
  if (board.nn[i] < 0 && board.pp[i]) {  // Converged
    const period = figurePeriod(board.pp[i]);
    periods[period] = (periods[period] || 0) + 1;
  }
}

console.log('Convergence periods:');
const periodKeys = Object.keys(periods).map(k => parseInt(k)).sort((a, b) => a - b);
for (let i = 0; i < periodKeys.length; i++) {
  const period = periodKeys[i];
  const count = periods[period];
  console.log(`  Period ${period}: ${count} pixels`);
}

console.log('');
console.log('Testing complete!');

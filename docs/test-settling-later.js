#!/usr/bin/env node

// Check distances later in the orbit when threading starts working

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = -0.6652323;
const testIm = 0.4601837;
const size = 0.01;

const config = {
  dims: 4,
  dims2: 16,
  exponent: 2,
  batchSize: 100
};

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

// Extend to 8000 iterations
while (!board.refOrbitEscaped && board.refIterations < 8000) {
  board.extendReferenceOrbit();
}

console.log('Consecutive distances at different phases:');
console.log('');

const checkRanges = [
  { start: 0, end: 100, label: 'Early (0-100)' },
  { start: 2000, end: 2100, label: 'Group 3 start (2000-2100)' },
  { start: 5000, end: 5100, label: 'Group 6 start (5000-5100)' },
  { start: 6000, end: 6100, label: 'Group 7 start (6000-6100)' }
];

for (const range of checkRanges) {
  console.log(`${range.label}:`);

  let minDist = Infinity;
  let maxDist = 0;
  let avgDist = 0;
  let count = 0;

  for (let i = range.start; i < Math.min(range.end, board.refOrbit.length - 1); i++) {
    const p1 = board.refOrbit[i];
    const p2 = board.refOrbit[i + 1];

    const re1 = p1[0] + p1[1];
    const im1 = p1[2] + p1[3];
    const re2 = p2[0] + p2[1];
    const im2 = p2[2] + p2[3];

    const dist = Math.max(Math.abs(re2 - re1), Math.abs(im2 - im1));
    minDist = Math.min(minDist, dist);
    maxDist = Math.max(maxDist, dist);
    avgDist += dist;
    count++;
  }

  avgDist = count > 0 ? avgDist / count : 0;

  console.log(`  Min: ${minDist.toExponential(3)}, Max: ${maxDist.toExponential(3)}, Avg: ${avgDist.toExponential(3)}`);
  console.log(`  epsilon3 = ${board.epsilon3.toExponential(3)}`);
  console.log(`  Avg/epsilon3 ratio: ${(avgDist / board.epsilon3).toFixed(1)}x`);
  console.log('');
}

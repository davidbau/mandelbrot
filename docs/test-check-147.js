#!/usr/bin/env node

// Quick check: is the period 147 or 75?

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = 0.443736022;
const testIm = 0.371601352;
const size = 0.01;

const config = {
  dims: 4,
  dims2: 16,
  exponent: 2,
  batchSize: 100
};

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

// Extend reference orbit
while (!board.refOrbitEscaped && board.refIterations < 5000) {
  board.extendReferenceOrbit();
}

// Check specific periods - scan broadly first
const testPeriods = [];
for (let p = 1; p <= 50; p++) testPeriods.push(p);
for (let p = 55; p <= 500; p += 5) testPeriods.push(p);
// Also specifically check 41 and 410 (found by threading and distance)
if (!testPeriods.includes(41)) testPeriods.push(41);
if (!testPeriods.includes(410)) testPeriods.push(410);

console.log('Checking periods:\n');

const results = [];

for (const period of testPeriods) {
  let maxDist = 0;
  let avgDist = 0;
  let count = 0;

  for (let i = 2000; i < Math.min(3000, board.refIterations - period); i++) {
    const p1 = board.refOrbit[i];
    const p2 = board.refOrbit[i + period];
    if (!p1 || !p2) continue;

    const re1 = p1[0] + p1[1];
    const im1 = p1[2] + p1[3];
    const re2 = p2[0] + p2[1];
    const im2 = p2[2] + p2[3];

    const dist = Math.max(Math.abs(re2 - re1), Math.abs(im2 - im1));
    maxDist = Math.max(maxDist, dist);
    avgDist += dist;
    count++;
  }

  avgDist = count > 0 ? avgDist / count : 0;
  results.push({ period, maxDist, avgDist });
}

// Sort by avg distance
results.sort((a, b) => a.avgDist - b.avgDist);

console.log('Top 10 candidates (by avg distance):');
for (let i = 0; i < Math.min(10, results.length); i++) {
  const { period, maxDist, avgDist } = results[i];
  console.log(`  Period ${('   ' + period).slice(-3)}: max = ${maxDist.toExponential(4)}, avg = ${avgDist.toExponential(4)}`);
}

if (results[0].avgDist < 1e-6) {
  console.log(`\n** Detected period: ${results[0].period} **`);
}

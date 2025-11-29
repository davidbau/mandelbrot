#!/usr/bin/env node

// Test threading statistics within high-period bulbs
// Check how often points fail to thread forward in groups of k iterations

const { ZhuoranBoard } = require('./zhuoran-threading.js');

// Unknown period bulb (user wants to determine periodicity)
const testRe = -0.6652323;
const testIm = 0.4601837;
const size = 0.01;

const config = {
  dims: 4,  // Small board, we just care about reference orbit
  dims2: 16,
  exponent: 2,
  batchSize: 100
};

console.log('Testing threading statistics - determining periodicity');
console.log(`Location: c = ${testRe} + ${testIm}i, size = ${size}`);
console.log('');

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

console.log(`epsilon = ${board.epsilon.toExponential(3)}`);
console.log(`epsilon2 = ${board.epsilon2.toExponential(3)}`);
console.log(`epsilon3 = ${board.threading.epsilon3.toExponential(3)}`);
console.log(`bucketSize = ${board.threading.bucketSize.toExponential(3)}`);
console.log('');

// Force reference orbit to extend to 12000 iterations
console.log('Extending reference orbit to 12000 iterations...');
while (!board.refOrbitEscaped && board.refIterations < 12000) {
  board.extendReferenceOrbit();
}

console.log(`Reference orbit length: ${board.refIterations}`);
console.log(`Reference escaped: ${board.refOrbitEscaped}`);
console.log('');

// Analyze threading statistics in groups of 1000 iterations
const k = 1000;
const numGroups = Math.floor(board.refIterations / k);

console.log(`Analyzing threading in groups of ${k} iterations:`);
console.log('Group | Total Points | With Threads | Without Threads | % Without | Max Jump | Avg Jump');
console.log('-'.repeat(90));

for (let group = 0; group < numGroups; group++) {
  const startIdx = group * k;
  const endIdx = Math.min((group + 1) * k, board.refIterations);

  let withThreads = 0;
  let withoutThreads = 0;
  let maxJump = 0;
  let totalJump = 0;

  for (let i = startIdx; i < endIdx; i++) {
    if (i >= board.threading.refThreading.length) break;

    const thread = board.threading.refThreading[i];
    if (thread.next >= 0) {
      withThreads++;
      const jump = thread.next - i;
      maxJump = Math.max(maxJump, jump);
      totalJump += jump;
    } else {
      withoutThreads++;
    }
  }

  const total = withThreads + withoutThreads;
  const pctWithout = total > 0 ? (100 * withoutThreads / total) : 0;
  const avgJump = withThreads > 0 ? (totalJump / withThreads) : 0;

  const pad = (s, len) => {
    s = s.toString();
    while (s.length < len) s = ' ' + s;
    return s;
  };

  console.log(
    pad(group + 1, 5) + ' | ' +
    pad(total, 12) + ' | ' +
    pad(withThreads, 12) + ' | ' +
    pad(withoutThreads, 15) + ' | ' +
    pad(pctWithout.toFixed(1), 9) + ' | ' +
    pad(maxJump, 8) + ' | ' +
    pad(avgJump.toFixed(1), 8)
  );
}

console.log('');

// Check if orbit appears periodic
console.log('Checking for periodicity in reference orbit:');
// Check many periods to identify which one it is
const checkPeriods = [];
for (let p = 1; p <= 20; p++) checkPeriods.push(p);
for (let p = 25; p <= 100; p += 5) checkPeriods.push(p);
for (let p = 110; p <= 500; p += 10) checkPeriods.push(p);

let bestPeriod = -1;
let bestAvgDist = Infinity;
const periodResults = [];

for (const period of checkPeriods) {
  if (board.refIterations < period * 3) continue;

  // Check if orbit returns close to itself after 'period' iterations
  let maxDist = 0;
  let avgDist = 0;
  let count = 0;

  for (let i = 1000; i < Math.min(2000, board.refIterations - period); i++) {
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
  periodResults.push({ period, maxDist, avgDist });

  if (avgDist < bestAvgDist && avgDist < 1e-3) {
    bestAvgDist = avgDist;
    bestPeriod = period;
  }
}

// Show top 10 candidates (smallest avg distance)
periodResults.sort((a, b) => a.avgDist - b.avgDist);
console.log('  Top 10 period candidates (by avg distance):');
for (let i = 0; i < Math.min(10, periodResults.length); i++) {
  const { period, maxDist, avgDist } = periodResults[i];
  const marker = period === bestPeriod ? ' *** BEST ***' : '';
  const periodStr = ('   ' + period).slice(-3);
  console.log(`    Period ${periodStr}: max = ${maxDist.toExponential(3)}, avg = ${avgDist.toExponential(3)}${marker}`);
}

if (bestPeriod > 0) {
  console.log(`\n  ** Detected period: ${bestPeriod} **`);
}

console.log('');
console.log('Test complete!');

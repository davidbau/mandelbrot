#!/usr/bin/env node

// Test ZhuoranBoard threading with various high-period bulb locations
// Also verify that results match CpuBoard

const { ZhuoranBoard, figurePeriod } = require('./zhuoran-threading.js');

// Also need CpuBoard for comparison - extract from index.html
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf-8');

// Extract CpuBoard class (simplified version for testing)
// For now, we'll just test ZhuoranBoard threading

// Known high-period bulb locations
const testLocations = [
  {
    name: 'Period-3 bulb (top)',
    re: -0.125,
    im: 0.649519,
    size: 0.01,
    expectedPeriod: 3
  },
  {
    name: 'Period-5 bulb',
    re: -0.4812,
    im: 0.5329,
    size: 0.005,
    expectedPeriod: 5
  },
  {
    name: 'Period-7 bulb',
    re: 0.3001,
    im: 0.0251,
    size: 0.002,
    expectedPeriod: 7
  },
  {
    name: 'Period-31 bulb (deep zoom)',
    re: -0.749,
    im: 0.1,
    size: 0.0001,
    expectedPeriod: 31
  },
  {
    name: 'Period-119 bulb',
    re: 0.2983,
    im: 0.0235,
    size: 0.0002,
    expectedPeriod: 119
  },
  {
    name: 'Near boundary (should diverge)',
    re: -0.5,
    im: 0.6,
    size: 0.01,
    expectDivergence: true
  }
];

const config = {
  dims: 16,
  dims2: 256,
  exponent: 2,
  batchSize: 100
};

console.log('Testing ZhuoranBoard with various high-period bulb locations\n');
console.log('='.repeat(70));

for (const loc of testLocations) {
  console.log(`\n${loc.name}`);
  console.log(`Location: c = ${loc.re} + ${loc.im}i, size = ${loc.size}`);

  const board = new ZhuoranBoard(0, loc.size, loc.re, loc.im, config, 'test');

  console.log(`  epsilon3 = ${board.epsilon3.toExponential(3)}`);

  // Iterate until convergence or max iterations
  let maxIter = 5000;
  let iter = 0;

  while (board.unfinished() > 0 && iter < maxIter) {
    board.iterate();
    iter++;
  }

  console.log(`  Finished after ${iter} iterations`);
  console.log(`  Reference orbit length: ${board.refIterations}`);
  console.log(`  Converged: ${config.dims2 - board.unfinished() - board.di}`);
  console.log(`  Diverged: ${board.di}`);
  console.log(`  Unfinished: ${board.unfinished()}`);

  // Analyze threading
  let threadsFound = 0;
  let maxJump = 0;
  const jumpCounts = {};

  for (let i = 0; i < board.refThreading.length; i++) {
    const thread = board.refThreading[i];
    if (thread.next >= 0) {
      threadsFound++;
      const jump = thread.next - i;
      maxJump = Math.max(maxJump, jump);

      // Count jumps by size
      if (jump === 10) jumpCounts['10'] = (jumpCounts['10'] || 0) + 1;
      else if (jump <= 50) jumpCounts['11-50'] = (jumpCounts['11-50'] || 0) + 1;
      else if (jump <= 100) jumpCounts['51-100'] = (jumpCounts['51-100'] || 0) + 1;
      else if (jump <= 500) jumpCounts['101-500'] = (jumpCounts['101-500'] || 0) + 1;
      else jumpCounts['500+'] = (jumpCounts['500+'] || 0) + 1;
    }
  }

  console.log(`  Threading: ${threadsFound}/${board.refThreading.length} (${(100*threadsFound/board.refThreading.length).toFixed(1)}%)`);
  console.log(`  Max jump: ${maxJump}`);

  if (Object.keys(jumpCounts).length > 0) {
    console.log(`  Jump distribution:`, jumpCounts);
  }

  // Check convergence periods
  const periods = {};
  for (let i = 0; i < board.nn.length; i++) {
    if (board.nn[i] < 0 && board.pp[i]) {
      const period = figurePeriod(board.pp[i]);
      periods[period] = (periods[period] || 0) + 1;
    }
  }

  if (Object.keys(periods).length > 0) {
    const sortedPeriods = Object.keys(periods).map(p => parseInt(p)).sort((a, b) => a - b);
    console.log(`  Detected periods:`, sortedPeriods.slice(0, 10).join(', '));

    if (loc.expectedPeriod) {
      const hasExpected = periods[loc.expectedPeriod] > 0;
      console.log(`  Expected period ${loc.expectedPeriod}: ${hasExpected ? 'FOUND' : 'NOT FOUND'}`);
    }
  } else {
    console.log(`  No convergence detected`);
  }

  if (loc.expectDivergence) {
    const divergenceRate = board.di / config.dims2;
    console.log(`  Divergence rate: ${(divergenceRate * 100).toFixed(1)}% (expected high)`);
  }
}

console.log('\n' + '='.repeat(70));
console.log('\nTest complete!');

#!/usr/bin/env node

// Comprehensive test suite for all identified test cases

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testCases = [
  {
    name: 'Period 95',
    c: { re: -0.087040, im: 0.648312 },
    size: 0.01,
    expectedPeriod: 95,
    expectedThreadJump: 95
  },
  {
    name: 'Period 147',
    c: { re: -0.1007382, im: 0.6526223 },
    size: 0.01,
    expectedPeriod: 147,
    expectedThreadJump: 147
  },
  {
    name: 'Period 273',
    c: { re: -0.6447902, im: 0.4136655 },
    size: 0.01,
    expectedPeriod: 273,
    expectedThreadJump: 273
  },
  {
    name: 'Period 410 (jump 41)',
    c: { re: 0.443736022, im: 0.371601352 },
    size: 0.01,
    expectedPeriod: 410,  // Can be 41, 205, or 410
    expectedThreadJump: 41
  },
  {
    name: 'Problematic (no rebase)',
    c: { re: -0.6652323, im: 0.4601837 },
    size: 0.01,
    expectedPeriod: 60,
    expectedThreadJump: 30
  }
];

const config = {
  dims: 32,
  dims2: 1024,
  exponent: 2,
  batchSize: 100
};

console.log('='.repeat(80));
console.log('COMPREHENSIVE THREADING TEST SUITE');
console.log('='.repeat(80));
console.log('');

let allPassed = true;

for (const testCase of testCases) {
  console.log(`Testing: ${testCase.name}`);
  console.log(`  Location: c = ${testCase.c.re} + ${testCase.c.im}i`);

  const board = new ZhuoranBoard(0, testCase.size, testCase.c.re, testCase.c.im, config, 'test');

  // Iterate until convergence
  let iter = 0;
  const maxIter = 30000;
  while (board.unfinished() > 0 && iter < maxIter) {
    board.iterate();
    iter++;
  }

  // Check results
  const unfinished = board.unfinished();
  const converged = config.dims2 - unfinished - board.di;

  console.log(`  Iterations: ${iter}`);
  console.log(`  Unfinished: ${unfinished}, Converged: ${converged}, Diverged: ${board.di}`);

  // Analyze threading
  const stats = board.threading.getStats();
  console.log(`  Threading: ${stats.threadingRate.toFixed(1)}% threaded, avg jump: ${stats.avgJump.toFixed(1)}, max jump: ${stats.maxJump}`);

  // Find dominant thread jump in settled region (last 2000 iterations)
  const threadJumps = {};
  const startCheck = Math.max(0, board.threading.refThreading.length - 2000);
  for (let i = startCheck; i < board.threading.refThreading.length; i++) {
    const thread = board.threading.refThreading[i];
    if (thread.next >= 0) {
      const jump = thread.next - i;
      threadJumps[jump] = (threadJumps[jump] || 0) + 1;
    }
  }

  // Find most common jump
  let dominantJump = 0;
  let maxCount = 0;
  for (const jump in threadJumps) {
    const count = threadJumps[jump];
    if (count > maxCount) {
      maxCount = count;
      dominantJump = parseInt(jump);
    }
  }

  console.log(`  Dominant thread jump: ${dominantJump} (${maxCount} occurrences)`);

  // Verify expectations
  let testPassed = true;

  if (unfinished > 0) {
    console.log(`  ✗ FAIL: ${unfinished} pixels remain unfinished`);
    testPassed = false;
    allPassed = false;
  } else {
    console.log(`  ✓ All pixels finished`);
  }

  if (testCase.expectedThreadJump && dominantJump !== testCase.expectedThreadJump) {
    console.log(`  ✗ FAIL: Expected thread jump ${testCase.expectedThreadJump}, got ${dominantJump}`);
    testPassed = false;
    allPassed = false;
  } else if (testCase.expectedThreadJump) {
    console.log(`  ✓ Thread jump matches expected: ${dominantJump}`);
  }

  if (testPassed) {
    console.log(`  ✓ PASS`);
  }

  console.log('');
}

console.log('='.repeat(80));
if (allPassed) {
  console.log('✓ ALL TESTS PASSED');
} else {
  console.log('✗ SOME TESTS FAILED');
}
console.log('='.repeat(80));

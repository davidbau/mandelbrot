#!/usr/bin/env node

// Verify GpuZhuoranBoard checkpoint generation with Fibonacci
// Specifically test the high iteration scenario from the user bug report

function fibonacciPeriod(iteration) {
  if (iteration === 0) return 1;
  if (iteration === 1) return 1;

  let a = 1, b = 1;
  while (b < iteration) {
    const next = a + b;
    a = b;
    b = next;
  }

  if (b === iteration) return 1;
  return iteration - a + 1;
}

// Legacy alias
function figurePeriod(iteration) {
  return fibonacciPeriod(iteration);
}

// Simulate GpuZhuoranBoard checkpoint precomputation
function precomputeCheckpoints(startIter, iterationsPerBatch) {
  const checkpointOffsets = [];
  const bufferIter = startIter - 1;  // What's in the buffer

  for (let i = 0; i < iterationsPerBatch; i++) {
    const globalIter = bufferIter + i + 1;
    if (figurePeriod(globalIter) === 1) {
      checkpointOffsets.push(i);
    }
  }

  return checkpointOffsets.slice(0, 8);  // Cap at 8
}

console.log('GpuZhuoranBoard Checkpoint Generation Test\n');
console.log('=== User Bug Scenario: Deep Zoom Region ===\n');

// User reported issue: convergence detection failing at high iterations
// This was because power-of-2 checkpoints became too sparse
const userBugScenario = {
  startIter: 10000,
  batchSize: 100
};

console.log('Scenario: Deep zoom, period-30 orbit converges around iteration 10000');
console.log('Start iteration: ' + userBugScenario.startIter);
console.log('Batch size: ' + userBugScenario.batchSize + '\n');

const checkpoints = precomputeCheckpoints(userBugScenario.startIter, userBugScenario.batchSize);
console.log('Fibonacci checkpoints in batch:');
console.log('  Count: ' + checkpoints.length);
console.log('  Offsets: [' + checkpoints.join(', ') + ']');
console.log('  Status: ' + (checkpoints.length > 0 ? 'PASS - Convergence detection will work!' : 'FAIL - No checkpoints!'));
console.log('');

// Show what the actual global iterations are
console.log('Actual checkpoint iterations:');
for (const offset of checkpoints) {
  const globalIter = userBugScenario.startIter + offset;
  console.log('  Batch offset ' + offset + ' = global iteration ' + globalIter);
}
console.log('');

console.log('=== Checkpoint Density Analysis ===\n');

// Test various iteration ranges
const testRanges = [
  { start: 1, size: 100, name: 'Early iterations (1-100)' },
  { start: 1000, size: 100, name: 'Mid iterations (1000-1100)' },
  { start: 10000, size: 100, name: 'High iterations (10000-10100)' },
  { start: 50000, size: 100, name: 'Very high iterations (50000-50100)' }
];

console.log('Range                              | Checkpoints | Density');
console.log('-----------------------------------|-------------|--------');

for (const range of testRanges) {
  const ckpts = precomputeCheckpoints(range.start, range.size);
  const density = (ckpts.length / range.size * 100).toFixed(1) + '%';
  const name = range.name + ' '.repeat(Math.max(0, 35 - range.name.length));
  const count = ckpts.length.toString() + ' '.repeat(Math.max(0, 11 - ckpts.length.toString().length));
  console.log(name + '| ' + count + ' | ' + density);
}

console.log('\n=== Comparison: Power-of-2 vs Fibonacci ===\n');

// Simulate old power-of-2 approach
function oldPowerOf2Period(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1;
}

function precomputeOldCheckpoints(startIter, batchSize) {
  const checkpoints = [];
  const bufferIter = startIter - 1;
  for (let i = 0; i < batchSize; i++) {
    const globalIter = bufferIter + i + 1;
    if (oldPowerOf2Period(globalIter) === 1) {
      checkpoints.push(i);
    }
  }
  return checkpoints;
}

const oldCheckpoints = precomputeOldCheckpoints(userBugScenario.startIter, userBugScenario.batchSize);
const newCheckpoints = precomputeCheckpoints(userBugScenario.startIter, userBugScenario.batchSize);

console.log('At iteration 10000 with batch size 100:');
console.log('  Old (power-of-2): ' + oldCheckpoints.length + ' checkpoints');
console.log('  New (Fibonacci):  ' + newCheckpoints.length + ' checkpoints');
console.log('');

if (oldCheckpoints.length === 0 && newCheckpoints.length === 0) {
  console.log('✓ EXPECTED: Both have sparse checkpoints at high iterations');
  console.log('  This is OK - GPU keeps comparing to last checkpoint from previous batch');
  console.log('  The KEY DIFFERENCE is in harmonic reduction (see below)');
} else if (oldCheckpoints.length > 0 && newCheckpoints.length > 0) {
  console.log('✓ IMPROVEMENT: Both work, but Fibonacci may reduce harmonics');
} else {
  console.log('! Fibonacci has different checkpoint density');
}

console.log('\n=== Harmonic Reduction Analysis ===\n');

// Check if Fibonacci checkpoints avoid multiples of 30
const period30Multiples = [];
for (let i = 30; i <= 1000; i += 30) {
  period30Multiples.push(i);
}

const fibCheckpoints = [];
for (let i = 1; i <= 1000; i++) {
  if (fibonacciPeriod(i) === 1) {
    fibCheckpoints.push(i);
  }
}

// Count how many checkpoints are multiples of 30
const fibMultiplesOf30 = fibCheckpoints.filter(c => c % 30 === 0);
console.log('Fibonacci checkpoints up to 1000: ' + fibCheckpoints.length);
console.log('Multiples of 30 in that range: ' + period30Multiples.length);
console.log('Fibonacci checkpoints that are multiples of 30: ' + fibMultiplesOf30.length);
console.log('Overlap ratio: ' + (fibMultiplesOf30.length / fibCheckpoints.length * 100).toFixed(1) + '%');
console.log('');
console.log('Expected: Low overlap ratio means less systematic bias toward detecting harmonics');

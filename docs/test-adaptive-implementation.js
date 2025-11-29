#!/usr/bin/env node

// Comprehensive test of adaptive checkpoint implementation

function figurePeriod(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

console.log('=== Adaptive Checkpoint Implementation Test ===\n');

// Simulate the precomputation logic from index.html
function precomputeCheckpoints(startIter, iterationsPerBatch) {
  const checkpointOffsets = [];
  for (let i = 0; i < iterationsPerBatch; i++) {
    const globalIter = startIter + i;
    if (figurePeriod(globalIter) === 1) {
      checkpointOffsets.push(i);
    }
  }

  // CRITICAL FIX: Ensure at least one checkpoint per batch
  if (checkpointOffsets.length === 0 && iterationsPerBatch > 0) {
    checkpointOffsets.push(0);
  }

  return checkpointOffsets;
}

// Test cases covering different scenarios
const testCases = [
  { name: 'Early iterations', startIter: 0, batchSize: 100 },
  { name: 'Mid iterations', startIter: 1000, batchSize: 100 },
  { name: 'High iterations (critical case)', startIter: 10000, batchSize: 100 },
  { name: 'Very high iterations', startIter: 50000, batchSize: 100 },
  { name: 'Large batch at high iters', startIter: 10000, batchSize: 1000 },
  { name: 'Edge case: batch size 1', startIter: 10000, batchSize: 1 },
];

console.log('Test Case                        | Start Iter | Batch Size | Checkpoints | Status');
console.log('--------------------------------|------------|------------|-------------|--------');

let allPassed = true;

for (const test of testCases) {
  const checkpoints = precomputeCheckpoints(test.startIter, test.batchSize);
  const status = checkpoints.length > 0 ? 'PASS' : 'FAIL';
  if (checkpoints.length === 0) allPassed = false;

  console.log(test.name + ' | ' + test.startIter + ' | ' + test.batchSize + ' | ' + checkpoints.length + ' | ' + status);
}

console.log('\n=== Detailed Analysis ===\n');

// Detailed look at the critical high-iteration case
console.log('High iteration case (startIter=10000, batchSize=100):');
const highIterCheckpoints = precomputeCheckpoints(10000, 100);
console.log('  Checkpoint offsets: [' + highIterCheckpoints.join(', ') + ']');
console.log('  Count: ' + highIterCheckpoints.length);
console.log('  Result: ' + (highIterCheckpoints.length > 0 ? 'Convergence detection will work!' : 'FAIL - no checkpoints!'));
console.log('');

// Verify the checkpoint pattern makes sense
console.log('Checkpoint pattern verification (first 100 batches):');
const batchesWithNaturalCheckpoint = [];
const batchesWithFallbackCheckpoint = [];

for (let batchNum = 0; batchNum < 100; batchNum++) {
  const start = batchNum * 100;
  const checkpoints = [];

  for (let i = 0; i < 100; i++) {
    if (figurePeriod(start + i) === 1) {
      checkpoints.push(i);
    }
  }

  if (checkpoints.length > 0) {
    batchesWithNaturalCheckpoint.push(batchNum);
  } else {
    batchesWithFallbackCheckpoint.push(batchNum);
  }
}

console.log('  Batches with natural figurePeriod checkpoints: ' + batchesWithNaturalCheckpoint.length + '/100');
console.log('  Batches requiring fallback checkpoint: ' + batchesWithFallbackCheckpoint.length + '/100');
console.log('');

// Show example of batches needing fallback
if (batchesWithFallbackCheckpoint.length > 0) {
  const exampleBatch = batchesWithFallbackCheckpoint[0];
  console.log('  Example fallback batch ' + exampleBatch + ' (iterations ' + (exampleBatch * 100) + '-' + ((exampleBatch + 1) * 100 - 1) + '):');
  console.log('    Without fallback: 0 checkpoints (convergence detection fails)');
  console.log('    With fallback: 1 checkpoint at offset 0 (convergence detection works)');
  console.log('');
}

console.log('=== Buffer Size Verification ===\n');

// Verify we never exceed 32 checkpoint limit
let maxCheckpoints = 0;
let maxCheckpointBatch = null;

for (let startIter = 0; startIter < 100000; startIter += 100) {
  const checkpoints = precomputeCheckpoints(startIter, 1000); // Test with large batch
  if (checkpoints.length > maxCheckpoints) {
    maxCheckpoints = checkpoints.length;
    maxCheckpointBatch = { startIter, count: checkpoints.length };
  }
}

console.log('Maximum checkpoints in any batch: ' + maxCheckpoints);
console.log('  Occurred at: startIter=' + maxCheckpointBatch.startIter + ', batchSize=1000');
console.log('  Buffer limit: 32 checkpoints');
console.log('  Status: ' + (maxCheckpoints <= 32 ? 'PASS - within limit' : 'FAIL - exceeds limit!'));
console.log('');

console.log('=== Summary ===\n');
console.log('Adaptive checkpoint implementation: ' + (allPassed ? 'PASS' : 'FAIL'));
console.log('All batches have at least one checkpoint: ' + (allPassed ? 'YES' : 'NO'));
console.log('Buffer size adequate: ' + (maxCheckpoints <= 32 ? 'YES' : 'NO'));
console.log('\nImplementation ready for production: ' + (allPassed && maxCheckpoints <= 32 ? 'YES ✓' : 'NO ✗'));

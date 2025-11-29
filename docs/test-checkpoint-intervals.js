#!/usr/bin/env node

// Investigate checkpoint intervals at various iteration counts

function figurePeriod(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

console.log('Checkpoint intervals at different iteration counts\n');

// Check what tail value is used at various iterations
function getTailAndInterval(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return { tail, period: figurePeriod(iteration), interval: tail };
}

const testIterations = [0, 100, 1000, 5000, 10000, 15000, 20000, 30000, 50000, 100000];

console.log('Iteration | Tail | Period | Checkpoint Interval');
console.log('----------|------|--------|-------------------');
for (const iter of testIterations) {
  const { tail, period } = getTailAndInterval(iter);
  console.log(iter + ' | ' + tail + ' | ' + period + ' | ' + tail + ' iterations');
}

console.log('\nFinding actual checkpoints around iteration 10000:');
const checkpoints = [];
for (let iter = 9000; iter < 16000; iter++) {
  if (figurePeriod(iter) === 1) {
    checkpoints.push(iter);
  }
}
console.log(`Checkpoints in range 9000-16000: [${checkpoints.join(', ')}]`);

// Calculate intervals between checkpoints
console.log('\nIntervals between consecutive checkpoints:');
for (let i = 1; i < checkpoints.length; i++) {
  const interval = checkpoints[i] - checkpoints[i-1];
  console.log(`  ${checkpoints[i-1]} -> ${checkpoints[i]}: ${interval} iterations`);
}

console.log('\n\nKey insight:');
console.log('At high iteration counts, figurePeriod creates very sparse checkpoints.');
console.log('This is by design - it assumes convergence happens early.');
console.log('For deep zoom regions where convergence happens after 10k+ iterations,');
console.log('the checkpoint intervals are TOO LARGE to effectively detect small periods like 30.\n');

// Show what happens in a batch starting at iteration 10000
console.log('Example: Batch of 100 iterations starting at iter=10000');
const batchStart = 10000;
const batchSize = 100;
const batchCheckpoints = [];
for (let i = 0; i < batchSize; i++) {
  if (figurePeriod(batchStart + i) === 1) {
    batchCheckpoints.push(i);
  }
}
console.log(`  Checkpoint offsets in batch: [${batchCheckpoints.join(', ')}]`);
console.log(`  Count: ${batchCheckpoints.length}`);
if (batchCheckpoints.length === 0) {
  console.log('  Result: NO checkpoints in this batch - period detection will fail!');
}

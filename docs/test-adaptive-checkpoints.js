#!/usr/bin/env node

// Test adaptive checkpoint precomputation

// Load figurePeriod from index.html
function figurePeriod(iteration) {
  // Returns 1 plus the number of iterations since the most recent multiple
  // of a high power-of-two-exceeding-3/4-digits-of(iteration).
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

console.log('Testing adaptive checkpoint precomputation\n');

// Test 1: Small batch starting at iteration 0
console.log('Test 1: Batch of 100 iterations starting at iter=0');
const batch1Size = 100;
const batch1Start = 0;
const checkpoints1 = [];
for (let i = 0; i < batch1Size; i++) {
  const globalIter = batch1Start + i;
  if (figurePeriod(globalIter) === 1) {
    checkpoints1.push(i);
  }
}
console.log(`  Checkpoint offsets: [${checkpoints1.join(', ')}]`);
console.log(`  Count: ${checkpoints1.length}\n`);

// Test 2: Batch starting at iteration 1000
console.log('Test 2: Batch of 100 iterations starting at iter=1000');
const batch2Size = 100;
const batch2Start = 1000;
const checkpoints2 = [];
for (let i = 0; i < batch2Size; i++) {
  const globalIter = batch2Start + i;
  if (figurePeriod(globalIter) === 1) {
    checkpoints2.push(i);
  }
}
console.log(`  Checkpoint offsets: [${checkpoints2.join(', ')}]`);
console.log(`  Count: ${checkpoints2.length}\n`);

// Test 3: Larger batch to ensure we don't exceed max checkpoints
console.log('Test 3: Batch of 1000 iterations starting at iter=10000');
const batch3Size = 1000;
const batch3Start = 10000;
const checkpoints3 = [];
for (let i = 0; i < batch3Size; i++) {
  const globalIter = batch3Start + i;
  if (figurePeriod(globalIter) === 1) {
    checkpoints3.push(i);
  }
}
console.log(`  Checkpoint offsets: [${checkpoints3.slice(0, 10).join(', ')}${checkpoints3.length > 10 ? ', ...' : ''}]`);
console.log(`  Count: ${checkpoints3.length}`);
console.log(`  Max checkpoint offset: ${Math.max(...checkpoints3)}`);
if (checkpoints3.length > 32) {
  console.log(`  WARNING: More than 32 checkpoints! May exceed buffer size.\n`);
} else {
  console.log(`  OK: Within 32 checkpoint limit\n`);
}

// Test 4: Compare with power-of-2 checkpoints
console.log('Test 4: Comparing adaptive vs power-of-2 checkpoints');
const batch4Size = 100;
const batch4Start = 1000;
const adaptiveCheckpoints = [];
const powerOf2Checkpoints = [];

for (let i = 0; i < batch4Size; i++) {
  const globalIter = batch4Start + i;

  // Adaptive
  if (figurePeriod(globalIter) === 1) {
    adaptiveCheckpoints.push(i);
  }

  // Power of 2
  if (globalIter > 0 && (globalIter & (globalIter - 1)) === 0) {
    powerOf2Checkpoints.push(i);
  }
}

console.log(`  Adaptive checkpoints: [${adaptiveCheckpoints.join(', ')}]`);
console.log(`  Power-of-2 checkpoints: [${powerOf2Checkpoints.join(', ')}]`);
console.log(`  Adaptive count: ${adaptiveCheckpoints.length}`);
console.log(`  Power-of-2 count: ${powerOf2Checkpoints.length}`);
console.log(`\nAdaptive checkpointing provides ${adaptiveCheckpoints.length - powerOf2Checkpoints.length} more checkpoints in this batch`);
console.log('More checkpoints = better period detection at the cost of more computation\n');

// Test 5: Verify first few checkpoint iterations match CPU implementation
console.log('Test 5: First 20 checkpoint iterations from figurePeriod');
const firstCheckpoints = [];
for (let iter = 0; iter < 10000; iter++) {
  if (figurePeriod(iter) === 1) {
    firstCheckpoints.push(iter);
    if (firstCheckpoints.length >= 20) break;
  }
}
console.log(`  [${firstCheckpoints.join(', ')}]`);
console.log('\nThese should match CPU ZhuoranBoard checkpoint intervals');

#!/usr/bin/env node

// Test period detection bug at c = 0.118 + 0i
// GPU reports period 2 after 17 iterations
// CPU reports convergence (presumably different period)

const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf-8');

// Extract and eval the required code from index.html
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('Could not find script in index.html');
  process.exit(1);
}

// We need to extract just the utility functions and board classes
// Define figurePeriod function (extracted from index.html, adapted for old Node)
function figurePeriod(iteration) {
  // Returns 1 plus the number of iterations since the most recent multiple
  // of a high power-of-two-exceeding-3/4-digits-of(iteration).
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

console.log('Testing c = 0.118 + 0i');
console.log('Expected: GPU reports period 2 after 17 iterations');
console.log('');

// Test what figurePeriod returns for iteration 17
console.log(`figurePeriod(17) = ${figurePeriod(17)}`);

// Let me check what checkpoints would be saved
console.log('\nCheckpoint iterations (where figurePeriod returns 1):');
for (let i = 0; i <= 20; i++) {
  const fp = figurePeriod(i);
  if (fp === 1) {
    console.log(`  Iteration ${i}: checkpoint saved`);
  }
}

console.log('\nPower-of-2 iterations (GPU checkpoints):');
function is_power_of_2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

for (let i = 0; i <= 20; i++) {
  if (is_power_of_2(i)) {
    console.log(`  Iteration ${i}: checkpoint saved`);
  }
}

// Manually trace through the iterations for c = 0.118
console.log('\n\nManual iteration trace for c = 0.118:');
const c = 0.118;
let z = c;  // Start with z = c
const epsilon = 1e-12;
const epsilon2 = 1e-9;

// CPU-style simulation
console.log('\nCPU-style (figurePeriod):');
let it = 1;
let bb = 0;  // checkpoint z
let pp = 0;  // period detection
for (let iter = 0; iter < 30; iter++) {
  // Check if we should save checkpoint (BEFORE compute)
  if (figurePeriod(it) === 1) {
    bb = z;
    pp = 0;
    console.log(`  it=${it}: Checkpoint saved, bb=${bb.toFixed(10)}, pp=0`);
  }

  // Compute new z
  const z_old = z;
  z = z * z + c;

  // Check convergence
  const db = Math.abs(z - bb);
  if (db <= epsilon2) {
    if (pp === 0) {
      pp = it;
      console.log(`  it=${it}: First detected convergence, pp=${pp}, db=${db.toExponential(3)}`);
    }
    if (db <= epsilon) {
      console.log(`  it=${it}: CONVERGED! pp=${pp}, period=${figurePeriod(pp)}, db=${db.toExponential(3)}`);
      break;
    }
  }

  if (iter < 5 || db <= epsilon2) {
    console.log(`  it=${it}: z=${z.toFixed(10)}, db=${db.toExponential(3)}`);
  }

  it++;
}

// GPU-style simulation
console.log('\n\nGPU-style (is_power_of_2):');
z = c;  // Reset
let gpu_iter = 0;
let base = 0;  // checkpoint z
let p = 0;  // period detection

for (let batch = 0; batch < 30; batch++) {
  // GPU increments FIRST
  gpu_iter++;

  // Check if we should save checkpoint (BEFORE compute)
  if (is_power_of_2(gpu_iter)) {
    base = z;
    p = 0;
    console.log(`  iter=${gpu_iter}: Checkpoint saved, base=${base.toFixed(10)}, p=0`);
  }

  // Compute new z
  z = z * z + c;

  // Check convergence
  const db = Math.abs(z - base);
  if (db <= epsilon2) {
    if (p === 0) {
      p = gpu_iter;
      console.log(`  iter=${gpu_iter}: First detected convergence, p=${p}, db=${db.toExponential(3)}`);
    }
    if (db <= epsilon) {
      console.log(`  iter=${gpu_iter}: CONVERGED! p=${p}, period=${figurePeriod(p)}, db=${db.toExponential(3)}`);
      break;
    }
  }

  if (batch < 5 || db <= epsilon2) {
    console.log(`  iter=${gpu_iter}: z=${z.toFixed(10)}, db=${db.toExponential(3)}`);
  }
}

console.log('\n\nDifference summary:');
console.log('If there are differences in when checkpoints are saved or when');
console.log('convergence is detected, that would explain the period bug.');

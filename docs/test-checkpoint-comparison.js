#!/usr/bin/env node

// Compare adaptive checkpoints vs power-of-2 checkpoints

function figurePeriod(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

function isPowerOf2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

console.log('Comparing checkpoint strategies\n');

// Find all checkpoints in first 5000 iterations
const adaptiveCheckpoints = [];
const powerOf2Checkpoints = [];

for (let iter = 0; iter < 5000; iter++) {
  if (figurePeriod(iter) === 1) {
    adaptiveCheckpoints.push(iter);
  }
  if (isPowerOf2(iter)) {
    powerOf2Checkpoints.push(iter);
  }
}

console.log(`Adaptive checkpoints (first 30): [${adaptiveCheckpoints.slice(0, 30).join(', ')}]`);
console.log(`Power-of-2 checkpoints (first 30): [${powerOf2Checkpoints.slice(0, 30).join(', ')}]\n`);

console.log(`Total in first 5000 iterations:`);
console.log(`  Adaptive: ${adaptiveCheckpoints.length}`);
console.log(`  Power-of-2: ${powerOf2Checkpoints.length}\n`);

// Find differences
const adaptiveOnly = adaptiveCheckpoints.filter(x => !powerOf2Checkpoints.includes(x));
const powerOf2Only = powerOf2Checkpoints.filter(x => !adaptiveCheckpoints.includes(x));

console.log(`Adaptive-only checkpoints (not power-of-2): [${adaptiveOnly.slice(0, 20).join(', ')}${adaptiveOnly.length > 20 ? ', ...' : ''}]`);
console.log(`Power-of-2-only checkpoints (not adaptive): [${powerOf2Only.slice(0, 20).join(', ')}${powerOf2Only.length > 20 ? ', ...' : ''}]\n`);

// Key insight: which strategy is better for detecting period 30?
console.log('Period detection analysis for period-30 orbits:');
console.log('Ideal checkpoints would be multiples of 30 or at least frequent enough to detect 30-iteration cycles\n');

// Find which checkpoints are near multiples of 30
const period = 30;
const adaptiveNearMultiples = adaptiveCheckpoints.filter(cp => cp % period < 5 || cp % period > period - 5);
const powerOf2NearMultiples = powerOf2Checkpoints.filter(cp => cp % period < 5 || cp % period > period - 5);

console.log(`Adaptive checkpoints within 5 of multiples of ${period} (first 20):`);
console.log(`  [${adaptiveNearMultiples.slice(0, 20).join(', ')}]`);
console.log(`Power-of-2 checkpoints within 5 of multiples of ${period} (first 20):`);
console.log(`  [${powerOf2NearMultiples.slice(0, 20).join(', ')}]\n`);

// Check specific iteration range where period-30 detection matters
console.log('Checkpoints in iteration range 10000-15000 (where period detection is critical):');
const rangeStart = 10000;
const rangeEnd = 15000;
const adaptiveInRange = adaptiveCheckpoints.filter(cp => cp >= rangeStart && cp < rangeEnd);
const powerOf2InRange = powerOf2Checkpoints.filter(cp => cp >= rangeStart && cp < rangeEnd);

console.log(`  Adaptive: [${adaptiveInRange.join(', ')}]`);
console.log(`  Power-of-2: [${powerOf2InRange.join(', ')}]`);
console.log(`\nAdaptive provides ${adaptiveInRange.length} vs power-of-2's ${powerOf2InRange.length} checkpoints in this range`);

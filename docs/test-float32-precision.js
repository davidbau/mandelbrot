#!/usr/bin/env node

// Test to demonstrate float32 precision loss when subtracting large numbers

console.log('='.repeat(80));
console.log('FLOAT32 PRECISION LOSS TEST');
console.log('='.repeat(80));

// Simulate what happens with checkpoint convergence detection

function testSubtraction(checkpointMag, actualDelta) {
  // Simulate two nearby points on the orbit
  const checkpoint = checkpointMag;  // Large number
  const current = checkpoint + actualDelta;  // Slightly different

  // Double precision (correct)
  const deltaDouble = current - checkpoint;

  // Float32 precision (buggy)
  const checkpointF32 = Math.fround(checkpoint);
  const currentF32 = Math.fround(current);
  const deltaF32 = Math.fround(currentF32 - checkpointF32);

  // Relative error
  const relativeError = Math.abs(deltaF32 - actualDelta) / Math.abs(actualDelta);

  console.log(`\nCheckpoint magnitude: ${checkpointMag.toExponential(3)}`);
  console.log(`Actual delta: ${actualDelta.toExponential(3)}`);
  console.log(`Double precision result: ${deltaDouble.toExponential(3)}`);
  console.log(`Float32 result: ${deltaF32.toExponential(3)}`);
  console.log(`Error: ${Math.abs(deltaF32 - actualDelta).toExponential(3)}`);
  console.log(`Relative error: ${(relativeError * 100).toFixed(2)}%`);

  return { checkpointMag, actualDelta, deltaDouble, deltaF32, relativeError };
}

// Test cases with different magnitudes
console.log('\n' + '-'.repeat(80));
console.log('Test 1: Small checkpoint magnitude (no precision loss expected)');
console.log('-'.repeat(80));
testSubtraction(0.1, 1e-10);

console.log('\n' + '-'.repeat(80));
console.log('Test 2: Medium checkpoint magnitude (some precision loss)');
console.log('-'.repeat(80));
testSubtraction(10.0, 1e-10);

console.log('\n' + '-'.repeat(80));
console.log('Test 3: Large checkpoint magnitude (severe precision loss)');
console.log('-'.repeat(80));
testSubtraction(1000.0, 1e-10);

console.log('\n' + '-'.repeat(80));
console.log('Test 4: Very large checkpoint magnitude (catastrophic precision loss)');
console.log('-'.repeat(80));
testSubtraction(1e6, 1e-10);

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS: Float32 precision');
console.log('='.repeat(80));

const float32Mantissa = 23;  // 23 bits
const float32Precision = 1.0 / (1 << float32Mantissa);  // ~1.2e-7

console.log(`Float32 mantissa bits: ${float32Mantissa}`);
console.log(`Float32 relative precision: ${float32Precision.toExponential(2)}`);
console.log(`\nWhen subtracting two float32 numbers of magnitude M:`);
console.log(`  Absolute precision: M * ${float32Precision.toExponential(2)}`);
console.log(`\nExample: For checkpoint magnitude 1000:`);
console.log(`  Absolute precision: 1000 * ${float32Precision.toExponential(2)} = ${(1000 * float32Precision).toExponential(2)}`);
console.log(`  If epsilon threshold is ${(1e-10).toExponential(0)}, comparison is MEANINGLESS!`);

console.log('\n' + '='.repeat(80));
console.log('CONCLUSION');
console.log('='.repeat(80));
console.log(`When checkpoints store ABSOLUTE z positions (not dz perturbations):`);
console.log(`1. Checkpoint magnitudes can grow very large (|z| >> 1)`);
console.log(`2. Subtracting large float32 numbers loses precision`);
console.log(`3. The computed delta may be SMALLER than epsilon due to precision loss`);
console.log(`4. This causes FALSE CONVERGENCE detection!`);
console.log(`\nSOLUTION: Store perturbations (dz) in checkpoints, not absolute positions.`);
console.log(`Or: Use tighter rebasing to keep |z| small.`);
console.log(`Or: Only check convergence when |dz| is small enough for precision.`);

console.log('\n' + '='.repeat(80));

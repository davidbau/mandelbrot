#!/usr/bin/env node

// Test if period 30 exists for c = -0.665232300 + 0.460183700i

const c_re = -0.665232300;
const c_im = 0.460183700;

console.log(`Testing if period 30 exists for c = ${c_re} + ${c_im}i`);
console.log('');

// Iterate to settling point (after 100000 iterations for full settling)
let z_re = 0;
let z_im = 0;

for (let i = 0; i < 100000; i++) {
  const temp_re = z_re * z_re - z_im * z_im + c_re;
  const temp_im = 2 * z_re * z_im + c_im;
  z_re = temp_re;
  z_im = temp_im;
}

console.log(`After 100000 iterations (fully settled):`);
console.log(`z = (${z_re.toFixed(15)}, ${z_im.toFixed(15)})`);
console.log('');

// Now test periods 30, 60, 90, 120
const periodsToTest = [30, 60, 90, 120];

for (const period of periodsToTest) {
  let test_re = z_re;
  let test_im = z_im;

  // Iterate for 'period' iterations
  for (let i = 0; i < period; i++) {
    const temp_re = test_re * test_re - test_im * test_im + c_re;
    const temp_im = 2 * test_re * test_im + c_im;
    test_re = temp_re;
    test_im = temp_im;
  }

  const delta_re = test_re - z_re;
  const delta_im = test_im - z_im;
  const dist = Math.max(Math.abs(delta_re), Math.abs(delta_im));

  console.log(`Period ${period}:`);
  console.log(`  After ${period} iterations: z = (${test_re.toFixed(15)}, ${test_im.toFixed(15)})`);
  console.log(`  Distance from start: ${dist.toExponential(6)}`);

  if (dist < 1e-10) {
    console.log(`  ✓ Period ${period} is VALID (tight tolerance)`);
  } else if (dist < 1e-6) {
    console.log(`  ~ Period ${period} is possible (loose tolerance)`);
  } else {
    console.log(`  ✗ Period ${period} is NOT valid`);
  }
  console.log('');
}

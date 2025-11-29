#!/usr/bin/env node

// Test the specific pixel that's detecting period 60 instead of 30
// Pixel c = -0.66522504 + 0.46018822i
// Reference c = -0.6652323 + 0.4601837i

const pixel_c_re = -0.66522504;
const pixel_c_im = 0.46018822;

console.log(`Testing pixel c = ${pixel_c_re} + ${pixel_c_im}i`);
console.log('');

// Iterate to settling point
let z_re = 0;
let z_im = 0;

const settleIters = 50000;
for (let i = 0; i < settleIters; i++) {
  const temp_re = z_re * z_re - z_im * z_im + pixel_c_re;
  const temp_im = 2 * z_re * z_im + pixel_c_im;
  z_re = temp_re;
  z_im = temp_im;
}

console.log(`After ${settleIters} iterations (settled):`);
console.log(`z = (${z_re.toFixed(15)}, ${z_im.toFixed(15)})`);
console.log('');

// Test periods around 30 and 60
const periodsToTest = [15, 30, 45, 60, 90, 120];

console.log('Testing various periods:');
for (const period of periodsToTest) {
  let test_re = z_re;
  let test_im = z_im;

  for (let i = 0; i < period; i++) {
    const temp_re = test_re * test_re - test_im * test_im + pixel_c_re;
    const temp_im = 2 * test_re * test_im + pixel_c_im;
    test_re = temp_re;
    test_im = temp_im;
  }

  const delta_re = test_re - z_re;
  const delta_im = test_im - z_im;
  const dist = Math.max(Math.abs(delta_re), Math.abs(delta_im));

  const periodStr = ('   ' + period).slice(-3);
  console.log(`Period ${periodStr}: distance = ${dist.toExponential(6)}`);
}

console.log('');
console.log('Now simulating what happens with checkpoints at power-of-2 iterations:');
console.log('');

// Simulate checkpoint-based detection
// Start fresh
z_re = 0;
z_im = 0;

// Track checkpoints
const checkpoints = [];

for (let iter = 0; iter <= 32768; iter++) {
  // Create checkpoint at power-of-2
  if ((iter & (iter - 1)) === 0 && iter > 0) {
    checkpoints.push({
      iter: iter,
      z_re: z_re,
      z_im: z_im
    });
    console.log(`Checkpoint created at iteration ${iter}`);
  }

  // Iterate
  const temp_re = z_re * z_re - z_im * z_im + pixel_c_re;
  const temp_im = 2 * z_re * z_im + pixel_c_im;
  z_re = temp_re;
  z_im = temp_im;

  // Check distance to most recent checkpoint (after settling)
  if (iter > 10000 && checkpoints.length > 0) {
    const lastCheckpoint = checkpoints[checkpoints.length - 1];
    const delta_re = z_re - lastCheckpoint.z_re;
    const delta_im = z_im - lastCheckpoint.z_im;
    const dist = Math.max(Math.abs(delta_re), Math.abs(delta_im));

    // Typical epsilon2 for this zoom level
    const pixel_size = 1.369e-7;
    const epsilon2 = Math.min(1e-9, pixel_size * 10);

    if (dist <= epsilon2 && (iter - lastCheckpoint.iter) >= 10) {
      const period = iter - lastCheckpoint.iter;
      console.log(`  At iter ${iter}: distance to checkpoint ${lastCheckpoint.iter} = ${dist.toExponential(6)} (period would be ${period})`);

      // Only report first few detections
      if (iter - lastCheckpoint.iter < 200) {
        // This would be when pp is set
      }
    }
  }
}

#!/usr/bin/env node

// High-precision test to find the true period of a specific point
// c = -0.665232300 + 0.460183700i

const c_re = -0.665232300;
const c_im = 0.460183700;

console.log(`Finding true period of c = ${c_re} + ${c_im}i`);
console.log('');

// Iterate the Mandelbrot function z_{n+1} = z_n^2 + c
let z_re = 0;
let z_im = 0;

// Store orbit points to detect periodicity
const orbit = [];
const maxIters = 100000;

// Very tight epsilon for detecting true period
const epsilon = 1e-14;

for (let iter = 0; iter < maxIters; iter++) {
  // Store current point
  orbit.push({ re: z_re, im: z_im });

  // Check if we've returned close to any previous point
  // Only check after settling (skip first 5000 iterations to ensure full settling)
  if (iter > 5000) {
    // Check against ALL previous points to find smallest period
    for (let i = 0; i < iter; i++) {
      const old_re = orbit[i].re;
      const old_im = orbit[i].im;

      const delta_re = z_re - old_re;
      const delta_im = z_im - old_im;
      const dist = Math.max(Math.abs(delta_re), Math.abs(delta_im));

      if (dist < epsilon) {
        const period = iter - i;
        console.log(`Found period: ${period}`);
        console.log(`  At iteration ${iter}, returned to iteration ${i}`);
        console.log(`  Distance: ${dist.toExponential(3)}`);
        console.log(`  z = (${z_re.toFixed(15)}, ${z_im.toFixed(15)})`);
        console.log(`  old_z = (${old_re.toFixed(15)}, ${old_im.toFixed(15)})`);

        // Verify by iterating period more times
        console.log('');
        console.log('Verifying period by continuing iteration...');
        let verify_re = z_re;
        let verify_im = z_im;

        for (let j = 0; j < period; j++) {
          const temp_re = verify_re * verify_re - verify_im * verify_im + c_re;
          const temp_im = 2 * verify_re * verify_im + c_im;
          verify_re = temp_re;
          verify_im = temp_im;
        }

        const verify_delta_re = verify_re - z_re;
        const verify_delta_im = verify_im - z_im;
        const verify_dist = Math.max(Math.abs(verify_delta_re), Math.abs(verify_delta_im));

        console.log(`After ${period} more iterations:`);
        console.log(`  z = (${verify_re.toFixed(15)}, ${verify_im.toFixed(15)})`);
        console.log(`  Distance from start: ${verify_dist.toExponential(3)}`);

        if (verify_dist < epsilon * 10) {
          console.log(`✓ Period ${period} confirmed!`);
        } else {
          console.log(`✗ Period ${period} NOT confirmed, continuing search...`);
          continue;
        }

        process.exit(0);
      }
    }
  }

  // Mandelbrot iteration: z = z^2 + c
  const temp_re = z_re * z_re - z_im * z_im + c_re;
  const temp_im = 2 * z_re * z_im + c_im;
  z_re = temp_re;
  z_im = temp_im;

  // Check for divergence
  const mag_sq = z_re * z_re + z_im * z_im;
  if (mag_sq > 4) {
    console.log(`Point diverges at iteration ${iter}`);
    process.exit(1);
  }

  // Progress indicator
  if (iter % 10000 === 0 && iter > 0) {
    console.log(`Iteration ${iter}: z = (${z_re.toFixed(6)}, ${z_im.toFixed(6)}), |z| = ${Math.sqrt(mag_sq).toFixed(6)}`);
  }
}

console.log('');
console.log(`No period found within ${maxIters} iterations`);
console.log(`Final z = (${z_re.toFixed(15)}, ${z_im.toFixed(15)})`);

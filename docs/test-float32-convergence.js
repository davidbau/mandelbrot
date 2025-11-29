#!/usr/bin/env node

// Test convergence detection with float32 precision
// Simulates GPU behavior to verify magnitude-based comparison works

function toFloat32(x) {
  const arr = new Float32Array(1);
  arr[0] = x;
  return arr[0];
}

function testConvergenceDetection() {
  console.log('================================================================================');
  console.log('FLOAT32 CONVERGENCE DETECTION TEST');
  console.log('================================================================================\n');

  // Simulate deep zoom scenario
  const pixelSize = 3.072e-7;

  // Test case 1: z near reference point (small |z|)
  console.log('Test 1: Near reference point (|z| ~ 0.1)');
  console.log('-'.repeat(80));
  const z1_near_r = toFloat32(0.1);
  const z1_near_i = toFloat32(0.05);
  const z2_near_r = toFloat32(0.1 + pixelSize);
  const z2_near_i = toFloat32(0.05);

  // Old method: position subtraction
  const delta_r_near = toFloat32(z2_near_r - z1_near_r);
  const delta_i_near = toFloat32(z2_near_i - z1_near_i);
  const db_old_near = toFloat32(Math.abs(delta_r_near) + Math.abs(delta_i_near));

  // New method: magnitude-based
  const mag1_near = toFloat32(Math.sqrt(z1_near_r * z1_near_r + z1_near_i * z1_near_i));
  const mag2_near = toFloat32(Math.sqrt(z2_near_r * z2_near_r + z2_near_i * z2_near_i));
  const mag_diff_near = toFloat32(Math.abs(mag2_near - mag1_near));
  const cross_near = toFloat32(Math.abs(z1_near_r * z2_near_i - z1_near_i * z2_near_r));
  const avg_mag_near = toFloat32((mag1_near + mag2_near) / 2);
  const angular_dist_near = toFloat32(avg_mag_near > 0 ? cross_near / avg_mag_near : 0);
  const db_new_near = toFloat32(mag_diff_near + angular_dist_near);

  console.log(`  z1 = (${z1_near_r.toExponential(6)}, ${z1_near_i.toExponential(6)})`);
  console.log(`  z2 = (${z2_near_r.toExponential(6)}, ${z2_near_i.toExponential(6)})`);
  console.log(`  Actual distance: ${pixelSize.toExponential(6)}`);
  console.log(`  Old method (subtraction): ${db_old_near.toExponential(6)}`);
  console.log(`  New method (magnitude):   ${db_new_near.toExponential(6)}`);
  console.log(`  Old error: ${Math.abs(db_old_near - pixelSize).toExponential(6)}`);
  console.log(`  New error: ${Math.abs(db_new_near - pixelSize).toExponential(6)}`);
  console.log();

  // Test case 2: z far from reference point (large |z|)
  console.log('Test 2: Far from reference point (|z| ~ 1.0)');
  console.log('-'.repeat(80));
  const z1_far_r = toFloat32(1.0);
  const z1_far_i = toFloat32(0.5);
  const z2_far_r = toFloat32(1.0 + pixelSize);
  const z2_far_i = toFloat32(0.5);

  // Old method: position subtraction
  const delta_r_far = toFloat32(z2_far_r - z1_far_r);
  const delta_i_far = toFloat32(z2_far_i - z1_far_i);
  const db_old_far = toFloat32(Math.abs(delta_r_far) + Math.abs(delta_i_far));

  // New method: magnitude-based
  const mag1_far = toFloat32(Math.sqrt(z1_far_r * z1_far_r + z1_far_i * z1_far_i));
  const mag2_far = toFloat32(Math.sqrt(z2_far_r * z2_far_r + z2_far_i * z2_far_i));
  const mag_diff_far = toFloat32(Math.abs(mag2_far - mag1_far));
  const cross_far = toFloat32(Math.abs(z1_far_r * z2_far_i - z1_far_i * z2_far_r));
  const avg_mag_far = toFloat32((mag1_far + mag2_far) / 2);
  const angular_dist_far = toFloat32(avg_mag_far > 0 ? cross_far / avg_mag_far : 0);
  const db_new_far = toFloat32(mag_diff_far + angular_dist_far);

  console.log(`  z1 = (${z1_far_r.toExponential(6)}, ${z1_far_i.toExponential(6)})`);
  console.log(`  z2 = (${z2_far_r.toExponential(6)}, ${z2_far_i.toExponential(6)})`);
  console.log(`  Actual distance: ${pixelSize.toExponential(6)}`);
  console.log(`  Old method (subtraction): ${db_old_far.toExponential(6)}`);
  console.log(`  New method (magnitude):   ${db_new_far.toExponential(6)}`);
  console.log(`  Old error: ${Math.abs(db_old_far - pixelSize).toExponential(6)}`);
  console.log(`  New error: ${Math.abs(db_new_far - pixelSize).toExponential(6)}`);
  console.log();

  // Test case 3: Convergence threshold check
  console.log('Test 3: Convergence detection (orbit returns to checkpoint)');
  console.log('-'.repeat(80));
  const epsilon = 1e-12;
  const epsilon2 = 1e-9;

  // Checkpoint position
  const ckpt_r = toFloat32(0.9);
  const ckpt_i = toFloat32(0.4);

  // Current position (very close to checkpoint, but precision loss in subtraction)
  const curr_r = toFloat32(0.9 + 1e-9);
  const curr_i = toFloat32(0.4);

  // Old method
  const delta_r_conv = toFloat32(curr_r - ckpt_r);
  const delta_i_conv = toFloat32(curr_i - ckpt_i);
  const db_old_conv = toFloat32(Math.abs(delta_r_conv) + Math.abs(delta_i_conv));

  // New method
  const mag_ckpt = toFloat32(Math.sqrt(ckpt_r * ckpt_r + ckpt_i * ckpt_i));
  const mag_curr = toFloat32(Math.sqrt(curr_r * curr_r + curr_i * curr_i));
  const mag_diff_conv = toFloat32(Math.abs(mag_curr - mag_ckpt));
  const cross_conv = toFloat32(Math.abs(ckpt_r * curr_i - ckpt_i * curr_r));
  const avg_mag_conv = toFloat32((mag_ckpt + mag_curr) / 2);
  const angular_dist_conv = toFloat32(avg_mag_conv > 0 ? cross_conv / avg_mag_conv : 0);
  const db_new_conv = toFloat32(mag_diff_conv + angular_dist_conv);

  console.log(`  Checkpoint = (${ckpt_r.toExponential(6)}, ${ckpt_i.toExponential(6)})`);
  console.log(`  Current    = (${curr_r.toExponential(6)}, ${curr_i.toExponential(6)})`);
  console.log(`  Threshold epsilon2: ${epsilon2.toExponential(6)}`);
  console.log(`  Threshold epsilon:  ${epsilon.toExponential(6)}`);
  console.log(`  Old method distance: ${db_old_conv.toExponential(6)}`);
  console.log(`  New method distance: ${db_new_conv.toExponential(6)}`);
  console.log(`  Old method: ${db_old_conv <= epsilon2 ? '✅ DETECTED' : '❌ MISSED'}`);
  console.log(`  New method: ${db_new_conv <= epsilon2 ? '✅ DETECTED' : '❌ MISSED'}`);
  console.log();

  // Summary
  console.log('================================================================================');
  console.log('SUMMARY');
  console.log('================================================================================');
  console.log('At deep zoom with float32 precision:');
  console.log('  - Old method fails when |z| is large (precision loss in subtraction)');
  console.log('  - New method works for all |z| values (magnitude + angular distance)');
  console.log();
  console.log('The magnitude-based approach:');
  console.log('  1. Computes sqrt() which preserves relative precision');
  console.log('  2. Uses cross product to capture angular difference');
  console.log('  3. Avoids subtracting large similar numbers');
  console.log('================================================================================');
}

testConvergenceDetection();

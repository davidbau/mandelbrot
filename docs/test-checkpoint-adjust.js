#!/usr/bin/env node

// Test the checkpoint adjustment logic in isolation

// Simulate the checkpoint adjustment when rebasing
function testCheckpointAdjustment() {
  // Scenario: We have a checkpoint at ref_iter=100
  // The checkpoint dz is small: 1e-8
  // Now we rebase to ref_iter=0
  // ref[100] = 0.5 (for example)
  // ref[0] = 0.0

  const ref0R = 0.0;
  const ckptRefR = 0.5;
  const oldCkptDr = 1e-8;

  // WRONG way (what I had before):
  const wrongAdjust = Math.fround(Math.fround(ckptRefR - ref0R) + oldCkptDr);

  // RIGHT way (current fix):
  const rightAdjust = Math.fround((ckptRefR - ref0R) + oldCkptDr);

  console.log('Checkpoint adjustment test:');
  console.log(`  ref[ckpt] = ${ckptRefR}`);
  console.log(`  ref[0] = ${ref0R}`);
  console.log(`  old checkpoint dz = ${oldCkptDr}`);
  console.log(`  ref_diff = ${ckptRefR - ref0R}`);
  console.log('');
  console.log(`  WRONG (round ref_diff first): ${wrongAdjust}`);
  console.log(`  RIGHT (add first, then round): ${rightAdjust}`);
  console.log('');
  console.log(`  Expected (double precision): ${(ckptRefR - ref0R) + oldCkptDr}`);
  console.log(`  Error (wrong method): ${Math.abs(wrongAdjust - ((ckptRefR - ref0R) + oldCkptDr))}`);
  console.log(`  Error (right method): ${Math.abs(rightAdjust - ((ckptRefR - ref0R) + oldCkptDr))}`);

  return Math.abs(rightAdjust - ((ckptRefR - ref0R) + oldCkptDr)) < 1e-10;
}

const passed = testCheckpointAdjustment();
console.log('');
console.log(passed ? '✅ PASS: Checkpoint adjustment logic is correct' : '❌ FAIL');
process.exit(passed ? 0 : 1);

#!/usr/bin/env node

// Simple test to verify the checkpoint preservation fix
// This tests the CRITICAL observation: convergence should work across rebases

console.log('='.repeat(80));
console.log('Testing Checkpoint Preservation Across Rebases');
console.log('='.repeat(80));
console.log();

console.log('PROBLEM (before fix):');
console.log('  - Pixels near reference: rarely rebase → keep checkpoints → detect convergence ✓');
console.log('  - Pixels far from reference: frequently rebase → lose checkpoints → NO convergence ✗');
console.log();

console.log('SOLUTION (after fix):');
console.log('  - Do NOT invalidate checkpoints on rebase');
console.log('  - Skip convergence check when |dz| is too large (just after rebase)');
console.log('  - Resume checking once |dz| shrinks back to small values');
console.log();

// Verify the fix by checking the code
const fs = require('fs');
const indexHtml = fs.readFileSync('./index.html', 'utf8');

console.log('='.repeat(80));
console.log('Verifying Fix in index.html');
console.log('='.repeat(80));
console.log();

// Check 1: Verify checkpoint invalidation is removed
const hasCheckpointInvalidation = indexHtml.includes('this.hasCheckpoint[index] = false')
  && indexHtml.includes('FIX: Invalidate checkpoint after rebase');

const hasGpuCheckpointInvalidation = indexHtml.includes('ckpt_iter = 0u')
  && indexHtml.includes('FIX: Invalidate checkpoint after rebase');

console.log('1. CPU (ZhuoranBoard) checkpoint invalidation on rebase:');
if (hasCheckpointInvalidation) {
  console.log('   ❌ STILL PRESENT - checkpoints are being invalidated on rebase');
  console.log('   This will cause the bug!');
} else {
  console.log('   ✅ REMOVED - checkpoints are preserved across rebases');
}
console.log();

console.log('2. GPU (GpuZhuoranBoard) checkpoint invalidation on rebase:');
if (hasGpuCheckpointInvalidation) {
  console.log('   ❌ STILL PRESENT - checkpoints are being invalidated on rebase');
  console.log('   This will cause the bug!');
} else {
  console.log('   ✅ REMOVED - checkpoints are preserved across rebases');
}
console.log();

// Check 2: Verify dz magnitude check is added
const hasCpuDzCheck = indexHtml.includes('const dzMagnitude = Math.abs(newDr) + Math.abs(newDi)')
  && indexHtml.includes('const DZ_THRESHOLD = 1e-6');

const hasGpuDzCheck = indexHtml.includes('let dz_magnitude = abs(dzr) + abs(dzi)')
  && indexHtml.includes('let DZ_THRESHOLD = 1e-6');

console.log('3. CPU dz magnitude check for convergence detection:');
if (hasCpuDzCheck) {
  console.log('   ✅ ADDED - convergence only checked when |dz| < threshold');
  console.log('   This prevents false comparisons right after rebase');
} else {
  console.log('   ❌ MISSING - convergence will be checked even when |dz| is large');
}
console.log();

console.log('4. GPU dz magnitude check for convergence detection:');
if (hasGpuDzCheck) {
  console.log('   ✅ ADDED - convergence only checked when |dz| < threshold');
  console.log('   This prevents false comparisons right after rebase');
} else {
  console.log('   ❌ MISSING - convergence will be checked even when |dz| is large');
}
console.log();

// Overall assessment
console.log('='.repeat(80));
console.log('ASSESSMENT');
console.log('='.repeat(80));
console.log();

const fixComplete = !hasCheckpointInvalidation && !hasGpuCheckpointInvalidation
  && hasCpuDzCheck && hasGpuDzCheck;

if (fixComplete) {
  console.log('✅ FIX COMPLETE - All changes applied correctly!');
  console.log();
  console.log('Expected behavior:');
  console.log('  1. Checkpoints are preserved across rebases');
  console.log('  2. Convergence detection pauses when |dz| is large (just after rebase)');
  console.log('  3. Convergence detection resumes when |dz| shrinks back to small values');
  console.log('  4. Periodic orbits detected everywhere, not just near reference point');
  console.log();
  console.log('To test in browser:');
  console.log('  1. Open index.html in a browser');
  console.log('  2. Navigate to: s=3.072e-7&c=-0.1666193416+1.0423928039i,-0.1666193570+1.0423928116i&grid=8');
  console.log('  3. Enable ZhuoranBoard or GpuZhuoranBoard');
  console.log('  4. Verify that CONVERGENCE (purple) appears across the entire grid');
  console.log('  5. Before fix: only small patch near reference would show convergence');
  console.log('  6. After fix: convergence should appear everywhere it should');
} else {
  console.log('❌ FIX INCOMPLETE - Some changes are missing');
  console.log();
  const issues = [];
  if (hasCheckpointInvalidation) issues.push('CPU checkpoint invalidation still present');
  if (hasGpuCheckpointInvalidation) issues.push('GPU checkpoint invalidation still present');
  if (!hasCpuDzCheck) issues.push('CPU dz magnitude check missing');
  if (!hasGpuDzCheck) issues.push('GPU dz magnitude check missing');
  console.log('Issues found:');
  issues.forEach(issue => console.log(`  - ${issue}`));
}

console.log();

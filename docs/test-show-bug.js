#!/usr/bin/env node

// Simple demonstration of the period detection bug

// At iteration 16, we have:
// - z15 = some value
// - We save checkpoint: base = z15
// - We compute: z16 = z15^2 + c
// - z16 is very close to z15 (the orbit is converging)

// QUESTION: Should we detect convergence at iteration 16 or 17?

console.log('Scenario: z16 is close to z15 (checkpoint saved at iter 16)\n');

console.log('CPU BEHAVIOR:');
console.log('  Iteration 16:');
console.log('    1. Save checkpoint: bb = z15');
console.log('    2. Compute: z16 = z15^2 + c');
console.log('    3. Check: Is z16 close to bb? YES!');
console.log('    4. Record: pp = 16');
console.log('    5. Result: CONVERGED at iteration 16');
console.log('    6. Period = figurePeriod(16) = 1');
console.log('');

console.log('GPU BEHAVIOR (BUGGY):');
console.log('  Iteration 16:');
console.log('    1. Save checkpoint: base = z15');
console.log('    2. Compute: z16 = z15^2 + c');
console.log('    3. SKIP convergence check (because we just saved checkpoint)');
console.log('  Iteration 17:');
console.log('    1. Compute: z17 ≈ z16 (barely changes)');
console.log('    2. Check: Is z17 close to base (z15)? YES!');
console.log('    3. Record: p = 17');
console.log('    4. Result: CONVERGED at iteration 17');
console.log('    5. Period = figurePeriod(17) = 2');
console.log('');

console.log('PROBLEM: GPU detects convergence 1 iteration late!');
console.log('  - CPU says: period 1 (converged right at checkpoint)');
console.log('  - GPU says: period 2 (converged 1 iteration after checkpoint)');
console.log('');

console.log('THE FIX: Remove the check-skip on checkpoint iterations');
console.log('  - Old GPU code: if (!saved_base_this_iter) { check convergence }');
console.log('  - New GPU code: always check convergence');

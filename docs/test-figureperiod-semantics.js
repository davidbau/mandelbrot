#!/usr/bin/env node

function fibonacciPeriod(iteration) {
  if (iteration === 0) return 1;
  if (iteration === 1) return 1;

  let a = 1, b = 1;
  while (b < iteration) {
    const next = a + b;
    a = b;
    b = next;
  }

  if (b === iteration) return 1;
  return iteration - a + 1;
}

console.log('Understanding figurePeriod() semantics\n');
console.log('Fibonacci numbers: 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144\n');

console.log('Iterations around checkpoint 21:');
for (let i = 19; i <= 36; i++) {
  const period = fibonacciPeriod(i);
  const isCheckpoint = period === 1 ? ' ← CHECKPOINT' : '';
  console.log(`  iter ${i}: figurePeriod = ${period}${isCheckpoint}`);
}

console.log('\nKey insight:');
console.log('  figurePeriod(22) = 10');
console.log('  This means: iteration 22 is 10 iterations after checkpoint 13');
console.log('  NOT: 1 iteration after checkpoint 21!');
console.log('');
console.log('  figurePeriod(33) = 13');
console.log('  This means: iteration 33 is 13 iterations after checkpoint 21');
console.log('  NOT: 12 iterations after checkpoint 21!');
console.log('');
console.log('The function returns iteration - last_checkpoint + 1');
console.log('So it\'s the 1-indexed distance from the checkpoint.');
console.log('');
console.log('For period detection, we want the 0-indexed distance:');
console.log('  orbital_period = figurePeriod(iter) - 1');

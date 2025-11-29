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

console.log('Testing period calculation for reported bug\n');
console.log('User says: period 4 showing as period 3, period 3 showing as period 2\n');

// Period-4 orbit example:
// If checkpoint at iteration 21, period-4 should converge at iteration 25
console.log('Period-4 orbit:');
console.log('  Checkpoint at iteration 21 (Fibonacci)');
console.log('  Should converge at iteration 25 (21 + 4)');
console.log('  If pp = 25: figurePeriod(25) = ' + fibonacciPeriod(25));
console.log('  If pp = 24: figurePeriod(24) = ' + fibonacciPeriod(24));
console.log('');

// Period-3 orbit example:
console.log('Period-3 orbit:');
console.log('  Checkpoint at iteration 21 (Fibonacci)');
console.log('  Should converge at iteration 24 (21 + 3)');
console.log('  If pp = 24: figurePeriod(24) = ' + fibonacciPeriod(24));
console.log('  If pp = 23: figurePeriod(23) = ' + fibonacciPeriod(23));
console.log('');

console.log('HYPOTHESIS: If GPU is storing pp = iteration - 1, periods would be off by 1!');

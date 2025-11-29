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

console.log('Checkpoint timing analysis\n');
console.log('Fibonacci checkpoints: 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, ...\n');

console.log('Scenario: Period-2 orbit with checkpoint at iteration 21');
console.log('');
console.log('At START of iterate() when this.it = 21:');
console.log('  - zz contains z[20] (from previous iteration)');
console.log('  - figurePeriod(21) = ' + fibonacciPeriod(21) + ' (checkpoint!)');
console.log('  - Take checkpoint: bb = zz = z[20]');
console.log('  - Reset pp = 0');
console.log('  - Compute iteration 21: z[21] = f(z[20])');
console.log('  - Update zz = z[21]');
console.log('  - this.it++, now this.it = 22');
console.log('');
console.log('At START of iterate() when this.it = 22:');
console.log('  - zz contains z[21]');
console.log('  - figurePeriod(22) = ' + fibonacciPeriod(22) + ' (not a checkpoint)');
console.log('  - Compute iteration 22: z[22] = f(z[21])');
console.log('  - Compare z[22] to bb = z[20]');
console.log('  - For period-2: z[22] ≈ z[20], CONVERGES');
console.log('  - Store pp = 22');
console.log('  - this.it++, now this.it = 23');
console.log('');
console.log('Display calculation:');
console.log('  - pp = 22');
console.log('  - figurePeriod(22) = ' + fibonacciPeriod(22));
console.log('  - period = figurePeriod(22) - 1 = ' + (fibonacciPeriod(22) - 1));
console.log('');
console.log('BUT the actual orbital period should be 2!');
console.log('The issue: checkpoint at iter 21 stores z[20]');
console.log('So when converge at iter 22, orbital period = 22 - 20 = 2');
console.log('');
console.log('The formula should be: period = figurePeriod(pp)');
console.log('because figurePeriod(22) = 22 - 21 + 1 = 2, which accounts for the');
console.log('checkpoint being taken at iteration 21 but storing z[20].');

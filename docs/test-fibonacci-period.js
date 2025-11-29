#!/usr/bin/env node

// Test the Fibonacci period function

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

console.log('Testing fibonacciPeriod function\n');

// Test that it returns 1 at Fibonacci numbers
const fibSequence = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];
console.log('Checkpoint iterations (should all return 1):');
for (const fib of fibSequence) {
  const result = fibonacciPeriod(fib);
  const status = result === 1 ? 'PASS' : 'FAIL';
  console.log('  iter=' + fib + ': ' + result + ' ' + status);
}

console.log('\nNon-checkpoint iterations (should return distance from previous):');
const testCases = [
  { iter: 4, expected: 2, prev: 3 },   // 4 = 3 + 1
  { iter: 6, expected: 2, prev: 5 },   // 6 = 5 + 1
  { iter: 10, expected: 3, prev: 8 },  // 10 = 8 + 2
  { iter: 100, expected: 12, prev: 89 }, // 100 = 89 + 11, + 1 offset = 12
];

for (const test of testCases) {
  const result = fibonacciPeriod(test.iter);
  const status = result === test.expected ? 'PASS' : 'FAIL';
  console.log('  iter=' + test.iter + ' (prev Fib=' + test.prev + '): ' + result + ' (expected ' + test.expected + ') ' + status);
}

console.log('\nFirst 50 checkpoints:');
const checkpoints = [];
for (let i = 0; i <= 1000 && checkpoints.length < 50; i++) {
  if (fibonacciPeriod(i) === 1) {
    checkpoints.push(i);
  }
}
console.log(checkpoints.join(', '));

console.log('\nCompare checkpoint density at high iterations:');
console.log('Range 10000-10100:');
let count = 0;
for (let i = 10000; i <= 10100; i++) {
  if (fibonacciPeriod(i) === 1) {
    console.log('  Checkpoint at iter=' + i);
    count++;
  }
}
console.log('  Total: ' + count + ' checkpoints in 100 iterations');

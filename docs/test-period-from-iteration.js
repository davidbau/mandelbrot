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

// Find the last Fibonacci number before or at iteration
function lastFibonacci(iteration) {
  if (iteration === 0) return 0;
  if (iteration === 1) return 1;
  
  let a = 1, b = 1;
  while (b < iteration) {
    const next = a + b;
    a = b;
    b = next;
  }
  
  if (b === iteration) return iteration;  // iteration IS a Fibonacci number
  return a;  // Last Fibonacci < iteration
}

console.log('Calculating orbital period from iteration number\n');

const testCases = [
  { iter: 22, desc: 'Just after checkpoint 21' },
  { iter: 33, desc: 'GpuBoard convergence (main bulb)' },
  { iter: 55, desc: 'CpuBoard convergence (Fibonacci number)' },
  { iter: 144, desc: 'Pixel 1000000 on GpuBoard' }
];

for (const test of testCases) {
  const figPeriod = fibonacciPeriod(test.iter);
  const lastFib = lastFibonacci(test.iter);
  const orbitalPeriod = test.iter - lastFib;
  
  console.log('Iteration ' + test.iter + ': ' + test.desc);
  console.log('  figurePeriod(' + test.iter + ') = ' + figPeriod);
  console.log('  Last Fibonacci checkpoint = ' + lastFib);
  console.log('  Orbital period = ' + test.iter + ' - ' + lastFib + ' = ' + orbitalPeriod);
  console.log('  Formula: figurePeriod - 1 = ' + (figPeriod - 1));
  console.log('');
}

console.log('KEY INSIGHT:');
console.log('  orbital_period = figurePeriod(iter) - 1');
console.log('');
console.log('BUT when iter IS a Fibonacci number:');
console.log('  Checkpoint taken AT iteration 55');
console.log('  pp = 0 is reset, then immediately set to 55 when convergence detected');
console.log('  figurePeriod(55) = 1, so period = 1 - 1 = 0');
console.log('');
console.log('Wait - this means the checkpoint was taken BEFORE this iteration,');
console.log('not AT this iteration! Need to check the actual checkpoint sequence.');

#!/usr/bin/env node

function oldFigurePeriod(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1;
}

console.log('Old power-of-2 figurePeriod behavior\n');
console.log('Power-of-2 checkpoints: 1, 2, 4, 8, 16, 32, 64, 128, ...\n');

// Calculate which iterations are checkpoints
function isCheckpoint(iter) {
  return oldFigurePeriod(iter) === 1;
}

console.log('Checkpoint iterations up to 50:');
const checkpoints = [];
for (let i = 1; i <= 50; i++) {
  if (isCheckpoint(i)) {
    checkpoints.push(i);
  }
}
console.log(checkpoints.join(', '));
console.log('');

console.log('Iterations around checkpoint 16:');
for (let i = 14; i <= 35; i++) {
  const period = oldFigurePeriod(i);
  const isCheck = period === 1 ? ' ← CHECKPOINT' : '';
  console.log(`  iter ${i}: figurePeriod = ${period}${isCheck}`);
}
console.log('');

console.log('Key differences from Fibonacci:');
console.log('  Power-of-2: Checkpoints at 1, 2, 4, 8, 16, 32, 64 (exponential growth)');
console.log('  Fibonacci: Checkpoints at 1, 1, 2, 3, 5, 8, 13, 21, 34, 55 (golden ratio growth)');
console.log('');
console.log('Both methods have the same problem:');
console.log('  They detect convergence but report the wrong orbital period!');

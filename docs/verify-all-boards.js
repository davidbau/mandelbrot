#!/usr/bin/env node

console.log('Verifying period storage strategy across all boards\n');
console.log('====================================================\n');

console.log('CpuBoard (line 2719):');
console.log('  if (!this.pp[m]) { this.pp[m] = this.it; }');
console.log('  Stores: ITERATION NUMBER when convergence first detected\n');

console.log('ZhuoranBoard (line 3008):');
console.log('  if (!this.pp[m]) { this.pp[m] = this.it; }');
console.log('  Stores: ITERATION NUMBER when convergence first detected\n');

console.log('PerturbationBoard (line 3559):');
console.log('  this.pp[index] = this.it;');
console.log('  Stores: ITERATION NUMBER when convergence first detected\n');

console.log('GpuBoard shader (line 3991):');
console.log('  if (p == 0u) { p = iter; }');
console.log('  Stores: ITERATION NUMBER when convergence first detected');
console.log('  Then JS (line 4360): this.pp[i] = period;');
console.log('  Stores: Raw iteration number from GPU\n');

console.log('GpuZhuoranBoard shader (line 4944):');
console.log('  if (pp == 0u) { pp = iter; }');
console.log('  Stores: ITERATION NUMBER when convergence first detected');
console.log('  Then JS (line 5250): this.pp[i] = period - 1;');
console.log('  Stores: Iteration number - 1 (WHY?!)\n');

console.log('Display code (line 2105):');
console.log('  let period = figurePeriod(view.currentp(j));');
console.log('  Calculates period by calling figurePeriod() on the ITERATION NUMBER\n');

console.log('CONCLUSION:');
console.log('===========');
console.log('ALL boards store the iteration number in pp, then the display');
console.log('code calls figurePeriod() to convert it to a period.');
console.log('');
console.log('This only works when the iteration number happens to be a');
console.log('Fibonacci number (returns 1) or by pure luck returns the right value.');

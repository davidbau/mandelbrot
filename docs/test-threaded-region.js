// Test threaded convergence detection in the specific region the user reported
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

// Extract ZhuoranBoard class
const zStart = html.indexOf('class ZhuoranBoard extends Board {');
const zEnd = html.indexOf('\nclass GpuZhuoranBoard', zStart);
const zhuoranCode = html.substring(zStart, zEnd);

// Extract Board base class and dependencies
const boardStart = html.indexOf('class Board {');
const boardEnd = html.indexOf('\nclass CpuBoard', boardStart);
const boardCode = html.substring(boardStart, boardEnd);

// Extract quad-double functions
const qdStart = html.indexOf('function toQd(');
const qdEnd = html.indexOf('function figurePeriod(');
const qdCode = html.substring(qdStart, qdEnd);

// Extract figurePeriod
const fpStart = html.indexOf('function figurePeriod(');
const fpEnd = html.indexOf('function fromQd(');
const fpCode = html.substring(fpStart, fpEnd);

// Create test setup
eval(qdCode);
eval(fpCode);
eval(boardCode);
eval(zhuoranCode);

// Test configuration from URL: s=3.072e-7&c=-0.1666193416+1.0423928039i,-0.1666193570+1.0423928116i
const config = {
  dims: 8,  // grid=8
  exponent: 2
};

const testRe = -0.1666193493;  // Center between the two c values
const testIm = 1.04239280775;
const testSize = 3.072e-7;

console.log('=== Testing Threaded Convergence Detection ===');
console.log(`Location: re=${testRe}, im=${testIm}, size=${testSize}`);
console.log(`Grid: ${config.dims}x${config.dims}`);
console.log('');

// Create board
const board = new ZhuoranBoard(0, testSize, testRe, testIm, config, 'test');

console.log(`epsilon: ${board.epsilon}`);
console.log(`epsilon2: ${board.epsilon2}`);
console.log(`epsilon3: ${board.epsilon3}`);
console.log(`bucket_size: ${board.bucket_size}`);
console.log('');

// Run for 3000 iterations
const maxIter = 3000;
for (let i = 0; i < maxIter; i++) {
  board.iterate();

  if (i % 500 === 0 || i === maxIter - 1) {
    console.log(`iter=${i}: un=${board.un} di=${board.di} converged=${config.dims*config.dims - board.un - board.di}`);
  }
}

console.log('');
console.log('Final Results:');
console.log(`  Total iterations: ${maxIter}`);
console.log(`  Diverged: ${board.di}`);
console.log(`  Converged: ${config.dims*config.dims - board.un - board.di}`);
console.log(`  Unfinished: ${board.un}`);
console.log('');

// Count periods
const periods = {};
let convergedCount = 0;
for (let i = 0; i < board.nn.length; i++) {
  if (board.nn[i] < 0 && board.pp[i]) {
    convergedCount++;
    const period = board.pp[i];
    periods[period] = (periods[period] || 0) + 1;
  }
}

console.log(`Converged points: ${convergedCount}`);
if (Object.keys(periods).length > 0) {
  console.log('Periods detected:', periods);
} else {
  console.log('No periods detected - this is the problem!');
}
console.log('');

// Debug: Check threading statistics
let threadedCount = 0;
let maxThreadLength = 0;
for (let i = 0; i < Math.min(board.threaded.length, 1000); i++) {
  if (board.threaded[i] && board.threaded[i].next !== -1) {
    threadedCount++;
    const length = board.threaded[i].next - i;
    maxThreadLength = Math.max(maxThreadLength, length);
  }
}

console.log('Threading statistics:');
console.log(`  Reference orbit length: ${board.refOrbit.length}`);
console.log(`  Threaded points (first 1000): ${threadedCount}/1000`);
console.log(`  Max thread jump: ${maxThreadLength}`);
console.log(`  Bucket count: ${board.buckets.size}`);
console.log('');

// Debug: Show some pixel states
console.log('Sample pixel states:');
for (let i = 0; i < Math.min(5, config.dims * config.dims); i++) {
  console.log(`  Pixel ${i}: nn=${board.nn[i]}, refIter=${board.refIter[i]}, pp=${board.pp[i]}, hasCheckpoint=${board.hasCheckpoint[i]}, checkpointIter=${board.checkpointIter[i]}`);
}

#!/usr/bin/env node

// Test different epsilon3 values to find what works for this orbit

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = -0.6652323;
const testIm = 0.4601837;
const dims = 32;
const pixel = 1.369e-7;
const size = pixel * dims;

const config = {
  dims: dims,
  dims2: dims * dims,
  exponent: 2,
  batchSize: 100
};

// Try different epsilon values to see effect on threading
const epsilonTests = [
  1e-12,  // Current (clamp minimum)
  1e-11,
  1e-10,
  1e-9,
  1e-8,
  1e-7,
  pixel / 10  // Actual pixel-based epsilon
];

console.log(`Testing different epsilon values`);
console.log(`Location: c = ${testRe} + ${testIm}i`);
console.log(`pixel = ${pixel.toExponential(3)}, size = ${size.toExponential(3)}`);
console.log('');

for (const testEpsilon of epsilonTests) {
  const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

  // Override epsilon and recreate threading with new epsilon3
  board.epsilon = testEpsilon;
  const { ReferenceOrbitThreading } = require('./reference-threading.js');
  board.threading = new ReferenceOrbitThreading(testEpsilon);

  // Re-initialize threading data
  board.threading.refThreading.push({next: -1, deltaRe: 0, deltaIm: 0});
  board.threading.refThreading.push({next: -1, deltaRe: 0, deltaIm: 0});

  // Rebuild reference orbit with new threading
  while (!board.refOrbitEscaped && board.refIterations < 3000) {
    board.extendReferenceOrbit();
  }

  const stats = board.threading.getStats();
  const epsilon3 = board.threading.epsilon3;

  console.log(`epsilon=${testEpsilon.toExponential(3)}, epsilon3=${epsilon3.toExponential(3)}: ` +
              `${stats.threadingRate.toFixed(1)}% threaded, avg=${stats.avgJump.toFixed(1)}, max=${stats.maxJump}`);
}

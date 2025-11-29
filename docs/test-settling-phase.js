#!/usr/bin/env node

// Analyze the settling phase of the problematic orbit
// Check distances between consecutive points to see why threading fails

const { ZhuoranBoard } = require('./zhuoran-threading.js');

const testRe = -0.6652323;
const testIm = 0.4601837;
const size = 0.01;

const config = {
  dims: 4,
  dims2: 16,
  exponent: 2,
  batchSize: 100
};

console.log('Analyzing settling phase of problematic orbit');
console.log(`Location: c = ${testRe} + ${testIm}i, size = ${size}`);
console.log('');

const board = new ZhuoranBoard(0, size, testRe, testIm, config, 'test');

console.log(`epsilon3 = ${board.epsilon3.toExponential(3)} (threading threshold)`);
console.log('');

// Extend reference orbit
while (!board.refOrbitEscaped && board.refIterations < 3000) {
  board.extendReferenceOrbit();
}

console.log('Consecutive point distances (should be < epsilon3 for threading):');
console.log('Iteration | Distance to Next | epsilon3 Ratio');
console.log('-'.repeat(55));

for (let i = 0; i < Math.min(100, board.refOrbit.length - 1); i += 10) {
  const p1 = board.refOrbit[i];
  const p2 = board.refOrbit[i + 1];

  const re1 = p1[0] + p1[1];
  const im1 = p1[2] + p1[3];
  const re2 = p2[0] + p2[1];
  const im2 = p2[2] + p2[3];

  const dist = Math.max(Math.abs(re2 - re1), Math.abs(im2 - im1));
  const ratio = dist / board.epsilon3;

  const pad = (n, len) => {
    let s = n.toString();
    while (s.length < len) s = ' ' + s;
    return s;
  };

  console.log(`${pad(i, 9)} | ${dist.toExponential(3)}    | ${ratio.toFixed(1)}x`);
}

console.log('');
console.log('Note: Ratio > 1 means consecutive points too far apart for threading');
console.log('      This is why groups 1-2 have 0% threading!');

#!/usr/bin/env node

// Test that extracts and runs the actual ZhuoranBoard code from index.html

const fs = require('fs');
const html = fs.readFileSync('./index.html', 'utf8');

// Extract quad-double code
const qdStart = html.indexOf('// Quad-double arithmetic');
const qdEnd = html.indexOf('// Helper function to figure', qdStart);
const qdCode = html.substring(qdStart, qdEnd);
eval(qdCode);

// Extract figurePeriod
const fpMatch = html.match(/function figurePeriod\([^)]*\) \{[^}]+\}/);
if (!fpMatch) throw new Error('Could not find figurePeriod');
eval(fpMatch[0]);

// Extract Board base class
const boardStart = html.indexOf('class Board {');
const boardEnd = html.indexOf('\n  }\n\n  iterate()', boardStart) + 5;
const boardCode = html.substring(boardStart, boardEnd);
eval(boardCode);

// Extract CpuBoard for comparison
const cpuStart = html.indexOf('class CpuBoard extends Board {');
const cpuEnd = html.indexOf('\nclass ZhuoranBoard', cpuStart);
const cpuCode = html.substring(cpuStart, cpuEnd);
eval(cpuCode);

// Extract ZhuoranBoard more carefully
const zStart = html.indexOf('class ZhuoranBoard extends Board {');
let braceCount = 0;
let inClass = false;
let zEnd = zStart;
for (let i = zStart; i < html.length; i++) {
  if (html[i] === '{') {
    braceCount++;
    inClass = true;
  } else if (html[i] === '}') {
    braceCount--;
    if (inClass && braceCount === 0) {
      zEnd = i + 1;
      break;
    }
  }
}
const zCode = html.substring(zStart, zEnd);
eval(zCode);

// Test configuration - same as user's reported problem
const size = 3.072e-7;
const centerRe = -0.1666193416;
const centerIm = 1.0423928039;
const gridSize = 8;

const config = {
  exponent: 2,
  dims: gridSize,
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

console.log('================================================================================');
console.log('Testing actual browser ZhuoranBoard code with Math.fround simulation');
console.log('================================================================================');
console.log(`Region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}\n`);

// Run CpuBoard as ground truth
console.log('--- CpuBoard (ground truth) ---');
const cpuBoard = new CpuBoard(0, size, centerRe, centerIm, config, 'cpu');
for (let i = 0; i < 10000 && cpuBoard.un > 0; i++) {
  cpuBoard.iterate();
}

let cpuConverged = 0, cpuDiverged = 0, cpuUnfinished = 0;
for (let i = 0; i < gridSize * gridSize; i++) {
  if (cpuBoard.nn[i] < 0) cpuConverged++;
  else if (cpuBoard.nn[i] > 0) cpuDiverged++;
  else cpuUnfinished++;
}
console.log(`  Final: converged=${cpuConverged}, diverged=${cpuDiverged}, unfinished=${cpuUnfinished}`);

// Run ZhuoranBoard with Math.fround simulation
console.log('\n--- ZhuoranBoard (with Math.fround simulation) ---');
const zBoard = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'zhuoran');
for (let i = 0; i < 10000 && zBoard.un > 0; i++) {
  zBoard.iterate();
}

let zConverged = 0, zDiverged = 0, zUnfinished = 0;
for (let i = 0; i < gridSize * gridSize; i++) {
  if (zBoard.nn[i] < 0) zConverged++;
  else if (zBoard.nn[i] > 0) zDiverged++;
  else zUnfinished++;
}
console.log(`  Final: converged=${zConverged}, diverged=${zDiverged}, unfinished=${zUnfinished}`);

// Compare
console.log('\n' + '='.repeat(80));
console.log('COMPARISON');
console.log('='.repeat(80));

if (zConverged === cpuConverged && zDiverged === cpuDiverged) {
  console.log(`\n✅ PASS: ZhuoranBoard matches CpuBoard!`);
  console.log(`   Both found ${cpuConverged} converged, ${cpuDiverged} diverged`);
  process.exit(0);
} else {
  console.log(`\n❌ FAIL: Mismatch detected`);
  console.log(`   CpuBoard: ${cpuConverged} converged, ${cpuDiverged} diverged`);
  console.log(`   ZhuoranBoard: ${zConverged} converged, ${zDiverged} diverged`);
  process.exit(1);
}

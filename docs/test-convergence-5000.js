#!/usr/bin/env node

/**
 * Self-contained test harness that reproduces browser convergence issues
 * Runs to 5000+ iterations to detect convergence pattern differences
 */

const fs = require('fs');

// Extract and execute board classes from index.html
const html = fs.readFileSync('./index.html', 'utf8');

// Extract the quad-double functions
const qdMatch = html.match(/\/\/ Quad-double arithmetic[\s\S]*?(?=\/\/ Helper function)/);
if (!qdMatch) throw new Error('Could not find quad-double code');
eval(qdMatch[0]);

// Extract figurePeriod function
const figurePeriodMatch = html.match(/function figurePeriod\(n\) \{[\s\S]*?^}/m);
if (!figurePeriodMatch) throw new Error('Could not find figurePeriod');
eval(figurePeriodMatch[0]);

// Extract Board base class
const boardMatch = html.match(/class Board \{[\s\S]*?^  constructor\([\s\S]*?^  \}/m);
if (!boardMatch) throw new Error('Could not find Board class');
eval(boardMatch[0]);

// Extract CpuBoard class
const cpuBoardMatch = html.match(/class CpuBoard extends Board \{[\s\S]*?(?=\nclass [A-Z])/);
if (!cpuBoardMatch) throw new Error('Could not find CpuBoard');
eval(cpuBoardMatch[0]);

// Extract ZhuoranBoard class - more careful extraction
const zhuoranStart = html.indexOf('class ZhuoranBoard extends Board {');
if (zhuoranStart === -1) throw new Error('Could not find ZhuoranBoard start');
let braceCount = 0;
let inClass = false;
let zhuoranEnd = zhuoranStart;
for (let i = zhuoranStart; i < html.length; i++) {
  if (html[i] === '{') {
    braceCount++;
    inClass = true;
  } else if (html[i] === '}') {
    braceCount--;
    if (inClass && braceCount === 0) {
      zhuoranEnd = i + 1;
      break;
    }
  }
}
const zhuoranCode = html.substring(zhuoranStart, zhuoranEnd);
eval(zhuoranCode);

// Test configuration
const size = 3.072e-7;
const centerRe = -0.1666193416;
const centerIm = 1.0423928039;
const gridSize = 8;

const config = {
  exponent: 2,
  dims: gridSize,
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

console.log('='.repeat(80));
console.log('CONVERGENCE TEST - 5000 ITERATIONS');
console.log('='.repeat(80));
console.log(`Region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}`);
console.log('');

// Helper to show convergence progress
function showProgress(board, name, iteration) {
  const totalPixels = gridSize * gridSize;
  let converged = 0;
  let diverged = 0;
  let unfinished = 0;

  for (let i = 0; i < totalPixels; i++) {
    if (board.nn[i] < 0) converged++;
    else if (board.nn[i] > 0) diverged++;
    else unfinished++;
  }

  console.log(`${name} @ iter ${iteration}: converged=${converged}, diverged=${diverged}, unfinished=${unfinished}`);
  return { converged, diverged, unfinished };
}

// Run CpuBoard to 5000 iterations
console.log('\n--- Testing CpuBoard (naive, should work correctly) ---');
const cpuBoard = new CpuBoard(0, size, centerRe, centerIm, config, 'cpu');

for (let iter = 1; iter <= 5000 && cpuBoard.un > 0; iter++) {
  cpuBoard.iterate();

  if (iter === 500 || iter === 1000 || iter === 2000 || iter === 5000 || cpuBoard.un === 0) {
    showProgress(cpuBoard, 'CpuBoard', iter);
    if (cpuBoard.un === 0) break;
  }
}

const cpuFinal = showProgress(cpuBoard, 'CpuBoard FINAL', cpuBoard.it);

// Run ZhuoranBoard to 5000 iterations
console.log('\n--- Testing ZhuoranBoard (perturbation, BROKEN) ---');
const zhuoranBoard = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'zhuoran');

for (let iter = 1; iter <= 5000 && zhuoranBoard.un > 0; iter++) {
  zhuoranBoard.iterate();

  if (iter === 500 || iter === 1000 || iter === 2000 || iter === 5000 || zhuoranBoard.un === 0) {
    showProgress(zhuoranBoard, 'ZhuoranBoard', iter);
    if (zhuoranBoard.un === 0) break;
  }
}

const zhuoranFinal = showProgress(zhuoranBoard, 'ZhuoranBoard FINAL', zhuoranBoard.it);

// Compare results
console.log('\n' + '='.repeat(80));
console.log('COMPARISON');
console.log('='.repeat(80));

const missingConvergence = cpuFinal.converged - zhuoranFinal.converged;

if (missingConvergence > 0) {
  console.log(`\n❌ BUG REPRODUCED: ZhuoranBoard missing ${missingConvergence} convergences!`);
  console.log(`   CpuBoard found: ${cpuFinal.converged} converged`);
  console.log(`   ZhuoranBoard found: ${zhuoranFinal.converged} converged`);

  // Find which pixels failed to converge
  console.log('\n--- Pixels that should have converged but didn\'t ---');
  for (let i = 0; i < gridSize * gridSize; i++) {
    if (cpuBoard.nn[i] < 0 && zhuoranBoard.nn[i] >= 0) {
      const x = i % gridSize;
      const y = Math.floor(i / gridSize);
      const status = zhuoranBoard.nn[i] === 0 ? 'unfinished' : 'diverged';
      console.log(`  Pixel ${i} (${x},${y}): CpuBoard converged @ iter ${-cpuBoard.nn[i]}, ZhuoranBoard ${status}`);
    }
  }

  process.exit(1);
} else {
  console.log('\n✅ PASS: ZhuoranBoard matches CpuBoard convergence');
  process.exit(0);
}

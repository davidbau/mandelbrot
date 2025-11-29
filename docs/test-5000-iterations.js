#!/usr/bin/env node

// Test that runs to 5000 iterations to reproduce browser convergence issues
const { CpuBoard, ZhuoranBoard } = require('./test-convergence.js');

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
console.log('CONVERGENCE TEST - Running to 5000 iterations');
console.log('================================================================================');
console.log(`Region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}\n`);

// Helper to count status
function countStatus(board) {
  const totalPixels = gridSize * gridSize;
  let converged = 0;
  let diverged = 0;
  let unfinished = 0;

  for (let i = 0; i < totalPixels; i++) {
    if (board.nn[i] < 0) converged++;
    else if (board.nn[i] > 0) diverged++;
    else unfinished++;
  }

  return { converged, diverged, unfinished };
}

// Test CpuBoard
console.log('--- CpuBoard (naive, known correct) ---');
const cpuBoard = new CpuBoard(0, size, centerRe, centerIm, config, 'cpu');

const checkpoints = [500, 1000, 2000, 3000, 4000, 5000];
let nextCheckpoint = 0;

for (let iter = 1; iter <= 5000; iter++) {
  if (cpuBoard.un === 0) break;
  cpuBoard.iterate();

  if (checkpoints[nextCheckpoint] && iter >= checkpoints[nextCheckpoint]) {
    const status = countStatus(cpuBoard);
    console.log(`  @ iter ${iter}: converged=${status.converged}, diverged=${status.diverged}, unfinished=${status.unfinished}`);
    nextCheckpoint++;
  }
}

const cpuFinal = countStatus(cpuBoard);
console.log(`  FINAL @ iter ${cpuBoard.it}: converged=${cpuFinal.converged}, diverged=${cpuFinal.diverged}, unfinished=${cpuFinal.unfinished}`);

// Test ZhuoranBoard
console.log('\n--- ZhuoranBoard (perturbation, testing for bug) ---');
const zhuoranBoard = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'zhuoran');

nextCheckpoint = 0;
for (let iter = 1; iter <= 5000; iter++) {
  if (zhuoranBoard.un === 0) break;
  zhuoranBoard.iterate();

  if (checkpoints[nextCheckpoint] && iter >= checkpoints[nextCheckpoint]) {
    const status = countStatus(zhuoranBoard);
    console.log(`  @ iter ${iter}: converged=${status.converged}, diverged=${status.diverged}, unfinished=${status.unfinished}`);
    nextCheckpoint++;
  }
}

const zhuoranFinal = countStatus(zhuoranBoard);
console.log(`  FINAL @ iter ${zhuoranBoard.it}: converged=${zhuoranFinal.converged}, diverged=${zhuoranFinal.diverged}, unfinished=${zhuoranFinal.unfinished}`);

// Compare
console.log('\n' + '='.repeat(80));
console.log('COMPARISON');
console.log('='.repeat(80));

const missingConvergence = cpuFinal.converged - zhuoranFinal.converged;

if (missingConvergence > 0) {
  console.log(`\n❌ BUG REPRODUCED: ZhuoranBoard missing ${missingConvergence} convergences!`);
  console.log(`   Expected: ${cpuFinal.converged} converged`);
  console.log(`   Got: ${zhuoranFinal.converged} converged`);

  // Show which pixels failed
  console.log('\n--- Pixels that converged in CpuBoard but not ZhuoranBoard ---');
  for (let i = 0; i < gridSize * gridSize; i++) {
    if (cpuBoard.nn[i] < 0 && zhuoranBoard.nn[i] >= 0) {
      const x = i % gridSize;
      const y = Math.floor(i / gridSize);
      const zStatus = zhuoranBoard.nn[i] === 0 ? 'still computing' : `diverged @ ${zhuoranBoard.nn[i]}`;
      console.log(`  Pixel ${i} (${x},${y}): CPU converged @ ${-cpuBoard.nn[i]}, Zhuoran ${zStatus}`);

      // Show checkpoint status
      if (zhuoranBoard.hasCheckpoint && zhuoranBoard.hasCheckpoint[i]) {
        console.log(`    Has checkpoint from iter ${zhuoranBoard.checkpointIter[i]}`);
      } else {
        console.log(`    NO CHECKPOINT`);
      }
    }
  }

  process.exit(1);
} else {
  console.log(`\n✅ PASS: Both found ${cpuFinal.converged} converged pixels`);
  process.exit(0);
}

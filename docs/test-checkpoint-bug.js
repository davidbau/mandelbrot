#!/usr/bin/env node

// Test to demonstrate the checkpoint bug

const { ZhuoranBoard } = require('./test-convergence.js');

const size = 6.144e-8;
const centerRe = -0.1666193570;
const centerIm = 1.0423928116;
const gridSize = 2;  // Small grid to see details

const config = {
  exponent: 2,
  dims: gridSize,
  spike: { re: -0.75, im: 0.1, radius: 0.1 }
};

console.log('Testing checkpoint bug');
console.log(`Region: s=${size}, center=${centerRe}+${centerIm}i, grid=${gridSize}x${gridSize}\n`);

// Patch ZhuoranBoard to log checkpoint saves
const originalIteratePixel = ZhuoranBoard.prototype.iteratePixel;
ZhuoranBoard.prototype.iteratePixel = function(index) {
  const index2 = index * 2;
  // Capture dz before iteration
  const oldDr = this.dz[index2];
  const oldDi = this.dz[index2 + 1];

  // Call original
  const result = originalIteratePixel.call(this, index);

  // Check if checkpoint was saved
  if (this.hasCheckpoint[index] && this.checkpointIter[index] === this.it) {
    // Checkpoint was just saved this iteration
    const newDr = this.dz[index2];
    const newDi = this.dz[index2 + 1];
    const savedDr = this.bb[index2];
    const savedDi = this.bb[index2 + 1];

    console.log(`Pixel ${index} checkpoint saved at iter ${this.it}:`);
    console.log(`  Old dz: (${oldDr.toFixed(10)}, ${oldDi.toFixed(10)})`);
    console.log(`  New dz: (${newDr.toFixed(10)}, ${newDi.toFixed(10)})`);
    console.log(`  Saved:  (${savedDr.toFixed(10)}, ${savedDi.toFixed(10)})`);
    console.log(`  Matches old? ${savedDr === oldDr && savedDi === oldDi ? 'YES (BUG!)' : 'no'}`);
    console.log(`  Matches new? ${savedDr === newDr && savedDi === newDi ? 'YES (correct)' : 'no'}`);
    console.log();
  }

  return result;
};

const board = new ZhuoranBoard(0, size, centerRe, centerIm, config, 'test');

console.log('Running iterations...\n');
for (let i = 0; i < 1000 && board.un > 0; i++) {
  board.iterate();
}

console.log(`\nFinal state: converged=${board.nn.filter(n => n < 0).length}, diverged=${board.nn.filter(n => n > 0).length}, unfinished=${board.un}`);

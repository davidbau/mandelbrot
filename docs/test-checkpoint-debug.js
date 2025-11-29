#!/usr/bin/env node

// Debug checkpoint offset calculation

function figurePeriod(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

console.log('Checkpoint offset calculation for different starting iterations\n');

// Test what offsets we get for batch size 7, starting at different iterations
for (const startIter of [0, 7, 14, 21, 28]) {
  const iterationsPerBatch = 7;
  const checkpointOffsets = [];

  console.log(`startIter=${startIter}, batchSize=${iterationsPerBatch}`);
  console.log('  i | globalIter | figurePeriod | isCheckpoint');
  console.log('  --|------------|--------------|-------------');

  for (let i = 0; i < iterationsPerBatch; i++) {
    const globalIter = startIter + i + 1;  // +1 because iter++ before check
    const fp = figurePeriod(globalIter);
    const isCheckpoint = fp === 1;
    console.log('  ' + i + ' | ' + globalIter + ' | ' + fp + ' | ' + (isCheckpoint ? 'YES' : 'no'));
    if (isCheckpoint) {
      checkpointOffsets.push(i);
    }
  }

  console.log(`  Result: checkpointOffsets = [${checkpointOffsets.join(', ')}]\n`);
}

// Show first 30 checkpoint iterations
console.log('\nFirst 30 global iterations where figurePeriod=1:');
const checkpoints = [];
for (let iter = 1; iter <= 200 && checkpoints.length < 30; iter++) {
  if (figurePeriod(iter) === 1) {
    checkpoints.push(iter);
  }
}
console.log(`[${checkpoints.join(', ')}]`);

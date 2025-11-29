#!/usr/bin/env node

// Show why checkpoints get sparse at higher iterations

function figurePeriod(iteration) {
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

console.log('Why checkpoints get sparse:\n');

const batches = [
  { startIter: 1, name: 'Batch 1 (iter=1)' },
  { startIter: 8, name: 'Batch 2 (iter=8)' },
  { startIter: 15, name: 'Batch 3 (iter=15)' },
  { startIter: 22, name: 'Batch 4 (iter=22)' },
  { startIter: 100, name: 'Batch at iter=100' },
];

for (const {startIter, name} of batches) {
  const batchSize = 7;
  const checkpoints = [];
  
  for (let i = 0; i < batchSize; i++) {
    const globalIter = startIter + i + 1;
    if (figurePeriod(globalIter) === 1) {
      checkpoints.push(i);
    }
  }
  
  console.log(name + ': checkpoints=' + JSON.stringify(checkpoints));
  
  // Show the tail value (checkpoint interval)
  let tail = 1;
  if (startIter) while (Math.pow(Math.floor(startIter / tail), 3) > tail) { tail *= 2; }
  console.log('  figurePeriod interval at this iteration: ' + tail);
  console.log('');
}

console.log('The interval grows as iterations increase, making checkpoints sparse.');
console.log('For a batch size of 7, we often only get 1 checkpoint per batch at higher iterations.');

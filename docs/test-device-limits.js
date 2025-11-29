// Test device limit querying
console.log('Device Limit Query Test');
console.log('='.repeat(70));

console.log('\nSimulating device limit query:');
console.log('  - Mac (256 MB): 80% = 204 MB → max dims ≈ 3650');
console.log('  - High-end GPU (1 GB): 80% = 819 MB → max dims ≈ 7320');
console.log('  - Workstation (2 GB): 80% = 1638 MB → max dims ≈ 10350');
console.log('');

const scenarios = [
    { name: 'Mac / Standard GPU', limit: 256 * 1024 * 1024 },
    { name: 'High-end Gaming GPU', limit: 1024 * 1024 * 1024 },
    { name: 'Workstation GPU', limit: 2048 * 1024 * 1024 },
  ];

for (let i = 0; i < scenarios.length; i++) {
  const scenario = scenarios[i];
  const safeLimit = Math.floor(scenario.limit * 0.8);
  const maxDims = Math.floor(Math.sqrt(safeLimit / 16));  // 16 bytes per pixel
  const maxPixels = maxDims * maxDims;
  const bufferMB = (maxPixels * 16 / (1024*1024)).toFixed(1);

  console.log(scenario.name + ':');
  console.log('  Device limit: ' + (scenario.limit / (1024*1024)).toFixed(0) + ' MB');
  console.log('  Safe limit (80%): ' + (safeLimit / (1024*1024)).toFixed(0) + ' MB');
  console.log('  Max dims: ' + maxDims + ' (' + bufferMB + ' MB)');
  console.log('');
}

console.log('='.repeat(70));
console.log('BENEFITS:');
console.log('  - Adapts to device capabilities');
console.log('  - High-end GPUs get 3-4x higher dims');
console.log('  - Macs still work (conservative 80% limit)');
console.log('  - Graceful fallback to CPU when exceeded');
console.log('='.repeat(70));

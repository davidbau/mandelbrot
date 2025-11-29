// Test board creation logic with different dims
console.log('Testing Board Creation Logic');
console.log('='.repeat(70));

// Simulate the decision logic
function simulateBoardCreation(dims, size) {
  const pixelSize = size / dims;
  const enableGPU = true;
  const webGPUAvailable = true;

  // isSafeDims check
  const dims2 = dims * dims;
  const maxSafeBufferSize = 200 * 1024 * 1024;
  const largestBufferSize = dims2 * 4 * 4;
  const gpuSafe = largestBufferSize <= maxSafeBufferSize;

  const bufferSizeMB = (largestBufferSize / (1024*1024)).toFixed(1);

  console.log('');
  console.log('dims=' + dims + ', size=' + size + ', pixel=' + pixelSize.toExponential(3));
  console.log('  Buffer size: ' + bufferSizeMB + ' MB, gpuSafe=' + gpuSafe);

  if (enableGPU && webGPUAvailable && gpuSafe) {
    if (pixelSize > 1e-6) {
      console.log('  Decision: GpuBoard (shallow zoom, GPU safe)');
      return 'GpuBoard';
    } else {
      console.log('  Decision: GpuZhuoranBoard (deep zoom, GPU safe)');
      return 'GpuZhuoranBoard';
    }
  } else {
    if (!gpuSafe) {
      console.log('  ⚠️  GPU NOT SAFE - falling back to CPU');
    }
    if (pixelSize > 1e-12) {
      console.log('  Decision: CpuBoard (CPU fallback)');
      return 'CpuBoard';
    } else {
      console.log('  Decision: PerturbationBoard (CPU fallback, very deep)');
      return 'PerturbationBoard';
    }
  }
}

// Test scenarios
console.log('\n--- SCENARIO 1: Normal board ---');
simulateBoardCreation(512, 3.0);

console.log('\n--- SCENARIO 2: Large board (high pixel ratio) ---');
simulateBoardCreation(2048, 3.0);

console.log('\n--- SCENARIO 3: Very large board (should fail) ---');
simulateBoardCreation(4096, 3.0);

console.log('\n--- SCENARIO 4: Extremely large board (should fail) ---');
simulateBoardCreation(8192, 3.0);

console.log('\n--- SCENARIO 5: Normal board, deep zoom ---');
simulateBoardCreation(512, 1e-10);

console.log('\n--- SCENARIO 6: Large board, deep zoom (should fail) ---');
simulateBoardCreation(4096, 1e-10);

console.log('\n' + '='.repeat(70));
console.log('EXPECTED BEHAVIOR:');
console.log('  - dims < 3600: GpuBoard or GpuZhuoranBoard (depending on zoom)');
console.log('  - dims >= 4096: CpuBoard or PerturbationBoard (GPU too large)');
console.log('='.repeat(70));

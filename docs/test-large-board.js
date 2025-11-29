// Test to reproduce "no pixels" issue when GPU board grows too large
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

// Calculate buffer sizes for different dims values
function calculateBufferSizes(dims) {
  const dims2 = dims * dims;
  const buffers = {
    iterations: dims2 * 4,
    statusAndPeriod: dims2 * 2 * 4,
    dc: dims2 * 2 * 4,
    dzAndCheckpoint: dims2 * 4 * 4,
    refIter: dims2 * 4,
    checkpointIter: dims2 * 4,
    refOrbit: 1024,  // varies
    params: 32
  };

  let total = 0;
  const names = Object.keys(buffers);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const size = buffers[name];
    console.log(`  ${name}: ${(size / (1024 * 1024)).toFixed(2)} MB`);
    total += size;
  }
  console.log(`  TOTAL: ${(total / (1024 * 1024)).toFixed(2)} MB`);
  return total;
}

// WebGPU spec maximum buffer size is typically 256 MB or device-specific
const maxBufferSize = 256 * 1024 * 1024;  // 256 MB typical limit

console.log('Buffer size analysis for GpuZhuoranBoard:');
console.log('='.repeat(60));

const testDims = [128, 256, 512, 1024, 2048, 4096, 8192];

for (const dims of testDims) {
  console.log(`\ndims = ${dims} (${dims * dims} pixels):`);
  const total = calculateBufferSizes(dims);

  // Check individual buffer limits
  const dims2 = dims * dims;
  const largestBuffer = dims2 * 4 * 4;  // dzAndCheckpoint buffer

  if (largestBuffer > maxBufferSize) {
    console.log(`  ⚠️  LARGEST BUFFER (dzAndCheckpoint) EXCEEDS LIMIT: ${(largestBuffer / (1024 * 1024)).toFixed(2)} MB > ${maxBufferSize / (1024 * 1024)} MB`);
  }

  if (total > maxBufferSize) {
    console.log(`  ⚠️  TOTAL EXCEEDS TYPICAL LIMIT`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('ANALYSIS:');
console.log('- WebGPU max buffer size varies by device but is often 256 MB');
console.log('- Single buffer (dzAndCheckpoint) is 16 bytes per pixel');
console.log('- At dims=4096: 268.44 MB for dzAndCheckpoint alone');
console.log('- This exceeds typical WebGPU buffer size limits!');
console.log('\nSOLUTION: Need to handle buffer creation failures gracefully');
console.log('and potentially split large buffers or use texture storage.');

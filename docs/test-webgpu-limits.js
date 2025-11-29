// Check various WebGPU limits that might affect large boards
console.log('WebGPU Limits Analysis for dims=2103');
console.log('='.repeat(70));

const dims = 2103;
const dims2 = dims * dims;

console.log('Board dimensions: ' + dims + ' x ' + dims + ' = ' + dims2 + ' pixels');
console.log('');

// Buffer size limits
const bufferSizes = {
  'iterations': dims2 * 4,
  'zValues': dims2 * 2 * 4,
  'status': dims2 * 4,
  'activePixels': dims2 * 4,
  'baseValues': dims2 * 2 * 4,
  'period': dims2 * 4,
};

console.log('BUFFER SIZES:');
for (const name in bufferSizes) {
  const sizeMB = bufferSizes[name] / (1024 * 1024);
  console.log('  ' + name + ': ' + sizeMB.toFixed(2) + ' MB');
}
console.log('');

// Workgroup dispatch limits
const workgroupSize = 64;
const numWorkgroups = Math.ceil(dims2 / workgroupSize);

console.log('WORKGROUP DISPATCH:');
console.log('  Workgroup size: ' + workgroupSize);
console.log('  Number of workgroups: ' + numWorkgroups);
console.log('  WebGPU maxComputeWorkgroupsPerDimension: typically 65535');
console.log('');

if (numWorkgroups > 65535) {
  console.log('  ⚠️  EXCEEDS LIMIT! ' + numWorkgroups + ' > 65535');
  console.log('  This will cause dispatchWorkgroups() to fail!');
} else {
  console.log('  ✓ Within limit (' + numWorkgroups + ' <= 65535)');
}
console.log('');

// Calculate maximum safe dims
const maxWorkgroups = 65535;
const maxPixels = maxWorkgroups * workgroupSize;
const maxDims = Math.floor(Math.sqrt(maxPixels));

console.log('MAXIMUM SAFE DIMENSIONS:');
console.log('  Max workgroups: ' + maxWorkgroups);
console.log('  Max pixels (with workgroup size 64): ' + maxPixels);
console.log('  Max dims: ' + maxDims + ' x ' + maxDims);
console.log('');

console.log('='.repeat(70));
console.log('DIAGNOSIS:');
if (numWorkgroups > 65535) {
  console.log('  dims=' + dims + ' EXCEEDS WebGPU workgroup dispatch limit!');
  console.log('  GPU board will fail to dispatch compute shader.');
} else {
  console.log('  dims=' + dims + ' is within WebGPU workgroup limits.');
  console.log('  Problem must be elsewhere (check browser console for errors).');
}
console.log('='.repeat(70));

// Test updated isSafeDims with workgroup limit
console.log('Updated isSafeDims Test (with workgroup limit)');
console.log('='.repeat(70));

function isSafeDims(dims) {
  const dims2 = dims * dims;

  // 1. Buffer size limit
  const maxSafeBufferSize = 200 * 1024 * 1024;  // 200 MB
  const largestBufferSize = dims2 * 4 * 4;
  if (largestBufferSize > maxSafeBufferSize) {
    return {safe: false, reason: 'buffer size'};
  }

  // 2. Workgroup dispatch limit
  const workgroupSize = 64;
  const numWorkgroups = Math.ceil(dims2 / workgroupSize);
  const maxWorkgroups = 65535;
  if (numWorkgroups > maxWorkgroups) {
    return {safe: false, reason: 'workgroup limit'};
  }

  return {safe: true, reason: 'ok'};
}

const testCases = [
  512,
  1024,
  2047,  // Should be SAFE (max safe dims)
  2048,  // Should be UNSAFE (exceeds workgroup limit)
  2103,  // User's failing case
  3600,  // Within buffer limit but exceeds workgroup
  4096   // Exceeds both
];

console.log('');
for (const dims of testCases) {
  const dims2 = dims * dims;
  const bufferSizeMB = (dims2 * 16 / (1024*1024)).toFixed(1);
  const numWorkgroups = Math.ceil(dims2 / 64);
  const result = isSafeDims(dims);

  const status = result.safe ? 'SAFE  ' : 'UNSAFE (' + result.reason + ')';
  console.log('dims=' + dims + ': ' + bufferSizeMB + ' MB, ' + numWorkgroups + ' workgroups -> ' + status);
}

console.log('');
console.log('='.repeat(70));
console.log('SUMMARY:');
console.log('  Max safe dims: 2047 (limited by workgroup dispatch)');
console.log('  User saw dims=2103 failing (69104 workgroups > 65535 limit)');
console.log('  Fix now correctly rejects dims >= 2048');
console.log('='.repeat(70));

// Test 2D workgroup dispatch calculations
console.log('2D Workgroup Dispatch Test');
console.log('='.repeat(70));

function calculate2DDispatch(dims) {
  const dims2 = dims * dims;
  const workgroupSize = 64;
  const numWorkgroups = Math.ceil(dims2 / workgroupSize);

  // 2D dispatch calculation
  const workgroupsX = Math.ceil(Math.sqrt(numWorkgroups));
  const workgroupsY = Math.ceil(numWorkgroups / workgroupsX);

  // Verify
  const totalWorkgroups = workgroupsX * workgroupsY;
  const maxThreads = totalWorkgroups * workgroupSize;
  const withinX = workgroupsX <= 65535;
  const withinY = workgroupsY <= 65535;

  return {
    dims,
    dims2,
    numWorkgroups,
    workgroupsX,
    workgroupsY,
    totalWorkgroups,
    maxThreads,
    withinX,
    withinY,
    valid: withinX && withinY && maxThreads >= dims2
  };
}

const testCases = [
  512,
  1024,
  2047,   // Was max with 1D
  2048,   // First to exceed 1D limit
  2103,   // User's failing case
  3600,
  4096,
  8192,
  16383   // New theoretical max (before buffer limit)
];

console.log('');
for (const dims of testCases) {
  const result = calculate2DDispatch(dims);
  const bufferMB = (result.dims2 * 16 / (1024*1024)).toFixed(1);

  console.log('dims=' + dims + ' (' + result.dims2 + ' pixels, ' + bufferMB + ' MB)');
  console.log('  Workgroups: ' + result.numWorkgroups + ' total');
  console.log('  2D dispatch: ' + result.workgroupsX + ' x ' + result.workgroupsY + ' = ' + result.totalWorkgroups);
  console.log('  Within limits: X=' + result.withinX + ', Y=' + result.withinY);
  console.log('  Result: ' + (result.valid ? 'WORKS' : 'FAILS'));

  // Check buffer limit
  if (result.dims2 * 16 > 200 * 1024 * 1024) {
    console.log('  Note: Exceeds buffer limit (200 MB), would use CPU');
  }

  console.log('');
}

console.log('='.repeat(70));
console.log('SUMMARY:');
console.log('  With 2D dispatch, workgroup limit no longer applies');
console.log('  Max dims now limited by buffer size: 3600 (197.8 MB)');
console.log('  dims=2103 now WORKS (was failing with 1D dispatch)');
console.log('='.repeat(70));

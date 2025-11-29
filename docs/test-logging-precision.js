// Test adaptive precision logging
console.log('Adaptive Precision Logging Test');
console.log('='.repeat(70));

function formatCoordinate(value, pixelSize) {
  // Calculate precision needed to resolve pixel size
  const precisionNeeded = Math.max(3, Math.min(15, Math.ceil(-Math.log10(pixelSize)) + 2));
  return value.toExponential(precisionNeeded);
}

const testCases = [
  { re: -0.5, im: 0.0, pixelSize: 3.0, desc: 'Initial view (shallow)' },
  { re: -0.5, im: 0.0, pixelSize: 1e-3, desc: 'Medium zoom' },
  { re: -0.7436438870371587, im: 0.1318259043121831, pixelSize: 1e-6, desc: 'Deep zoom' },
  { re: -0.7436438870371587, im: 0.1318259043121831, pixelSize: 1e-10, desc: 'Very deep zoom' },
  { re: -0.7436438870371587, im: 0.1318259043121831, pixelSize: 1e-14, desc: 'Ultra deep zoom' },
  { re: -0.7436438870371587, im: 0.1318259043121831, pixelSize: 1e-16, desc: 'At double precision limit' },
];

console.log('');
for (const test of testCases) {
  const precision = Math.max(3, Math.min(15, Math.ceil(-Math.log10(test.pixelSize)) + 2));
  const re_str = formatCoordinate(test.re, test.pixelSize);
  const im_str = formatCoordinate(test.im, test.pixelSize);

  console.log(test.desc + ':');
  console.log('  pixel=' + test.pixelSize.toExponential(1) + ', precision=' + precision + ' digits');
  console.log('  @ (' + re_str + ', ' + im_str + ')');
  console.log('');
}

console.log('='.repeat(70));
console.log('BENEFITS:');
console.log('  - Shallow zooms: concise (3-5 digits)');
console.log('  - Deep zooms: precise (10-15 digits)');
console.log('  - Coordinates always resolve to pixel level');
console.log('  - Capped at double precision limit (15 digits)');
console.log('='.repeat(70));

#!/usr/bin/env node

const fs = require('fs');

const path = require('path');
const rootDir = path.join(__dirname, '..');
const htmlLines = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8').split('\n');
const template = fs.readFileSync(path.join(__dirname, 'benchmark-template.html'), 'utf8');

// Line 2177: <script id="workerCode">
// Lines 2178-3413: code
// Line 3414: </script>
const workerCode = htmlLines.slice(2177, 3413).join('\n');

// Line 3415: <script id="mathCode">
// Lines 3416-3868: code
// Line 3869: </script>
const mathCode = htmlLines.slice(3415, 3868).join('\n');

console.log(`Extracted workerCode: ${workerCode.split('\n').length} lines`);
console.log(`Extracted mathCode: ${mathCode.split('\n').length} lines`);

if (!workerCode.includes('class Board')) {
  console.error('ERROR: Board class not found in workerCode!');
  process.exit(1);
}

if (!mathCode.includes('function toQd')) {
  console.error('ERROR: toQd function not found in mathCode!');
  process.exit(1);
}

let benchmark = template.replace('QUAD_CODE_PLACEHOLDER', mathCode);
benchmark = benchmark.replace('WORKER_CODE_PLACEHOLDER', workerCode);

fs.writeFileSync(path.join(rootDir, 'benchmark.html'), benchmark);

console.log('✓ Created benchmark.html');
console.log('✓ Open benchmark.html in your browser to test the optimized code.');

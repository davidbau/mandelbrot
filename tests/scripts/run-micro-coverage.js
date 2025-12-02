#!/usr/bin/env node
/**
 * Micro coverage test to verify line number alignment between
 * unit tests (c8) and integration tests (V8/CDP).
 *
 * This script:
 * 1. Runs a single unit test with c8 coverage
 * 2. Runs a single integration test with Puppeteer coverage
 * 3. Compares the coverage data to verify line numbers match
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '../..');
const NYC_OUTPUT = path.join(ROOT_DIR, '.nyc_output');
const SCRIPTS_DIR = path.join(NYC_OUTPUT, 'scripts');

// Clean up
console.log('=== Micro Coverage Test ===\n');
console.log('Cleaning up...');
if (fs.existsSync(NYC_OUTPUT)) {
  fs.rmSync(NYC_OUTPUT, { recursive: true });
}
fs.mkdirSync(NYC_OUTPUT, { recursive: true });
fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

// Extract scripts from index.html (includes coverageTestDummy function)
console.log('Extracting scripts...');
const { getWorkerBlobSource } = require('../utils/extract-scripts');
const workerBlob = getWorkerBlobSource();

// Find coverageTestDummy line number in the full blob
const blobLines = workerBlob.split('\n');
const dummyLineIndex = blobLines.findIndex(l =>
  l.includes('function coverageTestDummy')
);
const dummyLine = dummyLineIndex + 1; // 1-based

if (dummyLineIndex < 0) {
  console.error('ERROR: coverageTestDummy not found in workerBlob!');
  console.error('Make sure index.html contains the coverageTestDummy function.');
  process.exit(1);
}

console.log(`\ncoverageTestDummy function found at line ${dummyLine} in workerBlob`);
console.log('Lines around the function:');
for (let i = Math.max(0, dummyLineIndex - 1); i < dummyLineIndex + 10; i++) {
  const marker = (i === dummyLineIndex) ? '>>>' : '   ';
  console.log(`  ${marker} ${i + 1}: ${blobLines[i]?.substring(0, 60) || ''}`);
}

// Step 1: Run unit test with c8 + monocart for accurate line numbers
console.log('\n=== Running unit micro test with c8 + monocart ===');
try {
  execSync(
    `npx c8 --experimental-monocart ` +
    `--temp-directory="${NYC_OUTPUT}/c8-temp" ` +
    `--include=".nyc_output/scripts/workerBlob.js" ` +
    `npx jest tests/unit/coverage-micro.test.js --no-coverage`,
    { stdio: 'inherit', cwd: ROOT_DIR }
  );
} catch (e) {
  console.error('Unit test failed');
  process.exit(1);
}

// Convert c8 to Istanbul format using monocart
console.log('\nConverting c8 coverage with monocart...');
execSync(
  `npx c8 report --experimental-monocart ` +
  `--temp-directory="${NYC_OUTPUT}/c8-temp" ` +
  `--reporter=json --report-dir="${NYC_OUTPUT}/unit" ` +
  `--include=".nyc_output/scripts/workerBlob.js"`,
  { stdio: 'inherit', cwd: ROOT_DIR }
);

// Step 2: Run integration test with Puppeteer
console.log('\n=== Running integration micro test with Puppeteer ===');
try {
  execSync(
    'npx jest tests/integration/coverage-micro.test.js --runInBand ' +
    '--globalSetup ./tests/global-setup.js ' +
    '--globalTeardown ./tests/global-teardown.js',
    {
      stdio: 'inherit',
      cwd: ROOT_DIR,
      env: { ...process.env, COLLECT_COVERAGE: '1' }
    }
  );
} catch (e) {
  console.error('Integration test failed');
  process.exit(1);
}

// Step 3: Analyze coverage data
console.log('\n=== Analyzing Coverage Data ===\n');

// Load unit coverage
const unitCoveragePath = path.join(NYC_OUTPUT, 'unit', 'coverage-final.json');
let unitCoverage = null;
if (fs.existsSync(unitCoveragePath)) {
  const unitData = JSON.parse(fs.readFileSync(unitCoveragePath, 'utf-8'));
  // Find workerBlob coverage
  for (const [filePath, cov] of Object.entries(unitData)) {
    if (filePath.includes('workerBlob')) {
      unitCoverage = cov;
      break;
    }
  }
}

// Load integration coverage
const integrationCoveragePath = path.join(NYC_OUTPUT, 'coverage.json');
let integrationCoverage = null;
if (fs.existsSync(integrationCoveragePath)) {
  const intData = JSON.parse(fs.readFileSync(integrationCoveragePath, 'utf-8'));
  for (const [filePath, cov] of Object.entries(intData)) {
    if (filePath.includes('workerBlob')) {
      integrationCoverage = cov;
      break;
    }
  }
}

// Find the function in coverage data
function findFunctionCoverage(coverage, funcName) {
  if (!coverage || !coverage.fnMap) return null;
  for (const [id, fn] of Object.entries(coverage.fnMap)) {
    if (fn.name === funcName) {
      return {
        id,
        name: fn.name,
        line: fn.decl?.start?.line || fn.loc?.start?.line,
        hits: coverage.f[id]
      };
    }
  }
  return null;
}

console.log('Unit test coverage for coverageTestDummy:');
const unitFunc = findFunctionCoverage(unitCoverage, 'coverageTestDummy');
if (unitFunc) {
  console.log(`  Function ID: ${unitFunc.id}`);
  console.log(`  Line: ${unitFunc.line}`);
  console.log(`  Hits: ${unitFunc.hits}`);
} else {
  console.log('  NOT FOUND');
}

console.log('\nIntegration test coverage for coverageTestDummy:');
const intFunc = findFunctionCoverage(integrationCoverage, 'coverageTestDummy');
if (intFunc) {
  console.log(`  Function ID: ${intFunc.id}`);
  console.log(`  Line: ${intFunc.line}`);
  console.log(`  Hits: ${intFunc.hits}`);
} else {
  console.log('  NOT FOUND');
}

console.log('\n=== Verification ===');
console.log(`Expected line (from blob analysis): ${dummyLine}`);

let success = true;
if (unitFunc && unitFunc.line !== dummyLine) {
  console.log(`❌ Unit coverage line ${unitFunc.line} !== expected ${dummyLine}`);
  success = false;
} else if (unitFunc) {
  console.log(`✓ Unit coverage line matches: ${unitFunc.line}`);
}

if (intFunc && intFunc.line !== dummyLine) {
  console.log(`❌ Integration coverage line ${intFunc.line} !== expected ${dummyLine}`);
  success = false;
} else if (intFunc) {
  console.log(`✓ Integration coverage line matches: ${intFunc.line}`);
}

if (unitFunc && intFunc && unitFunc.line === intFunc.line) {
  console.log(`✓ Unit and integration lines match: ${unitFunc.line}`);
} else if (unitFunc && intFunc) {
  console.log(`❌ Line mismatch: unit=${unitFunc.line}, integration=${intFunc.line}`);
  success = false;
}

if (!unitFunc) {
  console.log('❌ Unit coverage not found for coverageTestDummy');
  success = false;
}

if (!intFunc) {
  console.log('⚠ Integration coverage not found (may be expected if function not called in worker)');
}

console.log('\n' + (success ? '✓ PASS' : '❌ FAIL'));
process.exit(success ? 0 : 1);

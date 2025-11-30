#!/usr/bin/env node
/**
 * Coverage collection script that combines:
 * 1. Unit test coverage via c8 (V8 native coverage)
 * 2. Integration test coverage via Puppeteer (V8 via CDP)
 *
 * Both use V8 coverage converted to Istanbul format via v8-to-istanbul,
 * ensuring compatible coverage data that can be merged.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const libCoverage = require('istanbul-lib-coverage');

const ROOT_DIR = path.join(__dirname, '../..');
const NYC_OUTPUT = path.join(ROOT_DIR, '.nyc_output');
const SCRIPTS_DIR = path.join(NYC_OUTPUT, 'scripts');

// Step 1: Clean up previous coverage
console.log('Cleaning up previous coverage data...');
if (fs.existsSync(NYC_OUTPUT)) {
  fs.rmSync(NYC_OUTPUT, { recursive: true });
}
fs.mkdirSync(NYC_OUTPUT, { recursive: true });
fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

// Step 2: Extract scripts from index.html
console.log('Extracting scripts from index.html...');
const { extractAllScripts } = require('../utils/extract-scripts');
extractAllScripts();

// Step 3: Run unit tests with c8
console.log('\n=== Running unit tests with c8 coverage ===');
try {
  execSync(
    `npx c8 --temp-directory="${NYC_OUTPUT}/c8-temp" --include=".nyc_output/scripts/**" jest tests/unit`,
    { stdio: 'inherit', cwd: ROOT_DIR }
  );
} catch (e) {
  console.error('Unit tests failed');
  process.exit(1);
}

// Step 4: Convert c8 coverage to Istanbul format
console.log('\nConverting c8 coverage to Istanbul format...');
try {
  execSync(
    `npx c8 report --temp-directory="${NYC_OUTPUT}/c8-temp" --reporter=json --report-dir="${NYC_OUTPUT}" --include=".nyc_output/scripts/**"`,
    { stdio: 'inherit', cwd: ROOT_DIR }
  );
  // c8 outputs to coverage-final.json, rename to unit-coverage.json
  const c8Output = path.join(NYC_OUTPUT, 'coverage-final.json');
  const unitOutput = path.join(NYC_OUTPUT, 'unit-coverage.json');
  if (fs.existsSync(c8Output)) {
    fs.renameSync(c8Output, unitOutput);
  }
} catch (e) {
  console.warn('Could not generate c8 coverage report:', e.message);
}

// Step 5: Run integration tests with Puppeteer coverage
console.log('\n=== Running integration tests with Puppeteer coverage ===');
try {
  execSync(
    'npx jest tests/integration --runInBand --globalSetup ./tests/global-setup.js --globalTeardown ./tests/global-teardown.js',
    { stdio: 'inherit', cwd: ROOT_DIR, env: { ...process.env, COLLECT_COVERAGE: '1' } }
  );
} catch (e) {
  console.error('Integration tests failed');
  process.exit(1);
}

// Step 6: Merge coverage files using istanbul-lib-coverage
console.log('\nMerging coverage data...');
const coverageFiles = [
  path.join(NYC_OUTPUT, 'coverage.json'),      // Integration tests
  path.join(NYC_OUTPUT, 'unit-coverage.json')  // Unit tests
].filter(f => fs.existsSync(f));

if (coverageFiles.length > 0) {
  // Create a coverage map using istanbul-lib-coverage
  const coverageMap = libCoverage.createCoverageMap({});

  for (const file of coverageFiles) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const [filePath, coverage] of Object.entries(data)) {
      // Use istanbul-lib-coverage to merge
      coverageMap.addFileCoverage(coverage);
    }
  }

  // Convert coverage map back to JSON format
  const merged = coverageMap.toJSON();

  fs.writeFileSync(
    path.join(NYC_OUTPUT, 'merged-coverage.json'),
    JSON.stringify(merged, null, 2)
  );

  // Use merged coverage for final report
  fs.writeFileSync(
    path.join(NYC_OUTPUT, 'coverage.json'),
    JSON.stringify(merged, null, 2)
  );
}

// Step 7: Generate report
console.log('\n=== Coverage Report ===\n');
try {
  execSync(
    'npx nyc report --reporter=text --reporter=html',
    { stdio: 'inherit', cwd: ROOT_DIR }
  );
} catch (e) {
  console.error('Could not generate coverage report:', e.message);
}

console.log('\nCoverage report generated in coverage/ directory');

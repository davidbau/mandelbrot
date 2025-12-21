#!/usr/bin/env node
/**
 * Coverage collection script that combines:
 * 1. Unit test coverage via c8 with monocart (V8 native coverage)
 * 2. Integration test coverage via Puppeteer (V8 via CDP)
 *
 * Uses monocart-coverage-reports instead of v8-to-istanbul for accurate
 * line number mapping. Both sources produce Istanbul-compatible format.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
const { extractAllScripts, getWorkerBlobSource } = require('../utils/extract-scripts');
extractAllScripts();
getWorkerBlobSource();  // Create combined workerBlob.js for unit tests

// Step 3: Run unit tests with c8 + monocart for accurate line numbers
console.log('\n=== Running unit tests with c8 coverage ===');
try {
  execSync(
    `npx c8 --experimental-monocart ` +
    `--temp-directory="${NYC_OUTPUT}/c8-temp" ` +
    `--include=".nyc_output/scripts/**" ` +
    `jest tests/unit`,
    { stdio: 'inherit', cwd: ROOT_DIR }
  );
} catch (e) {
  console.error('Unit tests failed');
  process.exit(1);
}

// Step 4: Convert c8 coverage to Istanbul format using monocart
console.log('\nConverting c8 coverage to Istanbul format...');
try {
  execSync(
    `npx c8 report --experimental-monocart ` +
    `--temp-directory="${NYC_OUTPUT}/c8-temp" ` +
    `--reporter=json --report-dir="${NYC_OUTPUT}" ` +
    `--include=".nyc_output/scripts/**"`,
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

// Step 6: Merge coverage files with custom logic
// istanbul-lib-coverage doesn't properly union function/statement/branch maps
// when one source has more entries than another. We need to:
// 1. Union all maps (fnMap, statementMap, branchMap)
// 2. Sum hit counts for entries in both, keep entries only in one
console.log('\nMerging coverage data...');
const coverageFiles = [
  path.join(NYC_OUTPUT, 'coverage.json'),      // Integration tests
  path.join(NYC_OUTPUT, 'unit-coverage.json')  // Unit tests
].filter(f => fs.existsSync(f));

/**
 * Merge two Istanbul coverage objects for the same file.
 * Properly unions maps and sums hit counts.
 */
function mergeCoverageObjects(a, b) {
  if (!a) return b;
  if (!b) return a;

  const merged = {
    path: a.path,
    statementMap: { ...a.statementMap },
    fnMap: { ...a.fnMap },
    branchMap: { ...a.branchMap },
    s: { ...a.s },
    f: { ...a.f },
    b: { ...a.b }
  };

  // Merge statement map and counts
  for (const [key, loc] of Object.entries(b.statementMap)) {
    if (!merged.statementMap[key]) {
      merged.statementMap[key] = loc;
      merged.s[key] = b.s[key] || 0;
    } else {
      merged.s[key] = (merged.s[key] || 0) + (b.s[key] || 0);
    }
  }

  // Merge function map and counts
  for (const [key, fn] of Object.entries(b.fnMap)) {
    if (!merged.fnMap[key]) {
      merged.fnMap[key] = fn;
      merged.f[key] = b.f[key] || 0;
    } else {
      merged.f[key] = (merged.f[key] || 0) + (b.f[key] || 0);
    }
  }

  // Merge branch map and counts
  for (const [key, branch] of Object.entries(b.branchMap)) {
    if (!merged.branchMap[key]) {
      merged.branchMap[key] = branch;
      merged.b[key] = b.b[key] || [0];
    } else {
      // Branch counts are arrays (one per branch path)
      const aCount = merged.b[key] || [];
      const bCount = b.b[key] || [];
      const maxLen = Math.max(aCount.length, bCount.length);
      merged.b[key] = [];
      for (let i = 0; i < maxLen; i++) {
        merged.b[key][i] = (aCount[i] || 0) + (bCount[i] || 0);
      }
    }
  }

  return merged;
}

/**
 * Extract just the filename from a coverage path.
 * Used as the key for merging coverage from different sources.
 */
function getFileKey(filePath) {
  // Extract just the filename
  const match = filePath.match(/([^/]+\.js)$/);
  return match ? match[1] : path.basename(filePath);
}

if (coverageFiles.length > 0) {
  const mergedByFile = {};

  for (const file of coverageFiles) {
    console.log(`  Loading ${path.basename(file)}...`);
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const [filePath, coverage] of Object.entries(data)) {
      // Use just the filename as key (for clean nyc output)
      const fileKey = getFileKey(filePath);
      // Path property should point to actual file for source lookup
      const fullPath = path.join(SCRIPTS_DIR, fileKey);
      const normalizedCoverage = { ...coverage, path: fullPath };
      mergedByFile[fileKey] = mergeCoverageObjects(
        mergedByFile[fileKey],
        normalizedCoverage
      );
    }
  }

  fs.writeFileSync(
    path.join(NYC_OUTPUT, 'merged-coverage.json'),
    JSON.stringify(mergedByFile, null, 2)
  );

  // Use merged coverage for final report
  fs.writeFileSync(
    path.join(NYC_OUTPUT, 'coverage.json'),
    JSON.stringify(mergedByFile, null, 2)
  );

  // Delete intermediate files so nyc only reads merged coverage.json
  const unitCoverageFile = path.join(NYC_OUTPUT, 'unit-coverage.json');
  if (fs.existsSync(unitCoverageFile)) {
    fs.unlinkSync(unitCoverageFile);
  }
  const rawCoverageFile = path.join(NYC_OUTPUT, 'raw-coverage.json');
  if (fs.existsSync(rawCoverageFile)) {
    const coverageDir = path.join(ROOT_DIR, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.renameSync(rawCoverageFile, path.join(coverageDir, 'raw-coverage.json'));
  }
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

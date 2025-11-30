/**
 * Coverage collection utilities for Puppeteer integration tests
 * Uses V8 coverage and converts to Istanbul format for reporting
 */

const v8toIstanbul = require('v8-to-istanbul');
const fs = require('fs');
const path = require('path');

const COVERAGE_DIR = path.join(__dirname, '../../.nyc_output');
const RAW_COVERAGE_FILE = path.join(COVERAGE_DIR, 'raw-coverage.json');

/**
 * Start collecting coverage on a page
 */
async function startCoverage(page) {
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
    includeRawScriptCoverage: true,
    reportAnonymousScripts: true
  });
}

/**
 * Stop coverage collection and append data to file
 */
async function stopCoverage(page) {
  const coverage = await page.coverage.stopJSCoverage();

  // Create output directory
  if (!fs.existsSync(COVERAGE_DIR)) {
    fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  }

  // Load existing data or start fresh
  let allCoverage = [];
  if (fs.existsSync(RAW_COVERAGE_FILE)) {
    try {
      allCoverage = JSON.parse(fs.readFileSync(RAW_COVERAGE_FILE, 'utf8'));
    } catch (e) {
      allCoverage = [];
    }
  }

  // Append new coverage
  allCoverage.push(...coverage);
  fs.writeFileSync(RAW_COVERAGE_FILE, JSON.stringify(allCoverage));
}

/**
 * Clear any existing raw coverage data (call at start of test run)
 */
function clearCoverage() {
  if (fs.existsSync(RAW_COVERAGE_FILE)) {
    fs.unlinkSync(RAW_COVERAGE_FILE);
  }
}

// Script block names matching script ids in index.html
const SCRIPT_NAMES = {
  198: 'mainCode',     // Main application code (lines 198-4522)
  4523: 'workerCode',  // Web worker code (lines 4523-8024)
  8025: 'quadCode',    // Quad-double precision math (lines 8025-9237)
  9238: 'i18nCode',    // Internationalization messages
  9416: 'mp4Muxer',    // MP4 muxer library
  9722: 'startApp',    // Application startup
  9730: 'analytics'    // Google Analytics
};

// Directory to store extracted scripts for coverage reporting
const SCRIPTS_DIR = path.join(COVERAGE_DIR, 'scripts');

/**
 * Get a descriptive name for a script based on its line number
 */
function getScriptName(lineNum) {
  // Find the closest matching line number
  const lines = Object.keys(SCRIPT_NAMES).map(Number).sort((a, b) => a - b);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lineNum >= lines[i]) {
      return SCRIPT_NAMES[lines[i]];
    }
  }
  return 'unknown';
}

/**
 * Convert raw V8 coverage to Istanbul format for reporting
 * Call this once at the end of all tests
 */
async function writeCoverageReport() {
  if (!fs.existsSync(RAW_COVERAGE_FILE)) {
    console.log('No coverage data collected');
    return;
  }

  const coverageData = JSON.parse(fs.readFileSync(RAW_COVERAGE_FILE, 'utf8'));
  if (coverageData.length === 0) {
    console.log('No coverage data collected');
    return;
  }

  const mergedCoverage = {};

  for (const entry of coverageData) {
    // Only collect coverage for index.html (main thread scripts)
    if (!entry.url.includes('index.html')) continue;

    // Skip entries without valid coverage data
    if (!entry.rawScriptCoverage || !entry.rawScriptCoverage.functions) continue;

    try {
      // v8-to-istanbul needs a file path, extract from URL and strip query params
      let filePath = entry.url.replace('file://', '');
      const queryIndex = filePath.indexOf('?');
      if (queryIndex !== -1) {
        filePath = filePath.substring(0, queryIndex);
      }

      // For HTML files, find where the script content starts
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const scriptStart = fileContent.indexOf(entry.text);
      if (scriptStart < 0) continue;

      const lineNum = fileContent.substring(0, scriptStart).split('\n').length;
      const scriptName = getScriptName(lineNum);

      // Create a real file for this script block so nyc can read it
      if (!fs.existsSync(SCRIPTS_DIR)) {
        fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
      }
      const scriptPath = path.join(SCRIPTS_DIR, `${scriptName}.js`);
      fs.writeFileSync(scriptPath, entry.text);

      // Use wrapperLength=0 since we're treating it as a standalone script
      const converter = v8toIstanbul(scriptPath, 0, {
        source: entry.text
      });
      await converter.load();
      converter.applyCoverage(entry.rawScriptCoverage.functions);
      const istanbulCoverage = converter.toIstanbul();

      // Merge coverage data (keyed by script path)
      for (const [file, data] of Object.entries(istanbulCoverage)) {
        const key = scriptPath;
        if (mergedCoverage[key]) {
          // Merge statement hit counts (only for statements that exist in statementMap)
          for (const [stmt, count] of Object.entries(data.s)) {
            if (mergedCoverage[key].statementMap[stmt]) {
              mergedCoverage[key].s[stmt] = (mergedCoverage[key].s[stmt] || 0) + count;
            }
          }
          // Merge branch hit counts (only for branches that exist in branchMap)
          for (const [branch, count] of Object.entries(data.b)) {
            if (mergedCoverage[key].branchMap[branch]) {
              if (!mergedCoverage[key].b[branch]) {
                mergedCoverage[key].b[branch] = count;
              } else {
                mergedCoverage[key].b[branch] = mergedCoverage[key].b[branch].map(
                  (c, i) => c + (count[i] || 0)
                );
              }
            }
          }
          // Merge function hit counts (only for functions that exist in fnMap)
          for (const [fn, count] of Object.entries(data.f)) {
            if (mergedCoverage[key].fnMap[fn]) {
              mergedCoverage[key].f[fn] = (mergedCoverage[key].f[fn] || 0) + count;
            }
          }
        } else {
          mergedCoverage[key] = data;
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not process coverage for ${entry.url}:`, err.message);
    }
  }

  // Write merged coverage
  const outputFile = path.join(COVERAGE_DIR, 'coverage.json');
  fs.writeFileSync(outputFile, JSON.stringify(mergedCoverage, null, 2));
  console.log(`Coverage data written to ${outputFile}`);

  // Clean up raw data
  fs.unlinkSync(RAW_COVERAGE_FILE);
}

/**
 * Check if coverage collection is enabled
 */
function isCoverageEnabled() {
  return process.env.COLLECT_COVERAGE === '1';
}

module.exports = {
  startCoverage,
  stopCoverage,
  clearCoverage,
  writeCoverageReport,
  isCoverageEnabled
};

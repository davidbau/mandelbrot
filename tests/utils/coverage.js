/**
 * Coverage collection utilities for Puppeteer integration tests
 * Uses V8 coverage and converts to Istanbul format for reporting
 * Supports both main thread and Web Worker coverage
 */

const v8toIstanbul = require('v8-to-istanbul');
const fs = require('fs');
const path = require('path');

const COVERAGE_DIR = path.join(__dirname, '../../.nyc_output');
const RAW_COVERAGE_FILE = path.join(COVERAGE_DIR, 'raw-coverage.json');
const WORKER_COVERAGE_FILE = path.join(COVERAGE_DIR, 'worker-coverage.json');

// Track active worker CDP sessions for coverage
const workerSessions = new Map();

/**
 * Start collecting coverage on a page and its workers
 */
async function startCoverage(page) {
  // Start main thread coverage
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
    includeRawScriptCoverage: true,
    reportAnonymousScripts: true
  });

  // Handle workers created on this page
  page.on('workercreated', async (worker) => {
    try {
      await startWorkerCoverage(worker);
    } catch (e) {
      // Worker may have terminated before we could attach
    }
  });

  page.on('workerdestroyed', async (worker) => {
    try {
      await stopWorkerCoverage(worker);
    } catch (e) {
      // Worker already gone
    }
  });
}

/**
 * Start coverage collection on a worker
 */
async function startWorkerCoverage(worker) {
  const client = await worker.client;

  // Enable profiler and start precise coverage
  await client.send('Profiler.enable');
  await client.send('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: true
  });

  workerSessions.set(worker, client);
}

/**
 * Stop coverage collection on a worker and save data
 */
async function stopWorkerCoverage(worker) {
  const client = workerSessions.get(worker);
  if (!client) return;

  try {
    const { result } = await client.send('Profiler.takePreciseCoverage');
    await client.send('Profiler.stopPreciseCoverage');
    await client.send('Profiler.disable');

    // Save worker coverage
    if (result && result.length > 0) {
      saveWorkerCoverage(result, worker.url());
    }
  } catch (e) {
    // Worker may have terminated
  } finally {
    workerSessions.delete(worker);
  }
}

/**
 * Save worker coverage data to file
 */
function saveWorkerCoverage(coverageResult, workerUrl) {
  if (!fs.existsSync(COVERAGE_DIR)) {
    fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  }

  let allWorkerCoverage = [];
  if (fs.existsSync(WORKER_COVERAGE_FILE)) {
    try {
      allWorkerCoverage = JSON.parse(fs.readFileSync(WORKER_COVERAGE_FILE, 'utf8'));
    } catch (e) {
      allWorkerCoverage = [];
    }
  }

  // Add source URL info for later processing
  for (const script of coverageResult) {
    script.workerUrl = workerUrl;
  }

  allWorkerCoverage.push(...coverageResult);
  fs.writeFileSync(WORKER_COVERAGE_FILE, JSON.stringify(allWorkerCoverage));
}

/**
 * Stop coverage collection and append data to file
 */
async function stopCoverage(page) {
  // Stop coverage on any remaining workers
  for (const [worker] of workerSessions) {
    try {
      await stopWorkerCoverage(worker);
    } catch (e) {
      // Worker may be gone
    }
  }

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
  if (fs.existsSync(WORKER_COVERAGE_FILE)) {
    fs.unlinkSync(WORKER_COVERAGE_FILE);
  }
  workerSessions.clear();
}

// Script block names matching script ids in index.html
// Note: workerCode and quadCode are excluded from main thread coverage
// since they're covered via workerBlob.js (combined file used by workers)
const SCRIPT_NAMES = {
  198: 'mainCode',     // Main application code (lines 198-4522)
  // 4523: 'workerCode' - covered via workerBlob.js
  // 8025: 'quadCode'   - covered via workerBlob.js
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

      // Write the script content without hardcoded exports
      // Unit tests use loadScript() which adds the correct exports dynamically
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

  // Process worker coverage if available
  if (fs.existsSync(WORKER_COVERAGE_FILE)) {
    const workerCoverageData = JSON.parse(fs.readFileSync(WORKER_COVERAGE_FILE, 'utf8'));
    console.log(`Processing ${workerCoverageData.length} worker coverage entries`);

    // Read the extracted script files to build the combined source
    const workerCodePath = path.join(SCRIPTS_DIR, 'workerCode.js');
    const quadCodePath = path.join(SCRIPTS_DIR, 'quadCode.js');

    if (fs.existsSync(workerCodePath) && fs.existsSync(quadCodePath)) {
      const workerCodeSource = fs.readFileSync(workerCodePath, 'utf8');
      const quadCodeSource = fs.readFileSync(quadCodePath, 'utf8');
      const combinedSource = workerCodeSource + quadCodeSource;

      // Create a combined worker blob file for coverage reporting
      const workerBlobPath = path.join(SCRIPTS_DIR, 'workerBlob.js');
      fs.writeFileSync(workerBlobPath, combinedSource);

      // Process each worker coverage entry
      for (const entry of workerCoverageData) {
        if (!entry.functions || entry.functions.length === 0) continue;

        try {
          const converter = v8toIstanbul(workerBlobPath, 0, {
            source: combinedSource
          });
          await converter.load();
          converter.applyCoverage(entry.functions);
          const istanbulCoverage = converter.toIstanbul();

          // Merge worker coverage with existing coverage data
          for (const [file, data] of Object.entries(istanbulCoverage)) {
            const key = workerBlobPath;
            if (mergedCoverage[key]) {
              // Merge statement hit counts
              for (const [stmt, count] of Object.entries(data.s)) {
                if (mergedCoverage[key].statementMap[stmt]) {
                  mergedCoverage[key].s[stmt] = (mergedCoverage[key].s[stmt] || 0) + count;
                }
              }
              // Merge branch hit counts
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
              // Merge function hit counts
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
          console.warn('Warning: Could not process worker coverage:', err.message);
        }
      }
    } else {
      console.log('Worker coverage skipped: extracted scripts not found');
    }

    fs.unlinkSync(WORKER_COVERAGE_FILE);
  }

  // Write merged coverage
  const outputFile = path.join(COVERAGE_DIR, 'coverage.json');
  fs.writeFileSync(outputFile, JSON.stringify(mergedCoverage, null, 2));
  console.log(`Coverage data written to ${outputFile}`);

  // Clean up raw data
  if (fs.existsSync(RAW_COVERAGE_FILE)) {
    fs.unlinkSync(RAW_COVERAGE_FILE);
  }
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

/**
 * Coverage collection utilities for Puppeteer integration tests
 * Uses V8 coverage and converts to Istanbul format via monocart-coverage-reports
 * for accurate line number mapping (avoiding v8-to-istanbul issues).
 * Supports both main thread and Web Worker coverage.
 */

const CoverageReport = require('monocart-coverage-reports');
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

// Directory to store extracted scripts for coverage reporting
const SCRIPTS_DIR = path.join(COVERAGE_DIR, 'scripts');
const HTML_PATH = path.join(__dirname, '../../index.html');

// Scripts to track for main thread coverage
// Note: workerCode is excluded (type="text/webworker", only used in worker blob)
// quadCode is included because it's used in both main thread AND worker blob
const MAIN_THREAD_SCRIPTS = ['mainCode', 'quadCode', 'i18nCode', 'mp4Muxer', 'startApp', 'analytics'];

/**
 * Parse index.html to find script block line numbers dynamically.
 * Returns a map of line number -> script name.
 */
function getScriptLineNumbers() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const lines = html.split('\n');
  const scriptLines = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match <script id="scriptName"> but exclude type="text/webworker"
    const match = line.match(/<script\s+id="([^"]+)"(?:\s+[^>]*)?>/)
    if (match) {
      const scriptId = match[1];
      // Skip workerCode (it's type="text/webworker", only used in worker blob)
      if (scriptId === 'workerCode') continue;
      // Only track scripts we care about
      if (MAIN_THREAD_SCRIPTS.includes(scriptId)) {
        scriptLines[i + 1] = scriptId;  // 1-based line number
      }
    }
  }

  return scriptLines;
}

// Cache the script line numbers (parsed once per process)
let cachedScriptNames = null;

/**
 * Get a descriptive name for a script based on its line number
 */
function getScriptName(lineNum) {
  // Parse script line numbers from HTML on first call
  if (cachedScriptNames === null) {
    cachedScriptNames = getScriptLineNumbers();
  }

  // Find the closest matching line number
  const lines = Object.keys(cachedScriptNames).map(Number).sort((a, b) => a - b);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lineNum >= lines[i]) {
      return cachedScriptNames[lines[i]];
    }
  }
  return 'unknown';
}

/**
 * Convert raw V8 coverage to Istanbul format for reporting using monocart.
 * Call this once at the end of all tests.
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

  // Prepare V8 coverage data for monocart
  const v8CoverageList = [];

  // Create scripts directory
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  // Process main thread scripts from index.html
  for (const entry of coverageData) {
    // Only collect coverage for index.html (main thread scripts)
    if (!entry.url.includes('index.html')) continue;

    // Skip entries without valid coverage data
    if (!entry.rawScriptCoverage || !entry.rawScriptCoverage.functions) continue;

    try {
      // Extract file path from URL and strip query params
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
      const scriptPath = path.join(SCRIPTS_DIR, `${scriptName}.js`);

      // Write the script content
      fs.writeFileSync(scriptPath, entry.text);

      // Add to V8 coverage list for monocart
      v8CoverageList.push({
        url: scriptPath,
        scriptId: entry.rawScriptCoverage.scriptId,
        source: entry.text,
        functions: entry.rawScriptCoverage.functions
      });
    } catch (err) {
      console.warn(`Warning: Could not process coverage for ${entry.url}:`, err.message);
    }
  }

  // Process worker coverage if available
  if (fs.existsSync(WORKER_COVERAGE_FILE)) {
    const workerCoverageData = JSON.parse(fs.readFileSync(WORKER_COVERAGE_FILE, 'utf8'));
    console.log(`Processing ${workerCoverageData.length} worker coverage entries`);

    // Use extract-scripts to get/regenerate workerBlob.js
    const { getWorkerBlobSource } = require('./extract-scripts');
    const combinedSource = getWorkerBlobSource();
    const workerBlobPath = path.join(SCRIPTS_DIR, 'workerBlob.js');

    if (combinedSource) {
      // Process each worker coverage entry
      for (const entry of workerCoverageData) {
        if (!entry.functions || entry.functions.length === 0) continue;

        // Add to V8 coverage list for monocart
        v8CoverageList.push({
          url: workerBlobPath,
          scriptId: entry.scriptId,
          source: combinedSource,
          functions: entry.functions
        });
      }
    } else {
      console.log('Worker coverage skipped: extracted scripts not found');
    }

    fs.unlinkSync(WORKER_COVERAGE_FILE);
  }

  // Use monocart to convert V8 coverage to Istanbul format
  // Use a separate temp directory so monocart doesn't clean up our scripts
  const monocartDir = path.join(COVERAGE_DIR, '.monocart-temp');
  const mcr = CoverageReport({
    name: 'Integration Coverage',
    outputDir: monocartDir,
    reports: ['json'],  // Generate Istanbul JSON
    cleanCache: true,
    logging: 'error'  // Suppress info logging
  });

  // Add all V8 coverage data
  await mcr.add(v8CoverageList);

  // Generate report (creates coverage-final.json)
  await mcr.generate();

  // Read the generated Istanbul coverage and rewrite with clean keys
  const istanbulPath = path.join(monocartDir, 'coverage-final.json');
  if (fs.existsSync(istanbulPath)) {
    const istanbulData = JSON.parse(fs.readFileSync(istanbulPath, 'utf8'));
    const cleanedData = {};

    for (const [filePath, coverage] of Object.entries(istanbulData)) {
      // Use just the filename as key for clean reports
      const fileName = path.basename(filePath);
      cleanedData[fileName] = coverage;
    }

    // Write to coverage.json (the file that run-coverage.js expects)
    fs.writeFileSync(
      path.join(COVERAGE_DIR, 'coverage.json'),
      JSON.stringify(cleanedData, null, 2)
    );

    // Clean up monocart's temp directory
    fs.rmSync(monocartDir, { recursive: true, force: true });
  }

  console.log(`Coverage data written to ${path.join(COVERAGE_DIR, 'coverage.json')}`);

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

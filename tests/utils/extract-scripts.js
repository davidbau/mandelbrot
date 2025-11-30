/**
 * Extract script blocks from index.html to separate .js files.
 * This enables V8-based coverage collection that's compatible with
 * both integration tests (Puppeteer) and unit tests (c8).
 */

const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, '../../.nyc_output/scripts');
const HTML_PATH = path.join(__dirname, '../../index.html');

// Script IDs to extract
const SCRIPT_IDS = ['quadCode', 'mainCode', 'workerCode', 'i18nCode'];

/**
 * Extract a script block by its ID and write it to a .js file
 * @param {string} scriptId - The id attribute of the script tag
 * @returns {string} Path to the extracted file
 */
function extractScript(scriptId) {
  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  // Match script tag at start of line (with optional leading whitespace) to avoid matching strings inside JS code
  const scriptPattern = new RegExp(`^\\s*<script id="${scriptId}">([\\s\\S]*?)^\\s*<\\/script>`, 'm');
  const match = scriptPattern.exec(html);

  if (!match) {
    throw new Error(`Script with id "${scriptId}" not found in index.html`);
  }

  // Ensure output directory exists
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  const scriptPath = path.join(SCRIPTS_DIR, `${scriptId}.js`);
  fs.writeFileSync(scriptPath, match[1]);

  return scriptPath;
}

/**
 * Extract all known script blocks
 * @returns {Object} Map of scriptId -> file path
 */
function extractAllScripts() {
  const paths = {};
  for (const scriptId of SCRIPT_IDS) {
    try {
      paths[scriptId] = extractScript(scriptId);
    } catch (e) {
      console.warn(`Warning: Could not extract ${scriptId}: ${e.message}`);
    }
  }
  return paths;
}

/**
 * Get the path to an extracted script, extracting it if necessary
 * @param {string} scriptId - The script ID
 * @returns {string} Path to the script file
 */
function getScriptPath(scriptId) {
  const scriptPath = path.join(SCRIPTS_DIR, `${scriptId}.js`);

  // If file doesn't exist or is older than index.html, re-extract
  if (!fs.existsSync(scriptPath)) {
    return extractScript(scriptId);
  }

  const htmlStat = fs.statSync(HTML_PATH);
  const scriptStat = fs.statSync(scriptPath);

  if (htmlStat.mtime > scriptStat.mtime) {
    return extractScript(scriptId);
  }

  return scriptPath;
}

/**
 * Load an extracted script and return specified exports
 * Uses vm.runInThisContext to execute the script, then extracts the requested names.
 *
 * Note: This approach doesn't work well with c8 coverage since c8 tracks file-based coverage.
 * For coverage collection, we need to use the module wrapper approach.
 *
 * @param {string} scriptId - The script ID to load
 * @param {Array<string>} exportNames - Names to export from the script
 * @returns {Object} Object with the requested exports
 */
function loadScript(scriptId, exportNames) {
  const scriptPath = getScriptPath(scriptId);

  // Read the script content
  const code = fs.readFileSync(scriptPath, 'utf-8');

  // For coverage collection, we need to require() a file so c8 can track it.
  // Create a module wrapper file that exports the requested names.
  // This will have different statement maps than the browser version,
  // but we handle this by running unit tests separately with c8.
  const wrappedCode = `${code}\nmodule.exports = { ${exportNames.join(', ')} };`;

  const tempPath = path.join(SCRIPTS_DIR, `${scriptId}.module.js`);
  fs.writeFileSync(tempPath, wrappedCode);

  // Clear require cache to ensure fresh load
  delete require.cache[require.resolve(tempPath)];

  return require(tempPath);
}

module.exports = {
  extractScript,
  extractAllScripts,
  getScriptPath,
  loadScript,
  SCRIPTS_DIR,
  SCRIPT_IDS
};

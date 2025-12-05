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
const SCRIPT_IDS = ['mathCode', 'mainCode', 'workerCode', 'i18nCode'];

/**
 * Extract a script block by its ID and write it to a .js file
 * @param {string} scriptId - The id attribute of the script tag
 * @returns {string} Path to the extracted file
 */
function extractScript(scriptId) {
  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  // Match script tag at start of line (with optional leading whitespace)
  // Allow optional attributes after the ID (e.g. type="text/javascript")
  const scriptPattern = new RegExp(`^\\s*<script id="${scriptId}"[^>]*>([\\s\\S]*?)^\\s*<\\/script>`, 'm');
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

// JavaScript reserved words that cannot be exported
const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new',
  'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'class', 'const', 'enum', 'export', 'extends', 'import', 'super',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'await', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity'
]);

/**
 * Extract all top-level function and class names from JavaScript code.
 * Filters out reserved words and local variables.
 * @param {string} code - JavaScript source code
 * @returns {Array<string>} Array of function/class names
 */
function extractExportNames(code) {
  const names = [];

  // Match function declarations: function name(
  const funcPattern = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  let match;
  while ((match = funcPattern.exec(code)) !== null) {
    const name = match[1];
    if (!RESERVED_WORDS.has(name)) {
      names.push(name);
    }
  }

  // Match class declarations: class Name
  const classPattern = /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = classPattern.exec(code)) !== null) {
    const name = match[1];
    if (!RESERVED_WORDS.has(name)) {
      names.push(name);
    }
  }

  return [...new Set(names)]; // Remove duplicates
}

/**
 * Load an extracted script and return all exports.
 * Auto-detects function and class names to export.
 * Appends module.exports to the base .js file so both unit tests (c8) and
 * integration tests (Puppeteer) use the exact same file, enabling coverage merge.
 *
 * @param {string} scriptId - The script ID to load
 * @returns {Object} Object with all detected exports
 */
function loadScript(scriptId) {
  const scriptPath = getScriptPath(scriptId);

  // Read the script content
  const code = fs.readFileSync(scriptPath, 'utf-8');

  // Auto-detect exports
  const exportNames = extractExportNames(code);

  // Append module.exports to the base file (not a separate .module.js)
  // This ensures both unit and integration tests use identical file content,
  // allowing coverage data to be properly merged.
  // The module.exports line is harmless in browser context.
  const exportLine = `\nif (typeof module !== 'undefined') module.exports = { ${exportNames.join(', ')} };`;
  if (!code.includes('module.exports')) {
    fs.writeFileSync(scriptPath, code + exportLine);
  }

  // Clear require cache to ensure fresh load
  delete require.cache[require.resolve(scriptPath)];

  return require(scriptPath);
}

/**
 * Get the combined worker blob source (workerCode + mathCode) without loading.
 * Matches the exact format created by assembleWorkerCode() in index.html
 * when running under Puppeteer (no line padding, for coverage alignment).
 *
 * @returns {string} The combined source code
 */
function getWorkerBlobSource() {
  // Get paths to source scripts (extract if needed)
  const workerCodePath = getScriptPath('workerCode');
  const quadCodePath = getScriptPath('mathCode');

  // Read source files
  const workerCode = fs.readFileSync(workerCodePath, 'utf-8');
  const quadCode = fs.readFileSync(quadCodePath, 'utf-8');

  // Build worker blob matching browser's assembleWorkerCode() format under Puppeteer
  // (no line padding - navigator.webdriver sets lastScriptLineNumber to 0)
  const combinedCode = '// Linefeeds to align line numbers with HTML.\n' +
                       '// <script id="workerCode">' +
                       workerCode +
                       '// </script>\n' +
                       '// <script id="mathCode">' +
                       quadCode +
                       '// </script>\n';

  // Auto-detect exports from combined code
  const exportNames = extractExportNames(combinedCode);
  const exportLine = `\nif (typeof module !== 'undefined') ` +
                     `module.exports = { ${exportNames.join(', ')} };`;

  // Ensure output directory exists
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  // Write combined file
  const blobPath = path.join(SCRIPTS_DIR, 'workerBlob.js');
  fs.writeFileSync(blobPath, combinedCode + exportLine);

  return combinedCode + exportLine;
}

/**
 * Create and load the combined worker blob (workerCode + mathCode).
 * Requires mocking global.self = global before calling.
 *
 * @returns {Object} Object with all detected exports
 */
function loadWorkerBlob() {
  getWorkerBlobSource();  // Ensure file is written

  // Clear require cache and load
  const blobPath = path.join(SCRIPTS_DIR, 'workerBlob.js');
  delete require.cache[require.resolve(blobPath)];
  return require(blobPath);
}

module.exports = {
  extractScript,
  extractAllScripts,
  getScriptPath,
  loadScript,
  getWorkerBlobSource,
  loadWorkerBlob,
  SCRIPTS_DIR,
  SCRIPT_IDS
};

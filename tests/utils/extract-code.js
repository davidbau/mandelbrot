/**
 * Utility to extract JavaScript code from index.html for testing.
 * This allows tests to remain synchronized with the main codebase.
 */

const fs = require('fs');
const path = require('path');

// Cache the HTML content
let htmlContent = null;

function getHtmlContent() {
  if (!htmlContent) {
    const htmlPath = path.join(__dirname, '../../index.html');
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  }
  return htmlContent;
}

/**
 * Extract a specific function by name from index.html
 * @param {string} functionName - Name of the function to extract
 * @returns {Function} The extracted function
 */
function extractFunction(functionName) {
  const html = getHtmlContent();

  // Match function declaration (handles both 'function name()' and 'const name = ')
  const patterns = [
    new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*{`, 'g'),
    new RegExp(`const\\s+${functionName}\\s*=\\s*(?:function\\s*)?\\([^)]*\\)\\s*=>\\s*{`, 'g'),
    new RegExp(`${functionName}\\s*:\\s*(?:function\\s*)?\\([^)]*\\)\\s*=>\\s*{`, 'g')
  ];

  let match = null;
  let startIndex = -1;

  for (const pattern of patterns) {
    const m = pattern.exec(html);
    if (m) {
      match = m;
      startIndex = m.index;
      break;
    }
  }

  if (!match) {
    throw new Error(`Function ${functionName} not found in index.html`);
  }

  // Find the matching closing brace
  let braceCount = 0;
  let inFunction = false;
  let endIndex = startIndex;

  for (let i = startIndex; i < html.length; i++) {
    const char = html[i];
    if (char === '{') {
      braceCount++;
      inFunction = true;
    } else if (char === '}') {
      braceCount--;
      if (inFunction && braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  const functionCode = html.substring(startIndex, endIndex);

  // Evaluate the function in a context
  // eslint-disable-next-line no-new-func
  return new Function('return ' + functionCode)();
}

/**
 * Extract all functions matching a pattern
 * @param {RegExp} pattern - Pattern to match function names
 * @returns {Object} Object with function names as keys and functions as values
 */
function extractFunctions(pattern) {
  const html = getHtmlContent();
  const functions = {};

  // Find all function declarations
  const functionRegex = /function\s+(\w+)\s*\([^)]*\)|const\s+(\w+)\s*=\s*(?:function\s*)?\([^)]*\)\s*=>/g;
  let match;

  while ((match = functionRegex.exec(html)) !== null) {
    const name = match[1] || match[2];
    if (pattern.test(name)) {
      try {
        functions[name] = extractFunction(name);
      } catch (e) {
        // Skip functions that can't be extracted
      }
    }
  }

  return functions;
}

/**
 * Extract a class definition from index.html
 * @param {string} className - Name of the class to extract
 * @returns {string} The class code as a string
 */
function extractClass(className) {
  const html = getHtmlContent();

  const classPattern = new RegExp(`class\\s+${className}\\s*(?:extends\\s+\\w+)?\\s*{`, 'g');
  const match = classPattern.exec(html);

  if (!match) {
    throw new Error(`Class ${className} not found in index.html`);
  }

  const startIndex = match.index;

  // Find the matching closing brace
  let braceCount = 0;
  let inClass = false;
  let endIndex = startIndex;

  for (let i = startIndex; i < html.length; i++) {
    const char = html[i];
    if (char === '{') {
      braceCount++;
      inClass = true;
    } else if (char === '}') {
      braceCount--;
      if (inClass && braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  return html.substring(startIndex, endIndex);
}

/**
 * Create a test environment with extracted functions and constants
 * All functions are evaluated in a shared scope so they can reference each other
 * @param {Array<string>} names - Names of functions or constants to extract
 * @returns {Object} Object with function/constant names as keys
 */
function createTestEnvironment(names) {
  const html = getHtmlContent();
  const env = {};

  // Extract all function/constant bodies as strings first
  const codeBodies = [];
  const foundNames = [];

  for (const name of names) {
    try {
      // Find function or constant in HTML
      const patterns = [
        // Function declaration: function name(...) {
        new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*{`, 'g'),
        // Arrow function: const name = (...) => {
        new RegExp(`const\\s+${name}\\s*=\\s*(?:function\\s*)?\\([^)]*\\)\\s*=>\\s*{`, 'g'),
        // Constant with array value: const name = [
        new RegExp(`const\\s+${name}\\s*=\\s*\\[`, 'g'),
        // Constant with other value: const name = ...
        new RegExp(`const\\s+${name}\\s*=\\s*[^\\[{]`, 'g')
      ];

      let match = null;
      let startIndex = -1;
      let patternIndex = -1;

      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        const m = pattern.exec(html);
        if (m) {
          match = m;
          startIndex = m.index;
          patternIndex = i;
          break;
        }
      }

      if (!match) {
        console.warn(`Warning: ${name} not found`);
        continue;
      }

      let endIndex = startIndex;

      if (patternIndex <= 1) {
        // Function: find matching closing brace
        let braceCount = 0;
        let inFunction = false;

        for (let i = startIndex; i < html.length; i++) {
          const char = html[i];
          if (char === '{') {
            braceCount++;
            inFunction = true;
          } else if (char === '}') {
            braceCount--;
            if (inFunction && braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
      } else if (patternIndex === 2) {
        // Constant with array: find matching closing bracket
        let bracketCount = 0;
        let inArray = false;

        for (let i = startIndex; i < html.length; i++) {
          const char = html[i];
          if (char === '[') {
            bracketCount++;
            inArray = true;
          } else if (char === ']') {
            bracketCount--;
            if (inArray && bracketCount === 0) {
              endIndex = i + 1;
              // Include the semicolon if present
              if (html[endIndex] === ';') endIndex++;
              break;
            }
          }
        }
      } else {
        // Simple constant: find end of line or semicolon
        for (let i = startIndex; i < html.length; i++) {
          const char = html[i];
          if (char === ';' || char === '\n') {
            endIndex = i + 1;
            break;
          }
        }
      }

      codeBodies.push(html.substring(startIndex, endIndex));
      foundNames.push(name);
    } catch (e) {
      console.warn(`Warning: Could not extract ${name}: ${e.message}`);
    }
  }

  // Evaluate all code in a shared scope
  const allCode = codeBodies.join('\n\n');

  // eslint-disable-next-line no-new-func
  const evalFunction = new Function(`
    ${allCode}
    return {${foundNames.join(', ')}};
  `);

  try {
    return evalFunction();
  } catch (e) {
    console.error('Error evaluating code:', e.message);
    console.error('Code:', allCode.substring(0, 500));
    throw e;
  }
}

/**
 * Extract code between script tags from index.html
 * @returns {string} All JavaScript code from the HTML
 */
function extractAllJavaScript() {
  const html = getHtmlContent();
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let allCode = '';
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    allCode += match[1] + '\n';
  }

  return allCode;
}

module.exports = {
  extractFunction,
  extractFunctions,
  extractClass,
  createTestEnvironment,
  extractAllJavaScript
};

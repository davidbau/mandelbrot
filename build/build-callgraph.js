#!/usr/bin/env node
/**
 * Generates call graph data from git history for visualization.
 *
 * Usage: node build/build-callgraph.js
 * Output: coverage/callgraph-data.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use acorn-loose for more forgiving parsing of potentially incomplete code
let acornLoose;
try {
  acornLoose = require('acorn-loose');
} catch (e) {
  console.error('acorn-loose not found, installing...');
  execSync('npm install acorn-loose', { stdio: 'inherit' });
  acornLoose = require('acorn-loose');
}

// Extract JavaScript from HTML file, tracking script boundaries
function extractJS(html) {
  const scripts = [];
  const scriptRanges = []; // {start, end, htmlLine, jsLineStart} in concatenated JS
  const regex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let offset = 0;
  let jsLineStart = 1; // Line number in concatenated JS where this script starts

  // Count lines up to a position in HTML
  function countLines(text, upTo) {
    let lines = 1;
    for (let i = 0; i < upTo && i < text.length; i++) {
      if (text[i] === '\n') lines++;
    }
    return lines;
  }

  // Count newlines in a string
  function countNewlines(text) {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') count++;
    }
    return count;
  }

  while ((match = regex.exec(html)) !== null) {
    // Skip external scripts - only check the opening tag, not the content
    const openingTag = match[0].slice(0, match[0].indexOf('>') + 1);
    if (openingTag.includes('src=')) continue;
    const content = match[1];
    // Line number where the script content starts in HTML
    const htmlLine = countLines(html, match.index + match[0].indexOf('>') + 1);
    scriptRanges.push({ start: offset, end: offset + content.length, htmlLine, jsLineStart });
    scripts.push(content);
    offset += content.length + 1; // +1 for the \n we join with
    jsLineStart += countNewlines(content) + 1; // +1 for the joining \n
  }
  return { js: scripts.join('\n'), scriptRanges };
}

// Find which script index a location belongs to
function getScriptIndex(loc, scriptRanges) {
  for (let i = 0; i < scriptRanges.length; i++) {
    if (loc >= scriptRanges[i].start && loc < scriptRanges[i].end) {
      return i;
    }
  }
  return scriptRanges.length - 1; // Default to last script
}

// Get HTML line offset for a location
// When jsLine is from the concatenated JS, we need to:
// 1. Subtract jsLineStart (where this script starts in concatenated JS)
// 2. Add htmlLine (where this script starts in HTML)
// Result: jsLine + (htmlLine - jsLineStart)
function getHtmlLineOffset(loc, scriptRanges) {
  for (let i = 0; i < scriptRanges.length; i++) {
    if (loc >= scriptRanges[i].start && loc < scriptRanges[i].end) {
      return scriptRanges[i].htmlLine - scriptRanges[i].jsLineStart;
    }
  }
  if (scriptRanges.length > 0) {
    const last = scriptRanges[scriptRanges.length - 1];
    return last.htmlLine - last.jsLineStart;
  }
  return 0;
}

// Convert character offset to line number
function offsetToLine(offset, lineOffsets) {
  for (let i = 0; i < lineOffsets.length; i++) {
    if (offset < lineOffsets[i]) {
      return i; // 1-indexed
    }
  }
  return lineOffsets.length;
}

// Build array of line start offsets
function buildLineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

// Parse JavaScript and extract call graph
function extractCallGraph(js, scriptRanges = []) {
  const functions = new Map(); // name -> { calls: Set, loc: number, type: string, script: number, line: number, endLine: number }
  const classes = new Map(); // className -> { extends: string|null, methods: Set, loc: number, script: number, line: number, endLine: number }

  // Build line offsets for the JS code
  const lineOffsets = buildLineOffsets(js);

  // Helper to get HTML line from JS location
  function getHtmlLine(jsLine, loc) {
    return jsLine + getHtmlLineOffset(loc, scriptRanges);
  }

  let ast;
  try {
    ast = acornLoose.parse(js, {
      ecmaVersion: 2022,
      sourceType: 'script',
      allowHashBang: true,
      locations: true
    });
  } catch (e) {
    console.warn('Parse error:', e.message);
    return { nodes: [], edges: [] };
  }

  // Collect all class and function/method definitions
  function collectDefinitions(node, currentClass = null) {
    if (!node || typeof node !== 'object') return;

    // Detect class declarations
    if (node.type === 'ClassDeclaration' && node.id?.name) {
      const className = node.id.name;
      let extendsName = null;
      let mixinName = null;
      let mixinBase = null;

      // Handle simple extends: class Foo extends Bar
      if (node.superClass?.type === 'Identifier') {
        extendsName = node.superClass.name;
      }
      // Handle mixin pattern: class Foo extends Mixin(Base)
      else if (node.superClass?.type === 'CallExpression') {
        if (node.superClass.callee?.type === 'Identifier') {
          mixinName = node.superClass.callee.name;
        }
        if (node.superClass.arguments?.[0]?.type === 'Identifier') {
          mixinBase = node.superClass.arguments[0].name;
        }
      }

      const loc = node.start || 0;
      const jsLine = node.loc?.start?.line || offsetToLine(loc, lineOffsets);
      const jsEndLine = node.loc?.end?.line || jsLine;
      classes.set(className, {
        extends: extendsName,
        mixinName,
        mixinBase,
        methods: new Set(),
        loc,
        script: getScriptIndex(loc, scriptRanges),
        line: getHtmlLine(jsLine, loc),
        endLine: getHtmlLine(jsEndLine, loc)
      });
      // Recurse into class body with class context
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(c => collectDefinitions(c, className));
        } else if (child && typeof child === 'object') {
          collectDefinitions(child, className);
        }
      }
      return;
    }

    // Detect class expressions assigned to variables: const X = class ...
    if (node.type === 'VariableDeclarator' && node.id?.name && node.init?.type === 'ClassExpression') {
      const className = node.id.name;
      const classNode = node.init;
      let extendsName = null;
      let mixinName = null;
      let mixinBase = null;

      if (classNode.superClass?.type === 'Identifier') {
        extendsName = classNode.superClass.name;
      } else if (classNode.superClass?.type === 'CallExpression') {
        if (classNode.superClass.callee?.type === 'Identifier') {
            mixinName = classNode.superClass.callee.name;
        }
        if (classNode.superClass.arguments?.[0]?.type === 'Identifier') {
            mixinBase = classNode.superClass.arguments[0].name;
        }
      }

      const loc = node.start || 0;
      const jsLine = node.loc?.start?.line || offsetToLine(loc, lineOffsets);
      const jsEndLine = node.loc?.end?.line || jsLine;
      classes.set(className, {
        extends: extendsName,
        mixinName,
        mixinBase,
        methods: new Set(),
        loc,
        script: getScriptIndex(loc, scriptRanges),
        line: getHtmlLine(jsLine, loc),
        endLine: getHtmlLine(jsEndLine, loc)
      });
      
      // Recurse into class body (node.init) with class context
      collectDefinitions(classNode, className);
      return;
    }

    let name = null;
    let type = 'function';

    if (node.type === 'FunctionDeclaration' && node.id) {
      name = node.id.name;
    } else if (node.type === 'MethodDefinition' && node.key && currentClass) {
      const methodName = node.key.name || node.key.value;
      name = `${currentClass}.${methodName}`;
      type = 'method';
      classes.get(currentClass)?.methods.add(methodName);
    } else if (node.type === 'PropertyDefinition' && node.value?.type?.includes('Function') && currentClass) {
      const methodName = node.key?.name || node.key?.value;
      name = `${currentClass}.${methodName}`;
      type = 'method';
      classes.get(currentClass)?.methods.add(methodName);
    } else if (node.type === 'VariableDeclarator' &&
               node.id?.name &&
               (node.init?.type?.includes('Function') || node.init?.type === 'ArrowFunctionExpression')) {
      name = node.id.name;

      // Check if this is a mixin pattern: (Base) => class extends Base { ... }
      const arrowBody = node.init?.body;
      if (node.init?.type === 'ArrowFunctionExpression' && arrowBody?.type === 'ClassExpression') {
        type = 'mixin';
        // Register the mixin as a class-like entity to track its methods
        const mixinName = node.id.name;
        const loc = node.start || 0;
        const jsLine = node.loc?.start?.line || offsetToLine(loc, lineOffsets);
        const jsEndLine = node.loc?.end?.line || jsLine;
        classes.set(mixinName, {
          extends: null,
          mixinName: null,
          mixinBase: null,
          methods: new Set(),
          loc,
          script: getScriptIndex(loc, scriptRanges),
          line: getHtmlLine(jsLine, loc),
          endLine: getHtmlLine(jsEndLine, loc),
          isMixin: true
        });
        // Recurse into the class body to find methods
        if (arrowBody.body?.body) {
          for (const member of arrowBody.body.body) {
            if (member.type === 'MethodDefinition' && member.key) {
              const methodName = member.key.name || member.key.value;
              classes.get(mixinName)?.methods.add(methodName);
              const methodLoc = member.start || 0;
              const methodJsLine = member.loc?.start?.line || offsetToLine(methodLoc, lineOffsets);
              const methodJsEndLine = member.loc?.end?.line || methodJsLine;
              functions.set(`${mixinName}.${methodName}`, {
                calls: new Set(),
                loc: methodLoc,
                type: 'method',
                script: getScriptIndex(methodLoc, scriptRanges),
                line: getHtmlLine(methodJsLine, methodLoc),
                endLine: getHtmlLine(methodJsEndLine, methodLoc)
              });
            }
          }
        }
        name = null; // Don't add as a regular function, we added it as a class
      }
    }

    if (name && !name.includes('undefined')) {
      const loc = node.start || 0;
      const jsLine = node.loc?.start?.line || offsetToLine(loc, lineOffsets);
      const jsEndLine = node.loc?.end?.line || jsLine;
      functions.set(name, {
        calls: new Set(),
        loc,
        type,
        script: getScriptIndex(loc, scriptRanges),
        line: getHtmlLine(jsLine, loc),
        endLine: getHtmlLine(jsEndLine, loc)
      });
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(c => collectDefinitions(c, currentClass));
      } else if (child && typeof child === 'object') {
        collectDefinitions(child, currentClass);
      }
    }
  }

  collectDefinitions(ast);

  // Index methods by name for "guess by name" lookup
  const methodIndex = new Map(); // methodName -> Set<className>
  for (const [className, classData] of classes) {
    for (const method of classData.methods) {
      if (!methodIndex.has(method)) {
        methodIndex.set(method, new Set());
      }
      methodIndex.get(method).add(className);
    }
  }

  // Helper to resolve method in class hierarchy
  function resolveMethodInClass(className, methodName) {
    const visited = new Set();
    const queue = [className];

    while (queue.length > 0) {
      const currentName = queue.shift();
      if (visited.has(currentName)) continue;
      visited.add(currentName);

      const classData = classes.get(currentName);
      if (!classData) continue;

      // Check if this class has the method
      if (classData.methods.has(methodName)) {
        return `${currentName}.${methodName}`;
      }

      // Add parents to queue
      if (classData.extends) queue.push(classData.extends);
      if (classData.mixinName) queue.push(classData.mixinName);
      if (classData.mixinBase) queue.push(classData.mixinBase);
    }
    return null;
  }

  // Helper to guess class from variable name
  function guessClassFromVar(varName) {
    // 1. Exact match (case sensitive) - uncommon for instances but possible
    if (classes.has(varName)) return varName;

    // 2. Case-insensitive match
    const lowerVar = varName.toLowerCase();
    for (const className of classes.keys()) {
      if (className.toLowerCase() === lowerVar) return className;
    }

    // 3. Substring/Suffix match (e.g., "cpuBoard" -> "CpuBoard" or "Board")
    // Prioritize longer matches (more specific)
    let bestMatch = null;
    for (const className of classes.keys()) {
      const lowerClass = className.toLowerCase();
      // Check if variable name contains class name or vice versa, but favor suffix
      if (lowerVar.includes(lowerClass) || lowerClass.includes(lowerVar)) {
        // Simple heuristic: if the variable ends with the class name (e.g. cpuBoard ends with Board)
        if (lowerVar.endsWith(lowerClass)) {
            if (!bestMatch || className.length > bestMatch.length) {
                bestMatch = className;
            }
        }
        // Or if the class name contains the variable name (e.g. MandelbrotExplorer contains explorer)
        else if (lowerClass.includes(lowerVar)) {
             if (!bestMatch || className.length > bestMatch.length) {
                bestMatch = className;
            }
        }
      }
    }
    return bestMatch;
  }

  // Find function calls within each function body
  function findCalls(node, currentFunc = null, currentClass = null, scope = {}) {
    if (!node || typeof node !== 'object') return;

    // Update current function/class context
    let funcName = currentFunc;
    let className = currentClass;
    // Create new scope for this block/function (simple inheritance)
    let currentScope = { ...scope };

    if (node.type === 'ClassDeclaration' && node.id?.name) {
      className = node.id.name;
    }

    if (node.type === 'VariableDeclarator' && node.id?.name) {
        if (node.init?.type === 'ClassExpression') {
             className = node.id.name;
        } else if (node.init?.type?.includes('Function') || node.init?.type === 'ArrowFunctionExpression') {
             funcName = node.id.name;
        }
    }
    
    if (node.type === 'FunctionDeclaration' && node.id) {
      funcName = node.id.name;
    } else if (node.type === 'MethodDefinition' && node.key && className) {
      funcName = `${className}.${node.key.name || node.key.value}`;
    } else if (node.type === 'PropertyDefinition' && node.value?.type?.includes('Function') && className) {
        // Class fields that are functions: class A { field = () => {} }
        const methodName = node.key?.name || node.key?.value;
        funcName = `${className}.${methodName}`;
    }

    // Track variable types: const x = new ClassName()
    if (node.type === 'VariableDeclarator' && node.id?.name && node.init?.type === 'NewExpression') {
        if (node.init.callee?.type === 'Identifier') {
            currentScope[node.id.name] = node.init.callee.name;
        }
    }

    // Detect function calls
    if (node.type === 'CallExpression') {
      let targets = [];

      // Case 1: Direct function call: func()
      if (node.callee?.type === 'Identifier') {
        const callee = node.callee.name;
        if (functions.has(callee)) {
          targets.push(callee);
        }
      } 
      // Case 2: Method call: obj.method()
      else if (node.callee?.type === 'MemberExpression' && node.callee.property) {
        const methodName = node.callee.property.name || node.callee.property.value;
        const objectNode = node.callee.object;

        // 2a. this.method()
        if (objectNode.type === 'ThisExpression' && className) {
            const resolved = resolveMethodInClass(className, methodName);
            if (resolved) {
                targets.push(resolved);
            }
        } 
        // 2b. obj.prop.method() or this.prop.method() - Chain guessing
        else if (objectNode.type === 'MemberExpression' && objectNode.property) {
             const propName = objectNode.property.name || objectNode.property.value;
             if (typeof propName === 'string') {
                 // Guess class from the property name itself (e.g. this.config.init() -> "config" implies "Config")
                 const targetClass = guessClassFromVar(propName);
                 if (targetClass) {
                     const resolved = resolveMethodInClass(targetClass, methodName);
                     if (resolved) {
                         targets.push(resolved);
                     }
                 }
             }
        }
        // 2c. variable.method()
        else if (objectNode.type === 'Identifier') {
            const varName = objectNode.name;
            let targetClass = currentScope[varName];

            // If not in local scope, try to guess from name
            if (!targetClass) {
                targetClass = guessClassFromVar(varName);
            }

            const COMMON_METHODS = new Set([
                'add', 'write', 'clear', 'push', 'pop', 'remove', 'delete', 
                'toString', 'keys', 'values', 'entries', 'forEach', 'map'
            ]);

            if (targetClass) {
                // Try to resolve in the guessed class
                const resolved = resolveMethodInClass(targetClass, methodName);
                if (resolved) {
                    targets.push(resolved);
                } else {
                     // The guessed class doesn't have the method. 
                     // It might be an interface or abstract class.
                     // Fallback: Link to ALL classes that have this method, unless it's too generic
                     if (!COMMON_METHODS.has(methodName) && methodIndex.has(methodName)) {
                         for (const cls of methodIndex.get(methodName)) {
                             targets.push(`${cls}.${methodName}`);
                         }
                     }
                }
            } else {
                // No clue what class this is.
                // Fallback: Link to ALL classes that have this method, unless it's too generic
                if (!COMMON_METHODS.has(methodName) && methodIndex.has(methodName)) {
                    for (const cls of methodIndex.get(methodName)) {
                        targets.push(`${cls}.${methodName}`);
                    }
                }
            }
        }
      }

      // Add edges
      if (funcName && functions.has(funcName)) {
        for (const target of targets) {
            // Avoid self-loops if desired, but they can be valid recursion
            functions.get(funcName).calls.add(target);
        }
      }
    }

    // Detect constructor calls
    if (node.type === 'NewExpression' && node.callee?.type === 'Identifier') {
        const targetClass = node.callee.name;
        // Resolve constructor (check class and ancestors)
        const constructorName = resolveMethodInClass(targetClass, 'constructor');
        
        if (constructorName && funcName && functions.has(funcName)) {
            functions.get(funcName).calls.add(constructorName);
        }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(c => findCalls(c, funcName, className, currentScope));
      } else if (child && typeof child === 'object') {
        findCalls(child, funcName, className, currentScope);
      }
    }
  }

  findCalls(ast);

  // Build nodes and edges
  const nodes = [];
  const edges = [];

  // Add class nodes (including mixins)
  for (const [name, data] of classes) {
    const nodeType = data.isMixin ? 'mixin' : 'class';
    nodes.push({ id: name, type: nodeType, script: data.script, line: data.line, endLine: data.endLine });
    // Add inheritance edge
    if (data.extends && classes.has(data.extends)) {
      edges.push({ source: name, target: data.extends, type: 'extends' });
    }
    // Add mixin edges (weak links)
    if (data.mixinName && classes.has(data.mixinName)) {
      edges.push({ source: name, target: data.mixinName, type: 'mixin' });
    }
    if (data.mixinBase && classes.has(data.mixinBase)) {
      edges.push({ source: name, target: data.mixinBase, type: 'mixin-base' });
    }
  }

  // Add function/method nodes
  for (const [name, data] of functions) {
    nodes.push({ id: name, type: data.type, script: data.script, line: data.line, endLine: data.endLine });
    for (const callee of data.calls) {
      edges.push({ source: name, target: callee, type: 'calls' });
    }
  }

  return { nodes, edges };
}

// Get file content at a specific commit
function getFileAtCommit(commit, filepath) {
  try {
    return execSync(`git show ${commit}:${filepath}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (e) {
    return null;
  }
}

// Compute a stable hash for cached artifacts
function hashContent(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// Extract co-author flags for a commit body
function getCoauthorFlags(hash) {
  try {
    const body = execSync(`git log -1 --format="%b" ${hash}`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });

    // Helper to check for Co-Authored-By lines that include a name
    const hasCoauthor = (name) => {
      const pattern = new RegExp(`Co-Authored-By[^\\n]*${name}`, 'i');
      return pattern.test(body);
    };

    return {
      claude: hasCoauthor('Claude'),
      gemini: hasCoauthor('Gemini'),
      codex: hasCoauthor('Codex')
    };
  } catch (e) {
    return { claude: false, gemini: false, codex: false };
  }
}

// Count test cases at a given commit
function countTests(hash) {
  try {
    // Get list of test files at this commit
    const files = execSync(
      `git ls-tree -r --name-only ${hash} -- tests/`,
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    ).trim();

    if (!files) return 0;

    let testCount = 0;
    for (const file of files.split('\n')) {
      if (!file.endsWith('.test.js')) continue;
      try {
        const content = execSync(`git show ${hash}:${file}`, {
          encoding: 'utf8',
          maxBuffer: 5 * 1024 * 1024
        });
        // Count test() and it() calls - match start of statement
        const matches = content.match(/^\s*(test|it)\s*\(/gm);
        if (matches) testCount += matches.length;
      } catch (e) {
        // File might not exist at this commit
      }
    }
    return testCount;
  } catch (e) {
    // tests/ directory doesn't exist at this commit
    return 0;
  }
}

function getTestsTreeHash(hash) {
  try {
    return execSync(`git rev-parse ${hash}:tests`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'] // suppress git warnings when tests/ is absent
    }).trim();
  } catch (e) {
    return null; // tests/ missing at this commit (avoid emitting git warnings)
  }
}

// Get commit history with dates, including original branch
function getCommitHistory() {
  // Get commits from main branch
  const mainLog = execSync(
    'git log --format="%H|%ad|%s" --date=short --follow -- index.html',
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  const mainCommits = mainLog.trim().split('\n').map(line => {
    const [hash, date, ...msgParts] = line.split('|');
    return { hash, date, message: msgParts.join('|') };
  });

  // Get the oldest commit hash from main branch to check if we need original branch
  const oldestMainHash = mainCommits[mainCommits.length - 1]?.hash;

  // Try to get commits from "original" branch that aren't in main
  let originalCommits = [];
  try {
    const originalLog = execSync(
      'git log original --format="%H|%ad|%s" --date=short -- index.html',
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    const allOriginalCommits = originalLog.trim().split('\n').map(line => {
      const [hash, date, ...msgParts] = line.split('|');
      return { hash, date, message: msgParts.join('|') };
    });

    // Filter to only commits not already in main (by hash prefix)
    const mainHashes = new Set(mainCommits.map(c => c.hash.slice(0, 7)));
    originalCommits = allOriginalCommits.filter(c => !mainHashes.has(c.hash.slice(0, 7)));
  } catch (e) {
    // Original branch doesn't exist or is inaccessible
    console.log('Note: "original" branch not found, using only main branch history');
  }

  // Combine: original commits first (reversed to oldest-first), then main commits (reversed)
  const allCommits = [...originalCommits.reverse(), ...mainCommits.reverse()];

  // Deduplicate by hash (in case of overlap)
  const seen = new Set();
  return allCommits.filter(c => {
    const key = c.hash.slice(0, 7);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


async function main() {
  console.log('Extracting call graph history...');

  const commits = getCommitHistory();
  console.log(`Found ${commits.length} commits`);

  const timeline = [];
  const graphCache = new Map();     // htmlHash -> parsed graph data
  const testCountCache = new Map(); // tests tree hash -> test count

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    process.stdout.write(`\rProcessing ${i + 1}/${commits.length}: ${commit.date} ${commit.hash.slice(0, 7)}`);

    const html = getFileAtCommit(commit.hash, 'index.html');
    if (!html) continue;

    const coauthors = getCoauthorFlags(commit.hash);
    const htmlHash = hashContent(html);

    let graphData = graphCache.get(htmlHash);
    if (!graphData) {
      const { js, scriptRanges } = extractJS(html);
      const graph = extractCallGraph(js, scriptRanges);
      const lineCount = html.split('\n').length;
      graphData = {
        lineCount,
        nodes: graph.nodes,
        edges: graph.edges,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length
      };
      graphCache.set(htmlHash, graphData);
    }

    // Cache test counts by tests/ tree hash to avoid re-counting unchanged trees
    const testsTreeHash = getTestsTreeHash(commit.hash);
    let testCount;
    if (!testsTreeHash) {
      testCount = 0;
    } else if (testCountCache.has(testsTreeHash)) {
      testCount = testCountCache.get(testsTreeHash);
    } else {
      testCount = countTests(commit.hash);
      testCountCache.set(testsTreeHash, testCount);
    }

    timeline.push({
      hash: commit.hash.slice(0, 7),
      date: commit.date,
      message: commit.message.slice(0, 60),
      claudeCoauthored: coauthors.claude,
      geminiCoauthored: coauthors.gemini,
      codexCoauthored: coauthors.codex,
      lineCount: graphData.lineCount,
      testCount,
      nodeCount: graphData.nodeCount,
      edgeCount: graphData.edgeCount,
      nodes: graphData.nodes,
      edges: graphData.edges
    });
  }

  console.log('\n');

  // Ensure coverage directory exists
  const coverageDir = path.join(__dirname, '..', 'coverage');
  if (!fs.existsSync(coverageDir)) {
    fs.mkdirSync(coverageDir, { recursive: true });
  }

  // Copy HTML viewer to coverage directory
  const htmlSource = path.join(__dirname, 'callgraph.html');
  const htmlDest = path.join(coverageDir, 'callgraph.html');
  fs.copyFileSync(htmlSource, htmlDest);

  // Write output as JSONP (allows loading via file:// URL without server)
  const outputPath = path.join(coverageDir, 'callgraph-data.js');
  const jsonp = `loadCallgraphData(${JSON.stringify(timeline, null, 2)});`;
  fs.writeFileSync(outputPath, jsonp);
  console.log(`Written to ${outputPath}`);
  console.log(`Timeline: ${timeline.length} snapshots`);
  console.log(`Final graph: ${timeline[timeline.length - 1]?.nodeCount} nodes, ${timeline[timeline.length - 1]?.edgeCount} edges`);
}

main().catch(console.error);

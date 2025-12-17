#!/usr/bin/env node
/**
 * Generates call graph data from git history for visualization.
 *
 * Usage: node build/build-callgraph.js
 * Output: media/callgraph-data.json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
      const extendsName = node.superClass?.name || null;
      const loc = node.start || 0;
      const jsLine = node.loc?.start?.line || offsetToLine(loc, lineOffsets);
      const jsEndLine = node.loc?.end?.line || jsLine;
      classes.set(className, {
        extends: extendsName,
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
               node.init?.type?.includes('Function')) {
      name = node.id.name;
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

  // Find function calls within each function body
  function findCalls(node, currentFunc = null, currentClass = null) {
    if (!node || typeof node !== 'object') return;

    // Update current function/class context
    let funcName = currentFunc;
    let className = currentClass;

    if (node.type === 'ClassDeclaration' && node.id?.name) {
      className = node.id.name;
    }
    if (node.type === 'FunctionDeclaration' && node.id) {
      funcName = node.id.name;
    } else if (node.type === 'MethodDefinition' && node.key && className) {
      funcName = `${className}.${node.key.name || node.key.value}`;
    }

    // Detect function calls
    if (node.type === 'CallExpression') {
      let callee = null;
      if (node.callee?.type === 'Identifier') {
        callee = node.callee.name;
      } else if (node.callee?.type === 'MemberExpression' && node.callee.property) {
        callee = node.callee.property.name || node.callee.property.value;
      }

      if (callee && funcName && functions.has(callee)) {
        functions.get(funcName)?.calls.add(callee);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(c => findCalls(c, funcName, className));
      } else if (child && typeof child === 'object') {
        findCalls(child, funcName, className);
      }
    }
  }

  findCalls(ast);

  // Build nodes and edges
  const nodes = [];
  const edges = [];

  // Add class nodes
  for (const [name, data] of classes) {
    nodes.push({ id: name, type: 'class', script: data.script, line: data.line, endLine: data.endLine });
    // Add inheritance edge
    if (data.extends && classes.has(data.extends)) {
      edges.push({ source: name, target: data.extends, type: 'extends' });
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

// Get commit history with dates
function getCommitHistory() {
  const log = execSync(
    'git log --format="%H|%ad|%s" --date=short --follow -- index.html',
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  return log.trim().split('\n').map(line => {
    const [hash, date, ...msgParts] = line.split('|');
    return { hash, date, message: msgParts.join('|') };
  }).reverse(); // Oldest first
}


async function main() {
  console.log('Extracting call graph history...');

  const commits = getCommitHistory();
  console.log(`Found ${commits.length} commits`);

  const timeline = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    process.stdout.write(`\rProcessing ${i + 1}/${commits.length}: ${commit.date} ${commit.hash.slice(0, 7)}`);

    const html = getFileAtCommit(commit.hash, 'index.html');
    if (!html) continue;

    const { js, scriptRanges } = extractJS(html);
    const graph = extractCallGraph(js, scriptRanges);
    const lineCount = html.split('\n').length;

    timeline.push({
      hash: commit.hash.slice(0, 7),
      date: commit.date,
      message: commit.message.slice(0, 60),
      lineCount,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes,
      edges: graph.edges
    });
  }

  console.log('\n');

  // Write output as JSONP (allows loading via file:// URL without server)
  const outputPath = path.join(__dirname, '..', 'media', 'callgraph-data.js');
  const jsonp = `loadCallgraphData(${JSON.stringify(timeline, null, 2)});`;
  fs.writeFileSync(outputPath, jsonp);
  console.log(`Written to ${outputPath}`);
  console.log(`Timeline: ${timeline.length} snapshots`);
  console.log(`Final graph: ${timeline[timeline.length - 1]?.nodeCount} nodes, ${timeline[timeline.length - 1]?.edgeCount} edges`);
}

main().catch(console.error);

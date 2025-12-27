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
  function collectDefinitions(node, currentClass = null, depth = 0) {
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
          child.forEach(c => collectDefinitions(c, className, depth + 1));
        } else if (child && typeof child === 'object') {
          collectDefinitions(child, className, depth + 1);
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
      collectDefinitions(classNode, className, depth + 1);
      return;
    }

    let name = null;
    let type = 'function';

    // Only collect global functions (depth <= 4 to account for Program -> VariableDeclaration -> VariableDeclarator)
    const isGlobalFunction = depth <= 4;

    if (node.type === 'FunctionDeclaration' && node.id && isGlobalFunction) {
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
               (node.init?.type?.includes('Function') || node.init?.type === 'ArrowFunctionExpression') &&
               isGlobalFunction) {
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
                calls: new Set(), references: new Set(),
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
    } else if (node.type === 'AssignmentExpression' && 
               node.left?.type === 'MemberExpression' &&
               (node.right?.type === 'FunctionExpression' || node.right?.type === 'ArrowFunctionExpression') &&
               isGlobalFunction) {
      // Handle document.onmousemove = function...
      const objName = node.left.object?.name || (node.left.object?.type === 'ThisExpression' ? 'this' : null);
      const propName = node.left.property?.name || node.left.property?.value;
      
      if (propName) {
        if (objName) {
            name = `${objName}.${propName}`;
        } else if (node.left.object?.type === 'MemberExpression') {
            // Handle simple nesting like document.body.onkeydown
            const parentProp = node.left.object.property?.name || node.left.object.property?.value;
            const rootObj = node.left.object.object?.name;
            if (rootObj && parentProp) {
                name = `${rootObj}.${parentProp}.${propName}`;
            }
        }
        
        if (!name && propName) {
             name = `?.${propName}`; // Fallback
        }
      }
    }

    if (name && !name.includes('undefined')) {
      const loc = node.start || 0;
      const jsLine = node.loc?.start?.line || offsetToLine(loc, lineOffsets);
      const jsEndLine = node.loc?.end?.line || jsLine;
      functions.set(name, {
        calls: new Set(), references: new Set(),
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

      // Calculate next depth
      let nextDepth = depth + 1;
      
      // Reset depth for IIFE (Immediately Invoked Function Expression)
      // This allows capturing definitions inside module wrappers
      if (node.type === 'CallExpression' && key === 'callee' && 
          child && (child.type === 'FunctionExpression' || child.type === 'ArrowFunctionExpression')) {
          // Reset to -1 so that the function's body (BlockStatement) becomes depth 0,
          // and its statements (VariableDeclarations) become depth 1 (Global/Top-level)
          if (depth < 20) { // Safety limit to prevent infinite recursion or deep resets
             nextDepth = -1;
          }
      }

      if (Array.isArray(child)) {
        child.forEach(c => collectDefinitions(c, currentClass, nextDepth));
      } else if (child && typeof child === 'object') {
        collectDefinitions(child, currentClass, nextDepth);
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

      // Common methods/names to ignore when guessing targets

      const COMMON_METHODS = new Set([

          'add', 'write', 'clear', 'push', 'pop', 'remove', 'delete', 

          'toString', 'keys', 'values', 'entries', 'forEach', 'map', 'url', 'last', 'size'

      ]);

  

        // Helper to resolve call/reference targets from a node

  

        function resolveTargets(node, currentClass, scope, currentFunc) {

  

          let targets = [];

  

    

  

                    // Case 1: Direct Identifier: func

  

    

  

                    if (node.type === 'Identifier') {

  

    

  

                      const callee = node.name;

  

    

  

          

  

    

  

                      // Don't create global references for local variables

  

    

  

                      if (scope[callee]) return targets;

  

    

  

          

  

    

  

                      if (functions.has(callee)) {

  

              // If it's a common name (like "last" or "url"), only resolve if in same script

  

              if (COMMON_METHODS.has(callee)) {

  

                 const callScript = getScriptIndex(node.start || 0, scriptRanges);

  

                 const targetScript = functions.get(callee).script;

  

                 if (callScript === targetScript) {

  

                     targets.push(callee);

  

                 }

  

              } else {

  

                 // Unique name - resolve globally

  

                 targets.push(callee);

  

              }

  

            }

  

          } 

                  // Case 2: Member Expression: obj.method

                  else if (node.type === 'MemberExpression' && node.property) {

                    if (node.computed && node.property.type !== 'Literal') return targets;

                    

                    const methodName = node.property.name || node.property.value;

            

                    // If the property is a local variable, don't link to global methods

                    if (node.property.type === 'Identifier' && scope[node.property.name]) return targets;

            

                    const objectNode = node.object;

            

                    // 2x. super.method - Resolve to parent class and suppress same-name calls

                    if (objectNode.type === 'Super' && currentClass) {

                         const classData = classes.get(currentClass);

                         // Resolve explicit extends or mixin base

                         const parentClass = classData?.extends || classData?.mixinBase;

                         

                         if (parentClass) {

                             const resolved = resolveMethodInClass(parentClass, methodName);

                             if (resolved) {

                                 // Suppress if calling super.sameMethod()

                                 const currentMethodName = currentFunc?.split('.').pop();

                                 if (currentMethodName !== methodName) {

                                     targets.push(resolved);

                                 }

                             }

                         }

                    }

              

                    // 2a. this.method

                    else if (objectNode.type === 'ThisExpression' && currentClass) {

            const resolved = resolveMethodInClass(currentClass, methodName);

            if (resolved) {

                targets.push(resolved);

            }

        } 

        // 2b. obj.prop.method - Chain guessing

        else if (objectNode.type === 'MemberExpression' && objectNode.property) {

             const propName = objectNode.property.name || objectNode.property.value;

             if (typeof propName === 'string') {

                 const targetClass = guessClassFromVar(propName);

                 if (targetClass) {

                     const resolved = resolveMethodInClass(targetClass, methodName);

                     if (resolved) {

                         targets.push(resolved);

                     }

                 }

             }

        }

                // 2c. variable.method

                else if (objectNode.type === 'Identifier') {

                    const varName = objectNode.name;

                    let targetClass = scope[varName];

        

                    if (targetClass === 'local') targetClass = null;

        

                    if (!targetClass) {

                        targetClass = guessClassFromVar(varName);

                    }

  

            if (targetClass) {

                const resolved = resolveMethodInClass(targetClass, methodName);

                if (resolved) {

                    targets.push(resolved);

                } else {

                     if (!COMMON_METHODS.has(methodName) && methodIndex.has(methodName)) {

                         for (const cls of methodIndex.get(methodName)) {

                             targets.push(`${cls}.${methodName}`);

                         }

                     }

                }

            } else {

                if (!COMMON_METHODS.has(methodName) && methodIndex.has(methodName)) {

                    for (const cls of methodIndex.get(methodName)) {

                        targets.push(`${cls}.${methodName}`);

                    }

                }

            }

        } else {
             // Case 2d. Complex expression: expression.method()
             // Fallback to guessing by method name if unique-ish
             if (!COMMON_METHODS.has(methodName) && methodIndex.has(methodName)) {
                 for (const cls of methodIndex.get(methodName)) {
                     targets.push(`${cls}.${methodName}`);
                 }
             }
        }

      }

      return targets;

    }

  // Find function calls within each function body
  function findCalls(node, currentFunc = null, currentClass = null, scope = {}) {
    if (!node || typeof node !== 'object') return;

    // Update current function/class context
    let funcName = currentFunc;
    let className = currentClass;
    let currentScope = scope;
    let isNewFunc = false;

    // 1. Context / Naming Setup
    if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.id?.name) {
      className = node.id.name;
    } else if (node.type === 'VariableDeclarator' && node.id?.name) {
        if (node.init?.type === 'ClassExpression') {
             className = node.id.name;
        } else if (node.init?.type?.includes('Function') || node.init?.type === 'ArrowFunctionExpression') {
             funcName = node.id.name;
             // Handle mixin pattern
             const body = node.init.body;
             if (node.init.type === 'ArrowFunctionExpression' && body?.type === 'ClassExpression') {
                 className = node.id.name;
             }
        }
    } else if (node.type === 'FunctionDeclaration' && node.id) {
      funcName = node.id.name;
    } else if (node.type === 'MethodDefinition' && node.key && className) {
      funcName = `${className}.${node.key.name || node.key.value}`;
    } else if (node.type === 'PropertyDefinition' && node.value?.type?.includes('Function') && className) {
        const methodName = node.key?.name || node.key?.value;
        funcName = `${className}.${methodName}`;
    } else if (node.type === 'AssignmentExpression' && 
               node.left?.type === 'MemberExpression' &&
               (node.right?.type === 'FunctionExpression' || node.right?.type === 'ArrowFunctionExpression')) {
      // Handle document.onmousemove = function...
      const objName = node.left.object?.name || (node.left.object?.type === 'ThisExpression' ? 'this' : null);
      const propName = node.left.property?.name || node.left.property?.value;
      
      let name = null;
      if (propName) {
        if (objName) {
            name = `${objName}.${propName}`;
        } else if (node.left.object?.type === 'MemberExpression') {
            const parentProp = node.left.object.property?.name || node.left.object.property?.value;
            const rootObj = node.left.object.object?.name;
            if (rootObj && parentProp) {
                name = `${rootObj}.${parentProp}.${propName}`;
            }
        }
        if (!name && propName) name = `?.${propName}`;
      }
      if (name) funcName = name;
    }

    // 2. Scope Boundary Detection
    if (node.type === 'FunctionDeclaration' || 
        node.type === 'FunctionExpression' || 
        node.type === 'ArrowFunctionExpression') {
        isNewFunc = true;
    }

    // If we just entered a function, pre-collect all locals in its scope
    // Skip collection for module wrappers (IIFEs) so their contents are treated as "globals"
    if (isNewFunc && !node._isModuleWrapper) {
        currentScope = { ...scope };
        const bodyToScan = node;
        
        // Add parameters
        if (bodyToScan.params) {
            for (const param of bodyToScan.params) {
                if (param.type === 'Identifier') currentScope[param.name] = 'local';
                else if (param.type === 'AssignmentPattern' && param.left?.type === 'Identifier') currentScope[param.left.name] = 'local';
            }
        }

        // Add all declarations in the function body
        function collectLocals(n) {
            if (!n || typeof n !== 'object') return;
            // Don't recurse into nested functions for this scope's locals
            if (n !== bodyToScan && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')) {
                 if (n.type === 'FunctionDeclaration' && n.id) currentScope[n.id.name] = 'local';
                 return;
            }
            if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') {
                currentScope[n.id.name] = (n.init?.type === 'NewExpression' && n.init.callee?.type === 'Identifier')
                    ? n.init.callee.name : 'local';
            }
            for (const key of Object.keys(n)) {
                if (key === 'type' || key === 'start' || key === 'end') continue;
                const child = n[key];
                if (Array.isArray(child)) child.forEach(collectLocals);
                else if (child && typeof child === 'object') collectLocals(child);
            }
        }
        collectLocals(bodyToScan.body || bodyToScan);
    }

    // Mark children for special handling before recursion
    if (node.type === 'CallExpression') {
        if (node.callee) node.callee._isCall = true;
    }
    if (node.type === 'NewExpression') {
        if (node.callee) node.callee._isCall = true;
    }
    if (node.type === 'MemberExpression') {
        if (node.property) node.property._isMemberProperty = true;
    }

    // 1. Handle CallExpression (Calls)
    if (node.type === 'CallExpression') {
      const targets = resolveTargets(node.callee, className, currentScope, funcName);
      if (funcName && functions.has(funcName)) {
        for (const target of targets) {
            functions.get(funcName).calls.add(target);
        }
      }
    }

    // 2. Handle NewExpression (Constructor Calls)
    if (node.type === 'NewExpression' && node.callee) {
        let targetClass = null;
        if (node.callee.type === 'Identifier') {
            targetClass = node.callee.name;
        } else if (node.callee.type === 'MemberExpression' && node.callee.property) {
            // Handle new obj.Prop() -> Prop
            const prop = node.callee.property;
            if (prop.type === 'Identifier') {
                targetClass = prop.name;
            } else if (prop.type === 'Literal') {
                targetClass = prop.value;
            }
        }

        if (targetClass) {
            // Resolve constructor (check class and ancestors)
            const constructorName = resolveMethodInClass(targetClass, 'constructor');
            
            if (constructorName && funcName && functions.has(funcName)) {
                functions.get(funcName).calls.add(constructorName);
            }
        }
    }

    // 3. Handle References (Identifier or MemberExpression not being called)
    if ((node.type === 'Identifier' || node.type === 'MemberExpression') && !node._isCall) {
        if (node.type === 'Identifier' && node._isMemberProperty) {
            // Do nothing
        } else {
            const targets = resolveTargets(node, className, currentScope, funcName);
            if (funcName && functions.has(funcName)) {
                if (!functions.get(funcName).references) {
                    functions.get(funcName).references = new Set();
                }
                for (const target of targets) {
                    // Filter out self-references
                    if (target !== funcName) {
                        functions.get(funcName).references.add(target);
                    }
                }
            }
        }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key.startsWith('_')) continue;

      // Skip defining properties to avoid artifactual self-references
      if (node.type === 'FunctionDeclaration' && key === 'id') continue;
      if (node.type === 'MethodDefinition' && key === 'key') continue;
      if (node.type === 'PropertyDefinition' && key === 'key') continue;
      if (node.type === 'VariableDeclarator' && key === 'id') continue;

      const child = node[key];
      
      // Mark IIFE functions as module wrappers
      if (node.type === 'CallExpression' && key === 'callee' && 
          child && (child.type === 'FunctionExpression' || child.type === 'ArrowFunctionExpression')) {
          child._isModuleWrapper = true;
      }

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

  // Count incoming references to filter out common globals
  const referenceCounts = new Map();
  for (const [name, data] of functions) {
    if (data.references) {
      for (const ref of data.references) {
        if (!data.calls.has(ref)) {
          referenceCounts.set(ref, (referenceCounts.get(ref) || 0) + 1);
        }
      }
    }
  }

  // Add function/method nodes
  for (const [name, data] of functions) {
    nodes.push({ id: name, type: data.type, script: data.script, line: data.line, endLine: data.endLine });
    for (const callee of data.calls) {
      edges.push({ source: name, target: callee, type: 'calls' });
    }
    if (data.references) {
      for (const ref of data.references) {
        // Avoid adding reference edge if call edge already exists
        if (!data.calls.has(ref)) {
          // Heuristic: skip if referenced too many times (likely a global utility)
          if ((referenceCounts.get(ref) || 0) <= 5) {
            edges.push({ source: name, target: ref, type: 'reference' });
          }
        }
      }
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

// Extract co-author flags for a commit (checks both author and co-author lines)
function getCoauthorFlags(hash) {
  try {
    // Get author email and commit body
    const authorEmail = execSync(`git log -1 --format="%ae" ${hash}`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    }).trim().toLowerCase();

    const body = execSync(`git log -1 --format="%b" ${hash}`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });

    // Helper to check for Co-Authored-By or Signed-off-by lines that include a name
    const hasCoauthor = (name) => {
      const coauthorPattern = new RegExp(`Co-Authored-By[^\\n]*${name}`, 'i');
      const signedOffPattern = new RegExp(`Signed-off-by[^\\n]*${name}`, 'i');
      return coauthorPattern.test(body) || signedOffPattern.test(body);
    };

    // Check if AI is the main author (by email) or a co-author/signer
    return {
      claude: hasCoauthor('Claude') || authorEmail.includes('anthropic'),
      gemini: hasCoauthor('Gemini') || authorEmail.includes('google'),
      codex: hasCoauthor('Codex') || authorEmail.includes('openai')
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

  // Split timeline into chunks targeting ~25MB per file (to stay well under 50MB GitHub limit)
  const TARGET_CHUNK_SIZE = 25 * 1024 * 1024; // 25MB target
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;

  for (const snapshot of timeline) {
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotSize = snapshotJson.length;

    // Start a new chunk if this one would exceed target size
    if (currentSize + snapshotSize > TARGET_CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(snapshot);
    currentSize += snapshotSize;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // Write each chunk as a separate JSONP file
  const chunkFiles = [];
  for (let i = 0; i < chunks.length; i++) {
    const filename = `callgraph-data-${i}.js`;
    const outputPath = path.join(coverageDir, filename);
    const jsonp = `loadCallgraphChunk(${i}, ${JSON.stringify(chunks[i])});`;
    fs.writeFileSync(outputPath, jsonp);
    const sizeMB = (Buffer.byteLength(jsonp) / (1024 * 1024)).toFixed(2);
    console.log(`Written ${filename}: ${chunks[i].length} snapshots, ${sizeMB}MB`);
    chunkFiles.push(filename);
  }

  // Write manifest file that tells the HTML how many chunks to load
  const manifest = { chunkCount: chunks.length, files: chunkFiles };
  const manifestPath = path.join(coverageDir, 'callgraph-manifest.js');
  const manifestJsonp = `loadCallgraphManifest(${JSON.stringify(manifest)});`;
  fs.writeFileSync(manifestPath, manifestJsonp);

  console.log(`\nTotal: ${chunks.length} chunk files`);
  console.log(`Timeline: ${timeline.length} snapshots`);
  console.log(`Final graph: ${timeline[timeline.length - 1]?.nodeCount} nodes, ${timeline[timeline.length - 1]?.edgeCount} edges`);
}

main().catch(console.error);

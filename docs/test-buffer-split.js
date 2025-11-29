#!/usr/bin/env node

// Quick syntax check - verify that the buffer split implementation doesn't have obvious errors

console.log("Testing buffer split implementation...");

// Load the HTML file and check for syntax issues
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

// Check that all buffer references have been updated
const checks = [
  { pattern: /refIter\[/g, name: 'refIter[', shouldBeZero: true },
  { pattern: /checkpointIter\[/g, name: 'checkpointIter[', shouldBeZero: true },
  { pattern: /refIterAndCheckpoint\[/g, name: 'refIterAndCheckpoint[', shouldBeZero: false },
  { pattern: /this\.buffers\.refIterAndCheckpoint/g, name: 'buffers.refIterAndCheckpoint', shouldBeZero: false },
  { pattern: /this\.buffers\.threading/g, name: 'buffers.threading', shouldBeZero: false },
  { pattern: /lastUploadedOrbitLength/g, name: 'lastUploadedOrbitLength', shouldBeZero: false },
  { pattern: /lastUploadedThreadingLength/g, name: 'lastUploadedThreadingLength', shouldBeZero: false },
];

let errors = 0;
for (const check of checks) {
  const matches = html.match(check.pattern);
  const count = matches ? matches.length : 0;

  if (check.shouldBeZero && count > 0) {
    console.error(`❌ ERROR: Found ${count} occurrences of '${check.name}' (should be 0 in GPU code)`);
    errors++;
  } else if (!check.shouldBeZero && count === 0) {
    console.error(`❌ ERROR: Found 0 occurrences of '${check.name}' (should have some)`);
    errors++;
  } else {
    console.log(`✓ ${check.name}: ${count} occurrences ${check.shouldBeZero ? '(correctly removed)' : '(found)'}`);
  }
}

// Check shader bindings are correct
const shaderBindings = html.match(/@group\(0\) @binding\(\d\)/g) || [];
console.log(`\n✓ Found ${shaderBindings.length} shader bindings`);

// Extract shader code
const shaderStart = html.indexOf('const shaderCode = `');
const shaderEnd = html.indexOf('`;', shaderStart);
if (shaderStart >= 0 && shaderEnd >= 0) {
  const shaderCode = html.substring(shaderStart, shaderEnd);

  // Check for old buffer references in shader
  const oldRefs = [
    shaderCode.match(/refIter\[index\]/g),
    shaderCode.match(/checkpointIter\[index\]/g),
  ].filter(x => x && x.length > 0);

  if (oldRefs.length > 0) {
    console.error(`\n❌ ERROR: Found old buffer references in shader code!`);
    errors++;
  } else {
    console.log(`✓ Shader code updated correctly (no old buffer references)`);
  }

  // Check for new buffer references
  if (shaderCode.includes('refIterAndCheckpoint[index].x') &&
      shaderCode.includes('refIterAndCheckpoint[index].y')) {
    console.log(`✓ Shader uses merged refIterAndCheckpoint buffer correctly`);
  } else {
    console.error(`❌ ERROR: Shader doesn't use refIterAndCheckpoint correctly`);
    errors++;
  }

  // Check for separate threading buffer
  if (shaderCode.includes('@binding(7)') && shaderCode.includes('threading')) {
    console.log(`✓ Shader has separate threading buffer at binding 7`);
  } else {
    console.error(`❌ ERROR: Shader missing separate threading buffer`);
    errors++;
  }
}

console.log(`\n${errors === 0 ? '✅ All checks passed!' : `❌ ${errors} errors found`}`);
console.log('\nNote: This only checks syntax. Test in browser to verify functionality.');

process.exit(errors);

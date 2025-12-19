#!/usr/bin/env node
/**
 * Analyze benchmark timing data using Non-Negative Least Squares regression.
 *
 * Model: timeUs = a + b*iters + c*pixels*iters
 *   a = per-batch overhead (μs)
 *   b = per-iteration overhead (μs/iter)
 *   c = per-pixel-iteration cost (ns/px-iter)
 *
 * Usage: node tests/analyze-benchmark.js [jsonl-file]
 *        If no file specified, uses most recent shallow-*.jsonl
 */

const fs = require('fs');
const path = require('path');

// Find input file
let inputFile = process.argv[2];
if (!inputFile) {
  const resultsDir = path.join(__dirname, 'benchmark-results');
  const files = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith('shallow-') && f.endsWith('.jsonl'))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error('No benchmark files found in', resultsDir);
    process.exit(1);
  }
  inputFile = path.join(resultsDir, files[0]);
}

console.log('Analyzing:', inputFile);

// Load and parse data
const lines = fs.readFileSync(inputFile, 'utf8').trim().split('\n');
console.log('Lines collected:', lines.length);

// Skip first N samples as warmup (GPU JIT, pipeline creation, etc.)
const WARMUP_SAMPLES = 10;

const byBoard = {};
for (const line of lines) {
  const data = JSON.parse(line);
  if (!byBoard[data.board]) byBoard[data.board] = [];
  // Skip warmup samples
  const timings = data.timings.slice(WARMUP_SAMPLES);
  // Add board size (max pixels = total buffer size) to each timing
  const boardSize = Math.max(...data.timings.map(t => t.pixels));
  timings.forEach(t => t.boardSize = boardSize);
  byBoard[data.board].push(...timings);
}

/**
 * Generic NNLS solver for n variables
 */
function solveNNLS(X, y, numVars) {
  const m = X.length;

  function solveLS(fixed) {
    const active = [];
    for (let i = 0; i < numVars; i++) {
      if (!fixed.has(i)) active.push(i);
    }
    if (active.length === 0) return Array(numVars).fill(0);

    const k = active.length;
    let XtX = Array(k).fill(0).map(() => Array(k).fill(0));
    let Xty = Array(k).fill(0);

    for (let row = 0; row < m; row++) {
      for (let i = 0; i < k; i++) {
        Xty[i] += X[row][active[i]] * y[row];
        for (let j = 0; j < k; j++) {
          XtX[i][j] += X[row][active[i]] * X[row][active[j]];
        }
      }
    }

    // Gaussian elimination with partial pivoting
    for (let i = 0; i < k; i++) {
      let maxRow = i;
      for (let r = i + 1; r < k; r++) {
        if (Math.abs(XtX[r][i]) > Math.abs(XtX[maxRow][i])) maxRow = r;
      }
      [XtX[i], XtX[maxRow]] = [XtX[maxRow], XtX[i]];
      [Xty[i], Xty[maxRow]] = [Xty[maxRow], Xty[i]];

      if (Math.abs(XtX[i][i]) < 1e-10) continue;  // Skip singular

      for (let r = i + 1; r < k; r++) {
        const c = XtX[r][i] / XtX[i][i];
        for (let j = i; j < k; j++) XtX[r][j] -= c * XtX[i][j];
        Xty[r] -= c * Xty[i];
      }
    }

    // Back substitution
    const beta = Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) {
      if (Math.abs(XtX[i][i]) < 1e-10) continue;
      beta[i] = Xty[i];
      for (let j = i + 1; j < k; j++) beta[i] -= XtX[i][j] * beta[j];
      beta[i] /= XtX[i][i];
    }

    const result = Array(numVars).fill(0);
    for (let i = 0; i < k; i++) result[active[i]] = beta[i];
    return result;
  }

  // Active set method: iteratively fix negative coefficients to 0
  let fixed = new Set();
  let coefs;
  for (let iter = 0; iter < 20; iter++) {
    coefs = solveLS(fixed);
    let anyNeg = false;
    for (let i = 0; i < numVars; i++) {
      if (coefs[i] < 0 && !fixed.has(i)) {
        fixed.add(i);
        anyNeg = true;
      }
    }
    if (!anyNeg) break;
  }
  return coefs;
}

/**
 * Calculate R² for a model
 */
function calcR2(X, y, coefs) {
  const n = y.length;
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    let yPred = 0;
    for (let j = 0; j < coefs.length; j++) yPred += coefs[j] * X[i][j];
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - yPred) ** 2;
  }
  return 1 - ssRes / ssTot;
}

/**
 * 3-variable NNLS: timeUs = a + b*iters + c*pixels*iters
 */
function nnlsRegression3(samples) {
  const n = samples.length;
  if (n < 5) return null;

  const X = samples.map(s => [1, s.iters, s.pixels * s.iters]);
  const y = samples.map(s => s.timeUs);
  const coefs = solveNNLS(X, y, 3);
  const [a, b, c] = coefs;
  const r2 = calcR2(X, y, coefs);

  const minPx = Math.min(...samples.map(s => s.pixels));
  const maxPx = Math.max(...samples.map(s => s.pixels));

  return { a, b, c, r2, n, minPx, maxPx };
}

/**
 * 4-variable NNLS: timeUs = a + b*iters + c*pixels + d*pixels*iters
 *   a = batch overhead (constant)
 *   b = per-iteration overhead
 *   c = per-pixel overhead (memory transfer)
 *   d = per-pixel-iteration cost (computation)
 */
function nnlsRegression4(samples) {
  const n = samples.length;
  if (n < 6) return null;

  const X = samples.map(s => [1, s.iters, s.pixels, s.pixels * s.iters]);
  const y = samples.map(s => s.timeUs);
  const coefs = solveNNLS(X, y, 4);
  const [a, b, c, d] = coefs;
  const r2 = calcR2(X, y, coefs);

  const minPx = Math.min(...samples.map(s => s.pixels));
  const maxPx = Math.max(...samples.map(s => s.pixels));

  return { a, b, c, d, r2, n, minPx, maxPx };
}

/**
 * 4-variable NNLS with boardSize: timeUs = a + b*iters + c*boardSize + d*pixels*iters
 *   a = batch overhead (constant)
 *   b = per-iteration overhead
 *   c = per-board-pixel overhead (GPU buffer size / memory transfer)
 *   d = per-pixel-iteration cost (computation)
 *
 * This removes the active-pixel overhead term since all pixel cost should be in compute.
 */
function nnlsRegression4b(samples) {
  const n = samples.length;
  if (n < 6) return null;
  if (!samples[0].boardSize) return null;  // Need boardSize data

  const X = samples.map(s => [1, s.iters, s.boardSize, s.pixels * s.iters]);
  const y = samples.map(s => s.timeUs);
  const coefs = solveNNLS(X, y, 4);
  const [a, b, c, d] = coefs;
  const r2 = calcR2(X, y, coefs);

  const minPx = Math.min(...samples.map(s => s.pixels));
  const maxPx = Math.max(...samples.map(s => s.pixels));
  const minBoard = Math.min(...samples.map(s => s.boardSize));
  const maxBoard = Math.max(...samples.map(s => s.boardSize));

  return { a, b, c, d, r2, n, minPx, maxPx, minBoard, maxBoard };
}

/**
 * 5-variable NNLS: timeUs = a + b*iters + c*boardSize + d*pixels + e*pixels*iters
 *   a = batch overhead (constant)
 *   b = per-iteration overhead
 *   c = per-board-pixel overhead (GPU buffer size / memory transfer)
 *   d = per-active-pixel overhead
 *   e = per-pixel-iteration cost (computation)
 */
function nnlsRegression5(samples) {
  const n = samples.length;
  if (n < 8) return null;
  if (!samples[0].boardSize) return null;  // Need boardSize data

  const X = samples.map(s => [1, s.iters, s.boardSize, s.pixels, s.pixels * s.iters]);
  const y = samples.map(s => s.timeUs);
  const coefs = solveNNLS(X, y, 5);
  const [a, b, c, d, e] = coefs;
  const r2 = calcR2(X, y, coefs);

  const minPx = Math.min(...samples.map(s => s.pixels));
  const maxPx = Math.max(...samples.map(s => s.pixels));
  const minBoard = Math.min(...samples.map(s => s.boardSize));
  const maxBoard = Math.max(...samples.map(s => s.boardSize));

  return { a, b, c, d, e, r2, n, minPx, maxPx, minBoard, maxBoard };
}

/**
 * Legacy 3-variable wrapper for compatibility
 */
function nnlsRegression(samples) {
  const n = samples.length;
  if (n < 5) return null;

  const X = samples.map(s => [1, s.iters, s.pixels * s.iters]);
  const y = samples.map(s => s.timeUs);
  const coefs = solveNNLS(X, y, 3);
  const [a, b, c] = coefs;

  // Calculate R²
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = a + b * samples[i].iters + c * samples[i].pixels * samples[i].iters;
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - yPred) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;

  // Calculate pixel range for context
  const minPx = Math.min(...samples.map(s => s.pixels));
  const maxPx = Math.max(...samples.map(s => s.pixels));

  return { a, b, c, r2, n, minPx, maxPx };
}

// Run analysis
console.log('');
console.log('NNLS Regression: timeUs = a + b*iters + c*pixels*iters  (all >= 0)');
console.log('');
const results = {};
for (const [board, samples] of Object.entries(byBoard)) {
  const r = nnlsRegression(samples);
  if (r) results[board] = r;
}

// Get CPU baseline for relative calculations
const cpuC = results['cpu']?.c || 1;

// Sort by ns/px-iter (fastest first)
const sorted = Object.entries(results)
  .sort((a, b) => a[1].c - b[1].c);

console.log('Board        Samples   Effort   Speed    Batch OH    Iter OH     ns/px-iter    R²');
console.log('                       (CPU=100) vs CPU     (μs)    (μs/iter)');
console.log('='.repeat(95));

for (const [board, r] of sorted) {
  const effort = Math.round(100 * r.c / cpuC);
  const speed = r.c > 0 ? (cpuC / r.c) : Infinity;
  const speedStr = speed === Infinity ? '∞' : speed.toFixed(2) + '×';
  const nsPerPxIter = r.c * 1000;  // convert from μs to ns

  console.log(
    board.padEnd(12) +
    String(r.n).padStart(7) +
    String(effort).padStart(9) +
    speedStr.padStart(8) +
    r.a.toFixed(0).padStart(10) +
    r.b.toFixed(1).padStart(11) +
    nsPerPxIter.toFixed(3).padStart(14) +
    r.r2.toFixed(4).padStart(10)
  );
}

// Show boards with insufficient data
for (const [board, samples] of Object.entries(byBoard)) {
  if (!results[board]) {
    console.log(board.padEnd(12) + '  (insufficient data - ' + samples.length + ' samples)');
  }
}

// 4-variable model
console.log('');
console.log('='.repeat(95));
console.log('4-Variable Model: timeUs = a + b*iters + c*pixels + d*pixels*iters');
console.log('  a=batch OH, b=iter OH, c=pixel OH (memory), d=px-iter cost (compute)');
console.log('');
console.log('Board        Samples   Batch OH    Iter OH    Pixel OH     ns/px-iter    R²');
console.log('                         (μs)    (μs/iter)   (ns/pixel)');
console.log('='.repeat(95));

const results4 = {};
for (const [board, samples] of Object.entries(byBoard)) {
  const r = nnlsRegression4(samples);
  if (r) results4[board] = r;
}

const cpu4D = results4['cpu']?.d || 1;
const sorted4 = Object.entries(results4).sort((a, b) => a[1].d - b[1].d);

for (const [board, r] of sorted4) {
  const nsPerPxIter = r.d * 1000;  // μs to ns
  const nsPerPixel = r.c * 1000;   // μs to ns
  console.log(
    board.padEnd(12) +
    String(r.n).padStart(7) +
    r.a.toFixed(0).padStart(10) +
    r.b.toFixed(1).padStart(11) +
    nsPerPixel.toFixed(1).padStart(12) +
    nsPerPxIter.toFixed(3).padStart(14) +
    r.r2.toFixed(4).padStart(10)
  );
}

// Compare R² improvement
console.log('');
console.log('--- R² Comparison (3-var vs 4-var) ---');
for (const [board] of sorted4) {
  const r3 = results[board];
  const r4 = results4[board];
  if (r3 && r4) {
    const improvement = ((r4.r2 - r3.r2) * 100).toFixed(1);
    const arrow = r4.r2 > r3.r2 ? '↑' : (r4.r2 < r3.r2 ? '↓' : '=');
    console.log(
      board.padEnd(12) +
      `3-var: ${r3.r2.toFixed(4)}  →  4-var: ${r4.r2.toFixed(4)}  (${arrow}${improvement}%)`
    );
  }
}

// 5-variable model with board size
console.log('');
console.log('='.repeat(105));
console.log('5-Variable Model: timeUs = a + b*iters + c*boardSize + d*pixels + e*pixels*iters');
console.log('  a=batch OH, b=iter OH, c=board-pixel OH (memory), d=active-pixel OH, e=compute');
console.log('');
console.log('Board        Samples   Batch OH    Iter OH   Board OH     Pixel OH     ns/px-iter    R²');
console.log('                         (μs)    (μs/iter)  (ns/board-px) (ns/pixel)');
console.log('='.repeat(105));

const results5 = {};
for (const [board, samples] of Object.entries(byBoard)) {
  const r = nnlsRegression5(samples);
  if (r) results5[board] = r;
}

const sorted5 = Object.entries(results5).sort((a, b) => a[1].e - b[1].e);

for (const [board, r] of sorted5) {
  const nsPerPxIter = r.e * 1000;  // μs to ns
  const nsPerBoardPx = r.c * 1000;  // μs to ns
  const nsPerPixel = r.d * 1000;   // μs to ns
  console.log(
    board.padEnd(12) +
    String(r.n).padStart(7) +
    r.a.toFixed(0).padStart(10) +
    r.b.toFixed(1).padStart(11) +
    nsPerBoardPx.toFixed(2).padStart(13) +
    nsPerPixel.toFixed(1).padStart(11) +
    nsPerPxIter.toFixed(3).padStart(14) +
    r.r2.toFixed(4).padStart(10)
  );
}

// Compare 4-var vs 5-var for GPU boards
console.log('');
console.log('--- R² Comparison (4-var vs 5-var) ---');
for (const [board] of sorted5) {
  const r4 = results4[board];
  const r5 = results5[board];
  if (r4 && r5) {
    const improvement = ((r5.r2 - r4.r2) * 100).toFixed(1);
    const arrow = r5.r2 > r4.r2 ? '↑' : (r5.r2 < r4.r2 ? '↓' : '=');
    console.log(
      board.padEnd(12) +
      `4-var: ${r4.r2.toFixed(4)}  →  5-var: ${r5.r2.toFixed(4)}  (${arrow}${improvement}%)`
    );
  }
}

// 4b model: batch + iter + boardSize (memory) + compute (no active-pixel term)
console.log('');
console.log('='.repeat(105));
console.log('4b-Variable Model: timeUs = a + b*iters + c*boardSize + d*pixels*iters');
console.log('  a=batch OH, b=iter OH, c=board-pixel OH (memory), d=compute (no active-pixel term)');
console.log('');
console.log('Board        Samples   Batch OH    Iter OH   Board OH     ns/px-iter    R²');
console.log('                         (μs)    (μs/iter)  (ns/board-px)');
console.log('='.repeat(105));

const results4b = {};
for (const [board, samples] of Object.entries(byBoard)) {
  const r = nnlsRegression4b(samples);
  if (r) results4b[board] = r;
}

const sorted4b = Object.entries(results4b).sort((a, b) => a[1].d - b[1].d);

for (const [board, r] of sorted4b) {
  const nsPerPxIter = r.d * 1000;  // μs to ns
  const nsPerBoardPx = r.c * 1000;  // μs to ns
  console.log(
    board.padEnd(12) +
    String(r.n).padStart(7) +
    r.a.toFixed(0).padStart(10) +
    r.b.toFixed(1).padStart(11) +
    nsPerBoardPx.toFixed(2).padStart(13) +
    nsPerPxIter.toFixed(3).padStart(14) +
    r.r2.toFixed(4).padStart(10)
  );
}

// Compare 4b vs 5-var
console.log('');
console.log('--- R² Comparison (4b vs 5-var) ---');
for (const [board] of sorted4b) {
  const r4b = results4b[board];
  const r5 = results5[board];
  if (r4b && r5) {
    const diff = ((r5.r2 - r4b.r2) * 100).toFixed(1);
    const arrow = r5.r2 > r4b.r2 ? '↑' : (r5.r2 < r4b.r2 ? '↓' : '=');
    console.log(
      board.padEnd(12) +
      `4b: ${r4b.r2.toFixed(4)}  →  5-var: ${r5.r2.toFixed(4)}  (${arrow}${diff}%)`
    );
  }
}

// Summary statistics
console.log('');
console.log('--- Data Summary ---');
for (const [board, samples] of Object.entries(byBoard)) {
  const r = results[board];
  if (!r) continue;
  const iters = samples.map(s => s.iters);
  console.log(
    board.padEnd(12) +
    `pixels: ${(r.minPx/1e6).toFixed(1)}-${(r.maxPx/1e6).toFixed(1)}M` +
    `  iters: ${Math.min(...iters)}-${Math.max(...iters)}`
  );
}

// ============================================================================
// SHARED BATCH OVERHEAD MODEL
// All boards constrained to have the same batch overhead
// Model: timeUs = a_shared + b_board*iters + c_board*boardSize + d_board*pixels*iters
// ============================================================================

console.log('');
console.log('='.repeat(105));
console.log('SHARED BATCH OVERHEAD MODEL');
console.log('All boards share same batch overhead; per-board: iter OH, board OH, compute');
console.log('Model: timeUs = a_shared + b*iters + c*boardSize + d*pixels*iters');
console.log('');

// Build joint regression matrix
// Columns: [1, iters_board0, boardSize_board0, pxIters_board0, iters_board1, ..., gpu_activePixels]
// Exclude pert and qdpert - they have poor model fit due to complex reference orbit behavior
const excludeBoards = ['pert', 'qdpert'];
const boardNames = Object.keys(byBoard).filter(b => {
  const samples = byBoard[b];
  return samples.length >= 6 && samples[0].boardSize && !excludeBoards.includes(b);
});
const numBoards = boardNames.length;
const gpuIdx = boardNames.indexOf('gpu');  // Find gpu board index for special active-pixel term

// Stack all samples
const allSamples = [];
const sampleBoardIdx = [];
for (let bi = 0; bi < numBoards; bi++) {
  const board = boardNames[bi];
  for (const s of byBoard[board]) {
    allSamples.push(s);
    sampleBoardIdx.push(bi);
  }
}

const m = allSamples.length;
// 1 shared + 3 per board (iter, boardSize, pxIters) + 1 gpu-only active-pixel term
const numVars = 1 + numBoards * 3 + (gpuIdx >= 0 ? 1 : 0);
const gpuActivePixelCol = gpuIdx >= 0 ? 1 + numBoards * 3 : -1;

// Build design matrix
const X = [];
const y = [];
for (let i = 0; i < m; i++) {
  const s = allSamples[i];
  const bi = sampleBoardIdx[i];

  const row = new Array(numVars).fill(0);
  row[0] = 1;  // Shared batch overhead
  // GPU has no iter overhead (constrained to 0) - it has no reference orbit computation
  if (bi !== gpuIdx) {
    row[1 + bi * 3 + 0] = s.iters;         // Per-board iter overhead
  }
  row[1 + bi * 3 + 1] = s.boardSize;       // Per-board board-pixel overhead
  row[1 + bi * 3 + 2] = s.pixels * s.iters; // Per-board compute

  // GPU-only active pixel term
  if (bi === gpuIdx && gpuActivePixelCol >= 0) {
    row[gpuActivePixelCol] = s.pixels;  // Per-active-pixel overhead (GPU only)
  }

  X.push(row);
  y.push(s.timeUs);
}

// Solve with NNLS
let sharedCoefs = solveNNLS(X, y, numVars);

// GPU compute should be at least half of gpuz's compute
const gpuComputeCol = gpuIdx >= 0 ? 1 + gpuIdx * 3 + 2 : -1;
const gpuzIdx = boardNames.indexOf('gpuz');
if (gpuIdx >= 0 && gpuzIdx >= 0) {
  const gpuzCompute = sharedCoefs[1 + gpuzIdx * 3 + 2];
  const gpuMinCompute = gpuzCompute / 2;

  if (sharedCoefs[gpuComputeCol] < gpuMinCompute) {
    // Subtract GPU compute contribution from y, then re-solve without that variable
    const yAdjusted = y.slice();
    for (let i = 0; i < m; i++) {
      if (sampleBoardIdx[i] === gpuIdx) {
        yAdjusted[i] -= gpuMinCompute * allSamples[i].pixels * allSamples[i].iters;
      }
    }
    // Zero out GPU compute column and re-solve
    const X2 = X.map(row => {
      const newRow = row.slice();
      newRow[gpuComputeCol] = 0;
      return newRow;
    });
    sharedCoefs = solveNNLS(X2, yAdjusted, numVars);
    sharedCoefs[gpuComputeCol] = gpuMinCompute;
  }
}

const sharedR2 = calcR2(X, y, sharedCoefs);

const sharedBatchOH = sharedCoefs[0];
const gpuActivePixelOH = gpuActivePixelCol >= 0 ? sharedCoefs[gpuActivePixelCol] : 0;

console.log(`Overall R²: ${sharedR2.toFixed(4)}`);
console.log('');
console.log('Board        Samples  Batch OH    Iter OH   Board OH   Active px OH   ns/px-iter   R²');
console.log('                        (μs)    (μs/iter)  (ns/brd-px)    (ns/px)');
console.log('-'.repeat(100));

// Calculate per-board R² and display results
for (let bi = 0; bi < numBoards; bi++) {
  const board = boardNames[bi];
  const samples = byBoard[board];
  const n = samples.length;

  const b = sharedCoefs[1 + bi * 3 + 0];  // iter OH
  const c = sharedCoefs[1 + bi * 3 + 1];  // board-pixel OH
  const d = sharedCoefs[1 + bi * 3 + 2];  // compute
  const activePxOH = (bi === gpuIdx) ? gpuActivePixelOH : 0;

  // Calculate per-board R² (include GPU active-pixel term if applicable)
  const yBoard = samples.map(s => s.timeUs);
  const yPred = samples.map(s => {
    let pred = sharedBatchOH + b * s.iters + c * s.boardSize + d * s.pixels * s.iters;
    if (bi === gpuIdx) {
      pred += gpuActivePixelOH * s.pixels;
    }
    return pred;
  });
  const yMean = yBoard.reduce((a, v) => a + v, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (yBoard[i] - yMean) ** 2;
    ssRes += (yBoard[i] - yPred[i]) ** 2;
  }
  const boardR2 = 1 - ssRes / ssTot;

  const activePxStr = (bi === gpuIdx) ? (activePxOH * 1000).toFixed(2) : '-';

  console.log(
    board.padEnd(12) +
    String(n).padStart(7) +
    sharedBatchOH.toFixed(0).padStart(9) +
    b.toFixed(1).padStart(11) +
    (c * 1000).toFixed(2).padStart(12) +  // μs to ns
    activePxStr.padStart(13) +
    (d * 1000).toFixed(3).padStart(13) +   // μs to ns
    boardR2.toFixed(4).padStart(9)
  );
}


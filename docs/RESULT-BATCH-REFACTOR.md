# ResultBatch Refactoring Design

## Goal
Standardize the output of "batch computation" across all backend implementations (CpuBoard, GpuBoard, GlBoard, etc.) to simplify the `FractalWorker` logic and decouple it from backend-specific storage details.

## Current State
- **CpuBoard:** Returns `changes` object with `iter`, `nn` (diverged indices), and `vv` (converged/periodic indices).
- **GpuBoard:** Uses compacted buffers and struct offsets. The worker logic has to know about `results.count`, `results.records`, and specific byte layouts.
- **GlBoard:** Uses PBO readbacks and texture parsing. The worker logic has to parse RGBA values and map them to indices.

The `FractalWorker.iterateBoards` and `processBatchResults` methods contain complex branching logic to handle these differences.

## Proposed Interface: `ResultBatch`

All `computeBatch` (or equivalent) methods will return a `ResultBatch` object (or a Promise resolving to one).

```javascript
/**
 * Standardized result of a computation batch.
 * @typedef {Object} ResultBatch
 * @property {number} startIter - The iteration number at the start of this batch.
 * @property {number} endIter - The iteration number at the end of this batch.
 * @property {number} [activeCount] - (Optional) Number of active pixels remaining after this batch.
 * @property {boolean} [compacted] - (Optional) Whether the batch triggered a compaction (for statistics).
 * @property {Array<{index: number}>} [diverged] - Indices of pixels that diverged (escaped).
 * @property {Array<{index: number, val: any}>} [converged] - Indices and values of pixels that converged (periodic).
 * @property {string} [error] - (Optional) Error message if the batch failed.
 */
```

## Backend Adaptations

### 1. CpuBoard (and variants)
- **Current:** `iterate()` manages the loop and updates `this.un`, `this.di` directly. It produces `changes` objects internally.
- **Change:** Modify `iterate()` to return a `ResultBatch`.
    - It can aggregate the internal `changes` into the standard `diverged` and `converged` arrays.
    - Instead of modifying `this.un` directly inside the loop, it can calculate the deltas and return them, allowing the caller (or a wrapper method) to update the state.
    - *Alternative:* Keep `CpuBoard` mostly as is but wrap the output of `iterate` into the `ResultBatch` format before returning to `FractalWorker`.

### 2. GpuBoard (and variants)
- **Current:** `readResults()` parses the `Results` struct from the GPU buffer.
- **Change:** `readResults()` should parse the buffer and populate a `ResultBatch` object.
    - `diverged`: Indices where `status == 1`.
    - `converged`: Indices where `status == 2` (with period/value).
    - `activeCount`: Extracted from the results header.

### 3. GlBoard (and variants)
- **Current:** `readPixels()` reads texture data.
- **Change:** `readPixels()` (or a wrapper) should parse the texture data and populate a `ResultBatch` object.
    - `diverged`: Indices where alpha channel indicates escape.
    - `converged`: Indices where alpha channel indicates convergence.

## Worker Logic Changes

`FractalWorker.iterateBoards()` will be simplified:

```javascript
// Pseudo-code
async iterateBoards() {
  // ... selection logic ...
  const batch = await board.computeBatch(targetIters);
  this.processResultBatch(board, batch);
}

processResultBatch(board, batch) {
  // Common logic for all boards
  if (batch.diverged) {
    for (const idx of batch.diverged) {
      board.markDiverged(idx, batch.endIter);
    }
  }
  if (batch.converged) {
    for (const item of batch.converged) {
      board.markConverged(item.index, item.val);
    }
  }
  // ... update stats, histograms, etc. ...
}
```

## Implementation Plan

1.  **Define `ResultBatch` structure** (implicitly via usage).
2.  **Refactor `CpuBoard`**:
    - Update `iterate` to return the batch data.
3.  **Refactor `GpuBoard`**:
    - Update `readResults` to return the batch data.
4.  **Refactor `GlBoard`**:
    - Update readback logic to return the batch data.
5.  **Refactor `FractalWorker`**:
    - Consolidate the result processing logic.

## Risk Mitigation
- **Performance:** Creating new objects/arrays for every batch might add GC overhead. `CpuBoard` is particularly sensitive.
    - *Mitigation:* `CpuBoard` can reuse a persistent `ResultBatch` object or arrays if needed, but for now, we will trust the V8 engine for short-lived objects. The GPU/GL boards already do heavy copying, so a wrapper object is negligible.
- **Complexity:** `CpuBoard` updates state *during* the loop.
    - *Mitigation:* The "Batch" concept maps well to "one call to `iterate`". The `CpuBoard` can accumulate changes during its synchronous loop and return them at the end.


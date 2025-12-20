# Precomputed Points: Parent-to-Child Inheritance Plan

## Overview

When zooming in (typically 5×), child views can inherit computed results from parent views for uniform regions, skipping redundant computation. This document describes the architecture for implementing this optimization.

## What Can Be Inherited

1. **Diverged pixels**: If a parent pixel and all 8 neighbors diverged at the same iteration, child pixels in that region will also diverge at that iteration.

2. **Converged pixels**: If a parent pixel and neighbors converged to the same attractor with matching periods, child pixels will converge similarly. Need to pass: iteration count, z value, and period.

3. **Chaotic pixels**: Can be marked as "known chaotic" but still need computation (they don't have a fixed iteration count to inherit).

## Heuristics for Safe Inheritance

Use 9-neighbor uniformity check:
```
For each parent pixel (px, py):
  Get iteration count n = parent.nn[px, py]
  Check all 8 neighbors have same n (or are converged with same period)
  If uniform: all child pixels mapping to this parent can inherit
```

At 5× zoom, each parent pixel maps to a 5×5 region of 25 child pixels.

## Data Flow

```
Parent View (complete)
    │
    ├── nn[] - iteration counts
    ├── convergedData - Map of {z, p} for converged pixels
    │
    ▼
computeInheritance(parentView, zoomFactor)
    │
    ├── Coordinate mapping: which parent pixel covers each child pixel
    ├── Uniformity check: 9-neighbor test
    │
    ▼
InheritedData = {
  diverged: [{index, iter}, ...],
  converged: [{index, iter, z, p}, ...],
  chaotic: [{index}, ...]  // Optional: mark but still compute
}
    │
    ▼
Worker receives via postMessage({type:'addBoard', data:{..., inheritedData}})
    │
    ▼
Board constructor creates PrecomputedPoints utility
```

## PrecomputedPoints Utility

Shared component usable by all board types:

```javascript
class PrecomputedPoints {
  constructor(inheritedData) {
    // Store by iteration: Map<iter, {diverged: [idx], converged: [{idx,z,p}]}>
    this.pendingReports = new Map();
    // Track which pixels are pre-known (for excluding from compute)
    this.knownPixels = new Set();

    for (const {index, iter, z, p} of inheritedData.diverged) {
      this.knownPixels.add(index);
      if (!this.pendingReports.has(iter)) {
        this.pendingReports.set(iter, {diverged: [], converged: []});
      }
      this.pendingReports.get(iter).diverged.push(index);
    }

    for (const {index, iter, z, p} of inheritedData.converged) {
      this.knownPixels.add(index);
      if (!this.pendingReports.has(iter)) {
        this.pendingReports.set(iter, {diverged: [], converged: []});
      }
      this.pendingReports.get(iter).converged.push({index, z, p});
    }
  }

  isPrecomputed(index) {
    return this.knownPixels.has(index);
  }

  getPrecomputedCount() {
    return this.knownPixels.size;
  }

  // Called each iteration to inject pending reports into changeList
  flushAtIteration(iter, board) {
    const pending = this.pendingReports.get(iter);
    if (pending) {
      board.queueChanges({
        iter,
        nn: pending.diverged,
        vv: pending.converged
      });
      // Update board's internal counters
      board.di += pending.diverged.length;
      board.un -= pending.diverged.length + pending.converged.length;
      // Mark pixels as done in nn[]
      for (const idx of pending.diverged) board.nn[idx] = iter;
      for (const c of pending.converged) board.nn[c.index] = -iter;
      this.pendingReports.delete(iter);
    }
  }

  // Check if all pending reports have been flushed
  isEmpty() {
    return this.pendingReports.size === 0;
  }
}
```

## Board Modifications

### CPU Boards (CpuBoard, DDZhuoranBoard, QDZhuoranBoard)

Filter `ss[]` (active pixel list) during construction:

```javascript
// In constructor, after initializing ss:
if (inheritedData) {
  this.precomputed = new PrecomputedPoints(inheritedData);
  this.ss = this.ss.filter(i => !this.precomputed.isPrecomputed(i));
  this.un -= this.precomputed.getPrecomputedCount();
}

// In iterate(), at start of each batch:
this.precomputed?.flushAtIteration(this.it, this);
```

### GPU Boards (GpuBoard, GpuZhuoranBoard, AdaptiveGpuBoard)

Filter during buffer population in `initPixels()` or `createBuffers()`:

```javascript
// During buffer creation:
let activeCount = 0;
for (let i = 0; i < dimsArea; i++) {
  if (this.precomputed?.isPrecomputed(i)) continue;
  // Add pixel to GPU buffer at position activeCount
  activeCount++;
}
this.activeCount = activeCount;

// In compute(), before each batch:
this.precomputed?.flushAtIteration(this.it, this);
```

## Main Thread Changes

### Grid.startViewComputation()

```javascript
startViewComputation(k) {
  const view = this.views[k];
  if (!view) return;

  // Compute inheritance from parent if available
  let inheritedData = null;
  if (view.parentView && view.parentView.isComplete()) {
    inheritedData = this.computeInheritance(
      view.parentView,
      view,
      this.config.zoomfactor
    );
  }

  this.scheduler.assignBoardToWorker(
    k, view.size, view.re, view.im,
    this.config, view.id, inheritedData
  );
}
```

### Scheduler.assignBoardToWorker()

Add `inheritedData` parameter and include in postMessage:

```javascript
assignBoardToWorker(k, size, reQD, imQD, config, id, inheritedData = null) {
  // ... existing code ...
  worker.postMessage({
    type: 'addBoard',
    data: {
      k, size, reQD, imQD, config, id, workerNumber,
      inheritedData  // New field
    }
  });
}
```

### computeInheritance() Function

```javascript
computeInheritance(parentView, childView, zoomFactor) {
  const parentWidth = parentView.config.dimsWidth;
  const parentHeight = parentView.config.dimsHeight;
  const childWidth = childView.config.dimsWidth;
  const childHeight = childView.config.dimsHeight;

  const diverged = [];
  const converged = [];

  // For each child pixel, find corresponding parent pixel
  // and check if it's in a uniform region
  for (let cy = 0; cy < childHeight; cy++) {
    for (let cx = 0; cx < childWidth; cx++) {
      const childIdx = cy * childWidth + cx;

      // Map child coordinates to parent coordinates
      // (accounting for zoom center offset)
      const px = Math.floor(cx / zoomFactor + parentWidth * (0.5 - 0.5/zoomFactor));
      const py = Math.floor(cy / zoomFactor + parentHeight * (0.5 - 0.5/zoomFactor));

      // Check bounds
      if (px < 1 || px >= parentWidth - 1 || py < 1 || py >= parentHeight - 1) {
        continue; // Can't check 9-neighbors at edge
      }

      const parentIdx = py * parentWidth + px;
      const parentIter = parentView.nn[parentIdx];

      if (parentIter === 0) continue; // Parent not yet computed

      // Check 9-neighbor uniformity
      let uniform = true;
      for (let dy = -1; dy <= 1 && uniform; dy++) {
        for (let dx = -1; dx <= 1 && uniform; dx++) {
          const neighborIdx = (py + dy) * parentWidth + (px + dx);
          if (parentView.nn[neighborIdx] !== parentIter) {
            uniform = false;
          }
        }
      }

      if (!uniform) continue;

      // Can inherit this pixel
      if (parentIter > 0) {
        diverged.push({index: childIdx, iter: parentIter});
      } else {
        const data = parentView.convergedData.get(parentIdx);
        converged.push({
          index: childIdx,
          iter: -parentIter,
          z: data.z,
          p: data.p
        });
      }
    }
  }

  return { diverged, converged };
}
```

## Visual Continuity

The `changeList` mechanism already batches results by iteration. When the main thread receives results:

```javascript
for (const { nn, vv, iter } of changeList) {
  // Draws pixels that completed at this iteration
}
```

Precomputed points injected via `flushAtIteration()` will appear at the correct visual moment, maintaining the smooth "unfolding" appearance as iteration count increases.

## Expected Performance Improvement

- **Typical case**: 50-70% of child pixels can be inherited
- **Best case** (deep in cardioid): 80-90% inherited
- **Worst case** (chaotic boundary): <10% inherited

The sparse `inheritedData` format is efficient:
- Only transmit inherited pixels, not full arrays
- At 5× zoom with 70% inheritance: ~70% reduction in compute work

## Implementation Order

1. Add `PrecomputedPoints` class (shared utility)
2. Add `computeInheritance()` to Grid
3. Modify `assignBoardToWorker()` to pass inheritedData
4. Modify worker's `handleMessage('addBoard')` to pass to board constructor
5. Modify CPU board constructors to filter `ss[]`
6. Modify GPU board `initPixels()`/`createBuffers()` to skip precomputed
7. Add `flushAtIteration()` calls to all `iterate()` methods
8. Test with various zoom levels and locations

## Open Questions

1. **Edge handling**: Should we use a larger neighbor window (5×5) for more conservative inheritance near boundaries?

2. **Partial completion**: If parent is still computing, should we wait or skip inheritance?

3. **Zoom factor variations**: The 9-neighbor heuristic assumes moderate zoom. For very large zooms (>10×), may need larger windows.

4. **Serialization**: When boards are serialized/transferred between workers, should precomputed state be preserved?

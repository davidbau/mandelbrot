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

## Debug Flag

Add a URL parameter `?inherit=0` to disable inheritance for A/B comparison:

```javascript
// In Config or URL parameter handling:
get enableInheritance() {
  return this.state.config.enableInheritance ?? true;
}

// In Grid.startViewComputation():
let inheritedData = null;
if (this.config.enableInheritance &&
    view.parentView && view.parentView.isComplete()) {
  inheritedData = this.computeInheritance(...);
}
```

**URL Parameters:**
- `?inherit=1` (default): Enable parent-to-child inheritance
- `?inherit=0`: Disable inheritance, compute all pixels from scratch

**Logging for debugging:**
```javascript
// In worker, log inheritance stats:
if (inheritedData) {
  const total = config.dimsArea;
  const inherited = inheritedData.diverged.length + inheritedData.converged.length;
  console.log(`Board ${k}: inherited ${inherited}/${total} (${(100*inherited/total).toFixed(1)}%)`);
}
```

## Testing Plan

### Unit Tests

Add to `tests/unit/precomputed-points.test.js`:

**1. PrecomputedPoints class tests:**
```javascript
describe('PrecomputedPoints', () => {
  test('constructor builds knownPixels set correctly', () => {
    const data = {
      diverged: [{index: 0, iter: 100}, {index: 5, iter: 100}],
      converged: [{index: 10, iter: 50, z: [0.1, 0.2], p: 3}]
    };
    const pp = new PrecomputedPoints(data);
    expect(pp.isPrecomputed(0)).toBe(true);
    expect(pp.isPrecomputed(5)).toBe(true);
    expect(pp.isPrecomputed(10)).toBe(true);
    expect(pp.isPrecomputed(1)).toBe(false);
    expect(pp.getPrecomputedCount()).toBe(3);
  });

  test('pendingReports groups by iteration', () => {
    const data = {
      diverged: [
        {index: 0, iter: 100},
        {index: 1, iter: 200},
        {index: 2, iter: 100}
      ],
      converged: []
    };
    const pp = new PrecomputedPoints(data);
    expect(pp.pendingReports.get(100).diverged).toEqual([0, 2]);
    expect(pp.pendingReports.get(200).diverged).toEqual([1]);
  });

  test('flushAtIteration injects changes and updates board state', () => {
    const data = {
      diverged: [{index: 5, iter: 100}],
      converged: [{index: 10, iter: 100, z: [0.1, 0.2], p: 3}]
    };
    const pp = new PrecomputedPoints(data);
    const mockBoard = {
      nn: new Array(20).fill(0),
      di: 0,
      un: 20,
      changeList: [],
      queueChanges(c) { this.changeList.push(c); }
    };

    pp.flushAtIteration(100, mockBoard);

    expect(mockBoard.nn[5]).toBe(100);
    expect(mockBoard.nn[10]).toBe(-100);
    expect(mockBoard.di).toBe(1);
    expect(mockBoard.un).toBe(18);
    expect(mockBoard.changeList).toHaveLength(1);
    expect(pp.pendingReports.has(100)).toBe(false);
  });

  test('flushAtIteration is idempotent for non-existent iterations', () => {
    const pp = new PrecomputedPoints({diverged: [], converged: []});
    const mockBoard = { nn: [], di: 0, un: 10, changeList: [], queueChanges() {} };
    pp.flushAtIteration(999, mockBoard);
    expect(mockBoard.un).toBe(10); // unchanged
  });

  test('isEmpty returns true when all pending flushed', () => {
    const data = { diverged: [{index: 0, iter: 100}], converged: [] };
    const pp = new PrecomputedPoints(data);
    expect(pp.isEmpty()).toBe(false);
    pp.flushAtIteration(100, { nn: [0], di: 0, un: 1, queueChanges() {} });
    expect(pp.isEmpty()).toBe(true);
  });
});
```

**2. computeInheritance function tests:**
```javascript
describe('computeInheritance', () => {
  test('returns empty for incomplete parent', () => {
    const parent = { nn: new Array(100).fill(0), config: {dimsWidth: 10, dimsHeight: 10} };
    const child = { config: {dimsWidth: 10, dimsHeight: 10} };
    const result = computeInheritance(parent, child, 5);
    expect(result.diverged).toHaveLength(0);
    expect(result.converged).toHaveLength(0);
  });

  test('inherits uniform diverged regions', () => {
    // 10x10 parent, all pixels diverged at iter 100
    const parent = {
      nn: new Array(100).fill(100),
      config: {dimsWidth: 10, dimsHeight: 10}
    };
    const child = { config: {dimsWidth: 10, dimsHeight: 10} };
    const result = computeInheritance(parent, child, 1);
    // Inner 8x8 can be inherited (edges excluded for 9-neighbor check)
    expect(result.diverged.length).toBeGreaterThan(0);
    expect(result.diverged.every(d => d.iter === 100)).toBe(true);
  });

  test('does not inherit non-uniform regions', () => {
    // Checkerboard pattern - no pixel has uniform neighbors
    const parent = {
      nn: new Array(100).fill(0).map((_, i) => (i % 2 === 0) ? 100 : 200),
      config: {dimsWidth: 10, dimsHeight: 10}
    };
    const child = { config: {dimsWidth: 10, dimsHeight: 10} };
    const result = computeInheritance(parent, child, 1);
    expect(result.diverged).toHaveLength(0);
  });

  test('inherits converged pixels with z and period', () => {
    const parent = {
      nn: new Array(100).fill(-50),  // All converged at iter 50
      convergedData: new Map(),
      config: {dimsWidth: 10, dimsHeight: 10}
    };
    // Add converged data for inner pixels
    for (let i = 0; i < 100; i++) {
      parent.convergedData.set(i, {z: [0.1, 0.2], p: 3});
    }
    const child = { config: {dimsWidth: 10, dimsHeight: 10} };
    const result = computeInheritance(parent, child, 1);
    expect(result.converged.length).toBeGreaterThan(0);
    expect(result.converged[0]).toMatchObject({iter: 50, z: [0.1, 0.2], p: 3});
  });

  test('coordinate mapping is correct for 5x zoom', () => {
    // 10x10 parent, 50x50 child at 5x zoom
    const parent = {
      nn: new Array(100).fill(100),
      config: {dimsWidth: 10, dimsHeight: 10}
    };
    const child = { config: {dimsWidth: 50, dimsHeight: 50} };
    const result = computeInheritance(parent, child, 5);
    // Center region of child should map to center of parent
    // Verify some specific mappings
    expect(result.diverged.some(d => d.index === 25 * 50 + 25)).toBe(true); // center
  });
});
```

### Integration Tests

Add to `tests/integration/precomputed-inheritance.test.js`:

**1. End-to-end inheritance test:**
```javascript
describe('Precomputed Inheritance', () => {
  test('child view inherits from completed parent', async () => {
    await page.goto(`file://${indexPath}?z=10&inherit=1`);

    // Wait for first view to complete
    await page.waitForFunction(() => {
      const view = window.grid?.views[0];
      return view && view.un === 0;
    }, {timeout: 30000});

    // Trigger zoom to create child view
    await page.keyboard.press('Space');

    // Wait for child to start
    await page.waitForFunction(() => window.grid?.views[1]);

    // Check that child has precomputed pixels
    const stats = await page.evaluate(() => {
      const child = window.grid.views[1];
      // Count pixels that were immediately known (nn !== 0 before first iteration)
      return {
        total: child.config.dimsArea,
        un: child.un,
        precomputed: child.config.dimsArea - child.un - child.di - child.ch
      };
    });

    // Expect significant inheritance (>30% for typical Mandelbrot view)
    expect(stats.precomputed / stats.total).toBeGreaterThan(0.3);
  });

  test('inherit=0 disables inheritance', async () => {
    await page.goto(`file://${indexPath}?z=10&inherit=0`);

    // Wait for first view to complete
    await page.waitForFunction(() => {
      const view = window.grid?.views[0];
      return view && view.un === 0;
    }, {timeout: 30000});

    // Trigger zoom
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.grid?.views[1]);

    // Check that child starts with all pixels unknown
    const initialUn = await page.evaluate(() => window.grid.views[1].un);
    const total = await page.evaluate(() => window.grid.views[1].config.dimsArea);

    expect(initialUn).toBe(total);  // No inheritance
  });

  test('inherited pixels render correctly', async () => {
    await page.goto(`file://${indexPath}?z=10&inherit=1`);

    // Complete first view
    await page.waitForFunction(() => {
      const view = window.grid?.views[0];
      return view && view.un === 0;
    }, {timeout: 30000});

    // Capture parent canvas
    const parentPixels = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return Array.from(data.slice(0, 100)); // First 100 values
    });

    // Zoom and complete child
    await page.keyboard.press('Space');
    await page.waitForFunction(() => {
      const view = window.grid?.views[1];
      return view && view.un === 0;
    }, {timeout: 60000});

    // Child center should match parent center colors (for uniform regions)
    const childPixels = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      const canvas = canvases[1];
      const ctx = canvas.getContext('2d');
      // Sample center region
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const data = ctx.getImageData(cx-5, cy-5, 10, 10).data;
      return Array.from(data.slice(0, 100));
    });

    // Verify colors are reasonable (not black/uncomputed)
    const hasColor = childPixels.some((v, i) => i % 4 < 3 && v > 0);
    expect(hasColor).toBe(true);
  });

  test('visual continuity - precomputed pixels appear at correct iteration', async () => {
    await page.goto(`file://${indexPath}?z=10&inherit=1&debug=t`);

    // Complete parent
    await page.waitForFunction(() => {
      const view = window.grid?.views[0];
      return view && view.un === 0;
    }, {timeout: 30000});

    // Start child and capture early state
    await page.keyboard.press('Space');

    // Wait for child to process a few iterations
    await page.waitForFunction(() => {
      const view = window.grid?.views[1];
      return view && view.it > 50;
    });

    // Check that some pixels are already known at low iteration counts
    const earlyKnown = await page.evaluate(() => {
      const view = window.grid.views[1];
      let knownCount = 0;
      for (let i = 0; i < view.nn.length; i++) {
        if (view.nn[i] !== 0 && Math.abs(view.nn[i]) <= view.it) {
          knownCount++;
        }
      }
      return knownCount;
    });

    expect(earlyKnown).toBeGreaterThan(0);
  });
});
```

**2. Board-specific integration tests:**
```javascript
describe('Inheritance with different board types', () => {
  const boardTypes = ['cpu', 'gpu', 'gpuz', 'adaptive'];

  boardTypes.forEach(board => {
    test(`${board} board handles inherited data correctly`, async () => {
      await page.goto(`file://${indexPath}?z=10&board=${board}&inherit=1`);

      // Complete parent and zoom
      await page.waitForFunction(() => {
        const view = window.grid?.views[0];
        return view && view.un === 0;
      }, {timeout: 60000});

      await page.keyboard.press('Space');

      // Wait for child to complete
      await page.waitForFunction(() => {
        const view = window.grid?.views[1];
        return view && view.un === 0;
      }, {timeout: 120000});

      // Verify final state is consistent
      const childState = await page.evaluate(() => {
        const view = window.grid.views[1];
        return {
          un: view.un,
          di: view.di,
          total: view.config.dimsArea,
          allResolved: view.nn.every(n => n !== 0)
        };
      });

      expect(childState.un).toBe(0);
      expect(childState.di + childState.ch).toBeLessThanOrEqual(childState.total);
    });
  });
});
```

## Benchmark Plan

### Test Scenario

Use the default starting view (z=1, centered on cardioid) with a single 5× zoom:

```bash
node tests/benchmark-inheritance.js
```

### Metrics

Run 5 times each with `?inherit=1` and `?inherit=0`, measuring:

1. **Inheritance rate**: `inherited_pixels / total_pixels`
2. **Child completion time**: `view.boardEndTime - view.boardStartTime`
3. **Speedup**: `time_without / time_with`

### Expected Output

```
=== Inheritance Benchmark ===

Without inheritance (baseline):
  Child completion: 1250ms, 1180ms, 1320ms, 1210ms, 1275ms
  Mean: 1247ms

With inheritance:
  Inherited: 68.2% (1842/2700 pixels)
  Child completion: 485ms, 512ms, 478ms, 495ms, 502ms
  Mean: 494ms

Speedup: 2.52x
```

### Success Criteria

- Inheritance rate > 50% for default view
- Speedup > 1.5× with inheritance enabled
- No visual differences between `inherit=0` and `inherit=1` final renders

## Implementation Notes

### Autonomy Guidelines

When implementing this plan, work autonomously:
- Use `tests/debug-*.js` scripts for debugging rather than inline commands requiring approval
- Prefer file-based logging over console inspection
- Take steps that don't require manual approval (use pre-approved tool patterns)
- Commit incrementally with working tests at each step

### Additional Implementation Considerations

1. **Grid dimension mismatch**: Parent and child may have different aspect ratios or grid sizes. The coordinate mapping in `computeInheritance()` must handle this correctly - map by fractional position, not pixel index.

2. **Converged data availability**: When inheriting converged pixels, the parent's `convergedData` Map must have the entry. Skip inheritance for any converged pixel where `convergedData.get(parentIdx)` is undefined.

3. **Incremental rollout**: Implement for one board type first (suggest GpuBoard), verify it works, then extend to others. Boards that don't yet support inheritance should ignore the `inheritedData` parameter gracefully.

4. **Message size**: For large grids (e.g., 4K), inheritedData could be large. Monitor postMessage overhead. If needed, consider sending only iteration counts and reconstructing z values for converged pixels.

5. **Debug logging**: Add `?debug=inherit` flag to log inheritance statistics per board without cluttering normal output.

6. **Compaction interaction**: When GPU boards compact their buffers, precomputed pixels are already excluded from the initial buffer, so no special handling needed during compaction.

## Design Decisions

1. **Edge handling**: Use 3×3 neighbor window. Simple and sufficient for typical 5× zoom.

2. **Partial completion**: Don't wait for parent to complete. Use whatever information is available at zoom time. Pixels with `nn[i] === 0` (unknown) in the parent are treated as unknown in the child and must be computed.

3. **Zoom factor variations**: Log a warning if zoom factor > 10× (where 3×3 window may be insufficient), but proceed with inheritance anyway.

4. **Serialization**: `PrecomputedPoints` state must be included in board serialization. When a board is transferred between workers, its precomputed data goes with it.

5. **Inheritance chain**: Only inherit from immediate parent. No grandparent inheritance for now.

---

## Detailed Design: Reporting Strategy

### Invariants to Maintain

1. **Monotonic iteration reporting**: Pixels must be reported in non-decreasing iteration order. If iteration 100 is reported, no later report can be at iteration < 100.

2. **Each pixel reported exactly once**: Every pixel index appears in exactly one changeList entry.

3. **Consistent histogram (no stripes)**: At each iteration, all reported pixels contribute to the same histogram entry with the same fracK value.

4. **Accurate progress tracking**:
   - `unP` = pixels not yet reported to changeList = `unC + pendingPrecomputed`
   - `unC` = GPU pixels still computing = `activeCount - deadSinceCompaction`
   - `pendingPrecomputed` = precomputed pixels not yet flushed

### Equivalence Classes for 9-Point Safety Check

The 9-point uniformity check ensures safe inheritance by verifying that a pixel and all 8 neighbors are in the same "equivalence class":

**For diverged (escaped) pixels:**
- All 9 pixels must have diverged at the SAME iteration count
- If center diverged at iteration 100, all 8 neighbors must also have nn[i] = 100
- Rationale: If neighbors diverged at different iterations, the boundary may cross through this region

**For converged (periodic) pixels:**
- All 9 pixels must have converged with the SAME period
- If center has period 3, all 8 neighbors must also be converged with period 3
- Rationale: Different periods indicate different attractors or boundary regions

**Mixed neighborhoods:**
- If any neighbor differs in type (diverged vs converged) or value, do NOT inherit
- This pixel is in a transition zone and must be computed fresh

### Diverged vs Converged: Key Differences

**Diverged (escaped) pixels:**
- `nn[i] > 0`: Positive iteration count when |z| exceeded escape radius
- Coloring uses iteration count + fractional escape (smooth coloring)
- Inheritance passes: `{index, iter}`
- Safe to inherit: All neighbors escaped at same iteration

**Converged (periodic) pixels:**
- `nn[i] < 0`: Negative iteration count when periodic orbit detected
- Coloring uses: period (cycle length) + position within cycle (z value)
- Inheritance passes: `{index, iter, z: [zr, zi], p: period}`
- Safe to inherit: All neighbors converged with same period
- z value is needed for interior coloring based on orbit position

### Reporting Algorithm

**Phase 1: GPU produces results**

When GPU completes a batch at iterations `[i1, i2, i3, ...]`:

1. Collect GPU results into `pixelsByIteration` and `convergedByIteration` maps
2. For each iteration i in sorted order (ascending):
   a. Get GPU diverged pixels at iteration i
   b. Get GPU converged pixels at iteration i
   c. Get precomputed pixels at iteration i (exact match)
   d. Report all together in one changeList entry

**Phase 2: Precomputed at iterations BELOW GPU min**

After Phase 1, any precomputed at iterations < minGpuIter haven't been reported.
Strategy: Report them all at minGpuIter to share its fracK.

This violates the "true" iteration, but maintains visual consistency (no stripes).

**Phase 3: Precomputed at iterations ABOVE GPU max**

When GPU finishes all work (`activeRemaining = 0`):
- Remaining precomputed are at iterations > any GPU iteration
- Report them at their actual iterations (in ascending order)
- Or report all at maxGpuIter for consistency

**Phase 4: All precomputed, no GPU (`unC = 0`)**

Special case: Every pixel was precomputed.
- No GPU work at all
- Report all precomputed at their actual iterations (in order)
- Or report all at iteration 1 for simplicity

### Edge Case: Deep Interior (Slow GPU Progress)

In deep interior regions, GPU may run many iterations before any pixel finishes.
During this time:
- `pendingPrecomputed` stays high
- `unP = unC + pendingPrecomputed` is correct
- No reports are sent until first GPU result

This is correct behavior: precomputed will be reported when GPU produces its first result.

### Algorithm Pseudocode

```
processComputeResults(gpuResults):
    // Collect GPU results by iteration
    for each gpuPixel in gpuResults:
        if diverged: add to pixelsByIteration[iter]
        if converged: add to convergedByIteration[iter]

    gpuIters = sorted(union(pixelsByIteration.keys, convergedByIteration.keys))
    minGpuIter = gpuIters.first or null

    // PHASE 1 & 2: First GPU result triggers precomputed flush
    if minGpuIter != null and not precomputedFlushed:
        // Report ALL precomputed at minGpuIter
        allPrecomputed = precomputed.extractAll()
        report(minGpuIter, allPrecomputed)
        precomputedFlushed = true

    // Report GPU results
    for iter in gpuIters:
        diverged = pixelsByIteration[iter] or []
        converged = convergedByIteration[iter] or []
        report(iter, {diverged, converged})

    // PHASE 3: Cleanup when GPU done
    if activeRemaining == 0 and precomputed.hasPending():
        // Report remaining at their actual iterations
        for iter in sorted(precomputed.pendingIterations):
            report(iter, precomputed.extractAt(iter))
        // Or: report all at maxGpuIter

report(iter, {diverged, converged}):
    for idx in diverged: nn[idx] = iter; di++
    for c in converged: nn[c.index] = -iter; pp[c.index] = c.p
    changeList.push({iter, nn: diverged, vv: converged})
    updateSize += diverged.length + converged.length
```

### Verification: Invariants Are Maintained

1. **Monotonic**:
   - Phase 1&2: All precomputed at minGpuIter, then GPU iters in order ✓
   - Phase 3: Remaining precomputed in ascending order ✓

2. **Each pixel once**:
   - `extractAll()` clears all precomputed
   - GPU results checked via `if nn[idx] != 0: continue`
   - No double-reporting ✓

3. **Consistent histogram**:
   - All precomputed share minGpuIter's fracK ✓
   - GPU pixels at same iter reported together ✓

4. **Accurate progress**:
   - `unP = unC + pendingPrecomputed`
   - After extractAll: pendingPrecomputed = 0
   - unP = unC (GPU work remaining) ✓

---

## Open Questions

1. **Stripe detection**: How do we verify no stripes? The current test checks warm/cool transitions in a pixel row. Is this sufficient?

2. **Period uniformity check**: Current code checks if neighbors have same period. Should we also check z values are close?

3. **Very deep zoom**: At zoom > 1e50, float64 may lose precision in coordinate mapping. Does this cause misalignment?

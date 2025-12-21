# Precomputed Inheritance

One of the most significant optimizations in the explorer is **Precomputed Inheritance**. When zooming in, the new "child" view often overlaps significantly with the "parent" view. Instead of re-calculating every pixel from scratch, we can mathematically prove that certain pixels in the new view *must* have the same value as corresponding pixels in the parent view.

This document explains the logic, safety checks, and data structures involved in this optimization.

## The Core Concept

When a user zooms in, the new viewport is a subset of the previous viewport (scaled up).

1.  **Mapping**: For every pixel in the new (child) view, we calculate its complex coordinate `c`.
2.  **Lookup**: We find which pixel in the old (parent) view corresponds to `c`.
3.  **Safety Check**: If the parent pixel and its neighbors are "stable" (uniform), we inherit the result.
4.  **Pre-filling**: These inherited results are stored as "Precomputed Points" and injected into the calculation engine, skipping the expensive GPU/CPU work for those specific points.

## Board Support

All board types support precomputed inheritance:

| Board | Type | Precision |
|-------|------|-----------|
| CpuBoard | CPU direct | float64 |
| QDCpuBoard | CPU direct | quad-double |
| DDZhuoranBoard | CPU perturbation | double-double |
| QDZhuoranBoard | CPU perturbation | quad-double |
| GpuBoard | GPU direct | float32 |
| GpuZhuoranBoard | GPU perturbation | double-double |
| AdaptiveGpuBoard | GPU perturbation | quad-double |

## 1. Coordinate Mapping

Because the explorer uses high-precision coordinates (Double-Double or Quad-Double), we cannot simply scale integer pixel coordinates. We must map through the complex plane:

```
Child Pixel (x, y)
  -> Complex Coordinate (re, im)
  -> Parent Pixel (px, py)
```

We compute `(re, im)` using the child's center and size, then project that back to the parent's grid. If `(px, py)` lands within the bounds of the parent view, it is a candidate for inheritance.

## 2. The Safety Check (3x3 Uniformity)

We cannot simply copy the value of the nearest parent pixel. The parent grid is coarser; a single parent pixel might split into 4, 16, or more child pixels. If that parent pixel sat on the boundary of the Mandelbrot set, some of its children might be inside and some outside.

To ensure safety, we require **3x3 Uniformity**. We look at the parent pixel `(px, py)` and its 8 immediate neighbors.

### Zoom Factor Limit

At very high zoom factors, a single parent pixel covers many child pixels, making the 3x3 check statistically insufficient:
- **>5x zoom**: Warning logged (3x3 window may be insufficient)
- **>8x zoom**: Inheritance disabled entirely for safety

### For Diverged Points (Outside the Set)
If the central parent pixel escaped at iteration `N`, we inherit this value **only if** all 8 neighbors also escaped at exactly iteration `N`. This implies we are in a solid band of color (a "dwelling"), far from the chaotic boundary.

### For Converged Points (Inside the Set)
If the central parent pixel converged to a cycle, we inherit **only if**:
1.  All 8 neighbors also converged.
2.  All 8 neighbors have the same **derived period**.

**Crucial Detail: Periods vs. Iterations**

In the current architecture, converged points store `p` as the *absolute iteration* where convergence was detected (e.g., 105 or 108), not the period length (e.g., 3).
*   Pixel A might detect convergence at iteration 105.
*   Pixel B might detect convergence at iteration 108.
*   Both are Period 3.

If we strictly compared `p` (105 vs 108), we would fail to inherit valid regions. Instead, we compare their derived periods:
```javascript
if (fibonacciPeriod(neighbor.p) === fibonacciPeriod(center.p)) {
  // Safe to inherit
}
```
This robust check allows us to inherit solid black regions without introducing "cracks" where the specific detection iteration shifted slightly.

## 3. Data Storage: PrecomputedPoints

Inherited data is not immediately written to the result grid. Instead, it is packaged into a `PrecomputedPoints` object passed to the compute worker. This class is highly optimized for memory and performance.

### Sparse Storage with TypedArrays

We do not store a full grid. Instead, we use **TypedArrays** to store only the known values:

*   `dIndices: Uint32Array` - Pixel indices for diverged points
*   `cIndices: Uint32Array` - Pixel indices for converged points
*   `cP: Uint32Array` - Period values (absolute iterations) for converged points
*   `cZ: Float64Array` - Final `z` coordinates (for resuming perturbation)
*   `rangeMap: Map<iter, {dStart, dCount, cStart, cCount}>` - Index ranges by iteration

### PrecomputedPoints API

```javascript
class PrecomputedPoints {
  constructor(inheritedData)     // Build from {diverged, converged} arrays

  isPrecomputed(index)           // Check if pixel was inherited
  getPrecomputedCount()          // Total inherited pixel count
  getPendingCount()              // Pixels not yet flushed
  getPendingIterations(maxIter?) // Get iterations with pending data

  extractAtIteration(iter)       // Extract and remove data for exact iteration
  extractBelowIteration(iter)    // Extract and remove data below iteration

  flushAtIteration(iter, board)  // Inject pending data into board's changeList
}
```

### The "Flush" Mechanism

To maintain correct progress bars and histograms, we don't mark all precomputed points as "done" instantly. Instead, we simulate their discovery.

The `PrecomputedPoints` class organizes data into a `rangeMap` keyed by iteration count. As the compute engine progresses through iterations (1, 2, ... N), it calls `flushAtIteration(N)`.

## 4. CPU Board Integration

For CPU boards (`CpuBoard`, `QDCpuBoard`, `DDZhuoranBoard`, `QDZhuoranBoard`), the pattern is:

**Constructor:**
```javascript
constructor(k, size, re, im, config, id, inheritedData = null) {
  super(k, size, re, im, config, id, inheritedData);
  // ...
  // Skip precomputed pixels when building active list
  if (!this.precomputed || !this.precomputed.isPrecomputed(index)) {
    this.activeList.push(index);
  }
}
```

**iterate():**
```javascript
iterate(targetIters) {
  for (let batch = 0; batch < targetIters && this.un > 0; batch++) {
    // ... compute pixels ...

    // Flush precomputed points at this iteration
    if (this.precomputed) {
      this.precomputed.flushAtIteration(this.it, this);
    }

    this.it++;
    this.queueChanges(changes);
  }
}
```

## 5. GPU Board Integration

For GPU boards (`GpuBoard`, `GpuZhuoranBoard`, `AdaptiveGpuBoard`), the flow is more complex:

### Buffer Initialization
```javascript
// Skip precomputed pixels when populating GPU buffer
const precomputedCount = this.precomputed?.getPrecomputedCount() || 0;
const activePixelCount = dimsArea - precomputedCount;
const bufferSize = Math.max(BYTES_PER_PIXEL, activePixelCount * BYTES_PER_PIXEL);

for (let i = 0; i < dimsArea; i++) {
  if (this.precomputed?.isPrecomputed(i)) continue;
  // Add to GPU buffer...
}
```

### Visual Continuity (Merge Strategy)

GPU boards compute in batches (e.g., 1000 iterations at a time). If we simply flushed precomputed points at their exact iterations (e.g., 50, 150), but the GPU reported results at iteration 1000, the histogram would show "stripes" of different colors.

To prevent this, GPU boards use a **Merge Strategy**:
1.  Collect all GPU results for a batch
2.  Identify the *minimum* iteration returned by the GPU (`minGpuIter`)
3.  Extract all precomputed points with `iter < minGpuIter`
4.  Report precomputed points *as if* they completed at `minGpuIter`

This ensures that precomputed pixels and GPU-computed pixels share the same "fractional iteration" in the histogram, blending seamlessly without visual artifacts.

### Edge Cases

**All pixels precomputed (no GPU work):**
When `activePixelCount === 0`, the GPU has nothing to compute. The board immediately flushes all precomputed points at their actual iterations.

**Deep interior (slow GPU progress):**
In deep interior regions, GPU may run many iterations before any pixel finishes. Precomputed points wait until the first GPU result, then are flushed together.

**Precomputed at high iterations:**
After GPU finishes all work but precomputed points remain at high iterations, they are flushed at their actual iterations.

## 6. Invariants

The implementation maintains these invariants:

1. **Monotonic iteration reporting**: Pixels are reported in non-decreasing iteration order
2. **Each pixel reported exactly once**: Every pixel index appears in exactly one changeList entry
3. **Consistent histogram**: At each iteration, all reported pixels share the same fracK value (no stripes)
4. **Accurate progress tracking**: `un` correctly reflects remaining work including pending precomputed

## 7. Debug Features

### URL Parameters

- `?inherit=1` (default): Enable inheritance
- `?inherit=0`: Disable inheritance for A/B comparison
- `?debug=inherit`: Enable debug logging and pink flash visualization

### Pink Flash Visualization

When `debug=inherit` is set, inherited pixels are briefly drawn in pink/magenta before computation begins:
- **Hot pink (#ff69b4)**: Diverged pixels
- **Magenta (#ff00ff)**: Converged pixels

This helps visualize which pixels are being inherited from the parent view.

## 8. Performance

### Expected Improvement

- **Typical case**: 50-70% of child pixels inherited
- **Best case** (deep in cardioid): 80-90% inherited
- **Worst case** (chaotic boundary): <10% inherited

### Memory Efficiency

The sparse TypedArray format is efficient:
- Only inherited pixels are stored (not full arrays)
- TypedArrays reduce GC pressure vs objects
- At 5x zoom with 70% inheritance: ~70% reduction in compute work

## Summary

| Step | Action |
| :--- | :--- |
| **Grid** | Calculates `diverged` and `converged` arrays using 3x3 safety check |
| **Worker** | Receives arrays, initializes `PrecomputedPoints` with TypedArrays |
| **Compute** | Runs normally (GPU/CPU), skipping precomputed pixels |
| **Flush** | At iteration `N`, `PrecomputedPoints` injects known results |
| **Result** | User sees a mix of computed and inherited pixels, seamless and fast |

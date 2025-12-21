# Precomputed Inheritance

One of the most significant optimizations in the explorer is **Precomputed Inheritance**. When zooming in, the new "child" view often overlaps significantly with the "parent" view. Instead of re-calculating every pixel from scratch, we can mathematically prove that certain pixels in the new view *must* have the same value as corresponding pixels in the parent view.

This document explains the logic, safety checks, and data structures involved in this optimization.

## The Core Concept

When a user zooms in, the new viewport is a subset of the previous viewport (scaled up).

1.  **Mapping**: For every pixel in the new (child) view, we calculate its complex coordinate `c`.
2.  **Lookup**: We find which pixel in the old (parent) view corresponds to `c`.
3.  **Safety Check**: If the parent pixel and its neighbors are "stable" (uniform), we inherit the result.
4.  **Pre-filling**: These inherited results are stored as "Precomputed Points" and injected into the calculation engine, skipping the expensive GPU/CPU work for those specific points.

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

### For Diverged Points (Outside the Set)
If the central parent pixel escaped at iteration `N`, we inherit this value **only if** all 8 neighbors also escaped at exactly iteration `N`. This implies we are in a solid band of color (a "dwelling"), far from the chaotic boundary.

### For Converged Points (Inside the Set)
If the central parent pixel converged to a cycle, we inherit **only if**:
1.  All 8 neighbors also converged.
2.  All 8 neighbors have the same **Period**.

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

### Sparse Storage
We do not store a full grid. Instead, we use **TypedArrays** to store only the known values:

*   `dIndices`: Array of pixel indices for diverged points.
*   `cIndices`: Array of pixel indices for converged points.
*   `cP`: Array of period values (absolute iterations) for converged points.
*   `cZ`: Array of final `z` coordinates (for resuming perturbation).

### The "Flush" Mechanism
To maintain correct progress bars and histograms, we don't mark all precomputed points as "done" instantly. Instead, we simulate their discovery.

The `PrecomputedPoints` class organizes data into a `rangeMap` keyed by iteration count. As the CPU compute engine progresses through iterations (1, 2, ... N), it calls `flushAtIteration(N)`.

### Visual Continuity (GPU Boards)
GPU boards compute in batches (e.g., 1000 iterations at a time). If we simply flushed precomputed points at their exact iterations (e.g., 50, 150), but the GPU reported results at iteration 1000, the histogram would show "stripes" of different colors (one from the exact precomputed value, one from the GPU's batch).

To prevent this, GPU boards use a **Merge Strategy**:
1.  They collect all GPU results for a batch.
2.  They identify the *minimum* iteration returned by the GPU (`minGpuIter`).
3.  They extract all precomputed points with `iter < minGpuIter`.
4.  These precomputed points are reported *as if* they completed at `minGpuIter`.

This ensures that precomputed pixels and GPU-computed pixels share the same "fractional iteration" in the histogram, blending seamlessly without visual artifacts.

## 4. Integration with GPU Boards

For `GpuBoard` and `GpuZhuoranBoard`, the flow is:

1.  **Initialize**: The board receives `inheritedData`. `PrecomputedPoints` is created.
2.  **Compaction**: The GPU typically computes in batches (active pixels only).
3.  **Flushing**: After each batch (e.g., every 1000 iterations), the board calls `precomputed.flushUpToIteration(currentIter)`.
4.  **Completion**: If the GPU finishes its work but precomputed points remain (e.g., points that escape at iteration 1,000,000), the board calls `getPendingIterations()` and flushes the rest.

### Handling "Pending Reports"
A recent regression involved accessing the internal `rangeMap` directly. The correct API is `getPendingIterations()`, which returns a sorted list of iterations that have stored data waiting to be released. This abstraction allows the underlying storage to change (e.g., from Map to Array) without breaking the compute boards.

## Summary

| Step | Action |
| :--- | :--- |
| **Grid** | Calculates `diverged` and `converged` arrays using 3x3 safety check. |
| **Worker** | Receives arrays, initializes `PrecomputedPoints`. |
| **Compute** | Runs normally (GPU/CPU). |
| **Inject** | At iteration `N`, `PrecomputedPoints` injects known results for `N`. |
| **Result** | User sees a mix of computed and inherited pixels, seamless and fast. |

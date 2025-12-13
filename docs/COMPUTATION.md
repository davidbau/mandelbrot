# Computation Architecture

How work is distributed across threads and GPUs, and how results flow back to create the final image.

## The Three-Tier Pipeline

The application uses a three-tier pipeline to keep the UI responsive while performing heavy calculations.

```
┌──────────────────────────────────────────────────────────────────────┐
│                             MAIN THREAD                              │
│                                                                      │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Grid    │  │ Scheduler │  │    View     │  │     Canvas      │  │
│  │ (manages  │─►│ (assigns  │  │  (pixels,   │─►│    (display)    │  │
│  │  views)   │  │  work)    │  │  histogram) │  │                 │  │
│  └───────────┘  └─────┬─────┘  └──────▲──────┘  └─────────────────┘  │
│                       │               │                              │
└───────────────────────┼───────────────┼──────────────────────────────┘
                        │               │
     createBoard        │               │  changeList
     {k, size, re, im}  │               │  {nn, vv}
                        ▼               │
┌──────────────────────────────────────────────────────────────────────┐
│                            WEB WORKERS                               │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                           Board                                │  │
│  │                                                                │  │
│  │  Arrays:  nn (iterations)  pp (periods)  zz (current z)        │  │
│  │           cc (c values)    bb (checkpoints)                    │  │
│  │                                                                │  │
│  │  Perturbation (deep zoom):  dc, dz, refIter, refOrbit          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                     │                                                │
│       GPU available │                                                │
│                     ▼                                                │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                        GpuBoard                                │  │
│  │                                                                │  │
│  │  Buffers:  iterations (read/write)    staging (for readback)   │  │
│  │            zValues, cValues           uniforms (params)        │  │
│  └────────────────────────┬───────────────────────────────────────┘  │
│                           │                                          │
└───────────────────────────┼──────────────────────────────────────────┘
                            │
       dispatch + readback  │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                           GPU SHADER                                 │
│                                                                      │
│  @compute @workgroup_size(64)                                        │
│  fn main(index):                                                     │
│      if iterations[index] != 0: return     // skip finished          │
│      z = zValues[index]                                              │
│      for batch_size iterations:                                      │
│          z = z^2 + c                                                 │
│          if |z| > 2: iterations[index] = i; return                   │
│      zValues[index] = z                    // continue next batch    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

A 'workgroup' is a batch of threads (64 in this case) that execute in parallel on the GPU. The workgroup size is a key parameter for tuning GPU performance, and 64 is a common, effective choice.

**Data flow summary:**
- **Main → Worker:** `createBoard` message with coordinates and size.
- **Worker → GPU:** Buffer writes (initial `z` and `c` values) and compute shader dispatches.
- **GPU → Worker:** Buffer readbacks with computed iteration counts.
- **Worker → Main:** `changeList` messages with batches of newly finished pixels.

## Sparse, Infinite Computation

The explorer computes "infinitely," refining the image as long as you watch. This is made practical by **sparse computation**. After the first pass, most pixels are already "finished" (diverged or converged). The computation engine then focuses only on the remaining "unknown" pixels. Without sparsity, computing one million iterations for a one-megapixel image would require 10^12 operations. With sparsity, if 90% of pixels are done by iteration 1000, the next million iterations cost only 10^11 operations for the remaining 100,000 active pixels.

## Board Lifecycle

A "Board" is the computational unit for a single zoom level. It lives in a Web Worker and owns all the data and logic for its view.

### Creation
When you click to zoom, the `Scheduler` picks a worker and sends a `createBoard` message. The worker then instantiates the appropriate Board type based on pixel size (smaller = deeper zoom).

#### GPU Board Selection

| Pixel Size | Zoom Level | Board | Precision |
|------------|------------|-------|-----------|
| > 1e-7 | < ~10⁷ | `GpuBoard` | float32 (~7 digits) direct iteration |
| 1e-30 to 1e-7 | ~10⁷ to ~10³⁰ | `GpuZhuoranBoard` | float32 perturbation, quad reference |
| < 1e-30 | > ~10³⁰ | `AdaptiveGpuBoard` | float32 perturbation, oct reference, adaptive per-pixel scaling |

#### CPU Fallback (no GPU available)

| Pixel Size | Zoom Level | Board | Precision |
|------------|------------|-------|-----------|
| > 1e-15 | < ~10¹⁵ | `CpuBoard` | float64 (~15 digits) direct iteration |
| 1e-30 to 1e-15 | ~10¹⁵ to ~10³⁰ | `PerturbationBoard` | float64 perturbation, quad reference |
| < 1e-30 | > ~10³⁰ | `OctZhuoranBoard` | float64 perturbation, oct reference |

The GPU thresholds are lower than CPU because `float32` has ~7 decimal digits vs `float64`'s ~15 digits. At deep zooms (> 10³⁰), `AdaptiveGpuBoard` uses adaptive per-pixel scaling to correctly detect escape even when the scale exponent exceeds float32's range.

## Data Structures
Each Board maintains several `TypedArray`s for performance. These map directly to GPU buffers and are much faster to iterate than standard JavaScript objects.

| Array | Type    | Purpose                                                     |
|-------|---------|-------------------------------------------------------------|
| `nn`  | Int32   | Iteration count. 0=unknown, >0=diverged, <0=converged.        |
| `pp`  | Int32   | Period of convergence (for `nn < 0` pixels).                |
| `cc`  | Float64 | The complex value `c` for each pixel.                       |
| `zz`  | Float64 | The current `z` value for each pixel.                       |

The `pp` array lives only in the worker. When a pixel's convergence is reported to the main thread, its period is sent as part of the `changeList` and stored in the `View`'s `convergedData` map.

### Perturbation Arrays (Deep Zoom)

| Array | Type | Purpose |
|-------|------|---------|
| `dc` | Float64 | Delta c from reference point |
| `dz` | Float64 | Current perturbation delta |
| `refIter` | Int32 | Which reference iteration each pixel follows |
| `refOrbit` | Float64×4 | Quad precision reference orbit values |

### Compaction

As pixels finish, boards "compact" to only track active pixels:

```javascript
compact() {
  // When more than half are done, rebuild active list
  if (this.un < this.pixelIndexes.length / 2) {
    this.pixelIndexes = this.pixelIndexes.filter(i => this.nn[i] === 0);
  }
}
```

This keeps memory usage reasonable and iteration loops tight.

## Worker Pool and Load Balancing

The `Scheduler` maintains a pool of Web Workers to compute multiple zoom levels in parallel. The pool size matches CPU core count (up to 8) to maximize throughput without oversubscription:

```javascript
class Scheduler {
  constructor() {
    this.numWorkers = Math.min(navigator.hardwareConcurrency || 4, 8);
    this.workers = [];
    this.workerBoards = new Map(); // worker -> Set of board keys
  }
}
```

If one worker finishes its board early while another is still busy, the Scheduler can transfer boards between them to balance the load.

## GPU Computation Strategy

### Dynamic Batch Size Tuning
The number of iterations per GPU batch is tuned dynamically to balance efficiency (favoring large batches) and UI responsiveness (requiring frequent updates). The formula `iterationsPerBatch = 1,111,211 / active_pixels` targets about 1 million pixel-iterations per batch. The target of ~1.1 million pixel-iterations was found empirically to be a sweet spot that balances GPU throughput with the overhead of launching a new compute pass.
- With **500,000 active pixels**, batches are tiny (~2 iterations), providing rapid UI updates.
- With **1,000 active pixels**, batches are large (~1000 iterations), maximizing GPU throughput.
This automatically shifts priority from responsiveness to throughput as the image fills in.

### Change Lists and View Updates

To minimize data transfer, workers send a `changeList` containing only the pixels that finished in the last batch. The format groups pixels by iteration:

```javascript
changeList: [
  {
    iter: 1000,              // Iteration count when these pixels finished
    nn: [index1, index2],    // Pixel indices that diverged
    vv: [                    // Pixels that converged
      { index: i1, z: [re, im], p: period1 },
      { index: i2, z: [re, im], p: period2 }
    ]
  },
  { iter: 1001, nn: [...], vv: [...] }
]
```

On the main thread, `updateViewFromWorkerResult` applies these sparse changes:

```javascript
updateFromWorkerResult(data) {
  for (const { nn, vv, iter } of data.changeList) {
    // Mark diverged pixels with positive iteration count
    for (const index of nn) {
      this.nn[index] = iter;
    }
    // Mark converged pixels with negative iteration count
    for (const { index, z, p } of vv) {
      this.nn[index] = -iter;
      this.convergedData.set(index, { z, p });
    }
    this.updateHistogram(data.un, data.di, iter);
  }
}
```

The View's `nn` array uses sign to distinguish pixel states: `nn[i] > 0` means diverged, `nn[i] < 0` means converged, `nn[i] === 0` means still computing.

## The Quad-Precision Compositing Problem
A subtle but critical challenge arises when drawing a new, high-zoom view on top of its parent. At a zoom of 10^25, the child view's center might differ from the parent's by only 10^-20. Standard `Float64` precision is only ~10^-15. Subtracting the two centers to find the offset would result in zero—an effect called **catastrophic cancellation**.

It's like trying to measure the thickness of a single sheet of paper by subtracting the height of a 1000-page book from the height of a 1001-page book. If your ruler's markings are wider than the paper's thickness, the measured difference is zero.

The solution is to perform the coordinate mapping calculations in quad precision. Even though the final result is a screen-space pixel coordinate, the intermediate steps must preserve the tiny differences.

```javascript
calculateParentMapping() {
  // All subtractions and scaling are done with quad-precision functions
  // until the final conversion to screen coordinates.
  AqdAdd(temp, 0, childCenterR_quad, childCenterR_quad_err,
                 -parentCenterR_quad, -parentCenterR_quad_err);
  const offset_quad = [temp[0], temp[1]];
  const sx = (offset_quad[0] / parentSize) * dimsWidth;
  // ...
}
```
By using quad-precision math for the intermediate subtractions, we avoid catastrophic cancellation and ensure the child view is positioned with sub-pixel accuracy.

## Next Steps

- [ALGORITHMS.md](ALGORITHMS.md): The mathematical algorithms inside the boards.
- [ARCHITECTURE.md](ARCHITECTURE.md): The overall application structure.
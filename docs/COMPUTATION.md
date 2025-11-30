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
When you click to zoom, the `Scheduler` picks a worker and sends a `createBoard` message. The worker then instantiates the appropriate Board type:

- **GPU enabled:** `GpuBoard` for shallow zooms (`pixelSize` > 1e-6) or `GpuZhuoranBoard` for deep zooms (`pixelSize` <= 1e-6).
- **CPU fallback:** `CpuBoard` for shallow zooms (`pixelSize` > 1e-12) or `PerturbationBoard` for deep zooms (`pixelSize` <= 1e-12).

The thresholds differ because GPUs use `float32` (losing precision around 10^-6), while CPUs use `float64` (reliable to about 10^-15).

## Data Structures
Each Board maintains several `TypedArray`s for performance. These map directly to GPU buffers and are much faster to iterate than standard JavaScript objects.

| Array | Type    | Purpose                                                     |
|-------|---------|-------------------------------------------------------------|
| `nn`  | Int32   | Iteration count. 0=unknown, >0=diverged, <0=converged.        |
| `pp`  | Int32   | Period of convergence (for `nn < 0` pixels).                |
| `cc`  | Float64 | The complex value `c` for each pixel.                       |
| `zz`  | Float64 | The current `z` value for each pixel.                       |

The `pp` array lives only in the worker. When a pixel's convergence is reported to the main thread, its period is sent as part of the `changeList` and stored in the `View`'s `convergedData` map.

## Worker Pool and Load Balancing
The `Scheduler` maintains a pool of Web Workers, typically matching the CPU core count. This allows multiple zoom levels to be computed in parallel. If one worker finishes its board early while another is still busy, the Scheduler can transfer boards between them to balance the load and maximize throughput.

## GPU Computation Strategy

### Dynamic Batch Size Tuning
The number of iterations per GPU batch is tuned dynamically to balance efficiency (favoring large batches) and UI responsiveness (requiring frequent updates). The formula `iterationsPerBatch = 1,111,211 / active_pixels` targets about 1 million pixel-iterations per batch.
- With **500,000 active pixels**, batches are tiny (~2 iterations), providing rapid UI updates.
- With **1,000 active pixels**, batches are large (~1000 iterations), maximizing GPU throughput.
This automatically shifts priority from responsiveness to throughput as the image fills in.

### Change Lists and View Updates
To minimize data transfer, workers send a `changeList` containing only the pixels that finished in the last batch. On the main thread, `updateViewFromWorkerResult` applies these sparse changes to the `View`'s local data and updates the color histogram.

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
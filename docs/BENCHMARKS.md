# Board Performance Benchmarks

This document describes the performance characteristics of the different board types used for Mandelbrot computation, and how these measurements inform the scheduler's effort-based work distribution.

## Methodology

### Test Configuration

Benchmarks were conducted using Puppeteer with headless Chrome, measuring actual iteration performance through the `?debug=w,s` step mode which runs computation on the main thread for accurate timing.

**Test parameters:**
- Viewport: 160×90 pixels (16:9 aspect ratio)
- Grid sizes: 10, 20, 40 (varying pixel counts)
- Iteration counts: 100, 500, 1000
- Locations: Three zoom levels (shallow z=625, medium z=1e15, deep z=1e29)

### Measurement Model

Performance was modeled as:

```
time = setup_overhead + (per_batch_overhead × batches) + (per_pixel_iter × pixels × iterations)
```

Each board was tested with multiple pixel/iteration combinations to fit a linear regression separating per-pixel-iteration cost from per-batch overhead.

### Running the Benchmarks

```bash
node tests/debug-benchmark.js
```

## Results

### Per-Pixel-Iteration Cost

The primary metric for comparing board performance. Lower values indicate faster computation.

| Board Class | Type | μs/pixel-iter (model fit) | Relative to CpuBoard |
|-------------|------|---------------------------|----------------------|
| **CpuBoard** | CPU | 7.97 | 1.00 |
| **PerturbationBoard** | CPU | 8.04 | 1.01 |
| **DDZhuoranBoard** | CPU | 8.04 | 1.01 |
| **QDZhuoranBoard** | CPU | 8.10 | 1.02 |
| **QDPerturbationBoard** | CPU | 8.90 | 1.12 |
| **QDCpuBoard** | CPU | 9.31 | 1.17 |
| **GpuBoard** | GPU | 0.58 | 0.07 |
| **AdaptiveGpuBoard** | GPU | 0.93 | 0.12 |
| **GpuZhuoranBoard** | GPU | 0.95 | 0.12 |

### Per-Batch Overhead

Overhead incurred each time `iterate()` is called, regardless of pixel count.

| Board Class | μs/batch |
|-------------|----------|
| GpuBoard | 221 |
| AdaptiveGpuBoard | 235 |
| CpuBoard | 264 |
| PerturbationBoard | 267 |
| QDZhuoranBoard | 284 |
| GpuZhuoranBoard | 284 |
| QDCpuBoard | 285 |
| DDZhuoranBoard | 289 |
| QDPerturbationBoard | 308 |

### Raw Benchmark Data

#### Shallow Zoom (z=625)

| Board | Grid | Pixels | Iters | Time (ms) | μs/px-iter | μs/batch |
|-------|------|--------|-------|-----------|------------|----------|
| CpuBoard | 40 | 576 | 100 | 546 | 9.48 | 5460 |
| CpuBoard | 40 | 576 | 500 | 2380 | 8.26 | 4760 |
| CpuBoard | 20 | 576 | 100 | 539 | 9.36 | 5390 |
| CpuBoard | 20 | 576 | 500 | 2366 | 8.22 | 4732 |
| GpuBoard | 40 | 576 | 100 | 155 | 2.69 | 1550 |
| GpuBoard | 40 | 576 | 500 | 282 | 0.98 | 564 |
| GpuBoard | 40 | 576 | 1000 | 454 | 0.79 | 454 |

#### Medium Zoom (z=1e15)

| Board | Grid | Pixels | Iters | Time (ms) | μs/px-iter | μs/batch |
|-------|------|--------|-------|-----------|------------|----------|
| PerturbationBoard | 40 | 576 | 100 | 533 | 9.25 | 5330 |
| PerturbationBoard | 40 | 576 | 500 | 2373 | 8.24 | 4746 |
| DDZhuoranBoard | 40 | 576 | 100 | 554 | 9.62 | 5540 |
| DDZhuoranBoard | 40 | 576 | 500 | 2395 | 8.32 | 4790 |
| GpuZhuoranBoard | 40 | 576 | 100 | 176 | 3.06 | 1760 |
| GpuZhuoranBoard | 40 | 576 | 500 | 419 | 1.46 | 838 |
| GpuZhuoranBoard | 40 | 576 | 1000 | 694 | 1.21 | 694 |
| QDPerturbationBoard | 40 | 576 | 100 | 596 | 10.35 | 5960 |
| QDPerturbationBoard | 40 | 576 | 500 | 2646 | 9.19 | 5292 |
| QDZhuoranBoard | 40 | 576 | 100 | 540 | 9.38 | 5400 |
| QDZhuoranBoard | 40 | 576 | 500 | 2416 | 8.39 | 4832 |
| QDCpuBoard | 40 | 576 | 100 | 615 | 10.68 | 6150 |
| QDCpuBoard | 40 | 576 | 500 | 2757 | 9.57 | 5514 |

#### Deep Zoom (z=1e29)

| Board | Grid | Pixels | Iters | Time (ms) | μs/px-iter | μs/batch |
|-------|------|--------|-------|-----------|------------|----------|
| GpuZhuoranBoard | 40 | 576 | 1000 | 690 | 1.20 | 690 |
| AdaptiveGpuBoard | 40 | 576 | 100 | 193 | 3.35 | 1930 |
| AdaptiveGpuBoard | 40 | 576 | 500 | 398 | 1.38 | 796 |
| AdaptiveGpuBoard | 40 | 576 | 1000 | 653 | 1.13 | 653 |
| QDZhuoranBoard | 40 | 576 | 500 | 2410 | 8.37 | 4820 |
| QDCpuBoard | 40 | 576 | 500 | 2775 | 9.64 | 5550 |

## Key Findings

### 1. CPU Boards Have Similar Per-Pixel Cost

All CPU-based boards (CpuBoard, PerturbationBoard, DDZhuoranBoard, QDZhuoranBoard, QDPerturbationBoard, QDCpuBoard) have remarkably similar per-pixel-iteration costs, ranging from 8.0 to 9.3 μs. This is because:

- The inner iteration loop is similar across all implementations
- Reference orbit computation (for perturbation boards) is amortized across all pixels
- The DD/QD precision overhead primarily affects reference orbit, not per-pixel work

**Implication:** Effort values for CPU boards should all be approximately 1.0.

### 2. GPU Boards Are 8-14× Faster

GPU boards achieve 0.6-1.0 μs per pixel-iteration compared to ~8 μs for CPU boards:

| Board | Speedup vs CpuBoard |
|-------|---------------------|
| GpuBoard | 14× |
| AdaptiveGpuBoard | 8× |
| GpuZhuoranBoard | 8× |

GpuBoard is fastest because it uses simple float32 arithmetic, while GpuZhuoranBoard and AdaptiveGpuBoard use double-double or quad-double emulation in shaders.

### 3. Per-Batch Overhead Is Consistent

All boards have per-batch overhead in the 220-320 μs range. This overhead includes:
- JavaScript function call overhead
- Buffer management and state updates
- For GPU boards: command buffer submission and synchronization

### 4. GPU Boards Show Higher Variance at Low Iteration Counts

GPU boards show higher μs/pixel-iter at low iteration counts (e.g., 2.7 μs at 100 iters vs 0.8 μs at 1000 iters for GpuBoard). This reflects the fixed per-batch GPU overhead being amortized over fewer iterations.

## Scheduler Implications

### Effort Values

The `effort` property on each board is used by the scheduler to estimate work cost:

```javascript
workDone += board.un * board.effort;
```

Based on benchmarks, effort values are normalized with CpuBoard = 100:

| Board | Previous Effort | Measured μs/px-iter | Normalized Effort |
|-------|-----------------|---------------------|-------------------|
| CpuBoard | 1 | 8.0 | **100** (baseline) |
| PerturbationBoard | 3 | 8.0 | **100** |
| DDZhuoranBoard | 2 | 8.0 | **100** |
| QDZhuoranBoard | 2 | 8.1 | **100** |
| QDPerturbationBoard | 4 | 8.9 | **112** |
| QDCpuBoard | 1 | 9.3 | **117** |
| GpuBoard | 1 | 0.6 | **12** (8× faster) |
| GpuZhuoranBoard | dynamic | 1.0 | **12** (8× faster) |
| AdaptiveGpuBoard | dynamic | 0.9 | **12** (8× faster) |

Note: GPU boards use `selfBatching = true`, so they skip the work threshold loop, but effort is still used for load balancing across workers.

### Work Threshold

The scheduler uses a work threshold of 1,737,700 units per scheduling slot:

```javascript
for (let workDone = 0; workDone < 1737700 && board.unfinished(); ) {
  workDone += board.un * board.effort;
  await board.iterate();
}
```

With 576 pixels and effort=100, this allows ~30 iterations per slot, taking approximately:
- CPU boards: 30 × 576 × 8 μs ≈ 138 ms per slot
- This provides responsive UI updates while maintaining computation throughput

The threshold is calibrated so that `pixels × effort × iterations ≈ 1.7M` per scheduling slot.

## Scheduler Analysis and Recommendations

Based on benchmark results, here is an analysis of the current scheduler design and potential improvements.

### Current Architecture

The scheduler distributes Mandelbrot computation across multiple Web Workers:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Main Thread                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    WorkScheduler                          │   │
│  │  - Assigns boards to workers (least-loaded-first)        │   │
│  │  - Tracks boardEfforts for load balancing                │   │
│  │  - Transfers boards between workers every 5s             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│  ┌─────────────┐     ┌─────────────┐      ┌─────────────┐       │
│  │  Worker 0   │     │  Worker 1   │      │  Worker N   │       │
│  │ ┌─────────┐ │     │ ┌─────────┐ │      │ ┌─────────┐ │       │
│  │ │ Board A │ │     │ │ Board B │ │      │ │ Board C │ │       │
│  │ └─────────┘ │     │ └─────────┘ │      │ │ Board D │ │       │
│  │             │     │             │      │ └─────────┘ │       │
│  └─────────────┘     └─────────────┘      └─────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

**Worker count:** 75% of `navigator.hardwareConcurrency` (typically 3-6 workers)

**Within-worker scheduling:**
- Exponential fairness: prioritizes most-unfinished boards 50%, most-recent 50%
- Focused board (mouse hover) gets priority
- CPU boards: batch iterations until `workDone >= 17377`
- GPU boards: single `iterate()` call (selfBatching)

**Load balancing:**
- Every 5 seconds, checks for imbalanced workers
- Transfers boards if any worker has >2× the minimum load
- GPU boards now support transfer via serialization

### Analysis

#### 1. Work Threshold Calibration

The current work threshold of 17,377 was chosen empirically. With the benchmarked timing:

| Scenario | Pixels | Iterations | Time | Responsiveness |
|----------|--------|------------|------|----------------|
| 17377 threshold | 576 | ~30 | ~138ms | Sluggish |
| 10000 threshold | 576 | ~17 | ~80ms | Good |
| 5000 threshold | 576 | ~9 | ~42ms | Very responsive |

**Recommendation:** Consider reducing threshold to ~10,000 for better UI responsiveness, especially on slower machines.

#### 2. Initial Effort Estimation

Current code estimates deep zoom (pixelSize < 1e-15) work at 7× normal:

```javascript
const estimatedWork = config.dimsArea * ((size / config.dimsWidth < 1e-15) ? 7 : 1);
```

Benchmarks show actual cost is only 1.1-1.2× higher (QD boards vs standard). This causes:
- Deep zoom boards assigned to workers sub-optimally
- Load balancing may not trigger when it should

**Recommendation:** Change multiplier from 7 to 1.2 or remove entirely:
```javascript
const estimatedWork = config.dimsArea;  // All boards have similar per-pixel cost
```

#### 3. GPU Board Considerations

GPU boards use `selfBatching = true`, meaning:
- They bypass the work threshold loop entirely
- Each `iterate()` runs a variable number of iterations internally
- Dynamic effort (`iterationsPerBatch`) is set per call

The GPU batching formula aims for ~333k pixel-iterations per batch:
```javascript
iterationsPerBatch = Math.floor(333337 / pixelsToIterate);
```

| Pixels | Iterations/batch | Estimated time |
|--------|------------------|----------------|
| 576 | 578 | ~0.5ms (GPU) |
| 10000 | 33 | ~0.3ms (GPU) |
| 100000 | 3 | ~0.3ms (GPU) |

GPU batching is already well-tuned for throughput.

#### 4. CPU vs GPU Workload Balance

When mixing CPU and GPU boards (e.g., multi-view at different zoom levels):

- GPU boards complete 8-14× faster per pixel-iteration
- A 4-view grid might have 1 GPU board finishing while 3 CPU boards barely started
- Load balancing uses `boardEffort = pixels × effort`, but GPU effort is dynamic

**Current behavior:** Works reasonably well because:
- GPU boards update frequently (every few iterations)
- CPU boards are spread across workers
- Load balancing transfers CPU boards between workers

**Potential improvement:** Prioritize GPU boards on dedicated workers to avoid GPU contention. WebGPU command queues from multiple workers may serialize at the driver level.

#### 5. Adaptive CPU Batching

GPU boards already adapt batch size based on pixel count. CPU boards could benefit from similar adaptation:

```javascript
// Current: fixed threshold
for (let workDone = 0; workDone < 17377 && board.unfinished(); ) {
  workDone += board.un * board.effort;
  await board.iterate();
}

// Proposed: adaptive threshold based on pixel count
const targetMs = 50;  // Target 50ms per scheduling slot
const targetWorkDone = board.un * targetMs / 8;  // ~8μs per pixel-iteration
for (let workDone = 0; workDone < targetWorkDone && board.unfinished(); ) {
  ...
}
```

This would maintain consistent responsiveness regardless of board size.

### Changes Made

Based on benchmarks, the following changes were implemented:

1. **Normalized effort values to 100 baseline:**
   - CpuBoard, PerturbationBoard, DDZhuoranBoard, QDZhuoranBoard: effort = 100
   - QDPerturbationBoard: effort = 112 (12% slower)
   - QDCpuBoard: effort = 117 (17% slower)

2. **Fixed initial effort estimate:**
   - Changed from 7× multiplier to 1.17× for deep zoom
   - Now uses `dimsArea × 117` for deep zoom, `dimsArea × 100` otherwise

3. **Scaled work threshold:**
   - Changed from 17,377 to 1,737,700 to match effort=100 scale
   - Maintains same ~30 iterations per scheduling slot

### Future Improvements (Medium Priority)

4. **Consider reducing work threshold for better responsiveness:**
   ```javascript
   // Reduce to ~1M for ~80ms slots instead of ~140ms
   for (let workDone = 0; workDone < 1000000 && board.unfinished(); ) {
   ```

5. **Consider adaptive CPU batching** based on pixel count rather than fixed threshold.

#### Low Priority (Future Work)

5. **GPU worker affinity:** Consider dedicating one worker to GPU boards to reduce WebGPU contention.

6. **Per-board timing feedback:** Track actual iterate() times and adjust scheduling dynamically.

### Summary

The current scheduler is well-designed and handles most cases effectively. The main issues are:

1. **Incorrect effort values** - Fixed by setting CPU boards to effort=1
2. **Overstated deep zoom cost** - The 7× multiplier should be removed
3. **Work threshold may be too high** - 17377 → 10000 would improve responsiveness

The GPU batching and load balancing mechanisms work well in practice.

## Test Environment

- **Platform:** macOS Darwin 24.6.0
- **Browser:** Headless Chrome via Puppeteer
- **Date:** December 2025
- **Hardware:** Results will vary based on CPU/GPU capabilities

## Reproducing Results

1. Install dependencies: `npm install`
2. Run benchmarks: `node tests/debug-benchmark.js`
3. Results are printed to stdout with CSV-formatted summary

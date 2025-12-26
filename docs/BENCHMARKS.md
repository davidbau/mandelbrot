# Board Performance Benchmarks

This document describes the performance characteristics of the different board types used for Mandelbrot computation, and how these measurements inform the scheduler's effort-based work distribution.

## Methodology

### Test Configuration

Benchmarks were conducted using Puppeteer with headless Chrome, measuring actual iteration performance through the `?debug=t,r` timing mode which runs computation with randomized batch sizes for regression analysis.

**Test parameters:**
- Viewport: 800×450 pixels (16:9 aspect ratio)
- Grid size: 1 (full viewport per board)
- Pixel ratios: 6-8 for GPU boards, 2 for CPU boards
- Runs: 3 per board/location combination
- Locations: 3 shallow zoom locations

### Measurement Model

Performance was modeled using Non-Negative Least Squares (NNLS) regression with a shared batch overhead across all boards:

```
time = batch_OH + iter_OH × iters + board_OH × boardSize + activePx_OH × pixels + compute × pixels × iters
```

Where:
- **batch_OH**: Shared per-batch overhead (GPU command submission)
- **iter_OH**: Per-iteration overhead (reference orbit computation for Zhuoran boards)
- **board_OH**: Per-board-pixel overhead (GPU buffer transfer, scales with total buffer size)
- **activePx_OH**: Per-active-pixel overhead (JavaScript processing, GPU board only)
- **compute**: Per-pixel-iteration cost (actual shader/CPU computation)

### Running the Benchmarks

```bash
# Run benchmarks
node tests/benchmark-shallow.js

# Analyze results
node tests/analyze-benchmark.js
```

Results are saved to `tests/benchmark-results/` as JSONL for accumulation across runs.

## Results (December 2025)

### Regression Model (R² = 0.98)

| Board | Batch OH | Iter OH | Board OH | Active px OH | Compute | R² |
|-------|----------|---------|----------|--------------|---------|-----|
| | (μs) | (μs/iter) | (ns/board-px) | (ns/px) | (ns/px-iter) | |
| **cpu** | 1,681 | 0 | 0 | - | 4.39 | 0.95 |
| **gpu** | 1,681 | 0 | 3.9 | 19.0 | 0.20 | 0.92 |
| **gpuz** | 1,681 | 812 | 14.0 | - | 0.41 | 0.82 |
| **adaptive** | 1,681 | 699 | 15.0 | - | 0.43 | 0.81 |
| **ddz** | 1,681 | 0 | 0 | - | 19.6 | 0.997 |
| **qdz** | 1,681 | 0 | 0 | - | 21.0 | 0.996 |
| **qdcpu** | 1,681 | 51,660 | 20.0 | - | 493 | 0.99 |

**Note on PerturbationBoard and QDPerturbationBoard:** These boards have complex reference orbit behavior that doesn't fit the linear model well (R² ≈ 0.68). Their aggregate measured performance is ~120 ns/px-iter for pert and ~525 ns/px-iter for qdpert, but the overhead structure is not well-characterized. Effort values for these boards are estimates.

### Key Observations

1. **Shared batch overhead**: ~1.7ms for GPU command submission, shared across all boards
2. **GPU compute is 22× faster than CPU**: 0.2 ns vs 4.4 ns per pixel-iteration
3. **GpuZ/Adaptive have reference orbit overhead**: ~700-800 μs per iteration for CPU-side orbit computation
4. **GPU board memory scales with buffer size**: 3.9-15 ns per board-pixel depending on struct size (28-60 bytes)
5. **Plain GPU has unique active-pixel overhead**: 19 ns/pixel for JavaScript result processing loop

### Cost Breakdown by Board Type

**CpuBoard**: Pure compute (4.4 ns/px-iter)
- No GPU overhead, no reference orbit
- Baseline for effort calculations

**GpuBoard**: Fast compute + JS overhead
- Compute: 0.2 ns/px-iter (22× faster than CPU)
- Board memory: 3.9 ns/board-px (28 bytes/pixel buffer)
- Active-pixel: 19 ns/px (JavaScript processing loop)

**GpuZhuoranBoard / GpuAdaptiveBoard**: Reference orbit + GPU
- Compute: 0.4 ns/px-iter (11× faster than CPU)
- Board memory: 14-15 ns/board-px (56-60 bytes/pixel buffer)
- Iter overhead: 700-812 μs/iter (reference orbit on CPU)

**DDZhuoranBoard / QDZhuoranBoard**: CPU perturbation
- Compute: 19.6-21.0 ns/px-iter (4.5-4.8× slower than CPU)
- Pure CPU computation with shared reference orbit

**QDCpuBoard**: Full quad-double arithmetic
- Compute: 493 ns/px-iter (112× slower than CPU)
- Every pixel does full QD precision iteration

## Effort Values

The `effort` property determines batch sizing:

```javascript
const workThreshold = batchTimeMs * 10000;  // 100ms → 1M work units
const targetIters = Math.floor(workThreshold / (pixels × effort));
```

Based on compute cost relative to CPU (effort=100 baseline):

| Board | Compute (ns/px-iter) | Effort |
|-------|---------------------|--------|
| GpuBoard | 0.20 | 5 |
| GpuZhuoranBoard | 0.41 | 9 |
| GpuAdaptiveBoard | 0.43 | 10 |
| CpuBoard | 4.39 | 100 |
| DDZhuoranBoard | 19.6 | 450 |
| QDZhuoranBoard | 21.0 | 480 |
| PerturbationBoard | ~100 (est.) | 2,300 |
| QDPerturbationBoard | ~500 (est.) | 11,400 |
| QDCpuBoard | 493 | 11,200 |

### Effort Examples

With 1M pixels and 100ms target batch time:
- GpuBoard (effort=5): targetIters = 1M / (1M × 5) = 200 iterations
- CpuBoard (effort=100): targetIters = 1M / (1M × 100) = 10 iterations
- DDZhuoranBoard (effort=450): targetIters = 1M / (1M × 450) = 2 iterations

## Scheduler Architecture

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

### Debug Flags

- `debug=t` - Log timing per batch: `[timing] BoardType k=N: X px × Y iters = Z.Zμs`
- `debug=s` - Step mode (single iteration per batch for debugging)
- `debug=w` - Run on main thread with MockWorker
- `debug=r` - Random batch sizes (1-16 iters) for regression analysis benchmarking

## Test Environment

- **Platform:** macOS Darwin 24.6.0
- **Browser:** Headless Chrome via Puppeteer
- **Date:** December 2025
- **Hardware:** Results will vary based on CPU/GPU capabilities

## Reproducing Results

1. Install dependencies: `npm install`
2. Run benchmarks: `node tests/benchmark-shallow.js`
3. Analyze results: `node tests/analyze-benchmark.js`
4. Results are saved to `tests/benchmark-results/` as JSONL

For quick single-board testing:
```bash
# Run with timing output
open "index.html?debug=t,w&board=cpu&z=6.25e2&c=-0.06091+0.66869i"
```

## Canvas Rendering Performance

### Fast Painting Path (ImageData vs fillRect)

When updating computed pixels on the canvas, two approaches are available:

1. **fillRect**: Draw each pixel individually with `ctx.fillRect(x, y, 1, 1)`
2. **ImageData**: Get canvas data, set pixel values directly, put data back

The tradeoff:
- **fillRect** has per-pixel overhead but no fixed cost
- **ImageData** has fixed overhead (~3ms for getImageData + putImageData) but O(1) per-pixel cost

#### Benchmark Results (1402×1402 canvas)

| Pixels | fillRect | ImageData | Winner |
|--------|----------|-----------|--------|
| 100 | 0.0ms | 3.0ms | fillRect |
| 1,000 | 0.2ms | 3.2ms | fillRect |
| 10,000 | 1.2ms | 5.5ms | fillRect |
| 50,000 | 4.0ms | 16.7ms | fillRect |
| **100,000** | **22.5ms** | **11.9ms** | **ImageData** |
| 500,000 | 129.2ms | 23.0ms | ImageData |

The crossover point is approximately **100,000 pixels**. At 500k pixels, ImageData is 5.6× faster.

#### Implementation

The `drawchangesFast()` method in the View class uses ImageData when:
- Update contains >100,000 pixels
- RGBA color theme functions are available (`colorThemesRGBA`)

```javascript
// In Grid.updateCanvas()
if (totalPixels > 100000 && this.config.colorThemesRGBA) {
  view.drawchangesFast(ctx, data.changeList);
} else {
  for (let change of data.changeList) {
    view.drawchange(ctx, change);
  }
}
```

This optimization reduced startup time to first visible pixels from ~1100ms to ~580ms (median) at 1470×827 viewport—a **~50% improvement**.

#### RGBA Color Themes

The fast path requires `colorThemesRGBA`, which provides color theme functions that return `[r, g, b, a]` arrays instead of CSS color strings. These are defined alongside the standard `colorThemes` and must be kept in sync.

```javascript
// Standard theme returns CSS string
colorThemes.warm = (i, frac, ...) => `rgb(${r},${g},${b})`;

// RGBA theme returns array for direct ImageData manipulation
colorThemesRGBA.warm = (i, frac, ...) => [r, g, b, 255];
```

## Startup Performance

Detailed breakdown of time-to-first-paint and full completion for GPU rendering.

### Test Configuration

- **Viewport:** 1470×827 pixels
- **Grid:** 1402×1402 computed pixels (1.97M pixels)
- **Board:** GpuBoard
- **Platform:** macOS, headless Chrome via Puppeteer

### First Paint Timeline (~285ms)

| Phase | Time | Cumulative | Notes |
|-------|------|------------|-------|
| **DOM & Script** | | | |
| DOM parsing | 32ms | 32ms | HTML parsed |
| Script execution start | 30ms | 62ms | `<script>` begins |
| MandelbrotExplorer() | 2ms | 64ms | Create Grid, Scheduler |
| explorer.start() | 30ms | 94ms | URL parse, updateLayout |
| **Worker Setup** | | | |
| Worker assemble | 0ms | 94ms | Collect script tags |
| Worker blob + new | 2ms | 96ms | Create blob URL, spawn |
| Worker startup | ~92ms | 188ms | Thread init, parse JS |
| **GPU Init** | | | |
| GPU adapter | 2ms | 190ms | requestAdapter() |
| GPU device | 1ms | 191ms | requestDevice() |
| Pipeline | 0ms | 191ms | createComputePipeline() |
| Buffer init | 16ms | 207ms | mappedAtCreation + loop |
| Bind group | 0ms | 207ms | createBindGroup() |
| **GPU Compute** | | | |
| Batch 1 (1 iter) | 1ms | 208ms | Warm-up |
| Batch 2 (2 iters) | 37ms | 245ms | **Shader JIT compile** |
| Batch 3-8 | ~23ms | 268ms | Accelerating batches |
| **Render** | | | |
| Result processing | 5ms | 273ms | Process GPU results |
| Canvas drawing | 8ms | 281ms | Draw to canvas |
| **First paint** | | **~285ms** | 137K pixels visible |

### Full Completion Breakdown (~1170ms)

| Component | Time | % of Total |
|-----------|------|------------|
| DOM load | 113ms | 10% |
| Worker startup | ~92ms | 8% |
| GPU init | 21ms | 2% |
| GPU batches (107 total) | 647ms | 55% |
| Shader JIT | ~40ms | 3% |
| Result processing | 103ms | 9% |
| Canvas drawing | 68ms | 6% |
| Other overhead | ~83ms | 7% |

### Accelerating Batch Sizes

To minimize time-to-first-paint, the first 8 batches use accelerating iteration counts:

| Batch | Iterations | Pixels | Time | Notes |
|-------|-----------|--------|------|-------|
| 1 | 1 | 1.97M | 1ms | Warm-up, no escapes at z=1 |
| 2 | 2 | 1.97M | 38ms | Shader JIT compilation |
| 3 | 4 | 1.97M | 8ms | |
| 4 | 8 | 1.97M | 2ms | |
| 5-8 | 25 each | 1.97M | 2-3ms | First escapes detected |

After batch 8 (115 total iterations), pixels start escaping and the first paint occurs.

### Startup Optimizations Applied

| Optimization | Before | After | Saved |
|-------------|--------|-------|-------|
| Buffer init: skip zeros | 83ms | 55ms | 28ms |
| mappedAtCreation | 55ms | 16ms | 39ms |
| queryMaxBufferSize: use adapter.limits | +1ms | 0ms | 1ms |
| MessageChannel scheduler | setTimeout(0) | MessageChannel | minor |
| Accelerating batch sizes | 25 iters | 1,2,4,8,25 | ~550ms to first paint |
| ImageData fast path | fillRect | ImageData | ~50% canvas time |

### Key Insights

1. **Worker startup is unavoidable** (~92ms): JavaScript parsing in the worker thread dominates. The worker code is ~400KB of embedded JS.

2. **Shader JIT is one-time** (~37ms): First real compute batch triggers WGSL→GPU compilation. Subsequent batches are fast.

3. **Buffer init uses mappedAtCreation**: Writing directly to GPU-visible memory avoids a 63MB CPU→GPU copy. This saved 39ms.

4. **Accelerating batches are critical**: Without them, first paint would require waiting for a 25-iteration batch to complete before any pixels escape—adding ~550ms.

5. **GPU adapter can't be cached**: Each `GPUAdapter` becomes "consumed" after calling `requestDevice()`, so each board needs a fresh adapter (~2ms).

### Remaining Bottlenecks

| Bottleneck | Time | Potential Fix |
|------------|------|---------------|
| Worker startup | 92ms | Minimal - inherent JS parsing cost |
| Shader JIT | 37ms | Pre-compile shader (complex, browser-specific) |
| DOM parsing | 32ms | Minify HTML (marginal gain) |

### Debug Scripts

```bash
# Detailed startup timeline
node tests/debug-detailed-startup.js

# Buffer init breakdown
node tests/debug-all-console.js

# Full timing report
node tests/debug-timing-report.js
```

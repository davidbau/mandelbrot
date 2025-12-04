# GPU Shaders and WebGPU

The explorer uses WebGPU to compute millions of Mandelbrot iterations in parallel on the GPU. This document explains the shader architecture, the two board types (shallow and deep zoom), and the techniques that make deep GPU zooming possible.

## WebGPU Overview

WebGPU is a modern graphics API that provides direct access to GPU compute shaders. Unlike WebGL, which is designed for rendering triangles, WebGPU's compute shaders are general-purpose: they run arbitrary code on thousands of GPU threads simultaneously.

The basic pattern:
1. **Create buffers** on the GPU to hold pixel data
2. **Write a shader** in WGSL (WebGPU Shading Language)
3. **Dispatch workgroups** of threads to process pixels in parallel
4. **Read results** back to the CPU

A typical Mandelbrot frame might dispatch 640,000 threads (for a 800×800 image) across 10,000 workgroups of 64 threads each.

## The Two GPU Boards

The explorer has two GPU implementations, selected based on zoom depth:

| Board | Pixel Size | Precision | Use Case |
|-------|------------|-----------|----------|
| **GpuBoard** | > 1e-6 | float32 | Shallow zoom (up to ~10^6 magnification) |
| **GpuZhuoranBoard** | ≤ 1e-6 | float32 + perturbation | Deep zoom (10^6 to 10^30+) |

The threshold of 1e-6 reflects float32's precision limit (~7 decimal digits). Beyond this, raw float32 iteration breaks down—neighboring pixels become indistinguishable.

## GpuBoard: The Simple Shader

For shallow zooms, the shader is straightforward: each thread computes one pixel's orbit independently.

### Shader Structure

```wgsl
struct Params {
  center_re: f32,
  center_im: f32,
  pixel_size: f32,
  aspect_ratio: f32,
  dims_width: u32,
  dims_height: u32,
  iterations_per_batch: u32,
  active_count: u32,
  epsilon: f32,
  epsilon2: f32,
  exponent: u32,
  // ... checkpoint parameters for cycle detection
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> iterations: array<u32>;
@group(0) @binding(2) var<storage, read_write> z_values: array<f32>;
// ... other buffers
```

**Uniforms** are read-only parameters shared by all threads (the view's center, size, etc.). **Storage buffers** hold per-pixel data that threads read and write.

### The Main Loop

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) { // global_id is a unique ID for each thread
  // Map thread ID to pixel index
  let index = active_pixels[global_id.x];

  // Compute c for this pixel
  let cr = params.center_re + xFrac * params.pixel_size;
  let ci = params.center_im + yFrac * (params.pixel_size / params.aspect_ratio);

  // Load current z from previous batch
  var zr = z_values[index * 2u];
  var zi = z_values[index * 2u + 1u];

  // Iterate
  for (var i = 0u; i < params.iterations_per_batch; i++) {
    let zr2 = zr * zr;
    let zi2 = zi * zi;

    // Check divergence
    if (zr2 + zi2 > 4.0) {
      status[index] = 1u;  // Diverged
      break;
    }

    // z = z^n + c
    var ra = zr2 - zi2;
    var ja = 2.0 * zr * zi;
    for (var ord = 2u; ord < params.exponent; ord++) {
      let rt = zr * ra - zi * ja;
      ja = zr * ja + zi * ra;
      ra = rt;
    }
    zr = ra + cr;
    zi = ja + ci;

    // Check convergence (cycle detection)
    // ...
  }

  // Save state for next batch
  z_values[index * 2u] = zr;
  z_values[index * 2u + 1u] = zi;
}
```

### Key Design Choices

**Workgroup size of 64**: This is a common sweet spot. Smaller workgroups waste GPU resources; larger ones can reduce occupancy. The GPU hardware typically executes threads in "warps" of 32 (NVIDIA) or "wavefronts" of 64 (AMD), so 64 aligns well with both.

**Sparse active pixel list**: Instead of iterating over all pixels (most of which have already finished), we maintain a list of only the active (still-computing) pixel indices. This dramatically speeds up late-stage computation.

**Batched iteration**: Rather than running the shader once per iteration, we run many iterations per dispatch (`iterations_per_batch`). This amortizes the overhead of launching a compute pass. The batch size is tuned dynamically based on how many pixels are still active.

**Generalized exponent**: The inner loop handles arbitrary integer exponents (z^2, z^3, z^4, etc.) by repeated complex multiplication.

## GpuZhuoranBoard: Deep Zoom with Perturbation

Beyond 10^6 magnification, float32 loses the ability to represent pixel coordinates precisely. The solution is *perturbation theory*: compute a single reference orbit at high precision on the CPU, then compute each pixel's orbit as a small *perturbation* from that reference on the GPU.

### The Perturbation Approach

Instead of iterating `z = z² + c` for each pixel, we track:
- **Reference orbit** `Z_n`: computed once in quad precision on the CPU
- **Perturbation** `δz_n` for each pixel: how far this pixel's orbit is from the reference

The iteration becomes:
```
z_n = Z_n + δz_n
z_{n+1} = z_n² + c = (Z_n + δz_n)² + c
        = Z_n² + 2·Z_n·δz_n + δz_n² + c
        = (Z_n² + c) + 2·Z_n·δz_n + δz_n²
        = Z_{n+1} + (2·Z_n·δz_n + δz_n²)
```

So: `δz_{n+1} = 2·Z_n·δz_n + δz_n² + δc`

The key insight: even though `c` requires 30+ digits of precision, the *difference* `δc = c - c_ref` is tiny and fits in float32.

### The Glitch Problem and Rebasing

Perturbation theory has a flaw: when the reference orbit passes near zero, small errors in `δz` get amplified catastrophically, causing visual "glitches"—blobs of wrong color.

The "Zhuoran method" (named after Zhuoran, who refined the technique from earlier work by Pauldelbrot, Imagina, and others) solves this with **rebasing**: when `z` gets close to zero, we reset `δz` to hold the absolute position and restart following the reference from iteration 0.

A simple diagram of rebasing:
```
Reference Orbit (Z):  ──────────────────────────────────>
Pixel's Orbit (z):      \____________/ \
                                      |
                                      `--<--<--<-- (Rebase)
                                            |
New path starts from here on ref orbit ---> *
```

```wgsl
// Check if we should rebase
let dz_norm = max(abs(dzr), abs(dzi));
let total_r = refr + dzr;
let total_i = refi + dzi;
let total_norm = max(abs(total_r), abs(total_i));

// Rebase when orbit approaches critical point (near zero)
if (ref_iter > 0u && total_norm < dz_norm * 2.0) {
  dzr = total_r;   // Set δz = z_total (absolute position)
  dzi = total_i;
  ref_iter = 0u;   // Restart from beginning of reference
}
```

The condition `total_norm < dz_norm * 2.0` catches orbits that are getting close to zero (where the reference is more accurate than the perturbation). After rebasing, the perturbation starts fresh with full precision.

### Binomial Expansion for Higher Exponents

For z^n + c with n > 2, the perturbation formula uses the binomial expansion:

```
(Z + δz)^n - Z^n = Σ_{k=1}^{n} C(n,k) · Z^{n-k} · δz^k
```

This is computed efficiently using an iterative method that builds up the polynomial term by term:

```wgsl
// Iterative method for perturbation
var z_pow_r = refr;
var z_pow_i = refi;
var coeff = f32(params.exponent);

var result_r = dzr;
var result_i = dzi;

for (var k = 1u; k < params.exponent; k++) {
  // Add coeff * z_ref^power term
  let term_r = coeff * z_pow_r;
  let term_i = coeff * z_pow_i;
  result_r = result_r + term_r;
  result_i = result_i + term_i;

  // Multiply by dz
  let temp_r = result_r * dzr - result_i * dzi;
  result_i = result_r * dzi + result_i * dzr;
  result_r = temp_r;

  // Update z_ref power and coefficient
  // ...
}

dzr = result_r + dcr;
dzi = result_i + dci;
```

### Cycle Detection with Threading

Detecting cycles (periodic orbits) in the perturbation context is tricky. The naive approach—save a checkpoint and check if `z` returns—doesn't work directly because `δz` values aren't comparable across rebases.

The solution is "threading": a data structure that tracks which reference orbit positions are close to each other. When orbit position 5000 is near position 3000, we record a "thread" from 5000 → 3000 with the small position difference.

```wgsl
// Check convergence at checkpoint or threaded position
if (ref_iter == ckpt_iter || ref_iter == next_threaded_ref_iter) {
  let dz_diff_r = old_dzr - bbr;  // Difference from checkpoint
  let dz_diff_i = old_dzi - bbi;
  let total_diff_r = threaded_delta_re + dz_diff_r;
  let total_diff_i = threaded_delta_im + dz_diff_i;
  let db = max(abs(total_diff_r), abs(total_diff_i));

  if (db <= epsilon) {
    status = 2u;  // Converged!
  }
}
```

The threading structure is computed on the CPU as the reference orbit extends, then uploaded to the GPU. It allows efficient O(1) cycle detection even when the pixel's orbit has rebased multiple times.

## Buffer Layout

GpuZhuoranBoard uses several GPU buffers:

| Buffer | `@binding` | Contents | Size per Pixel |
|--------|---|----------|---------------|
| `iterations` | 1 | Current iteration count | 4 bytes (u32) |
| `statusAndPeriod` | 2 | Status (0=computing, 1=diverged, 2=converged) + period | 8 bytes (2×u32) |
| `dc` | 3 | Delta c (offset from reference c) | 8 bytes (2×f32) |
| `dzAndCheckpoint` | 4 | Current δz, checkpoint δz, threading deltas | 24 bytes (6×f32) |
| `refIterAndCheckpoint`| 5 | Reference iteration, checkpoint iteration, next thread position | 12 bytes (3×u32) |
| `refOrbit` | 6 | Reference orbit positions (shared) | 8 bytes/iteration |
| `threading` | 7 | Thread links and deltas (shared) | 16 bytes/iteration |

The `params` uniform buffer is at `@binding(0)`. The total memory per pixel is about 56 bytes. For a 1920×1080 view, that's ~116 MB of GPU memory.

## CPU-GPU Coordination

The reference orbit is computed lazily on the CPU in quad precision. Each `compute()` call:

1. **Extends the reference orbit** if any pixel needs more iterations than currently available
2. **Uploads new orbit data** to the GPU (incrementally, only what's new)
3. **Uploads new threading data** similarly
4. **Dispatches the compute shader** for one batch of iterations
5. **Reads back results** (iteration counts, status, periods) for finished pixels

This interleaving allows the GPU to work on most pixels while the CPU extends the high-precision reference for the few deep-zooming pixels that need it.

## Performance Tuning

### Dynamic Batch Sizing

```javascript
const targetWork = 333337;  // Total pixel-iterations per batch
let iterationsPerBatch = Math.floor(targetWork / activeCount);
iterationsPerBatch = Math.max(17, iterationsPerBatch);
```

With many active pixels, each gets few iterations (responsive updates). With few active pixels, each gets many iterations (efficient GPU utilization).

### 2D Dispatch

WebGPU limits the number of workgroups per dimension to 65535. For large images, we use 2D dispatch:

```javascript
const numWorkgroups = Math.ceil(activeCount / 64);
const workgroupsX = Math.ceil(Math.sqrt(numWorkgroups));
const workgroupsY = Math.ceil(numWorkgroups / workgroupsX);
```

The shader reconstructs the linear index from 2D coordinates:
```wgsl
let index = global_id.y * params.workgroups_x + global_id.x;
```

### Orbit Loop for Very Deep Zooms

Beyond ~4 million iterations, the threading buffer would exceed reasonable memory limits. The code detects when the reference orbit loops back near a previous position and creates a "jump" that wraps the orbit around, allowing unbounded iteration depth with bounded memory.

## WebGPU Availability

WebGPU is available in:
- Chrome 113+ (desktop and Android)
- Edge 113+
- Safari 17+ (macOS Sonoma, iOS 17)
- Firefox (behind a flag)

The explorer feature-detects WebGPU and falls back to CPU computation (using `PerturbationBoard`) when unavailable.

## References

- [WebGPU Specification](https://www.w3.org/TR/webgpu/) - The W3C standard
- [WGSL Specification](https://www.w3.org/TR/WGSL/) - The WebGPU Shading Language
- [Perturbation Theory for Mandelbrot](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) - Claude Heiland-Allen's comprehensive guide
- [SuperFractalThing (2013)](https://fractalwiki.org/wiki/SuperFractalThing) - K.I. Martin's pioneering perturbation implementation

## Next Steps

- [MATH.md](MATH.md): The quad-precision math library used for reference orbits
- [ALGORITHMS.md](ALGORITHMS.md): Cycle detection and the Zhuoran method in detail
- [COMPUTATION.md](COMPUTATION.md): How CPU and GPU coordinate

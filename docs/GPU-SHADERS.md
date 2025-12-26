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

## The Three GPU Boards

The explorer has three GPU implementations, selected based on zoom depth:

| Board | Pixel Size | Precision | Buffer Layout | Use Case |
|-------|------------|-----------|---------------|----------|
| **GpuBoard** | > 1e-7 | float32 | 3 bindings (36 bytes/pixel) | Shallow zoom (up to ~10^7×) |
| **GpuZhuoranBoard** | 1e-30 to 1e-7 | float32 perturbation<br/>DD reference orbit | 3 bindings (56 bytes/pixel) | Deep zoom (10^7× to 10^30×) |
| **GpuAdaptiveBoard** | < 1e-30 | float32 perturbation<br/>QD reference orbit<br/>Per-pixel scaling | 3 bindings (60 bytes/pixel) | Ultra-deep zoom (10^30×+) |

The threshold of 1e-7 reflects float32's precision limit (~7 decimal digits). Beyond this, raw float32 iteration breaks down—neighboring pixels become indistinguishable. At extreme depths (> 10^30), GpuAdaptiveBoard uses QD-precision references and per-pixel adaptive scaling to handle coordinates that exceed float32's exponent range.

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
- **Reference orbit** `Z_n`: computed once in DD or QD precision on the CPU
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

### Binomial Expansion with Horner's Method

For z^n + c with n > 2, the perturbation formula uses the binomial expansion:

```
(Z + δz)^n - Z^n = Σ_{k=1}^{n} C(n,k) · Z^{n-k} · δz^k
```

Both GpuZhuoranBoard and GpuAdaptiveBoard compute this efficiently using **Horner's method**, which evaluates the polynomial as:

```
δz · (C(n,1)·Z^{n-1} + δz · (C(n,2)·Z^{n-2} + δz · (... + δz)))
```

This requires only one multiplication by `δz` per term, building from the innermost term outward.

#### GpuZhuoranBoard Implementation

```wgsl
// Start with innermost term
var result_r = dzr;
var result_i = dzi;

// Build binomial powers: z_pow tracks Z^k
var z_pow_r = refr;   // Start at Z^1
var z_pow_i = refi;
var coeff = f32(params.exponent);  // C(n,1) = n

// Horner's method: accumulate from highest to lowest power of Z
for (var k = 1u; k < params.exponent; k++) {
  // Add C(n,k) · Z^k term
  let term_r = coeff * z_pow_r;
  let term_i = coeff * z_pow_i;
  result_r = result_r + term_r;
  result_i = result_i + term_i;

  // Multiply by δz (complex multiplication)
  let temp_r = result_r * dzr - result_i * dzi;
  let temp_i = result_r * dzi + result_i * dzr;
  result_r = temp_r;
  result_i = temp_i;

  // Update Z^k: multiply by Z
  let new_z_pow_r = z_pow_r * refr - z_pow_i * refi;
  z_pow_i = z_pow_r * refi + z_pow_i * refr;
  z_pow_r = new_z_pow_r;

  // Update coefficient: C(n,k+1) = C(n,k) · (n-k) / (k+1)
  coeff *= f32(params.exponent - k) / f32(k + 1u);
}

// Add perturbation in c
dzr = result_r + dcr;
dzi = result_i + dci;
```

For exponent=3, this expands to:
- k=1: `result = δz + 3·Z` → `result · δz = 3·Z·δz + δz²`
- k=2: `result = (3·Z·δz + δz²) + 3·Z²` → `result · δz = 3·Z²·δz + 3·Z·δz² + δz³`

Which matches the binomial expansion: `3·Z²·δz + 3·Z·δz² + δz³`

#### GpuAdaptiveBoard Implementation with Scaling

GpuAdaptiveBoard cannot use Horner's method directly because converting between scaled and actual coordinates with `ldexp(..., -scale)` causes **float32 overflow** when scale is very negative (e.g., -159 at z=1e47). Instead, it uses explicit term-by-term computation that stays in scaled coordinates:

**Exponent 2** (z² + c):
```wgsl
// 2·Z·δz + δz²
let linear_r = 2.0 * (refr * dzr - refi * dzi);  // Z·δz_stored, stays in scaled
let linear_i = 2.0 * (refr * dzi + refi * dzr);
let dz2_r = ldexp(dzr * dzr - dzi * dzi, scale);  // δz² in 2^(2*scale), scale back
let dz2_i = ldexp(2.0 * dzr * dzi, scale);
result = linear + dz2 + dc;
```

**Exponent 3** (z³ + c):
```wgsl
// 3·Z²·δz + 3·Z·δz² + δz³
let ref2 = Z²;  // Precompute Z²
let t1 = 3.0 * ref2 * dz_stored;  // Linear term, stays in scaled
let dz2 = dz_stored²;  // δz² in 2^(2*scale)
let t2 = ldexp(3.0 * Z * dz2, scale);  // Scale back to 2^scale
let dz3 = dz_stored * dz2;  // δz³ in 2^(3*scale)
let t3 = ldexp(dz3, 2*scale);  // Scale back to 2^scale
result = t1 + t2 + t3 + dc;
```

**Exponent 4** (z⁴ + c):
```wgsl
// 4·Z³·δz + 6·Z²·δz² + 4·Z·δz³ + δz⁴
let ref2 = Z², ref3 = Z³;
let t1 = 4.0 * ref3 * dz_stored;  // O(1) * O(1) = O(1)
let t2 = ldexp(6.0 * ref2 * dz2, scale);
let t3 = ldexp(4.0 * Z * dz3, 2*scale);
let t4 = ldexp(dz4, 3*scale);
result = t1 + t2 + t3 + t4 + dc;
```

**Key constraint**: Never use `ldexp(..., -scale)` with large negative scale to convert actual→scaled coordinates. This multiplies by 2^|scale| and overflows float32 to Infinity. Instead, work entirely in scaled coordinates where all values stay in [0.25, 4.0] range.

For exponents > 4, a fallback computes `(Z+δz)^n - Z^n` directly using actual coordinates (less efficient but always works).

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

### GpuBoard: 3-Binding Layout (Shallow Zoom)

For shallow zooms where perturbation isn't needed, GpuBoard uses a simple 3-binding layout:

```wgsl
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> pixels: array<PixelState>;
@group(0) @binding(2) var<storage, read_write> active_indices: array<u32>;
```

The `PixelState` struct packs all per-pixel data:
```wgsl
struct PixelState {
  iter: u32,        // Current iteration count
  status: u32,      // 0=computing, 1=diverged, 2=converged
  period: u32,      // Detected period (for convergence)
  zr: f32,          // Current z real part
  zi: f32,          // Current z imaginary part
  ckpt_zr: f32,     // Checkpoint z real
  ckpt_zi: f32,     // Checkpoint z imaginary
  cr: f32,          // Pixel's c real part
  ci: f32,          // Pixel's c imaginary part
}
```

Total: 36 bytes per pixel (9 fields × 4 bytes).

### GpuZhuoranBoard: 3-Binding Layout (Deep Zoom)

For deep zoom with perturbation theory, GpuZhuoranBoard uses a consolidated 3-binding layout:

```wgsl
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> pixels: array<PixelState>;
@group(0) @binding(2) var<storage, read> iters: array<IterState>;
```

The `PixelState` struct (56 bytes) consolidates all per-pixel state:
```wgsl
struct PixelState {
  // Integer fields (6 × u32 = 24 bytes)
  iter: u32,                 // Total iterations completed
  status: u32,               // 0=computing, 1=diverged, 2=converged
  period: u32,               // Detected cycle period
  ref_iter: u32,             // Current position in reference orbit
  ckpt_refidx: u32,          // Checkpoint reference index
  pending_refidx: u32,       // Lazy threading: pending ref index

  // Float fields (8 × f32 = 32 bytes)
  dzr: f32,                  // Perturbation δz real
  dzi: f32,                  // Perturbation δz imaginary
  bbr: f32,                  // Current checkpoint δz real
  bbi: f32,                  // Current checkpoint δz imaginary
  ckpt_bbr: f32,             // Original checkpoint δz real (for rebasing)
  ckpt_bbi: f32,             // Original checkpoint δz imaginary
  dcr: f32,                  // Perturbation δc real (c - c_ref)
  dci: f32,                  // Perturbation δc imaginary
}
```

The `IterState` struct (20 bytes) combines reference orbit and threading data:
```wgsl
struct IterState {
  ref_re: f32,          // Reference orbit Z_n real part
  ref_im: f32,          // Reference orbit Z_n imaginary part
  thread_next: f32,     // Next thread index (-1 = no thread)
  thread_delta_re: f32, // Thread position delta real
  thread_delta_im: f32, // Thread position delta imaginary
}
```

This consolidation improves cache coherency by storing all shared data (reference orbit + threading) in a single buffer with uniform 20-byte stride. For a 1920×1080 view with 100,000 reference iterations: ~107 MB pixels + ~2 MB iters = ~109 MB total GPU memory.

### GpuAdaptiveBoard: 3-Binding Layout (Ultra-Deep Zoom)

GpuAdaptiveBoard uses the same 3-binding pattern but with per-pixel scaling:

```wgsl
struct PixelState {
  // Integer fields (7 × i32 = 28 bytes)
  iter: i32,            // Total iterations (signed for compatibility)
  scale: i32,           // Per-pixel exponent scale (adaptive)
  status: i32,          // 0=computing, 1=diverged, 2=converged
  period: i32,          // Detected cycle period
  ref_iter: i32,        // Current position in reference orbit
  ckpt_refidx: i32,     // Checkpoint reference index
  pending_refidx: i32,  // Lazy threading: pending ref index

  // Float fields (8 × f32 = 32 bytes)
  dzr: f32,             // Scaled perturbation: δz / 2^scale
  dzi: f32,             // (stored values are normalized)
  bbr: f32,             // Scaled checkpoint δz real
  bbi: f32,             // Scaled checkpoint δz imaginary
  ckpt_bbr: f32,        // Original scaled checkpoint
  ckpt_bbi: f32,        // (for reset after rebasing)
  dcr: f32,             // Scaled δc real
  dci: f32,             // Scaled δc imaginary
}
```

Total: 60 bytes per pixel. The `scale` field enables each pixel to independently adapt its floating-point exponent range, allowing computation at depths beyond float32's normal limits (pixel sizes < 1e-30).

## GpuAdaptiveBoard: Per-Pixel Adaptive Scaling

At extreme zoom depths (pixel sizes < 1e-30), float32's exponent range becomes the limiting factor. Even though perturbation theory keeps the mantissa in range, the values can become so small that they underflow to zero or require denormal numbers (which have poor performance).

GpuAdaptiveBoard solves this with **per-pixel adaptive scaling**: each pixel maintains its own exponent scale that shifts values into float32's normal range.

### Scaling Mechanism

Each pixel tracks:
- `scale`: an integer exponent offset (typically negative, e.g., -95 for pixel_size ≈ 1e-30)
- `dzr, dzi`: perturbation values stored as `δz_actual / 2^scale`

This effectively extends float32's range by borrowing bits from the exponent. For example:
- Actual value: `1e-95` (would underflow float32)
- With `scale = -95`: stored as `1.0` (perfectly normal float32)
- To convert back: `stored_value * 2^scale = 1.0 * 2^(-95) = actual_value`

### Dynamic Rescaling

After each iteration, the shader adjusts `scale` to keep `δz` in the range [0.5, 2.0]:

```wgsl
// Check if δz is getting too large
let dz_mag = max(abs(new_dzr), abs(new_dzi));
if (dz_mag > 0.0) {
  let log2_mag = floor(log2(dz_mag));

  // Scale down if magnitude ≥ 2
  if (log2_mag >= 1.0) {
    let steps = i32(log2_mag);
    new_dzr = ldexp(new_dzr, -steps);  // Divide by 2^steps
    new_dzi = ldexp(new_dzi, -steps);
    new_scale = new_scale + steps;     // Increase exponent offset
  }

  // Scale up if magnitude < 0.5 (and we have headroom)
  else if (log2_mag < -1.0 && new_scale > params.initial_scale) {
    let steps = min(i32(-log2_mag) - 1, new_scale - params.initial_scale);
    if (steps > 0) {
      new_dzr = ldexp(new_dzr, steps);   // Multiply by 2^steps
      new_dzi = ldexp(new_dzi, steps);
      new_scale = new_scale - steps;     // Decrease exponent offset
    }
  }
}
```

This keeps the stored values in float32's sweet spot (normal range, no denormals) while the actual mathematical values can be arbitrarily small.

### Reference Orbit Precision

For GpuAdaptiveBoard to work correctly, the CPU must compute the reference orbit in **QD (quad-double) precision** rather than DD (double-double). This provides ~62 decimal digits of precision, sufficient for:
- Pixel sizes down to ~1e-60
- Reference coordinates requiring ~60 digits
- Accurate orbit loop detection at extreme depths

The reference orbit values uploaded to the GPU are truncated to float32 for each iteration, which is sufficient because perturbation keeps individual terms small.

## CPU-GPU Coordination

The reference orbit is computed lazily on the CPU using high-precision arithmetic:
- **GpuZhuoranBoard**: DD (double-double) precision (~31 decimal digits)
- **GpuAdaptiveBoard**: QD (quad-double) precision (~62 decimal digits)

Each `compute()` call:

1. **Extends the reference orbit** if any pixel needs more iterations than currently available
   - Computed using QD complex precision (8 float64 components) on CPU
   - Truncated to DD or QD for storage depending on board type
   - Further truncated to float32 when uploading to GPU

2. **Uploads new orbit data** to the GPU (incrementally, only what's new)
   - Reference orbit positions: 2×f32 per iteration (8 bytes)
   - Only new iterations since last upload are transferred

3. **Uploads new threading data** similarly
   - Threading links and deltas: computed from iteration 0
   - Shader ignores threading checks until iteration ≥ F(18) = 2584
   - Full threading buffer populated for better orbit loop detection

4. **Dispatches the compute shader** for one batch of iterations
   - Dynamic batch sizing: more iterations when fewer pixels active
   - 2D workgroup dispatch for large images (>65535 workgroups)

5. **Reads back results** (iteration counts, status, periods) for finished pixels
   - Only completed pixels are read back to minimize PCIe bandwidth

This interleaving allows the GPU to work on most pixels while the CPU extends the high-precision reference for the few deep-zooming pixels that need it. The precision difference (DD vs QD) ensures each board has sufficient accuracy for its zoom range.

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

Beyond ~1 million iterations (2^20), the threading buffer would exceed reasonable memory limits. Both GpuZhuoranBoard and GpuAdaptiveBoard detect when the reference orbit loops back near a previous position and create a "jump" that wraps the orbit around, allowing unbounded iteration depth with bounded memory.

#### Loop Detection Algorithm

When the reference orbit reaches the threading capacity (1,048,576 iterations), the code searches backward through the last 12,000 iterations to find the closest previous position:

**GpuZhuoranBoard** (DD precision):
```javascript
const THREADING_CAPACITY = 1048576;  // 2^20
const SEARCH_WINDOW = 12000;

// Get endpoint (current position)
const endpoint = this.refOrbit[THREADING_CAPACITY];

let minDist = Infinity;
let closestIter = THREADING_CAPACITY - SEARCH_WINDOW;

for (let i = THREADING_CAPACITY - SEARCH_WINDOW; i < THREADING_CAPACITY; i++) {
  const pt = this.refOrbit[i];

  // Compute distance using DD (double-double) precision
  const dr = endpoint[0] - pt[0] + (endpoint[1] - pt[1]);  // DD subtraction
  const di = endpoint[2] - pt[2] + (endpoint[3] - pt[3]);
  const dist = Math.max(Math.abs(dr), Math.abs(di));  // Chebyshev distance

  if (dist < minDist) {
    minDist = dist;
    closestIter = i;
  }
}

this.refOrbitLoop = {
  enabled: true,
  threshold: THREADING_CAPACITY,
  jumpAmount: THREADING_CAPACITY - closestIter,
  deltaR: /* DD delta */,
  deltaI: /* DD delta */
};
```

**GpuAdaptiveBoard** (QD precision):
```javascript
// Same search window, but using QD (quad-double) precision for accuracy
const tt = new Float64Array(8);  // Temp array for QD arithmetic

for (let i = THREADING_CAPACITY - SEARCH_WINDOW; i < THREADING_CAPACITY; i++) {
  const pt = this.refOrbit[i];

  // Compute difference in QD precision (all 4 components)
  ArqdAdd(tt, 0, endpoint[0], endpoint[1], endpoint[2], endpoint[3],
                 -pt[0], -pt[1], -pt[2], -pt[3]);  // dr in QD
  ArqdAdd(tt, 4, endpoint[4], endpoint[5], endpoint[6], endpoint[7],
                 -pt[4], -pt[5], -pt[6], -pt[7]);  // di in QD

  // Sum QD components for final distance
  const dr = tt[0] + tt[1] + tt[2] + tt[3];
  const di = tt[4] + tt[5] + tt[6] + tt[7];
  const dist = Math.max(Math.abs(dr), Math.abs(di));

  // ... find minimum
}

// Store delta with full QD precision
this.refOrbitLoop = {
  enabled: true,
  threshold: THREADING_CAPACITY,
  jumpAmount: THREADING_CAPACITY - closestIter,
  deltaR_qd: [/* 4 QD components */],  // Full precision for CPU
  deltaI_qd: [/* 4 QD components */],
  deltaR: /* float64 for GPU */,       // Truncated for shader
  deltaI: /* float64 for GPU */
};
```

The larger 12,000-iteration search window (compared to earlier 10,000) increases the likelihood of finding a closer loop point, reducing accumulated error over millions of iterations.

#### GPU Application

When a pixel's `ref_iter` reaches the loop threshold, the shader applies the jump:

```wgsl
if (params.loop_enabled && ref_iter >= params.loop_threshold) {
  ref_iter = ref_iter - params.loop_jump;  // Jump back in orbit

  // Add the stored delta to maintain continuity
  dzr = dzr + params.loop_delta_r;
  dzi = dzi + params.loop_delta_i;
}
```

This allows pixels to iterate indefinitely without requiring unbounded memory for the reference orbit or threading structures.

### Double-Buffering

GPU boards use double-buffering to overlap computation with result processing:

```
Traditional (serial):
  [GPU compute] → [CPU readback] → [GPU compute] → [CPU readback]
                   ▲ idle GPU       ▲ idle GPU

Double-buffered (pipelined):
  [GPU compute batch N  ] → [GPU compute batch N+1] → [GPU compute N+2]
            └──────────────► [CPU process N      ] → [CPU process N+1]
```

The implementation uses two staging buffers that alternate roles:

```javascript
// In compute():
const currentStaging = this.buffers.stagingBuffers[this.currentStagingIndex];
const pendingStaging = this.buffers.stagingBuffers[1 - this.currentStagingIndex];

// 1. Start GPU compute (writes to pendingStaging)
encoder.copyBufferToBuffer(this.buffers.pixels, 0, pendingStaging, 0, bufferSize);
this.device.queue.submit([encoder.finish()]);

// 2. Process previous batch results (from currentStaging) while GPU runs
if (this.hasPendingResults) {
  await currentStaging.mapAsync(GPUMapMode.READ);
  // ... process results from previous batch
  currentStaging.unmap();
}

// 3. Swap buffers for next iteration
this.currentStagingIndex = 1 - this.currentStagingIndex;
```

This eliminates GPU idle time during result processing, providing ~15-25% throughput improvement depending on the ratio of compute time to readback time.

### Sparse Compaction

As pixels escape or converge, they become "dead" but remain in the GPU buffer, wasting bandwidth on every batch. Sparse compaction periodically rebuilds the buffer with only active pixels:

```
Before compaction (60% dead):
  [■][□][■][□][□][■][□][□][■][□]  ← 10 pixels processed, 4 active
       dead pixels waste GPU bandwidth

After compaction:
  [■][■][■][■]  ← 4 pixels processed, 4 active
       100% useful work
```

The compaction decision uses a cost-benefit heuristic:

```javascript
// Compaction saves: (deadPixels × futureReads) bandwidth
// Compaction costs: (activePixels) buffer writes

const wastedReads = this.cumulativeWastedReads;  // Dead pixels read since last compaction
const activeRemaining = this.activeCount - this.deadSinceCompaction;
const compactionCost = activeRemaining * this.compactionCostRatio;  // ~1.0

if (wastedReads >= compactionCost) {
  await this.compactBuffers();
  this.cumulativeWastedReads = 0;
}
```

This triggers compaction when cumulative wasted bandwidth exceeds the one-time cost of rebuilding the buffer. For typical renders, this means compaction happens 3-5 times as the image converges.

Each `PixelState` struct includes an `orig_index` field so compacted pixels can be mapped back to their display coordinates:

```wgsl
struct PixelState {
  orig_index: u32,  // Original grid position (for coordinate lookup)
  iter: u32,
  status: u32,
  // ... other fields
}
```

### Parallel CPU/GPU Execution

For perturbation-based boards (GpuZhuoranBoard, GpuAdaptiveBoard), the CPU must extend the reference orbit as pixels advance. This work can run in parallel with GPU computation:

```
Traditional:
  [Extend orbit to iter N] → [GPU compute to N] → [Extend to N+M] → [GPU compute to N+M]
   CPU work                   GPU work            CPU work          GPU work

Parallel:
  [GPU compute to N    ] → [GPU compute to N+M   ] → [GPU compute to N+2M]
  [Extend orbit to N+M ] → [Extend orbit to N+2M ] → ...
   CPU runs during GPU      CPU runs during GPU
```

The implementation extends the reference orbit speculatively before waiting for GPU results:

```javascript
async compute() {
  // 1. Extend reference orbit (CPU work)
  const targetIter = this.it + this.iterationsPerBatch;
  this.extendReferenceOrbit(targetIter);

  // 2. Dispatch GPU compute (non-blocking)
  encoder.dispatchWorkgroups(workgroupsX, workgroupsY);
  this.device.queue.submit([encoder.finish()]);

  // 3. CPU is now free to do other work (e.g., extend orbit further)
  //    while GPU processes the batch

  // 4. Process results when GPU finishes
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  // ...
}
```

For boards with heavy reference orbit computation (especially QD precision), this parallelism can hide most of the CPU overhead behind GPU execution time.

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

- [MATH.md](MATH.md): The DD and QD precision math library used for reference orbits
- [ALGORITHMS.md](ALGORITHMS.md): Cycle detection and the Zhuoran method in detail
- [COMPUTATION.md](COMPUTATION.md): How CPU and GPU coordinate
- [gpu-results-readback-design.md](gpu-results-readback-design.md): GPU-to-CPU results pipeline
- [gpu-batch-locking.md](gpu-batch-locking.md): Preventing shader race conditions between batches

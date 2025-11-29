# Deep Zoom Bug Report: Float32 Underflow in WebGPUZhuoranBoard

## Test Case
**URL**: `file:///Users/davidbau/git/mandelbrot/index.html?s=1.649267441664001e-27&c=-0.521412147055749689855893694342+0.606667855124034722262091817947i&grid=4`

**Parameters**:
- Size (`s`): 1.649267441664001e-27 (extremely deep zoom)
- Center (`c`): -0.521412147055749689855893694342 + 0.606667855124034722262091817947i
- Grid: 4 column layout
- Grid dimensions: 512x512 (typical)
- Pixel size: 3.221225472000002e-30

## Executive Summary

At this extreme zoom level (pixel size ~3.2e-30), **WebGPUZhuoranBoard produces incorrect results** due to catastrophic underflow of the `dz²` term in the perturbation iteration formula. The float32 precision used for perturbation deltas cannot represent values smaller than ~1.4e-45, causing the squared perturbation term to underflow to zero and corrupting the entire computation.

## Root Cause

### 1. Board Selection Logic (Line 4622-4632)

The current two-tier strategy is:
```javascript
const pixelSize = data.size / data.config.dims;
if (pixelSize > 1e-6) {
  board = new WebGPUBoard(...);  // Simple float32 iteration
} else {
  board = new WebGPUZhuoranBoard(...);  // Quad-double reference + float32 perturbations
}
```

**Problem**: The comment on line 4626 states "WebGPUZhuoranBoard should work to arbitrary depth since reference orbit is quad-double" but this is **incorrect**. While the reference orbit is computed in quad-double precision on the CPU, the perturbation deltas (`dz`) are stored and computed in **float32** on the GPU.

### 2. Float32 Precision Limits

- Float32 min normal value: 1.175494e-38
- Float32 min subnormal value: 1.401298e-45
- At this zoom level: `|dz|² ≈ 6.8e-55`
- **Result**: `dz² < float32_min_subnormal` → **underflows to 0**

### 3. Perturbation Formula Corruption

The correct perturbation iteration formula (line 4329):
```wgsl
dz_new = 2*z_ref*dz + dz² + dc
```

With float32 underflow becomes:
```wgsl
dz_new = 2*z_ref*dz + 0 + dc  // dz² term lost!
```

### 4. Data Flow

1. **Initialization** (lines 4050-4085): `dc` values are computed in quad-double precision, then converted to float32:
   ```javascript
   this.dc[index2] = dcr_qd[0] + dcr_qd[1];  // Quad → float32 conversion
   this.dz[index2] = this.dc[index2];         // Start with dz = dc
   ```

2. **GPU Upload** (line 4124-4130): Float32 arrays uploaded to GPU buffers

3. **Shader Computation** (lines 4329-4336): All arithmetic in float32:
   ```wgsl
   let dz_sq_r = dzr * dzr - dzi * dzi;  // Underflows to 0!
   let dz_sq_i = 2.0 * dzr * dzi;        // Underflows to 0!
   ```

## Detailed Analysis

### Why This Zoom Level Triggers the Bug

| Parameter | Value | Notes |
|-----------|-------|-------|
| Size (s) | 1.649e-27 | Input parameter |
| Pixel size | 3.221e-30 | s / 512 |
| Max \|dc\| | 8.246e-28 | At image edge (size/2) |
| Max \|dc\|² | 6.800e-55 | **Below float32 min!** |
| Float32 min | 1.401e-45 | Subnormal threshold |
| Underflow factor | 4.85e-10 | How far below threshold |

### Error Progression

1. **Iteration 0**: `dz = dc` (small but representable in float32)
2. **Iteration 1**: `dz²` underflows to 0, formula becomes `dz_new = 2*z_ref*dz + dc`
3. **Iteration 2+**: Errors compound exponentially as orbit trajectory diverges from correct path
4. **Result**: Complete corruption of escape times, convergence detection, and final image

### Maximum Safe Zoom for Float32 Perturbations

To avoid underflow, we need `|dc|² > float32_min_subnormal`:

- Safe `|dc|²` > 1.4e-45 (with margin: 1.4e-43)
- Safe `|dc|` > 3.7e-22
- Safe size > 7.5e-22 (image width = 2 × dc_max)
- **Safe pixel size > 1.5e-24**

**Current pixel size (3.2e-30) exceeds safe limit by 200,000x**

## Affected Code Locations

### Primary Issues

1. **Line 4626**: Incorrect comment claiming arbitrary depth support
2. **Lines 4075-4076**: Quad-double to float32 conversion loses precision for ultra-deep zooms
3. **Lines 4329-4336**: Shader arithmetic in float32 causes underflow
4. **Lines 4039-4041**: Storage arrays declared as Float32Array

### Secondary Issues

1. **Lines 4293-4294**: Epsilon thresholds computed correctly but applied to corrupted orbits
2. **Line 4315-4323**: Rebasing logic operates on corrupted dz values
3. **Line 4351-4355**: Divergence check uses corrupted total z values

## Symptoms

When loading the test URL, you will observe:

1. Image appears incorrect/garbled compared to CPU ZhuoranBoard
2. Wrong escape times and iteration counts
3. Incorrect period detection for convergent points
4. May show all black or all colored regions
5. No error messages in console (silent corruption)
6. Works correctly if WebGPU is disabled (falls back to CPU ZhuoranBoard)

## Proposed Fixes

### Option A: Three-Tier Board Selection (Recommended)

Add an ultra-deep zoom threshold to fall back to CPU computation:

```javascript
const pixelSize = data.size / data.config.dims;
const FLOAT32_SAFE_PIXEL_SIZE = 1e-24;  // Conservative threshold

if (pixelSize > 1e-6) {
  board = new WebGPUBoard(...);         // Shallow: simple float32
} else if (pixelSize > FLOAT32_SAFE_PIXEL_SIZE) {
  board = new WebGPUZhuoranBoard(...);  // Deep: quad-double ref + float32 perturbations
} else {
  board = new ZhuoranBoard(...);        // Ultra-deep: CPU with float64
}
```

**Pros**:
- Simple fix, minimal code change
- CPU ZhuoranBoard already handles this correctly with float64
- Safe and reliable

**Cons**:
- Loses GPU acceleration at extreme zooms
- Slower but correct

### Option B: Scaled Perturbations

Store perturbations scaled by a power-of-two factor to avoid underflow:

```javascript
this.dzScale = Math.pow(2, Math.ceil(Math.log2(1e-20 / maxDc)));
this.dz[index2] = this.dc[index2] * this.dzScale;
```

Then in shader:
```wgsl
let scaled_dz_sq = dzr * dzr - dzi * dzi;
let dz_sq_r = scaled_dz_sq / (scale * scale);  // Unscale
```

**Pros**:
- Keeps GPU acceleration
- Extends working range

**Cons**:
- More complex implementation
- Requires shader changes
- Scale factor must be carefully chosen

### Option C: Emulated Double-Double in Shader

Implement double-double arithmetic using pairs of float32:

```wgsl
struct Double2 {
  hi: f32,
  lo: f32,
}

fn dd_mul(a: Double2, b: Double2) -> Double2 { ... }
```

**Pros**:
- Much higher precision (~30 digits)
- True arbitrary depth support

**Cons**:
- Significant shader complexity
- ~4-8x slower than float32
- Large implementation effort

### Option D: Wait for float64 in WebGPU

WebGPU may eventually support float64 in shaders.

**Pros**:
- Cleanest solution
- No performance tricks needed

**Cons**:
- Not available yet
- May never be widely supported
- Doesn't help users now

## Recommendation

**Implement Option A immediately** (three-tier selection) to fix the bug correctly and safely. This requires only a few lines of code change in the board selection logic.

**Consider Option B** (scaled perturbations) as a future enhancement if GPU acceleration is needed at these extreme zooms, but Option A is sufficient for correctness.

## Testing

To verify the fix:

1. Load the test URL with WebGPU enabled
2. Load the same URL with WebGPU disabled (CPU fallback)
3. Compare the results - they should be identical
4. Check console logs to confirm correct board type is selected

Expected log with fix:
```
View 0: ZhuoranBoard
```

Current (buggy) log:
```
View 0: WebGPUZhuoranBoard
```

## Related Files

- `/Users/davidbau/git/mandelbrot/index.html` (lines 4622-4632): Board selection logic
- `/Users/davidbau/git/mandelbrot/index.html` (lines 3997-4576): WebGPUZhuoranBoard class
- `/Users/davidbau/git/mandelbrot/index.html` (lines 2884-3316): ZhuoranBoard class (CPU reference)

## References

- Float32 precision limits: IEEE 754 single precision
- Perturbation theory: Zhuoran Li's 2021 approach
- Double-double arithmetic: QD library approach (already used for reference orbit)

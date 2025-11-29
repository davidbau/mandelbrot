# Deep Zoom Bug Summary

## Quick Reference

**Bug**: Float32 underflow in WebGPUZhuoranBoard at extreme zoom levels
**Test URL**: `?s=1.649267441664001e-27&c=-0.521412147055749689855893694342+0.606667855124034722262091817947i&grid=4`
**Affected zoom range**: Pixel size < 1e-24
**Fix**: Add third tier to board selection (3 lines of code)

## What's Happening

At this extreme zoom level (pixel size ~3.2e-30):

```
Perturbation delta: dc = 8.2e-28      ← Fits in float32 ✓
Delta squared:      dc² = 6.8e-55     ← Too small! Underflows to 0 ✗
Float32 minimum:    1.4e-45           ← Underflow threshold
```

The perturbation formula becomes:
```
Correct:  dz_new = 2*z_ref*dz + dz² + dc
Buggy:    dz_new = 2*z_ref*dz + 0   + dc    ← dz² term lost!
```

Result: **Complete corruption of fractal computation**

## Root Cause

**File**: `/Users/davidbau/git/mandelbrot/index.html`
**Line**: 4626

```javascript
// WebGPUZhuoranBoard should work to arbitrary depth since reference orbit is quad-double
```

This comment is **incorrect**. While the reference orbit uses quad-double (on CPU), the perturbation deltas (`dz`) use **float32** (on GPU). When `dz²` underflows, the computation fails.

### Key Code Locations

1. **Line 4627-4631**: Board selection logic (needs fix)
2. **Line 4075-4076**: Quad-double → float32 conversion (loses precision at extreme zoom)
3. **Line 4329-4336**: Shader perturbation iteration (dz² underflows here)
4. **Line 4039-4041**: Float32Array storage (fundamental limitation)

## The Fix

**Location**: Lines 4622-4632

**Change**:
```diff
  let board;
  if (testWebGPU && webGPUAvailable) {
-   // Two-tier strategy with WebGPU:
+   // Three-tier strategy with WebGPU:
    // - Shallow zooms (pixel > 1e-6): WebGPUBoard with simple float32 iteration
-   // - Deep zooms (pixel <= 1e-6): WebGPUZhuoranBoard with quad-double reference + float32 perturbations
-   // WebGPUZhuoranBoard should work to arbitrary depth since reference orbit is quad-double
+   // - Deep zooms (1e-24 < pixel <= 1e-6): WebGPUZhuoranBoard with quad-double reference + float32 perturbations
+   // - Ultra-deep zooms (pixel <= 1e-24): Fall back to CPU ZhuoranBoard to avoid float32 underflow
    const pixelSize = data.size / data.config.dims;
+   const FLOAT32_SAFE_THRESHOLD = 1e-24;
+
    if (pixelSize > 1e-6) {
      board = new WebGPUBoard(data.k, data.size, data.re, data.im, data.config, data.id);
+   } else if (pixelSize > FLOAT32_SAFE_THRESHOLD) {
-   } else {
      board = new WebGPUZhuoranBoard(data.k, data.size, data.re, data.im, data.config, data.id);
+   } else {
+     board = new ZhuoranBoard(data.k, data.size, data.re, data.im, data.config, data.id);
    }
  } else {
```

## Testing

Load test URL and check console:

**Before fix**:
```
View 0: WebGPUZhuoranBoard
```
→ Image is corrupted/incorrect

**After fix**:
```
View 0: ZhuoranBoard
```
→ Image is correct

## Why This Works

CPU ZhuoranBoard uses float64 (JavaScript `number`):
- Float64 min subnormal: 5.0e-324
- Can handle pixel sizes down to ~1e-162
- **138 orders of magnitude** deeper than float32 limit

## Performance Impact

| Zoom Range | Board Type | Performance | Change? |
|------------|------------|-------------|---------|
| pixel > 1e-6 | WebGPUBoard | Very fast (GPU) | No |
| 1e-24 to 1e-6 | WebGPUZhuoranBoard | Fast (GPU) | No |
| **< 1e-24** | **ZhuoranBoard (CPU)** | **Slower** | **Yes** |

Only ultra-deep zooms (< 1e-24) are affected. These are:
- Extremely rare
- Already slow due to high iteration counts
- Now **correct** instead of wrong

## Files

- `DEEP-ZOOM-BUG-REPORT.md` - Full technical analysis
- `PROPOSED-FIX.md` - Detailed fix with alternatives
- `BUG-SUMMARY.md` - This file (quick reference)

## Mathematical Details

### Underflow Calculation

```
Pixel size: p = s / dims = 1.649e-27 / 512 = 3.22e-30
Max delta:  dc = s / 2 = 8.25e-28
Delta²:     dc² = (8.25e-28)² = 6.80e-55

Float32 min: 1.40e-45

Result: dc² < float32_min → UNDERFLOWS TO ZERO
```

### Safe Threshold Calculation

```
For safe operation: dc² > float32_min_subnormal
                    dc² > 1.4e-45
                    dc > √(1.4e-45) = 3.7e-23
            pixel_size > dc/dims = 7.5e-26

Conservative threshold: 1e-24 (100x safety margin)
```

## Additional Context

### Perturbation Theory

The Mandelbrot set can be computed efficiently using perturbation theory:
```
z_total = z_ref + dz
```

Where:
- `z_ref` is a high-precision reference orbit (quad-double on CPU)
- `dz` is the small perturbation from the reference (float32 on GPU)

This works when `|dz|` is small, but the iteration formula is:
```
dz_new = 2*z_ref*dz + dz² + dc
```

The `dz²` term is crucial for correctness, even though it's smaller than other terms. When it underflows to 0, the orbit trajectory diverges from the correct path.

### Why Float32 in Shaders?

WebGPU shaders (WGSL) don't support float64. To achieve higher precision, we'd need to:
1. Implement double-double arithmetic in the shader (complex)
2. Scale perturbations to avoid underflow (moderate complexity)
3. Fall back to CPU (simple, this fix)

Option 3 is the best immediate fix.

## References

- IEEE 754 single-precision (float32) format
- Zhuoran Li's perturbation method (2021)
- Imagina's rebasing approach
- Double-double (QD) arithmetic

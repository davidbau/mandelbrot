# Proposed Fix for Deep Zoom Float32 Underflow Bug

## Summary

At pixel sizes below ~1.5e-24, the WebGPUZhuoranBoard class suffers from float32 underflow in the perturbation squared term (dz²), causing complete corruption of the fractal computation. The fix is to add a third tier to the board selection logic that falls back to CPU-based ZhuoranBoard (which uses float64) for ultra-deep zooms.

## The Fix

**File**: `/Users/davidbau/git/mandelbrot/index.html`

**Location**: Lines 4622-4632 (in the web worker message handler)

### Current Code (BUGGY)

```javascript
let board;
if (testWebGPU && webGPUAvailable) {
  // Two-tier strategy with WebGPU:
  // - Shallow zooms (pixel > 1e-6): WebGPUBoard with simple float32 iteration
  // - Deep zooms (pixel <= 1e-6): WebGPUZhuoranBoard with quad-double reference + float32 perturbations
  // WebGPUZhuoranBoard should work to arbitrary depth since reference orbit is quad-double
  const pixelSize = data.size / data.config.dims;
  if (pixelSize > 1e-6) {
    board = new WebGPUBoard(data.k, data.size, data.re, data.im, data.config, data.id);
  } else {
    board = new WebGPUZhuoranBoard(data.k, data.size, data.re, data.im, data.config, data.id);
  }
} else {
  // WebGPU disabled or unavailable - use CPU-based boards
  // TESTING: Always use ZhuoranBoard to test convergence detection
  board = new ZhuoranBoard(data.k, data.size, data.re, data.im, data.config, data.id);
}
```

### Fixed Code (CORRECT)

```javascript
let board;
if (testWebGPU && webGPUAvailable) {
  // Three-tier strategy with WebGPU:
  // - Shallow zooms (pixel > 1e-6): WebGPUBoard with simple float32 iteration
  // - Deep zooms (1e-24 < pixel <= 1e-6): WebGPUZhuoranBoard with quad-double reference + float32 perturbations
  // - Ultra-deep zooms (pixel <= 1e-24): Fall back to CPU ZhuoranBoard to avoid float32 underflow
  //   At pixel sizes below ~1e-24, the dz² term in perturbation formula underflows in float32
  const pixelSize = data.size / data.config.dims;
  const FLOAT32_SAFE_THRESHOLD = 1e-24;  // Below this, dz² < float32_min_subnormal

  if (pixelSize > 1e-6) {
    board = new WebGPUBoard(data.k, data.size, data.re, data.im, data.config, data.id);
  } else if (pixelSize > FLOAT32_SAFE_THRESHOLD) {
    board = new WebGPUZhuoranBoard(data.k, data.size, data.re, data.im, data.config, data.id);
  } else {
    // Ultra-deep zoom: use CPU with float64 to avoid underflow
    board = new ZhuoranBoard(data.k, data.size, data.re, data.im, data.config, data.id);
  }
} else {
  // WebGPU disabled or unavailable - use CPU-based boards
  board = new ZhuoranBoard(data.k, data.size, data.re, data.im, data.config, data.id);
}
```

## Changes Made

1. **Added constant** `FLOAT32_SAFE_THRESHOLD = 1e-24`
   - This is conservative (actual limit is ~1.5e-24)
   - Provides safety margin for numerical errors

2. **Modified condition** from single `if-else` to `if-else if-else`
   - Shallow: `pixelSize > 1e-6` → WebGPUBoard
   - Deep: `1e-24 < pixelSize <= 1e-6` → WebGPUZhuoranBoard
   - Ultra-deep: `pixelSize <= 1e-24` → ZhuoranBoard (CPU)

3. **Updated comments** to explain the three tiers and the underflow issue

4. **Removed incorrect comment** claiming arbitrary depth support

## Why This Works

### Float64 vs Float32 Precision

| Type | Precision | Min Subnormal | Can Handle |
|------|-----------|---------------|------------|
| float32 | ~7 digits | 1.4e-45 | pixel_size > 1e-24 |
| float64 | ~15 digits | 5.0e-324 | pixel_size > 1e-162 |

The CPU ZhuoranBoard uses JavaScript's native `number` type (float64), which has:
- Min subnormal: 5.0e-324
- Can handle: (5.0e-324)^0.5 ≈ 2.2e-162 pixel size
- This is 138 orders of magnitude deeper than the float32 limit!

### Performance Impact

- For most users (pixel_size > 1e-24): **No change** - still uses fast GPU
- For ultra-deep zooms (pixel_size < 1e-24): Switches to CPU
  - CPU is slower but **correct**
  - These extreme zooms are rare
  - Already slow due to high iteration counts

## Testing

### Test Case 1: Ultra-Deep Zoom (This Bug Report)

**URL**: `?s=1.649267441664001e-27&c=-0.521412147055749689855893694342+0.606667855124034722262091817947i&grid=4`

- Pixel size: 3.2e-30
- **Before fix**: Uses WebGPUZhuoranBoard → Incorrect image
- **After fix**: Uses ZhuoranBoard → Correct image

**Expected console log**:
```
View 0: ZhuoranBoard
```

### Test Case 2: Deep But Safe Zoom

**URL**: `?s=1e-15&c=-0.5+0.5i`

- Pixel size: ~2e-18
- **Before and after**: Uses WebGPUZhuoranBoard → Correct image
- No change in behavior (within safe range)

**Expected console log**:
```
View 0: WebGPUZhuoranBoard
```

### Test Case 3: Shallow Zoom

**URL**: `?s=1e-3&c=-0.5+0.5i`

- Pixel size: ~2e-6
- **Before and after**: Uses WebGPUBoard → Correct image
- No change in behavior

**Expected console log**:
```
View 0: WebGPUBoard
```

### Test Case 4: Threshold Boundary

**URL**: `?s=5.12e-22&c=-0.5+0.5i` (assuming 512x512 grid)

- Pixel size: 1e-24 (exactly at threshold)
- **After fix**: Uses ZhuoranBoard (CPU) for safety
- Should produce correct image

## Verification Steps

1. **Load test URL** with the fix applied
2. **Check console** for board type: should say "ZhuoranBoard"
3. **Verify image** is computed correctly (not garbled)
4. **Compare** with same URL but WebGPU disabled - should match exactly
5. **Test boundary** cases around 1e-24 threshold

## Alternative Implementations Considered

### Option B: Scaled Perturbations (More Complex)

Instead of falling back to CPU, scale the perturbations to avoid underflow:

```javascript
// In WebGPUZhuoranBoard.initPixels():
const maxDc = this.size / 2;
const targetScale = 1e-20;  // Keep dz around this magnitude
this.dzScale = Math.pow(2, Math.ceil(Math.log2(targetScale / maxDc)));

// Scale all dc and dz values
this.dc[index2] *= this.dzScale;
this.dz[index2] *= this.dzScale;
```

Then in shader, unscale before use. This is more complex but keeps GPU acceleration.

### Option C: Double-Double in Shader (Very Complex)

Implement full double-double arithmetic in WGSL for perturbations. This would truly support arbitrary depth but requires significant shader rewrite and is 4-8x slower.

## Recommendation

**Use Option A (the three-tier fix above)** because:
- Simple, safe, and correct
- Minimal code change (3 lines)
- No performance impact for typical zooms
- Ultra-deep zooms are rare and already slow

Options B and C can be future enhancements if needed, but Option A fixes the bug correctly right now.

## Additional Notes

### Why the Bug Was Hard to Spot

1. No error messages - silent numeric corruption
2. Happens only at extreme zoom levels (< 1e-24)
3. Float32 can represent `dc` itself, just not `dc²`
4. Quad-double reference orbit made it seem like precision was handled

### Related Issues

- The comment on line 4626 was misleading
- This bug doesn't affect moderate zooms (1e-6 to 1e-24)
- CPU boards work correctly because they use float64

### Future Work

Consider implementing Option B (scaled perturbations) to extend GPU acceleration to deeper zooms while maintaining correctness.

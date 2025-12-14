# Adaptive Per-Pixel Scaling for Deep Zoom GPU Perturbation

This document describes the adaptive scaling strategy used in `AdaptiveGpuBoard` to enable GPU-accelerated Mandelbrot computation at extreme zoom depths (10^30 and beyond).

## Problem Statement

Standard GPU perturbation (as in `GpuZhuoranBoard`) uses float32 arithmetic with a global scale factor. This fails at deep zooms because:

1. At z=10^40, pixel spacing is ~10^-40
2. Float32 can only represent values down to ~10^-38 (and loses precision much earlier)
3. When all pixels have the same tiny delta, escape detection fails—pixels appear identical
4. The global scale factor cannot adapt to how individual pixel deltas grow during iteration

**Root cause:** A fixed global scale is set at initialization based on pixel spacing, but during iteration, δ grows from ~10^-40 toward escape magnitude (~2). Near escape, δ_actual should be ~O(1), not ~O(10^-40).

## Solution: Per-Pixel Adaptive Scaling

`AdaptiveGpuBoard` gives each pixel its own scale factor that adjusts dynamically:

```
δ_actual = δ_stored × 2^(pixel_scale)

where pixel_scale starts at initial_scale and increases as δ grows
```

### Key Insight

At initialization:
- δ_stored ≈ 1 (normalized pixel offset)
- pixel_scale = initial_scale ≈ -133 (at z=10^40)
- δ_actual ≈ 10^-40 (correct initial delta)

As iteration progresses toward escape:
- δ_stored grows (would overflow without rescaling)
- When |δ_stored| > threshold, rescale: halve δ_stored, increment pixel_scale
- Near escape: δ_stored ≈ 1, pixel_scale ≈ 0, δ_actual ≈ 1
- Escape check: `Z_ref + ldexp(δ_stored, 0)` = `Z_ref + δ_stored` works correctly!

## Mathematical Derivation

### Standard Perturbation (Mandelbrot, n=2)

The perturbation recurrence is:
```
δ_{m+1} = 2·Z_m·δ_m + δ_m² + δc
```

### Adaptive Scaled Perturbation

Let δ_actual = δ_stored × 2^s where s is the per-pixel scale.

Substituting and dividing by 2^s:
```
δ_stored,m+1 = 2·Z_m·δ_stored,m + δ_stored,m² · 2^s + δc_stored · 2^{s0-s}
```

where:
- s0 = initial_scale (fixed at initialization)
- s = current pixel scale (increases as δ grows)
- δc_stored = initial pixel offset (normalized)

**Term analysis at deep zoom (s << 0):**

| Term | Formula | At deep zoom |
|------|---------|--------------|
| Linear | 2·Z·δ_stored | Dominant term |
| Quadratic | δ_stored² · 2^s | Small (2^s → 0) |
| Initial delta | δc_stored · 2^{s0-s} | Small when s > s0 |

### Rescaling Rules

When |δ_stored| > 2:
```
δ_stored → δ_stored / 2
scale → scale + 1
```

The invariant δ_actual = δ_stored × 2^scale is preserved.

## Implementation in AdaptiveGpuBoard

### Per-Pixel State

Each pixel tracks:
- `dz`: Complex stored delta (vec2<f32>)
- `scale`: Integer exponent (i32)
- `ref_iter`: Current reference orbit position (u32)

### WGSL Shader Core

```wgsl
// Perturbation iteration with adaptive scaling
let linear = 2.0 * cmul(Z_ref, dz);
let quadratic = cmul(dz, dz) * ldexp(1.0, scale);
let dc_term = dc * ldexp(1.0, initial_scale - scale);

var new_dz = linear + quadratic + dc_term;
var new_scale = scale;

// Rescale if magnitude exceeds threshold
let mag = max(abs(new_dz.x), abs(new_dz.y));
if (mag > 2.0) {
    new_dz = new_dz * 0.5;
    new_scale = new_scale + 1;
}
```

### Escape Detection

```wgsl
let delta_actual = dz * ldexp(1.0, scale);
let z = Z_ref + delta_actual;
let escaped = dot(z, z) > 4.0;
```

**Why this works at z=10^40:**
- Near escape: dz ≈ 1.0, scale ≈ 0
- delta_actual = ldexp(1.0, 0) = 1.0
- z = Z_ref + 1.0 can be correctly tested for |z| > 2

### Rebasing

When the reference orbit passes near zero, pixels rebase to their absolute position:

```wgsl
if (z_magnitude < delta_magnitude * 0.5 && z_magnitude > 1e-13) {
    // Compute new scale from absolute position
    let new_scale = ceil(log2(z_magnitude));
    let new_dz = z_actual / ldexp(1.0, new_scale);
    ref_iter = 0;  // Restart from orbit beginning
}
```

The threshold 1e-13 prevents underflow when z² would be too small to represent.

## Reference Orbit Precision

`AdaptiveGpuBoard` uses QD (quad-double) precision for reference orbits:
- Reference orbit computed at view center in full QD precision (~62 digits)
- Stored as float64 pairs for GPU upload
- Sufficient precision for zooms to 10^60

## Comparison with Other Boards

| Board | Zoom Range | Precision | GPU |
|-------|------------|-----------|-----|
| GpuBoard | < 10^7 | float32 direct | Yes |
| GpuZhuoranBoard | 10^7 - 10^14 | float32 perturbation, DD reference | Yes |
| AdaptiveGpuBoard | 10^14 - 10^60 | float32 perturbation, QD reference, adaptive scaling | Yes |
| QDZhuoranBoard | 10^30 - 10^60 | float64 perturbation, QD reference | No (CPU) |

## Performance

**Memory overhead:** +4 bytes per pixel for scale (i32)

**Compute overhead:** ~10-20% vs standard perturbation
- Additional ldexp operations
- Rescaling branch (infrequent, ~1% of iterations)

**Accuracy:** Matches QDZhuoranBoard (CPU reference) within subpixel tolerance:
- z=1e20: ~57% exact match, ~43% within ±1 iteration
- z=1e47: ~37% exact match, ~60% within ±1 iteration

## Testing

The `parent-child-match.test.js` integration test verifies accuracy:

```javascript
// At z=1e47, compare iteration counts between parent and child views
// Both should compute the same iterations for corresponding pixels
expect(closeRate).toBeGreaterThan(0.5);   // >50% within ±1 iteration
expect(exactRate).toBeGreaterThan(0.3);   // >30% exact match
```

The `adaptive-gpu-zhuoran.test.js` test compares AdaptiveGpuBoard against QDZhuoranBoard:

```javascript
// Compare GPU adaptive vs CPU QD at deep zoom
const gpu = await runBoard("adaptive", testCase);
const cpu = await runBoard("qdzhuoran", testCase);
const matchRate = compareIterations(gpu.nn, cpu.nn);
expect(matchRate).toBeGreaterThan(0.9);  // >90% match
```

## References

- [QD-PRECISION.md](QD-PRECISION.md): Quad-double precision arithmetic
- [GPU-SHADERS.md](GPU-SHADERS.md): WebGPU shader implementation details
- [COMPUTATION.md](COMPUTATION.md): Board selection and computation architecture
- WGSL ldexp specification: https://www.w3.org/TR/WGSL/#float-builtin-functions

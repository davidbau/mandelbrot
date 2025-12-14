# Adaptive Per-Pixel Scaling for GPU Perturbation

This document describes an adaptive scaling strategy that overcomes the escape detection precision limitation of the global-scaling approach (ScaledGpuZhuoranBoard).

## Problem Statement

The global scaling approach in ScaledGpuZhuoranBoard uses a single scale factor for all pixels:

```
δ_actual = δ_stored × 2^log2_scale
```

This fails at deep zooms (z > 10^6) because:
1. `log2_scale` becomes very negative (e.g., -133 at z=10^40)
2. `ldexp(dz, log2_scale)` produces values far smaller than float32 precision
3. When computing `Z_ref + δ × S`, the delta vanishes due to mantissa precision limits
4. All pixels appear identical in escape detection

**Root cause:** The global scale is fixed at initialization based on pixel spacing, but during iteration, δ grows from ~1 toward escape magnitude (~2). Near escape, δ_actual should be ~O(1), not ~O(10^-40).

## Solution: Per-Pixel Adaptive Scaling

Instead of a global scale, each pixel tracks its own scale factor that adjusts dynamically:

```
δ_actual = δ_stored × 2^(pixel_scale)

where pixel_scale starts at global_log2_scale and increases as δ grows
```

### Key Insight

At initialization:
- δ_stored ≈ 1 (normalized pixel offset)
- pixel_scale = log2_scale ≈ -133 (at z=10^40)
- δ_actual ≈ 10^-40 (correct initial delta)

As iteration progresses toward escape:
- δ_stored grows (would overflow without rescaling)
- When |δ_stored| > threshold, rescale: halve δ_stored, increment pixel_scale
- Near escape: δ_stored ≈ 1, pixel_scale ≈ 0, δ_actual ≈ 1
- Escape check: `Z_ref + ldexp(δ_stored, 0)` = `Z_ref + δ_stored` works correctly!

## Mathematical Derivation

### Standard Perturbation for z^n + c (Multibrot)

For the generalized Multibrot set with exponent n, the perturbation formula derives from the binomial expansion:

```
(Z + δ)^n + c = Z^n + c + Σ_{k=1}^{n} C(n,k) · Z^{n-k} · δ^k
```

The perturbation iteration is:
```
δ_{m+1} = Σ_{k=1}^{n} C(n,k) · Z_m^{n-k} · δ_m^k + δc
```

**For specific exponents:**

n=2 (Mandelbrot):
```
δ_{m+1} = 2·Z_m·δ_m + δ_m² + δc
```

n=3 (Cubic Multibrot):
```
δ_{m+1} = 3·Z_m²·δ_m + 3·Z_m·δ_m² + δ_m³ + δc
```

n=4 (Quartic Multibrot):
```
δ_{m+1} = 4·Z_m³·δ_m + 6·Z_m²·δ_m² + 4·Z_m·δ_m³ + δ_m⁴ + δc
```

### Adaptive Scaled Perturbation

Let δ_actual = δ_stored × 2^s where s is the per-pixel scale.

Substituting into the general perturbation formula:
```
δ_stored,m+1 × 2^{s_{m+1}} = Σ_{k=1}^{n} C(n,k) · Z_m^{n-k} · (δ_stored,m × 2^{s_m})^k + δc_actual
```

Dividing by 2^{s_m} (assuming no rescaling, s_{m+1} = s_m = s):
```
δ_stored,m+1 = Σ_{k=1}^{n} C(n,k) · Z_m^{n-k} · δ_stored,m^k · 2^{(k-1)·s} + δc_stored
```

where δc_stored = δc_actual / 2^s.

**Expanded for each term:**

| Term k | Coefficient | δ_stored power | Scale factor | At deep zoom (s << 0) |
|--------|-------------|----------------|--------------|----------------------|
| k=1 (linear) | n·Z^{n-1} | δ_stored | 2^0 = 1 | Dominant term |
| k=2 (quadratic) | C(n,2)·Z^{n-2} | δ_stored² | 2^s | Small |
| k=3 (cubic) | C(n,3)·Z^{n-3} | δ_stored³ | 2^{2s} | Negligible |
| k=j | C(n,j)·Z^{n-j} | δ_stored^j | 2^{(j-1)s} | 2^{(j-1)s} → 0 |

**For n=2 (Mandelbrot):**
```
δ_stored,m+1 = 2·Z_m·δ_stored,m + δ_stored,m² · 2^s + δc_stored
```

**For n=3 (Cubic):**
```
δ_stored,m+1 = 3·Z_m²·δ_stored,m + 3·Z_m·δ_stored,m² · 2^s + δ_stored,m³ · 2^{2s} + δc_stored
```

**For n=4 (Quartic):**
```
δ_stored,m+1 = 4·Z_m³·δ_stored,m + 6·Z_m²·δ_stored,m² · 2^s + 4·Z_m·δ_stored,m³ · 2^{2s} + δ_stored,m⁴ · 2^{3s} + δc_stored
```

### Rescaling Rules

**Case 1: No rescaling needed** (s_{m+1} = s_m = s)

Apply the formulas above directly.

**Case 2: Rescaling triggered** (|δ_stored,m+1| > threshold)
```
δ_stored,m+1 → δ_stored,m+1 / 2
s_{m+1} → s + 1
```

### Rescaling Procedure (Detailed Pseudocode)

The rescaling procedure maintains the invariant that `|dz_stored|` stays in a bounded range while preserving the true delta value `δ_actual = dz_stored × 2^scale`.

```
FUNCTION rescale(dz, s, s0):
    """
    Rescale dz and s to keep |dz| in the range [0.5, 2).

    Invariant: dz × 2^s represents the same actual delta before and after.

    Parameters:
        dz: Complex stored delta (will be modified)
        s:  Integer scale exponent (will be modified)
        s0: Initial scale (minimum allowed value for s)

    Returns: (dz_new, s_new)
    """

    dz_new = dz
    s_new = s

    # Compute magnitude (use max of components for efficiency)
    mag = max(|Re(dz_new)|, |Im(dz_new)|)

    # === UPSCALE: dz too large ===
    # If |dz| > 2, halve dz and increment scale
    # This may need multiple iterations if dz is very large
    WHILE mag > 2.0:
        dz_new = dz_new / 2       # Halve the stored value
        s_new = s_new + 1         # Compensate by doubling the scale factor
        mag = mag / 2

        # Invariant check: dz_new × 2^{s_new} = (dz/2) × 2^{s+1} = dz × 2^s ✓

    # === DOWNSCALE: dz too small (optional, for precision) ===
    # If |dz| < 0.5 and we have room to decrease scale, double dz
    # Don't go below initial scale (would make dc term overflow)
    WHILE mag < 0.5 AND s_new > s0:
        dz_new = dz_new * 2       # Double the stored value
        s_new = s_new - 1         # Compensate by halving the scale factor
        mag = mag * 2

        # Invariant check: dz_new × 2^{s_new} = (2×dz) × 2^{s-1} = dz × 2^s ✓

    RETURN (dz_new, s_new)
```

**Why the bounds [0.5, 2)?**

- **Upper bound 2**: Prevents overflow and keeps dz² reasonable (max ~4)
- **Lower bound 0.5**: Prevents underflow into subnormal float32 range
- **Powers of 2**: Rescaling by 2 is exact in floating-point (no rounding error)

**Example trace at z=10^40:**

```
Initial state:
  dz = (1.5, 0.8)      # Magnitude ~1.5
  s = -133             # Scale = 2^{-133} ≈ 10^{-40}
  δ_actual = dz × 2^s ≈ (1.5 × 10^{-40}, 0.8 × 10^{-40})

After many iterations, dz grows toward escape:

Iteration 4500:
  dz = (2.3, 1.1)      # |dz| = 2.3 > 2, trigger rescale!
  s = -70

  Rescale: dz = dz/2 = (1.15, 0.55), s = -69

  δ_actual = (1.15, 0.55) × 2^{-69}  # Same actual value

Iteration 4800:
  dz = (3.8, 2.1)      # |dz| = 3.8 > 2, rescale!
  s = -35

  Rescale: dz = (1.9, 1.05), s = -34
  Still > 2? No, done.

Near escape (iteration 4950):
  dz = (1.8, 0.9)      # Magnitude ~1.8
  s = -2               # Scale ≈ 0.25

  δ_actual = (1.8, 0.9) × 0.25 = (0.45, 0.225)
  z_actual = Z_ref + δ_actual ≈ (1.5, 0.8) + (0.45, 0.225) = (1.95, 1.025)
  |z_actual|² ≈ 4.85 > 4  →  ESCAPED!
```

**Key insight:** As δ grows from 10^{-40} toward escape (~2), the scale s grows from -133 toward 0. Near escape, `ldexp(dz, s)` produces O(1) values that can be meaningfully added to Z_ref for escape detection.

### Complete Iteration Pseudocode

Here is the full adaptive scaling iteration loop for exponent n=2 (Mandelbrot):

```
FUNCTION iterate_pixel(pixel, reference_orbit, max_iter):
    # Per-pixel state
    dz = pixel.dz_stored          # Complex, magnitude in [0.5, 2)
    s = pixel.scale               # Integer exponent
    dc = pixel.dc_stored          # Initial delta (normalized)
    s0 = pixel.initial_scale      # Scale at initialization
    ref_iter = pixel.ref_iter     # Current position in reference orbit

    FOR iter = pixel.current_iter TO max_iter:
        # Get reference orbit value at current iteration
        Z = reference_orbit[ref_iter]

        # === PERTURBATION RECURRENCE (n=2) ===
        #
        # True recurrence: δ_{m+1} = 2·Z·δ + δ² + δc
        #
        # With δ = dz·2^s and δc = dc·2^{s0}:
        #   dz_new·2^s = 2·Z·(dz·2^s) + (dz·2^s)² + dc·2^{s0}
        #   dz_new = 2·Z·dz + dz²·2^s + dc·2^{s0-s}

        # Linear term: 2·Z·dz (no scaling needed)
        linear = 2 * Z * dz

        # Quadratic term: dz²·2^s
        quadratic = dz² * ldexp(1, s)      # or: ldexp(dz², s)

        # Initial delta term: dc·2^{s0-s}
        dc_term = dc * ldexp(1, s0 - s)    # or: ldexp(dc, s0 - s)

        # Combine
        dz_new = linear + quadratic + dc_term
        s_new = s

        # === ADAPTIVE RESCALING ===
        # Keep |dz| in reasonable range [0.5, 2) for numerical stability

        IF |dz_new| > 2:
            dz_new = dz_new / 2
            s_new = s_new + 1
        ELSE IF |dz_new| < 0.5 AND s_new > s0:
            dz_new = dz_new * 2
            s_new = s_new - 1

        # Update state
        dz = dz_new
        s = s_new

        # === ESCAPE CHECK ===
        # Compute actual z = Z + δ = Z + dz·2^s
        delta_actual = dz * ldexp(1, s)    # or: ldexp(dz, s)
        z_actual = Z + delta_actual

        IF |z_actual|² > 4:
            RETURN iter                     # Escaped

        # === REBASING (optional, for stability) ===
        # When reference orbit passes near 0, rebase to absolute position
        IF |z_actual| < |delta_actual| * 0.5:
            # Re-encode absolute position as new delta from origin
            mag = |z_actual|
            s = ceil(log2(mag))             # New scale
            dz = z_actual / ldexp(1, s)     # New normalized delta
            ref_iter = 0                    # Restart from beginning of orbit
        ELSE:
            ref_iter = ref_iter + 1
            IF ref_iter >= len(reference_orbit):
                # Reference orbit exhausted, extend or mark as non-escaping
                ...

    RETURN -1  # Did not escape within max_iter
```

### Pseudocode for General Exponent n

```
FUNCTION iterate_pixel_general(pixel, reference_orbit, max_iter, n):
    dz = pixel.dz_stored
    s = pixel.scale
    dc = pixel.dc_stored
    s0 = pixel.initial_scale
    ref_iter = pixel.ref_iter

    FOR iter = pixel.current_iter TO max_iter:
        Z = reference_orbit[ref_iter]

        # === PERTURBATION RECURRENCE (general n) ===
        #
        # dz_new = Σ_{k=1}^{n} C(n,k)·Z^{n-k}·dz^k·2^{(k-1)s} + dc·2^{s0-s}
        #
        # Term k=1 (linear):  n·Z^{n-1}·dz           (no scaling)
        # Term k=2 (quad):    C(n,2)·Z^{n-2}·dz²·2^s
        # Term k=3 (cubic):   C(n,3)·Z^{n-3}·dz³·2^{2s}
        # ...
        # Term k=n:           dz^n·2^{(n-1)s}

        # Compute powers of Z
        Z_powers[0] = 1
        FOR j = 1 TO n-1:
            Z_powers[j] = Z_powers[j-1] * Z

        # Compute powers of dz
        dz_powers[1] = dz
        FOR j = 2 TO n:
            dz_powers[j] = dz_powers[j-1] * dz

        # Sum all terms with appropriate scaling
        dz_new = 0
        FOR k = 1 TO n:
            coeff = binomial(n, k)
            Z_pow = Z_powers[n - k]         # Z^{n-k}
            dz_pow = dz_powers[k]           # dz^k
            scale_factor = ldexp(1, (k-1) * s)

            dz_new = dz_new + coeff * Z_pow * dz_pow * scale_factor

        # Add initial delta term
        dz_new = dz_new + dc * ldexp(1, s0 - s)

        # === ADAPTIVE RESCALING ===
        s_new = s
        IF |dz_new| > 2:
            dz_new = dz_new / 2
            s_new = s_new + 1
        ELSE IF |dz_new| < 0.5 AND s_new > s0:
            dz_new = dz_new * 2
            s_new = s_new - 1

        dz = dz_new
        s = s_new

        # === ESCAPE CHECK ===
        z_actual = Z + ldexp(dz, s)
        IF |z_actual|² > 4:
            RETURN iter

        # Advance reference iteration (rebasing logic omitted for brevity)
        ref_iter = ref_iter + 1

    RETURN -1
```

### Key Properties

1. **δ_stored stays bounded:** Always in range (-2, 2) due to rescaling
2. **Per-pixel independence:** Each pixel's scale evolves independently
3. **Automatic normalization:** Near escape, scale approaches 0, making escape detection accurate
4. **Initial delta correct:** δc_stored × 2^(initial_scale) = δc_actual
5. **Higher-order terms vanish:** At deep zooms, all k≥2 terms become negligible

## Implementation

### Per-Pixel State

Each pixel needs:
```wgsl
struct PixelState {
    dz: vec2<f32>,      // Stored delta (real, imag)
    scale: i32,         // Per-pixel exponent (δ_actual = dz × 2^scale)
    ref_iter: u32,      // Current reference iteration
    // ... other state
}
```

### WGSL Shader Core Loop (n=2, Mandelbrot)

```wgsl
fn iterate_adaptive_n2(
    Z_n: vec2<f32>,        // Reference orbit at current iteration
    dz: vec2<f32>,         // Current stored delta
    dc: vec2<f32>,         // Initial delta (normalized)
    scale: i32,            // Current pixel scale
    initial_scale: i32     // Scale for dc term
) -> AdaptiveResult {
    // Linear term: 2·Z_n·dz (scale unchanged)
    let linear = 2.0 * cmul(Z_n, dz);

    // Quadratic term: dz² × 2^scale
    // Note: dz² has effective scale 2*scale, but we need scale for result
    // So: dz² × 2^scale = dz² × 2^(2*scale - scale) = dz² × 2^scale
    let dz_sq = cmul(dz, dz);
    let quadratic = vec2<f32>(
        ldexp(dz_sq.x, scale),
        ldexp(dz_sq.y, scale)
    );

    // Initial delta term: dc × 2^(initial_scale - scale)
    let scale_diff = initial_scale - scale;
    let dc_term = vec2<f32>(
        ldexp(dc.x, scale_diff),
        ldexp(dc.y, scale_diff)
    );

    // Combine
    var new_dz = linear + quadratic + dc_term;
    var new_scale = scale;

    // Rescale if needed to keep |dz| in reasonable range
    let dz_mag = max(abs(new_dz.x), abs(new_dz.y));
    if (dz_mag > 2.0) {
        new_dz = new_dz * 0.5;
        new_scale = new_scale + 1;
    } else if (dz_mag < 0.5 && new_scale > initial_scale) {
        // Optional: scale down to maintain precision (avoid subnormals)
        new_dz = new_dz * 2.0;
        new_scale = new_scale - 1;
    }

    return AdaptiveResult(new_dz, new_scale);
}
```

### WGSL Shader Core Loop (n=3, Cubic Multibrot)

```wgsl
fn iterate_adaptive_n3(
    Z_n: vec2<f32>,        // Reference orbit at current iteration
    dz: vec2<f32>,         // Current stored delta
    dc: vec2<f32>,         // Initial delta (normalized)
    scale: i32,            // Current pixel scale
    initial_scale: i32     // Scale for dc term
) -> AdaptiveResult {
    // Precompute Z² for efficiency
    let Z_sq = cmul(Z_n, Z_n);

    // Linear term: 3·Z²·dz (coefficient = C(3,1) = 3)
    let linear = 3.0 * cmul(Z_sq, dz);

    // Quadratic term: 3·Z·dz² × 2^scale (coefficient = C(3,2) = 3)
    let dz_sq = cmul(dz, dz);
    let quad_raw = 3.0 * cmul(Z_n, dz_sq);
    let quadratic = vec2<f32>(
        ldexp(quad_raw.x, scale),
        ldexp(quad_raw.y, scale)
    );

    // Cubic term: dz³ × 2^(2·scale) (coefficient = C(3,3) = 1)
    // At deep zooms, 2^(2·scale) underflows, so this term is negligible
    // Include it for correctness at shallow zooms
    let dz_cubed = cmul(dz_sq, dz);
    let cubic = vec2<f32>(
        ldexp(dz_cubed.x, 2 * scale),
        ldexp(dz_cubed.y, 2 * scale)
    );

    // Initial delta term: dc × 2^(initial_scale - scale)
    let scale_diff = initial_scale - scale;
    let dc_term = vec2<f32>(
        ldexp(dc.x, scale_diff),
        ldexp(dc.y, scale_diff)
    );

    // Combine all terms
    var new_dz = linear + quadratic + cubic + dc_term;
    var new_scale = scale;

    // Rescale if needed
    let dz_mag = max(abs(new_dz.x), abs(new_dz.y));
    if (dz_mag > 2.0) {
        new_dz = new_dz * 0.5;
        new_scale = new_scale + 1;
    } else if (dz_mag < 0.5 && new_scale > initial_scale) {
        new_dz = new_dz * 2.0;
        new_scale = new_scale - 1;
    }

    return AdaptiveResult(new_dz, new_scale);
}
```

### WGSL Shader Core Loop (General n, Using Horner's Method)

For arbitrary exponent n, use Horner's method with adaptive scaling:

```wgsl
fn iterate_adaptive_general(
    Z_n: vec2<f32>,        // Reference orbit at current iteration
    dz: vec2<f32>,         // Current stored delta
    dc: vec2<f32>,         // Initial delta (normalized)
    scale: i32,            // Current pixel scale
    initial_scale: i32,    // Scale for dc term
    exponent: u32          // The exponent n
) -> AdaptiveResult {
    // Horner's method: compute Σ C(n,k)·Z^{n-k}·dz^k with scaling
    //
    // Rewrite as: dz · (C(n,1)·Z^{n-1} + dz·(C(n,2)·Z^{n-2}·S + dz·(C(n,3)·Z^{n-3}·S² + ...)))
    //
    // where S = 2^scale
    //
    // Working from inside out:
    //   result = C(n,n)  [= 1]
    //   result = dz·result·S + C(n,n-1)·Z
    //   result = dz·result·S + C(n,n-2)·Z²
    //   ...
    //   result = dz·result + C(n,1)·Z^{n-1}  [no S on final step]

    var result = vec2<f32>(1.0, 0.0);  // Start with C(n,n) = 1
    var Z_power = Z_n;                  // Z^1
    var coeff = f32(exponent);          // C(n,1) = n, working backwards

    // Build up Z powers and coefficients
    var Z_powers: array<vec2<f32>, 8>;  // Support up to n=8
    var coeffs: array<f32, 8>;

    Z_powers[0] = vec2<f32>(1.0, 0.0);  // Z^0 = 1
    coeffs[0] = 1.0;                     // C(n,n) = 1

    for (var k = 1u; k < exponent; k++) {
        Z_powers[k] = cmul(Z_powers[k-1], Z_n);
        // C(n, n-k) = C(n, n-k+1) * (n-k+1) / k
        coeffs[k] = coeffs[k-1] * f32(k) / f32(exponent - k + 1);
    }

    // Horner evaluation from k=n down to k=1
    result = vec2<f32>(0.0, 0.0);

    for (var k = exponent; k >= 1u; k--) {
        // Multiply by dz
        result = cmul(result, dz);

        // Apply scaling factor S = 2^scale for terms k >= 2
        if (k < exponent) {
            result = vec2<f32>(
                ldexp(result.x, scale),
                ldexp(result.y, scale)
            );
        }

        // Add C(n,k) · Z^{n-k}
        let Z_pow_idx = exponent - k;
        let term = coeffs[k - 1] * Z_powers[Z_pow_idx];
        result = result + term;
    }

    // Final multiply by dz (for k=1 term, no scaling)
    result = cmul(result, dz);

    // Add initial delta term: dc × 2^(initial_scale - scale)
    let scale_diff = initial_scale - scale;
    let dc_term = vec2<f32>(
        ldexp(dc.x, scale_diff),
        ldexp(dc.y, scale_diff)
    );
    result = result + dc_term;

    var new_dz = result;
    var new_scale = scale;

    // Rescale if needed
    let dz_mag = max(abs(new_dz.x), abs(new_dz.y));
    if (dz_mag > 2.0) {
        new_dz = new_dz * 0.5;
        new_scale = new_scale + 1;
    } else if (dz_mag < 0.5 && new_scale > initial_scale) {
        new_dz = new_dz * 2.0;
        new_scale = new_scale - 1;
    }

    return AdaptiveResult(new_dz, new_scale);
}
```

**Note:** The general implementation above is illustrative. For production use, specialize for each exponent n to avoid array overhead and enable compiler optimizations.

### Escape Detection

```wgsl
fn check_escape(Z_ref: vec2<f32>, dz: vec2<f32>, scale: i32) -> bool {
    // Compute z = Z_ref + dz × 2^scale
    let delta_actual = vec2<f32>(
        ldexp(dz.x, scale),
        ldexp(dz.y, scale)
    );
    let z = Z_ref + delta_actual;
    return dot(z, z) > 4.0;
}
```

**Why this works at deep zooms:**

At z=10^40 near escape:
- Z_ref ≈ 1.5
- dz ≈ 1.0 (rescaled throughout iteration)
- scale ≈ 0 (incremented ~133 times from -133)
- delta_actual = ldexp(1.0, 0) = 1.0
- z = 1.5 + 1.0 = 2.5 (can correctly detect |z| > 2)

### Rebasing

```wgsl
fn should_rebase(Z_ref: vec2<f32>, dz: vec2<f32>, scale: i32) -> bool {
    let delta_actual = vec2<f32>(
        ldexp(dz.x, scale),
        ldexp(dz.y, scale)
    );
    let z_total = Z_ref + delta_actual;
    let total_mag = max(abs(z_total.x), abs(z_total.y));
    let dz_mag = max(abs(dz.x), abs(dz.y));

    // Rebase when total z is smaller than delta (ref orbit passing near origin)
    return total_mag < dz_mag * ldexp(1.0, scale) * 0.5;
}

fn rebase(Z_ref: vec2<f32>, dz: vec2<f32>, scale: i32, initial_scale: i32) -> RebaseResult {
    // Compute absolute position
    let delta_actual = vec2<f32>(
        ldexp(dz.x, scale),
        ldexp(dz.y, scale)
    );
    let z_total = Z_ref + delta_actual;

    // Re-encode as new delta from origin
    // New dz × 2^new_scale = z_total
    // Choose new_scale so |new_dz| is in (0.5, 2.0)
    let mag = max(abs(z_total.x), abs(z_total.y));
    let new_scale = i32(ceil(log2(mag)));
    let new_dz = vec2<f32>(
        ldexp(z_total.x, -new_scale),
        ldexp(z_total.y, -new_scale)
    );

    return RebaseResult(new_dz, new_scale);
}
```

### Rebasing Minimum z Threshold

Rebasing must be skipped when z is too small. After rebasing, the first iteration computes:

```
δ_new = 2·Z·δ + δ² + δc
```

For center pixels where δc ≈ 0, and after rebasing where δ = z:

```
δ_new ≈ 2·z·z + z² = 3z²
```

If z is very small (e.g., 1e-20), then δ_new ≈ 3e-40, which either underflows or produces a scale so negative that the pixel becomes "stuck" and cannot recover.

**Theoretical minimum:**

For z² to be representable in float32 (min normal ≈ 2^-126 ≈ 1e-38):

```
z² > 1e-38  →  z > 1e-19
```

**Empirical minimum:**

In practice, a threshold of **1e-13** is required. This provides ~10⁶× margin above the theoretical minimum, which is needed for:

1. Multiple iterations of slow growth before recovery
2. Accumulated precision loss in adaptive scaling calculations
3. Edge cases where the reference orbit passes through z values in the 1e-19 to 1e-13 range

Testing showed:
- Threshold 1e-19 (theoretical): Full bug manifestation
- Threshold 1e-15: ~75% of problematic pixels remain
- Threshold 1e-13: Only isolated outliers (<0.01% of pixels)
- Threshold 1e-10: Excessive f32 noise (missing necessary rebases)

**Implementation:**

```wgsl
// Skip rebasing when z is too small to avoid δ² underflow
let z_norm = max(abs(zr), abs(zi));
let dz_norm = max(abs(dzr_actual), abs(dzi_actual));

if (ref_iter > 0u && z_norm < dz_norm * 2.0 && z_norm > 1e-13) {
    // Safe to rebase
    ...
}
```

The threshold 1e-13 ≈ 2^-43 ensures that z² has scale around -86, leaving 40 bits of headroom above the -126 minimum scale floor.

### Memory Layout

```wgsl
// Option 1: Separate buffers
@group(0) @binding(0) var<storage, read_write> dz_buffer: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> scale_buffer: array<i32>;

// Option 2: Combined buffer (better cache locality)
struct PixelData {
    dz: vec2<f32>,
    scale: i32,
    ref_iter: u32,
}
@group(0) @binding(0) var<storage, read_write> pixels: array<PixelData>;
```

**Memory impact:** +4 bytes per pixel for the scale (i32).

## Convergence Detection

With adaptive scaling, convergence detection (for interior points) becomes more complex.

### Challenge

Standard convergence checks compare δ at checkpoint iterations to detect periodicity:
```
if |δ_n - δ_checkpoint| < ε, pixel is interior
```

With per-pixel scaling:
- δ at iteration n has scale s_n
- δ at checkpoint has scale s_checkpoint
- These may differ!

### Solutions

**Option 1: Disable convergence at deep zooms (simplest)**
```wgsl
// Only do convergence checking when scale is near initial_scale
if (scale > initial_scale + 10) {
    // Skip convergence check - too deep for meaningful comparison
}
```

**Option 2: Scale-aware comparison**
```wgsl
fn compare_deltas(dz1: vec2<f32>, scale1: i32, dz2: vec2<f32>, scale2: i32) -> f32 {
    // Convert both to actual values for comparison
    let actual1 = vec2<f32>(ldexp(dz1.x, scale1), ldexp(dz1.y, scale1));
    let actual2 = vec2<f32>(ldexp(dz2.x, scale2), ldexp(dz2.y, scale2));
    let diff = actual1 - actual2;
    return dot(diff, diff);
}
```

**Option 3: Normalized comparison (no ldexp needed)**
```wgsl
// If scale1 == scale2, compare directly
// If scales differ, adjust one delta
fn compare_deltas_normalized(dz1: vec2<f32>, scale1: i32, dz2: vec2<f32>, scale2: i32) -> f32 {
    if (scale1 == scale2) {
        let diff = dz1 - dz2;
        return dot(diff, diff);
    }
    // Bring to same scale
    let scale_diff = scale1 - scale2;
    let dz2_adjusted = vec2<f32>(
        ldexp(dz2.x, scale_diff),
        ldexp(dz2.y, scale_diff)
    );
    let diff = dz1 - dz2_adjusted;
    return dot(diff, diff);
}
```

**Recommendation:** Start with Option 1 (disable convergence at deep zooms), then implement Option 3 if convergence acceleration is needed.

## Initialization

```javascript
// CPU-side initialization
const initialScale = Math.floor(Math.log2(pixelSize));

for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
        const idx = py * width + px;

        // Normalized pixel offset (independent of zoom)
        const offsetX = px - width/2;
        const offsetY = py - height/2;

        // dc_stored = pixelOffset × mantissa
        // where pixelSize = mantissa × 2^initialScale
        const mantissa = pixelSize / Math.pow(2, initialScale);
        dcBuffer[idx * 2] = offsetX * mantissa;
        dcBuffer[idx * 2 + 1] = offsetY * mantissa;

        // Initial dz = dc (pixel starts at its initial position)
        dzBuffer[idx * 2] = dcBuffer[idx * 2];
        dzBuffer[idx * 2 + 1] = dcBuffer[idx * 2 + 1];

        // Initial scale = global scale
        scaleBuffer[idx] = initialScale;
    }
}
```

## Numerical Analysis

### Precision Throughout Iteration

At z=10^40 (initial_scale ≈ -133):

| Iteration Phase | δ_stored | scale | δ_actual | Escape Detection |
|-----------------|----------|-------|----------|------------------|
| Initial | ~1 | -133 | ~10^-40 | Not needed yet |
| Mid-iteration | ~1 | ~-70 | ~10^-20 | Not escaping |
| Near escape | ~1 | ~0 | ~1 | Works correctly! |

**Key insight:** The scale "catches up" as δ grows, keeping δ_stored normalized while δ_actual reaches escape-detectable magnitude.

### Error Analysis for General Exponent n

The iteration formula with adaptive scaling is:
```
δ_stored,m+1 = Σ_{k=1}^{n} C(n,k) · Z_m^{n-k} · δ_stored,m^k · 2^{(k-1)·s} + δc_stored
```

**Error sources:**

1. **Higher-order term truncation (k ≥ 2)**
2. **Float32 rounding in each term**
3. **Initial delta (δc) precision loss as scale increases**

#### Higher-Order Term Error Analysis

Let S = 2^s be the current scale factor (S << 1 at deep zooms).

**Exact iteration:**
```
δ_actual,m+1 = Σ_{k=1}^{n} C(n,k) · Z_m^{n-k} · δ_actual,m^k + δc_actual
```

**Computed iteration (dropping terms with k ≥ K for some cutoff K):**
```
δ_computed,m+1 ≈ Σ_{k=1}^{K-1} C(n,k) · Z_m^{n-k} · δ_actual,m^k + δc_actual
```

**Truncation error per iteration:**
```
ε_trunc = |Σ_{k=K}^{n} C(n,k) · Z_m^{n-k} · δ_actual,m^k|
```

Since δ_actual = δ_stored · S and |δ_stored| ≤ 2, |δ_actual| ≤ 2S.

**For k ≥ 2:**
```
|C(n,k) · Z_m^{n-k} · δ_actual^k| ≤ C(n,k) · |Z_m|^{n-k} · (2S)^k
                                  = C(n,k) · |Z_m|^{n-k} · 2^k · S^k
```

**Total truncation error (dropping k ≥ 2 terms):**
```
ε_trunc ≤ Σ_{k=2}^{n} C(n,k) · |Z_m|^{n-k} · 2^k · S^k
```

**Bound using |Z_m| ≤ 2 (pre-escape):**
```
ε_trunc ≤ Σ_{k=2}^{n} C(n,k) · 2^{n-k} · 2^k · S^k
        = Σ_{k=2}^{n} C(n,k) · 2^n · S^k
        = 2^n · Σ_{k=2}^{n} C(n,k) · S^k
        ≤ 2^n · (1+S)^n · S²    (for S << 1)
        ≈ 2^n · S²              (dominant term)
```

**Examples:**

| Exponent n | Truncation bound (per iter) | At S=10^-40 |
|------------|----------------------------|-------------|
| n=2 | 4·S² | ~10^-79 |
| n=3 | 8·S² | ~10^-79 |
| n=4 | 16·S² | ~10^-79 |
| n=8 | 256·S² | ~10^-78 |

**Accumulated error after N iterations:**

Error grows multiplicatively with the linear term coefficient (~n·|Z|^{n-1}). In the worst case:
```
ε_total ≈ ε_trunc · (n · |Z_max|^{n-1})^N
```

But since we rescale, S grows as δ grows. Near escape:
- S approaches 1
- Truncation error becomes significant
- However, we only need ~1 iteration at S≈1 before escape

**Key insight:** The error is dominated by iterations where S is largest (near escape), but those are the fewest iterations. The cumulative error remains sub-pixel.

#### Float32 Rounding Error

Each arithmetic operation has relative error ε_f32 ≈ 2^-24 ≈ 6×10^-8.

**Per iteration rounding error:**
- Linear term: n·Z^{n-1}·δ_stored requires ~n complex multiplications
- Each multiply has error ~ε_f32
- Total per-iteration error: ~n² · ε_f32 · |result|

**For n=2:** ~4 · 6×10^-8 = 2.4×10^-7 relative error per iteration
**For n=4:** ~16 · 6×10^-8 = 1×10^-6 relative error per iteration

**Accumulated over N=10000 iterations:**
```
ε_rounding ≈ N · n² · ε_f32 ≈ 10^4 · n² · 6×10^-8 = 6×10^-4 · n²
```

**For n=2:** ~0.2% accumulated rounding error
**For n=4:** ~1% accumulated rounding error

This is acceptable for visualization (sub-pixel accuracy not required for final image).

#### Initial Delta (δc) Precision

The δc term is applied as:
```
δc_stored · 2^{(initial_scale - scale)}
```

When `scale > initial_scale + 24`:
- The scale difference exceeds float32's 24-bit mantissa
- δc contribution effectively becomes 0

**This is correct behavior!** At that point:
- δ_actual has grown from ~pixel_size to ~1
- δc_actual (~pixel_size) is negligible compared to δ_actual
- Dropping δc introduces error ~δc_actual ≈ 10^-40 (at z=10^40), far below pixel precision

#### Error Summary by Exponent

| n | Truncation (per iter) | Rounding (total) | δc loss | Overall |
|---|----------------------|-----------------|---------|---------|
| 2 | O(S²) negligible | ~0.2% | Correct | Excellent |
| 3 | O(S²) negligible | ~0.5% | Correct | Very good |
| 4 | O(S²) negligible | ~1% | Correct | Good |
| 8 | O(S²) negligible | ~4% | Correct | Acceptable |

**Recommendation:** For n > 8, consider keeping the k=2 term to reduce truncation error, though rounding error will dominate anyway.

### Rescaling Frequency

At z=10^40 starting with scale=-133:
- δ grows roughly 2× per iteration near escape
- Need ~133 rescalings to reach scale=0
- If maxiter=10000, that's ~1% of iterations trigger rescaling
- Branching overhead is minimal on modern GPUs

## Performance Considerations

### Memory Bandwidth

Additional per-pixel data:
- 4 bytes (i32 scale)
- ~25% overhead vs. standard perturbation (16 bytes → 20 bytes per pixel)

### Compute Overhead

Per iteration:
- 2× ldexp for quadratic term (same as global scaling)
- 1× ldexp for dc term (new)
- 1× magnitude check for rescaling
- Conditional rescale (branch)

Estimated overhead: ~10-20% vs. standard perturbation, but enables deep zoom functionality.

### GPU Occupancy

- Divergent rescaling branches may reduce SIMD efficiency
- Mitigation: rescaling is infrequent (~1% of iterations)
- Most iterations follow the same code path

## Comparison with Global Scaling

| Aspect | Global Scaling | Adaptive Scaling |
|--------|----------------|------------------|
| Escape detection at z=10^40 | Fails (0% accuracy) | Works correctly |
| Memory per pixel | 16 bytes | 20 bytes (+25%) |
| Compute overhead | Minimal | ~10-20% |
| Implementation complexity | Simple | Moderate |
| Convergence detection | Simple | Requires adjustment |

## Implementation Roadmap

1. **Phase 1: Basic implementation**
   - Add per-pixel scale storage
   - Implement adaptive iteration with rescaling
   - Disable convergence detection initially
   - Test at z=10^10, z=10^20, z=10^40

2. **Phase 2: Optimization**
   - Tune rescaling threshold
   - Optimize memory layout
   - Profile GPU performance

3. **Phase 3: Convergence support**
   - Implement scale-aware checkpoint comparison
   - Re-enable convergence for interior detection

## Testing Strategy

```javascript
// Compare AdaptiveGpuZhuoranBoard vs OctZhuoranBoard (CPU reference)
const testCases = [
    { zoom: "1e10", c: "-0.74543+0.11301i" },
    { zoom: "1e20", c: "-0.74543+0.11301i" },
    { zoom: "1e40", c: "-0.74543+0.11301i" },
];

for (const test of testCases) {
    const adaptive = await runBoard("adaptivegpuzhuoran", test);
    const oct = await runBoard("octzhuoran", test);

    // Compare iteration counts
    const matchRate = compareIterations(adaptive.nn, oct.nn);
    console.log(`z=${test.zoom}: ${matchRate}% match`);

    // Should be >95% at all zoom levels
    expect(matchRate).toBeGreaterThan(95);
}
```

## References

- [SCALED-GPU-PERTURBATION.md](SCALED-GPU-PERTURBATION.md): Original global scaling approach
- [QD-PRECISION.md](QD-PRECISION.md): Oct-precision reference orbits
- WGSL ldexp specification: https://www.w3.org/TR/WGSL/#float-builtin-functions

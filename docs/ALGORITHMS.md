# Mandelbrot Algorithms

How the explorer computes the Mandelbrot set—from the basic iteration to the high-precision techniques that enable deep zooms beyond 10^30 magnification.

## The Basic Iteration

The Mandelbrot set is defined by a deceptively simple iteration for each complex number `c`:

```
z₀ = 0
zₙ₊₁ = zₙ^2 + c
```

For each complex number `c`, we iterate and ask: does the sequence stay bounded, or does it escape to infinity?

- If `|z| > 2`, the sequence will escape (diverge).
- If the sequence stays bounded, `c` is in the Mandelbrot set.

The iteration count when escape occurs determines the color of divergent pixels. Points in the set are colored black.

### Higher Exponents

The explorer supports higher exponents: `z^n + c` where `n >= 2`. The classic Mandelbrot set uses `n=2`, but `n=3` (Multibrot) and higher create different fractal shapes with `(n-1)`-fold rotational symmetry.

Why explore different exponents? The `n=2` case is mathematically special—it is the only exponent where the Mandelbrot set is connected. Higher exponents produce sets that break into separate pieces, each with its own intricate structure. The explorer lets you see how the familiar Mandelbrot shapes generalize: the main cardioid becomes a multi-lobed figure, and the branching patterns change character.

## Cycle Detection: Finding Convergent Points

A key idea in this explorer is to detect not just divergence but also *convergence*. Many points in the Mandelbrot set converge to periodic cycles:

- Period 1: z → z (fixed point)
- Period 2: z → z' → z (alternating)
- Period n: z returns to itself after n iterations

Why bother detecting convergence? Without it, points inside the set would iterate forever, never finishing. The naive approach—iterate to some fixed maximum and give up—leaves large regions marked "unknown" and wastes computation on points that settled into cycles long ago. By detecting convergence, we can mark these points as definitively inside the set, stop wasting iterations on them, and concentrate computation on the genuinely undecided pixels at the boundary.

### The Checkpoint Method

We detect cycles using checkpoints at Fibonacci iteration numbers. The idea is simple: periodically save the current `z` value, then check if later `z` values return to that checkpoint. If `z` comes back to where it was, we have found a cycle.

```javascript
// At iterations 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, ...
if (isFibonacci(iteration)) {
  checkpoint[pixel] = z[pixel];  // Save current z
}

// Check if current z matches any recent checkpoint
const delta = |z - checkpoint|;
if (delta < epsilon) {
  // Converged! Period ≈ (current_iter - checkpoint_iter)
  markConverged(pixel, iteration);
}
```

### Fibonacci Checkpoint Intervals

Originally, powers of 2 were used for checkpoint intervals. The problem was that orbits could go undetected for too long between checkpoints, and more frequent checkpoints slowed down the GPU. Fibonacci numbers solve both problems. The intervals grow slowly enough to catch cycles quickly, yet the pattern is GPU-friendly. As a bonus, consecutive Fibonacci numbers are coprime, which avoids periodic coincidences that might otherwise prevent cycle detection.

### Epsilon Thresholds

Two epsilon values control detection sensitivity, and they scale with `pixelSize` to remain meaningful at any zoom level. At deep zooms, a fixed epsilon would be far too loose.

```javascript
this.epsilon = Math.min(1e-12, pixelSize / 10);   // Strict: confirmed convergence
this.epsilon2 = Math.min(1e-9, pixelSize * 10);   // Loose: probable convergence
```

When `|z - checkpoint| < epsilon2`, we note the iteration as a candidate period. When it drops below `epsilon`, we confirm convergence. This two-stage approach catches gradual, spiraling convergence earlier while avoiding false positives.

## Perturbation Theory: Breaking the Precision Barrier

Standard 64-bit floating point breaks down around 10^15 magnification. The solution is **perturbation theory**: instead of computing `z` directly for each pixel, we compute its tiny difference (`dz`) from a high-precision reference orbit.

### The Key Insight

If we have a reference point `C` with orbit `Z₀, Z₁, Z₂, ...` computed in high precision, and a nearby point `c = C + dc`, its orbit is `z = Z + dz`. The iteration `z² + c` becomes:

`(Z + dz)² + (C + dc) = (Z² + C) + (2·Z·dz + dz² + dc)`

Since `Z_next = Z² + C`, the perturbation `dz` evolves according to:
`dz_next = 2·Z·dz + dz² + dc`

The magic is that even if `dc` and `dz` are tiny (e.g., 10^-30), we only need standard `Float64` precision to track their *relative* differences. The reference orbit `Z` handles the large-scale structure.

### Binomial Expansion for Higher Exponents

For `z^n + c`, the formula uses the binomial expansion, which is evaluated efficiently on the GPU using Horner's method.
`(Z + dz)^n - Z^n = n·Z^(n-1)·dz + (n choose 2)·Z^(n-2)·dz^2 + ... + dz^n`

### The Zhuoran Method: Glitch-Free Deep Zoom
When the reference orbit `Z` passes near a critical point (like `z=0`), `dz` can grow explosively, causing visual "glitches." The "Zhuoran" method solves this with **rebasing**: when the total orbit `Z + dz` gets too close to a critical point, we reset `dz` to become the new absolute `z`, and the pixel starts tracking the reference orbit from the beginning.

## Quad-Precision Arithmetic

Reference orbits are computed using "quad-double" arithmetic, where each number is the unevaluated sum of two `Float64`s. This gives about 31 decimal digits of precision, pushing the zoom limit from 10^15 to 10^30. The technique uses algorithms by Dekker and Kahan to capture the exact rounding error from standard floating-point operations.

```javascript
// Quad number 'a' is [a_high, a_low]
function qdAdd(a, b) {
  let [s1, s0] = twoSum(a[0], b[0]); // Add high parts
  s0 += a[1] + b[1];                // Add low parts and error
  return fast2Sum(s1, s0);          // Renormalize the result
}
```

The multiplication algorithm uses the **Veltkamp-Dekker splitting constant** (`2^27 + 1`) to split a `Float64` into two non-overlapping parts without rounding error, a technique from Dekker's 1971 paper.

## Thread Following: Robust Cycle Detection

Deep zoom cycle detection is tricky because pixels can rebase. The solution is "thread following": tracking when the reference orbit comes close to a previous position. When the reference at iteration 1000 is close to where it was at iteration 200, we record a "thread." If a pixel later finds itself near iteration 200 of the reference, the thread tells us its future path. This is implemented efficiently using **spatial hashing** (bucketing) to avoid O(n^2) checks.

## Algorithm Selection

The `Scheduler` automatically selects the best algorithm for the job:

| Pixel Size | GPU Available | Board Type | Notes |
|------------|---------------|------------|-------|
| > 1e-6 | Yes | **GpuBoard** | Fast, parallel, but uses `float32` which has limited precision. |
| > 1e-12 | No | **CpuBoard** | Simple `float64` iteration on the CPU. |
| <= 1e-6 | Yes | **GpuZhuoranBoard** | The workhorse for deep GPU zooms. Uses a quad-precision reference orbit with `float32` perturbations and rebasing. |
| <= 1e-12 | No | **PerturbationBoard** | The CPU fallback for deep zooms. Uses quad-precision reference orbits and a multi-reference grid. |

## References

- [Deep zoom theory and practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) by Claude Heiland-Allen
- [Zhuoran's rebasing technique](https://fractalforums.org/fractal-mathematics-and-new-theories/28/another-solution-to-perturbation-glitches/4360) (Original forum post)
- [Double-double arithmetic](https://web.mit.edu/tabbott/Public/quaddouble-debian/qd-2.3.4-old/docs/qd.pdf) (The QD library paper by Hida, Li, and Bailey)
- [Dekker's 1971 paper](https://csclub.uwaterloo.ca/~pbarfuss/dekker1971.pdf), "A floating-point technique for extending the available precision"
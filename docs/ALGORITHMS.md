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

The strict `epsilon` is a fraction of the pixel size to confirm the orbit has settled well within a pixel's area. The looser `epsilon2` is larger than a pixel to generously detect orbits that are merely approaching a cycle.

When `|z - checkpoint| < epsilon2`, we note the iteration as a candidate period. When it drops below `epsilon`, we confirm convergence. This two-stage approach catches gradual, spiraling convergence earlier while avoiding false positives.

Why two thresholds? Convergence to a cycle is gradual—the orbit spirals inward, getting closer each time. A single tight threshold would miss early detection opportunities. The loose threshold (`epsilon2`) lets us notice "this point is probably converging" and record the likely period. The strict threshold (`epsilon`) confirms it.

## Perturbation Theory: Breaking the Precision Barrier

Standard 64-bit floating point breaks down around 10^15 magnification. The solution is **perturbation theory**: instead of computing `z` directly for each pixel, we compute its tiny difference (`dz`) from a high-precision reference orbit.

### The Key Insight

If we have a reference point `C` with orbit `Z₀, Z₁, Z₂, ...` computed in high precision, and a nearby point `c = C + dc`, its orbit is `z = Z + dz`. The iteration `z² + c` becomes:

`(Z + dz)² + (C + dc) = (Z² + C) + (2·Z·dz + dz² + dc)`

Since `Z_next = Z² + C`, the perturbation `dz` evolves according to:
`dz_next = 2·Z·dz + dz² + dc`

The magic is that even if `dc` and `dz` are tiny (e.g., 10^-30), we only need standard `Float64` precision to track their *relative* differences. The reference orbit `Z` handles the large-scale structure.

Why does this work? The key insight is that neighboring pixels follow nearly identical orbits—they start close together and stay close together (until one escapes). Rather than computing each orbit independently to 30+ digits of precision, we compute one reference orbit accurately and track how the others deviate from it. The deviations are small numbers that standard double precision can handle, even when the absolute positions would require extended precision.

### Binomial Expansion for Higher Exponents

For `z^n + c`, the formula uses the binomial expansion, which is evaluated efficiently on the GPU using [Horner's method](https://en.wikipedia.org/wiki/Horner%27s_method):
`(Z + dz)^n - Z^n = n·Z^(n-1)·dz + (n choose 2)·Z^(n-2)·dz^2 + ... + dz^n`

Rather than computing the full expansion each iteration, the code precomputes the coefficients and powers of Z:

```javascript
fillBinZpow(binZpow, zr, zi) {
  let zrCurrent = zr, ziCurrent = zi;
  let coeff = this.config.exponent;  // Start with n

  for (let k = 1; k < this.config.exponent - 1; k++) {
    binZpow[k*2-2] = coeff * zrCurrent;
    binZpow[k*2-1] = coeff * ziCurrent;

    // Update z power: z_current = z_current * z (complex multiplication)
    const zrNew = zrCurrent * zr - ziCurrent * zi;
    ziCurrent = zrCurrent * zi + ziCurrent * zr;
    zrCurrent = zrNew;

    // Update coefficient for next iteration: n*(n-1)/2, then n*(n-1)*(n-2)/6, etc.
    coeff *= (this.config.exponent - k) / (k + 1);
  }
}
```

The coefficient update formula `coeff *= (n-k)/(k+1)` generates binomial coefficients incrementally without computing factorials. For exponent 4, the sequence is: 4, 6, 4, 1—exactly `(4 choose 1)`, `(4 choose 2)`, etc. This cache is rebuilt only when the reference pixel changes, avoiding redundant computation.

### The Zhuoran Method: Glitch-Free Deep Zoom
When the reference orbit `Z` passes near a critical point (like `z=0`), `dz` can grow explosively, causing visual "glitches." The "Zhuoran" method solves this with **rebasing**: when the total orbit `Z + dz` gets too close to a critical point, we reset `dz` to become the new absolute `z`, and the pixel starts tracking the reference orbit from the beginning.

```javascript
iteratePixel(index) {
  const totalR = refR + dzR;  // Absolute z position
  const totalI = refI + dzI;

  // Check if we should rebase
  if (totalR * totalR + totalI * totalI < this.rebaseThreshold) {
    // Reset: dz becomes the full z, reference restarts
    this.dz[index * 2] = totalR;
    this.dz[index * 2 + 1] = totalI;
    this.refIter[index] = 0;  // Start following reference from beginning
  }
}
```

The beauty of rebasing is that it *avoids* glitches rather than detecting and correcting them. You only need one reference orbit (computed once at the center), and all pixels can rebase as needed.

### PerturbationBoard: Multi-Reference Grid

`PerturbationBoard` uses a different approach: a grid of reference points rather than a single reference with rebasing. Each reference point is computed in quad precision, and nearby pixels use double-precision perturbations. When a pixel's perturbation grows too large, it switches to full quad-precision iteration for the remainder.

This multi-reference approach handles regions where orbits diverge significantly from any single reference. Compared to `ZhuoranBoard`'s single-reference rebasing, it has higher overhead from computing many reference orbits, but the memory access pattern is more cache-friendly and the per-pixel bookkeeping is simpler.

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

```javascript
function qdSplit(a) {
  const c = 134217729 * a;  // 2^27 + 1
  const x = c - (c - a);    // high 27 bits
  const y = a - x;          // low 26 bits
  return [x, y];
}
```

IEEE 754 doubles have 53-bit mantissas. Multiplying by `2^27 + 1` and then subtracting cleverly exploits floating-point rounding to isolate the high 27 bits. With 27 bits in the high part and 26 in the low part, the two pieces do not overlap and their sum exactly equals the original.

## Thread Following: Robust Cycle Detection

Deep zoom cycle detection is tricky because pixels can rebase. Without rebasing, pixel iteration count and reference iteration stay synchronized—if a pixel is at iteration 5000, it is comparing against reference iteration 5000. But after rebasing, a pixel might be at iteration 5000 while following reference iteration 200.

The solution is "thread following": tracking when the reference orbit comes close to a previous position. When the reference at iteration 1000 is close to where it was at iteration 200, we record a "thread." If a pixel later finds itself near iteration 200 of the reference, the thread tells us its future path.

### Spatial Bucketing

The naive approach—checking every previous iteration—is O(n²). For orbits with millions of iterations, this is prohibitive. The code uses spatial hashing to reduce this to O(1) amortized:

```javascript
class ReferenceOrbitThreading {
  constructor(epsilon) {
    this.bucketSize = 2 * epsilon;
    this.spatialBuckets = new Map();  // "x,y" -> [indices]
  }

  addOrbitPoint(currentIndex, re, im, getPoint) {
    const bx = Math.floor(re / this.bucketSize);
    const by = Math.floor(im / this.bucketSize);

    // Check 3x3 neighborhood of buckets
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.spatialBuckets.get(`${bx+dx},${by+dy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          const pt = getPoint(j);
          if (distance(re, im, pt) < epsilon) {
            this.recordThread(j, currentIndex);  // Found a thread!
          }
        }
      }
    }
    this.addToBucket(bx, by, currentIndex);
  }
}
```

The bucket size is `2 * epsilon`, so any two points within epsilon are guaranteed to be in the same or adjacent buckets. Checking 9 buckets instead of the entire history transforms O(n²) into O(n).

## Algorithm Selection

The `Scheduler` automatically selects the best algorithm for the job:

| Pixel Size | GPU Available | Board Type | Notes |
|------------|---------------|------------|-------|
| > 1e-7 | Yes | **GpuBoard** | Fast, parallel, uses `float32` direct iteration. |
| > 1e-15 | No | **CpuBoard** | Simple `float64` iteration on the CPU. |
| 1e-30 to 1e-7 | Yes | **GpuZhuoranBoard** | GPU perturbation with quad-precision reference orbit, `float32` deltas, and rebasing. |
| 1e-30 to 1e-15 | No | **PerturbationBoard** | CPU perturbation with quad-precision reference, `float64` deltas. |
| < 1e-30 | Yes | **AdaptiveGpuBoard** | GPU perturbation with oct-precision reference (~62 digits) and per-pixel adaptive scaling. |
| < 1e-30 | No | **OctZhuoranBoard** | CPU perturbation with oct-precision reference (~62 digits). |

## Unsolved Problems

### Chaotic Regions

Some points in the Mandelbrot set are genuinely chaotic—they neither escape nor converge to a detectable cycle. The classic example is the real axis between -2 and the Feigenbaum point (-1.401155...), called "the spike." Since many of these points will never converge to finite cycles, the code caps iteration at MAX_CHAOTIC_ITERATIONS (100,000) and colors them black.

### Very Long Periods

Points can have periods of millions of iterations. With Fibonacci checkpoints, detecting period 1,000,000 requires reaching iteration ~1,600,000 (the nearest larger Fibonacci). This is correct but slow.

### Period Harmonics

 This is not a visual bug, as the point is still correctly identified as being inside the set and colored black. The only consequence is that the 'period' number shown in the hover details may be a multiple of the true minimum period.

### Precision Limits

Beyond 10^30 magnification, quad precision (~31 digits) starts to degrade. The explorer automatically switches to oct precision (4-double, ~62 digits) for zooms beyond 10^30, enabling exploration to 10^60 magnification and beyond.

## References

- [Deep zoom theory and practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) by Claude Heiland-Allen
- [Zhuoran's rebasing technique](https://fractalforums.org/fractal-mathematics-and-new-theories/28/another-solution-to-perturbation-glitches/4360) (Original forum post)
- [Deep zoom theory and practice (rebasing)](https://mathr.co.uk/blog/2022-02-21_deep_zoom_theory_and_practice_again.html) by Claude Heiland-Allen
- [Double-double arithmetic](https://web.mit.edu/tabbott/Public/quaddouble-debian/qd-2.3.4-old/docs/qd.pdf) (The QD library paper by Hida, Li, and Bailey)
- [Dekker's 1971 paper](https://csclub.uwaterloo.ca/~pbarfuss/dekker1971.pdf), "A floating-point technique for extending the available precision"
- [Feigenbaum point](http://www.mrob.com/pub/muency/feigenbaumpoint.html) - The chaotic boundary at c = -1.401155...

## Next Steps

- [COMPUTATION.md](COMPUTATION.md): How computation is distributed across threads
- [COLORS.md](COLORS.md): Mapping iterations to colors
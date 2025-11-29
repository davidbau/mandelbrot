# Mandelbrot Algorithms

How the explorer computes the Mandelbrot set - from basic iteration to the
perturbation techniques that enable deep zooms beyond 10^30 magnification.

## The Basic Iteration

The Mandelbrot set is defined by a deceptively simple iteration:

```
z₀ = 0
zₙ₊₁ = zₙ² + c
```

For each complex number `c`, we iterate and ask: does the sequence stay bounded,
or does it escape to infinity?

- If |z| > 2, the sequence will escape (diverge)
- If the sequence stays bounded, `c` is in the Mandelbrot set

The iteration count when escape occurs determines the color of divergent pixels.
Points in the set are colored black.

### Higher Exponents

The explorer supports higher exponents: z^n + c where n ≥ 2. The classic
Mandelbrot set uses n=2, but n=3 (Multibrot) and higher create different
fractal shapes with (n-1)-fold rotational symmetry.

Why explore different exponents? The n=2 case is mathematically special - it is
the only exponent where the Mandelbrot set is connected. Higher exponents produce
sets that break into separate pieces, each with its own intricate structure. The
explorer lets you see how the familiar Mandelbrot shapes generalize: the main
cardioid becomes a multi-lobed figure, and the branching patterns change character.

## Cycle Detection: Finding Convergent Points

The key idea in this explorer: detect not just divergence but *convergence*.
Many points in the Mandelbrot set converge to periodic cycles:

- Period 1: z → z (fixed point)
- Period 2: z → z' → z (alternating)
- Period n: z returns to itself after n iterations

Why bother detecting convergence? Without it, points inside the set would iterate
forever, never finishing. The naive approach - iterate to some fixed maximum and
give up - leaves large regions marked "unknown" and wastes computation on points
that settled into cycles long ago. By detecting convergence, we can mark these
points as definitively inside the set, stop wasting iterations on them, and
concentrate computation on the genuinely undecided pixels at the boundary.

### The Checkpoint Method

We detect cycles using checkpoints at Fibonacci iteration numbers. The idea is
simple: periodically save the current z value, then check if later z values
return to that checkpoint. If z comes back to where it was, we have found a cycle.

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

Originally I used powers of 2 (1, 2, 4, 8, 16...) for checkpoint intervals. The
problem was that orbits could go undetected for too long between checkpoints,
and when I tried more frequent checkpoints, the GPU computation became very slow.

Fibonacci numbers (1, 1, 2, 3, 5, 8, 13, 21, 34, 55...) solve both problems.
The intervals grow slowly enough to catch cycles quickly, yet the pattern is
GPU-friendly with minimal branching overhead. As a bonus, consecutive Fibonacci
numbers are coprime, which avoids periodic coincidences that might otherwise
prevent cycle detection.

### Epsilon Thresholds

Two epsilon values control detection sensitivity:

```javascript
this.epsilon = Math.min(1e-12, pixelSize / 10);   // Strict: confirmed convergence
this.epsilon2 = Math.min(1e-9, pixelSize * 10);   // Loose: probable convergence
```

When `|z - checkpoint| < epsilon2`, we note the iteration as a candidate period.
When it drops below `epsilon`, we confirm convergence and stop iterating.

Why two thresholds? Convergence to a cycle is gradual - the orbit spirals inward,
getting closer each time. A single tight threshold would miss early detection
opportunities. The loose threshold (`epsilon2`) lets us notice "this point is
probably converging" and record the likely period. The strict threshold (`epsilon`)
confirms it. This two-stage approach catches convergence earlier while avoiding
false positives from orbits that happen to pass near a checkpoint once.

The thresholds also scale with pixel size. At deep zoom, adjacent pixels represent
points that differ by 10^-20 or less. Using a fixed epsilon like 1e-12 would be
far too loose - every pixel would appear to converge to the same cycle. Scaling
epsilon with pixel size keeps detection meaningful at any zoom level.

## Perturbation Theory: Breaking the Precision Barrier

Standard 64-bit floating point breaks down around 10^15 magnification. Beyond
that, the pixels are so close together that double precision cannot distinguish them.

The solution is *perturbation theory*: instead of computing z directly for each
pixel, we compute the difference (perturbation) from a high-precision reference orbit.

### The Key Insight

If we have a reference point `C` with orbit `Z₀, Z₁, Z₂, ...` computed in high
precision, and a nearby point `c = C + dc` (where `dc` is tiny), then:

```
z = Z + dz  (perturbation from reference)
```

The iteration formula becomes:

```
z² + c = (Z + dz)² + (C + dc)
       = Z² + 2·Z·dz + dz² + C + dc
       = (Z² + C) + (2·Z·dz + dz² + dc)
       = Z_next + (2·Z·dz + dz² + dc)
```

So: `dz_next = 2·Z·dz + dz² + dc`

The magic: even though `dc` and `dz` are tiny (10^-30 or smaller), we only need
enough precision to track their *relative* differences. The reference orbit `Z`
handles the large-scale structure.

Why does this work? The key insight is that neighboring pixels follow nearly
identical orbits - they start close together and stay close together (until one
escapes). Rather than computing each orbit independently to 30+ digits of precision,
we compute one reference orbit accurately and track how the others deviate from it.
The deviations are small numbers that standard double precision can handle, even
when the absolute positions would require extended precision.

### Binomial Expansion for Higher Exponents

For the classic z² + c, the perturbation formula is simple. But what about
z³ + c or z⁴ + c? The explorer supports arbitrary exponents using the binomial
expansion. This formulation also avoids catastrophic subtraction, enabling
higher-precision calculations that are especially important on the GPU:

```
(Z + dz)^n - Z^n = n·Z^(n-1)·dz + (n choose 2)·Z^(n-2)·dz² + ... + dz^n
```

The GPU shader evaluates this polynomial efficiently using
[Horner's method](https://en.wikipedia.org/wiki/Horner%27s_method), which
restructures the sum as nested multiplications to minimize operations and
improve numerical stability.

Rather than computing the full expansion each iteration, the code precomputes
the coefficients and powers of Z:

```javascript
fillBinZpow(binZpow, zr, zi) {
  let zrCurrent = zr, ziCurrent = zi;
  let coeff = this.config.exponent;  // Start with n

  for (let k = 1; k < this.config.exponent - 1; k++) {
    binZpow[k*2-2] = coeff * zrCurrent;
    binZpow[k*2-1] = coeff * ziCurrent;

    // Next power of z
    const zrNew = zrCurrent * zr - ziCurrent * zi;
    ziCurrent = zrCurrent * zi + ziCurrent * zr;
    zrCurrent = zrNew;

    // Coefficient: n*(n-1)/2, then n*(n-1)*(n-2)/6, etc.
    coeff *= (this.config.exponent - k) / (k + 1);
  }
}
```

The coefficient update formula `coeff *= (n-k)/(k+1)` generates binomial
coefficients incrementally without computing factorials. For exponent 4, the
sequence is: 4, 6, 4, 1 - exactly `(4 choose 1)`, `(4 choose 2)`, etc.

This cache is rebuilt only when the reference pixel changes, avoiding redundant
computation when iterating thousands of perturbation pixels that share the same
reference.

Why precompute? The binomial expansion has n-1 terms for exponent n. Computing
Z^k and the binomial coefficients from scratch each iteration would multiply the
work by a factor of n. Since all pixels share the same reference Z at each iteration,
we compute the Z powers and coefficients once and reuse them across all pixels.
This keeps the cost of higher exponents manageable.

### PerturbationBoard (Quad Precision)

PerturbationBoard uses a grid of reference points rather than a single reference.
Each reference point is computed in quad precision (about 31 decimal digits),
and nearby pixels use double-precision perturbations relative to their assigned
reference. When a pixel's perturbation grows too large (indicating the reference
is no longer a good approximation), the pixel switches to full quad-precision
iteration for the remainder of its computation.

This multi-reference approach handles regions where orbits diverge significantly
from any single reference. The disadvantage compared to ZhuoranBoard's single-
reference rebasing is the overhead of computing many reference orbits. However,
PerturbationBoard turns out to be faster on CPU for several reasons: the grid
of references avoids the per-pixel rebasing checks that ZhuoranBoard requires,
the memory access pattern is more cache-friendly, and pixels that exceed the
perturbation threshold can switch to straight quad-precision iteration without
the bookkeeping of tracking reference positions:

```javascript
class PerturbationBoard extends Board {
  iteratePixel(index) {
    const dr = this.dz[index * 2];      // perturbation real
    const di = this.dz[index * 2 + 1];  // perturbation imag
    const Zr = this.refOrbit[this.it * 2];     // reference real
    const Zi = this.refOrbit[this.it * 2 + 1]; // reference imag

    // dz_next = 2*Z*dz + dz² + dc
    const new_dr = 2 * (Zr * dr - Zi * di) + dr*dr - di*di + this.dc[index * 2];
    const new_di = 2 * (Zr * di + Zi * dr) + 2*dr*di + this.dc[index * 2 + 1];

    // If perturbation grows too large, switch to quad precision
    if (new_dr * new_dr + new_di * new_di > this.perturbationLimit) {
      this.switchToFullPrecision(index);
      return;
    }

    this.dz[index * 2] = new_dr;
    this.dz[index * 2 + 1] = new_di;
  }
}
```

## The Zhuoran Method: Glitch-Free Deep Zoom

Perturbation has a problem: when the perturbed orbit gets too close to a
critical point (like z=0), the perturbation `dz` can grow suddenly while
the reference `Z` is small. This causes "glitches" - visual artifacts.

In December 2021, Zhuoran [proposed "rebasing"](https://fractalforums.org/fractal-mathematics-and-new-theories/28/another-solution-to-perturbation-glitches/4360)
on fractalforums.org: when the total orbit `Z + dz` gets near a critical point,
reset the reference iteration to start over from there.

### Rebasing in Action

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

The beauty of rebasing is that it *avoids* glitches rather than detecting and
correcting them. You only need one reference orbit (computed once at the center),
and all pixels can rebase as needed.

## Quad Precision Arithmetic

Both PerturbationBoard and ZhuoranBoard use quad precision for reference orbit
computation. Each number is stored as the unevaluated sum of two IEEE doubles,
giving about 31 decimal digits of precision. This is enough for zooms to around
10^30.

A single IEEE double has a 53-bit mantissa, giving about 15-16 decimal digits.
Two doubles together have 106 bits of mantissa, but the representation does not
pack them perfectly since there is some overlap and the low word has reduced
range. The effective precision works out to roughly 2 × 53 - 22 ≈ 84 bits, or
about 31 decimal digits. This is not arbitrary-precision arithmetic, but it is
enough to push the zoom limit from 10^15 to 10^30.

```javascript
// Quad: [high, low] where value = high + low
function qdAdd(a, b) {
  let [s1, s0] = twoSum(a[0], b[0]);
  s0 += a[1] + b[1];
  return fast2Sum(s1, s0);
}

function qdMul(a, b) {
  let [p1, p0] = twoProd(a[0], b[0]);
  p0 += a[0] * b[1] + a[1] * b[0];
  return fast2Sum(p1, p0);
}
```

These operations use the Dekker/Kahan algorithms (twoSum, twoProd) that extract
the exact error from IEEE floating-point operations.

### The Veltkamp-Dekker Splitting Constant

The multiplication algorithm depends on a subtle trick: splitting a double into
high and low parts without rounding error. The code uses `134217729`, which is
`2^27 + 1`:

```javascript
function qdSplit(a) {
  const c = 134217729 * a;  // 2^27 + 1
  const x = c - (c - a);    // high 27 bits
  const y = a - x;          // low 26 bits
  return [x, y];
}
```

IEEE 754 doubles have 53-bit mantissas. We need to split a into two parts that
do not overlap, with the high part getting roughly half the bits and the low
part the rest. Multiplying by `2^27 + 1` and then subtracting cleverly exploits
floating-point rounding to isolate the high 27 bits. The number 27 is chosen
because 27 + 26 = 53, exactly filling the mantissa. With 27 bits in the high
part and 26 in the low part, the two pieces do not overlap and their sum exactly
equals the original. This technique dates to T.J. Dekker's 1971 paper "A
floating-point technique for extending the available precision."

The `twoProduct` function then uses these splits to compute the exact product
of two doubles as the sum of two doubles, the rounded result plus the rounding
error:

```javascript
function twoProduct(a, b) {
  let p = a * b;                              // Rounded product
  let [ah, al] = qdSplit(a);
  let [bh, bl] = qdSplit(b);
  let err = ((ah*bh - p) + ah*bl + al*bh) + al*bl;  // Exact error
  return [p, err];
}
```

## Thread Following: Robust Cycle Detection

Deep zoom cycle detection is tricky. The reference orbit may cycle, but
individual pixels might have different periods or be at different phases.
When pixels rebase (restart from the beginning of the reference), naive
cycle detection breaks - the pixel's iteration count no longer matches
the reference orbit position.

Why is rebasing a problem for cycle detection? Without rebasing, pixel iteration
count and reference iteration stay synchronized - if a pixel is at iteration 5000,
it is comparing against reference iteration 5000. But after rebasing, a pixel might
be at iteration 5000 while following reference iteration 200. If we only save
checkpoints at the pixel's iteration count, we miss cycles that the reference
orbit reveals.

The solution is "thread following" - tracking which reference orbit positions
are close to each other. When the reference at iteration 1000 is close to where
it was at iteration 200, we record a "thread" linking them. Later, when a pixel
rebases and finds itself near iteration 200 of the reference, we know it will
soon be near iteration 1000 as well - the thread tells us the orbit's future.

### Spatial Bucketing

The naive approach - checking every previous iteration - is O(n²). For orbits
with millions of iterations, this is prohibitive. The code uses spatial hashing
to reduce this to O(1) amortized:

```javascript
class ReferenceOrbitThreading {
  constructor(epsilon) {
    this.bucketSize = 2 * epsilon;
    this.spatialBuckets = new Map();  // "x,y" -> [indices]
    this.threadingWindowSize = 1024;  // Sliding window limit
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
            // Found a thread!
            this.recordThread(j, currentIndex, re - pt.re, im - pt.im);
          }
        }
      }
    }

    // Add current point to its bucket
    this.addToBucket(bx, by, currentIndex);

    // Remove old points (sliding window)
    this.cleanupOldPoints(currentIndex);
  }
}
```

The bucket size is `2 * epsilon`, so any two points within epsilon of each
other are guaranteed to be in the same bucket or adjacent buckets. Why 2×epsilon?
A point at the edge of a bucket might have a neighbor just across the boundary.
With bucket size 2×epsilon, even the worst case - two points epsilon apart,
straddling a boundary - puts them in adjacent buckets. Checking 9 buckets (3×3)
covers all possible positions of a neighbor within epsilon distance.

Checking 9 buckets instead of the entire history transforms O(n²) into O(n).

The sliding window (default 1024 iterations) limits memory growth. Points
older than the window are removed from the spatial index. This means we
might miss very long cycles, but cycles longer than 1024 iterations are
rare in practice, and the checkpoint method catches them eventually.

## Float32 Precision Challenges

GPU computation uses float32 for performance, which creates challenges:

### The dz² Underflow Problem

At extreme zooms (pixel size < 10^-24), the perturbation squared term `dz²`
underflows to zero in float32:

```
|dz|² ≈ 6.8e-55  (actual value)
float32 min ≈ 1.4e-45  (minimum representable)
→ dz² = 0 in GPU!
```

Solution: Fall back to PerturbationBoard on CPU at extreme zoom depths where GPU
precision fails.

### The Checkpoint Comparison Problem

Comparing z positions to detect convergence also suffers precision loss.
When |z| ≈ 1.4 and we are looking for differences of 10^-12:

```
float32 precision at |z|=1.4: ~1.7e-7
Required precision: ~1e-12
Ratio: 170,000x too imprecise!
```

Solution: Use magnitude-based comparison instead of position subtraction:

```javascript
// Instead of: delta = |z_current - z_checkpoint|
// Use:
const currentMag = Math.sqrt(zr*zr + zi*zi);
const checkpointMag = Math.sqrt(bbr*bbr + bbi*bbi);
const magDiff = Math.abs(currentMag - checkpointMag);

// Plus angular difference via cross product
const crossProd = Math.abs(bbr * zi - bbi * zr);
const angularDist = crossProd / ((currentMag + checkpointMag) / 2);

const distance = magDiff + angularDist;
```

This formulation is more stable because magnitude operations preserve
relative precision better than position subtraction.

## Board Selection

The Scheduler chooses algorithms based on zoom depth and GPU availability:

| Pixel Size | GPU Available | Board Type |
|------------|---------------|------------|
| > 1e-6 | Yes | GpuBoard (float32) |
| > 1e-12 | No | CpuBoard (float64) |
| ≤ 1e-6 | Yes | GpuZhuoranBoard (quad reference, float32 perturbations) |
| ≤ 1e-12 | No | PerturbationBoard (quad precision) |

The GPU threshold (1e-6) is higher than the CPU threshold (1e-12) because float32
loses precision earlier than float64. At extreme depths where GPU float32
perturbations underflow, computation falls back to PerturbationBoard on CPU.

## Unsolved Problems

### Chaotic Regions

Some points in the Mandelbrot set are genuinely chaotic - they neither escape
nor converge to a detectable cycle. The classic example is the real axis
between -2 and the Feigenbaum point (-1.401155...), called "the spike."

Since many of these points will never converge to finite cycles, I cap
iteration at MAX_CHAOTIC_ITERATIONS (100,000) and color them black.

### Very Long Periods

Points can have periods of millions of iterations. With Fibonacci checkpoints,
detecting period 1,000,000 requires reaching iteration ~1,600,000 (the nearest
larger Fibonacci). This is correct but slow.

### Period Harmonics

The checkpoint method can report a multiple of the true period. If a point has
period p, we detect convergence when the orbit returns to a checkpoint position.
But if the checkpoint was set at iteration n and the orbit returns at iteration
n + kp for some integer k > 1, we report period kp instead of the fundamental
period p. Fibonacci checkpoint intervals reduce but don't eliminate this since
consecutive Fibonacci numbers are coprime, making harmonic coincidences less
likely. The reported period is still correct in the sense that the orbit does
repeat every kp iterations, but it may not be the smallest such period.

### Precision at Extreme Depths

Beyond 10^30 magnification, even quad precision starts to degrade.
The theoretical limit is around 10^31 (the precision of quad arithmetic).
For deeper zooms, oct precision (4-double, ~62 digits) or arbitrary-precision
arithmetic would be needed.

## References

- [Deep zoom theory and practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) - Claude Heiland-Allen's comprehensive overview of perturbation, glitch detection, rescaling, and series approximation
- [Zhuoran's rebasing technique](https://fractalforums.org/fractal-mathematics-and-new-theories/28/another-solution-to-perturbation-glitches/4360) - The original December 2021 forum post
- [Deep zoom theory and practice (again)](https://mathr.co.uk/blog/2022-02-21_deep_zoom_theory_and_practice_again.html) - Claude Heiland-Allen's writeup of rebasing
- [K.I. Martin's SuperFractalThing](https://fractalwiki.org/wiki/SuperFractalThing) - The 2013 software that pioneered perturbation for Mandelbrot rendering
- [Perturbation for the Mandelbrot set](https://www.deviantart.com/dinkydauset/journal/Perturbation-for-the-Mandelbrot-set-450766847) - DinkydauSet's accessible explanation
- [Feigenbaum point](http://www.mrob.com/pub/muency/feigenbaumpoint.html) - The chaotic boundary at c = -1.401155...
- [Double-double arithmetic](https://web.mit.edu/tabbott/Public/quaddouble-debian/qd-2.3.4-old/docs/qd.pdf) - The QD library paper by Hida, Li, and Bailey
- [Dekker's 1971 paper](https://csclub.uwaterloo.ca/~pbarfuss/dekker1971.pdf) - "A floating-point technique for extending the available precision"
- [Veltkamp splitting](https://en.wikipedia.org/wiki/Kahan_summation_algorithm#Further_enhancements) - The 2^27+1 constant for error-free multiplication

## Next Steps

- [COMPUTATION.md](COMPUTATION.md): How computation is distributed
- [COLORS.md](COLORS.md): Mapping iterations to colors

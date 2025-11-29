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

## Cycle Detection: Finding Convergent Points

The key idea in this explorer: detect not just divergence but *convergence*.
Many points in the Mandelbrot set converge to periodic cycles:

- Period 1: z → z (fixed point)
- Period 2: z → z' → z (alternating)
- Period n: z returns to itself after n iterations

### The Checkpoint Method

We detect cycles using checkpoints at Fibonacci iteration numbers:

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

### Why Fibonacci Numbers?

Originally I used powers of 2 (1, 2, 4, 8, 16...). But this has a problem: if a
point has period 30, we detect it at iteration 60 (multiple of both 30 and the
checkpoint interval). We report "period 60" instead of the true fundamental
period 30.

Fibonacci numbers (1, 1, 2, 3, 5, 8, 13, 21, 34, 55...) have the beautiful property
that consecutive Fibonacci numbers are coprime, so we are more likely to catch
the fundamental period rather than a harmonic.

### Epsilon Thresholds

Two epsilon values control detection sensitivity:

```javascript
this.epsilon = Math.min(1e-12, pixelSize / 10);   // Strict: confirmed convergence
this.epsilon2 = Math.min(1e-9, pixelSize * 10);   // Loose: probable convergence
```

When `|z - checkpoint| < epsilon2`, we note the iteration as a candidate period.
When it drops below `epsilon`, we confirm convergence and stop iterating.

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

### Binomial Expansion for Higher Exponents

For the classic z² + c, the perturbation formula is simple. But what about
z³ + c or z⁴ + c? The explorer supports arbitrary exponents using the binomial
expansion:

```
(Z + dz)^n - Z^n = n·Z^(n-1)·dz + (n choose 2)·Z^(n-2)·dz² + ... + dz^n
```

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

### PerturbationBoard (Double Precision)

For moderate deep zooms, double-precision perturbations suffice:

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

### Double-Double Precision

For the reference orbit, we use "double-double" precision: each number is stored
as the unevaluated sum of two IEEE doubles, giving about 31 decimal digits of
precision. This is enough for zooms to around 10^30.

```javascript
// Double-double: [high, low] where value = high + low
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

Why this specific constant? IEEE 754 doubles have 53-bit mantissas. Multiplying
by `2^27 + 1` shifts the high 27 bits up, and the subtraction sequence isolates
them. The split produces two non-overlapping parts whose sum exactly equals the
original - no information lost. This technique dates to T.J. Dekker's 1971 paper
"A floating-point technique for extending the available precision."

The `twoProduct` function then uses these splits to compute the exact product
of two doubles as the sum of two doubles - the rounded result plus the rounding
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

The solution is "thread following" - tracking which reference orbit positions
are close to each other. When point at iteration 1000 is close to where the
reference was at iteration 200, we record a "thread" linking them.

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
other are guaranteed to be in the same bucket or adjacent buckets. Checking
9 buckets instead of the entire history transforms O(n²) into O(n).

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

Solution: Fall back to CPU (ZhuoranBoard) at extreme zoom depths where GPU
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

The Scheduler chooses algorithms based on zoom depth:

| Pixel Size | GPU Available | Board Type |
|------------|---------------|------------|
| > 1e-6 | Yes | GpuBoard |
| > 1e-6 | No | CpuBoard |
| ≤ 1e-6, > 1e-24 | Yes | GpuZhuoranBoard |
| ≤ 1e-6, > 1e-24 | No | ZhuoranBoard |
| ≤ 1e-24 | Any | ZhuoranBoard (CPU only) |

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

### Precision at Extreme Depths

Beyond 10^30 magnification, even double-double precision starts to degrade.
The theoretical limit is around 10^31 (the precision of double-double arithmetic).
For deeper zooms, quad-double (four doubles, ~62 digits) or arbitrary-precision
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

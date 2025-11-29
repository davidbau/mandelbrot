# Mandelbrot Algorithms

This document explains the mathematical algorithms used to compute and detect
convergence in the Mandelbrot set, from the basic iteration to the sophisticated
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

The innovation in this explorer is detecting not just divergence but *convergence*.
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

Originally, checkpoints were at powers of 2 (1, 2, 4, 8, 16...). But this causes
a problem: if a point has period 30, we'd detect it at iteration 60 (multiple of
both 30 and the checkpoint interval). We'd report "period 60" instead of the
true fundamental period 30.

Fibonacci numbers (1, 1, 2, 3, 5, 8, 13, 21, 34, 55...) have the beautiful property
that consecutive Fibonacci numbers are coprime. This means we're more likely to
catch the fundamental period rather than a harmonic.

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
that, the pixels are so close together that double precision can't distinguish them.

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

The perturbation method has a problem: when the perturbed orbit gets too close
to a critical point (like z=0), the perturbation `dz` can grow suddenly while
the reference `Z` is small. This causes "glitches" - visual artifacts.

In 2021, a user named Zhuoran on fractalforums.org proposed an elegant solution
called "rebasing": when the total orbit `Z + dz` gets near a critical point,
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

### Quad-Double Precision

For the reference orbit, we use "quad-double" precision: each number is stored
as the unevaluated sum of four IEEE doubles, giving about 62 decimal digits of
precision. This is enough for zooms beyond 10^50.

```javascript
// Quad-double: [high, low] where value = high + low
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

## Thread Following: Robust Cycle Detection

Deep zoom cycle detection is tricky. The reference orbit may cycle, but
individual pixels might have different periods or be at different phases.

The solution is "thread following" - tracking not just the reference orbit
but its relationship to periodic behavior:

```javascript
class ReferenceOrbitThreading {
  constructor(epsilon) {
    this.refThreading = [];  // For each ref iter: which iter it's close to
  }

  updateReference(orbit, iter) {
    // Check if current ref position is close to any previous
    for (let j = 0; j < iter; j++) {
      if (distance(orbit[iter], orbit[j]) < epsilon) {
        this.refThreading[iter] = { next: j, delta: subtract(orbit[iter], orbit[j]) };
        return;
      }
    }
    this.refThreading[iter] = { next: -1 };
  }
}
```

When the reference "threads" to an earlier iteration, pixels can use this
information to accelerate their own cycle detection.

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
When |z| ≈ 1.4 and we're looking for differences of 10^-12:

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

For these points, we cap iteration at MAX_CHAOTIC_ITERATIONS (100,000) and
color them black. They're in the set, but we can't prove it through cycle
detection.

### Very Long Periods

Points can have periods of millions of iterations. With Fibonacci checkpoints,
detecting period 1,000,000 requires reaching iteration ~1,600,000 (the nearest
larger Fibonacci). This is correct but slow.

### Precision at Extreme Depths

Beyond 10^50 magnification, even quad-double precision starts to degrade.
The theoretical limit is around 10^62 (the precision of quad-double arithmetic).
For deeper zooms, arbitrary-precision arithmetic would be needed.

## References

- [Deep zoom theory and practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) - Claude Heiland-Allen's excellent overview
- [Zhuoran's rebasing technique](https://mathr.co.uk/blog/2022-02-21_deep_zoom_theory_and_practice_again.html) - The breakthrough glitch avoidance method
- [Perturbation Theory](https://en.wikipedia.org/wiki/Perturbation_theory) - The mathematical foundation
- [Double-double arithmetic](https://web.mit.edu/tabbott/Public/quaddouble-debian/qd-2.3.4-old/docs/qd.pdf) - The QD library paper

## Next Steps

- [COMPUTATION.md](COMPUTATION.md): How computation is distributed
- [COLORS.md](COLORS.md): Mapping iterations to colors

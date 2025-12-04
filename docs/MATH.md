# Quad-Precision Arithmetic

When zooming deep into the Mandelbrot set—beyond a trillion-fold magnification—standard 64-bit floating-point numbers run out of precision. This document explains how the explorer achieves ~31 decimal digits of precision using a technique called "double-double" arithmetic, sometimes abbreviated as QD (for quad-precision, the general term for high-precision arithmetic using multiple floating-point numbers; here we specifically use the double-double variant).

## The Precision Problem

A JavaScript `Number` (IEEE 754 double-precision float) has a 53-bit mantissa, giving roughly 15-16 significant decimal digits. At a zoom of 10^15, neighboring pixels differ by about 10^-15—right at the edge of representable precision. Beyond this, pixel coordinates become indistinguishable, and the fractal turns to mush.

```
Standard float64:  15-16 decimal digits
Deep zoom need:    10^20 → 20+ digits
                   10^30 → 30+ digits
```

To push past this limit without abandoning JavaScript for arbitrary-precision libraries, we use an elegant trick: represent each number as the *unevaluated sum* of two doubles.

## The Double-Double Representation

A double-double number `x` is stored as an array `[hi, lo]` where:
- `hi` is the high-order part (the "main" value)
- `lo` is the low-order correction (the "error" term)
- The true value is `hi + lo`

The key insight: when you add two floats and round to fit in 64 bits, the lost bits aren't gone—they're computable! By carefully tracking these rounding errors, we can recover them into the `lo` component.

```javascript
// A quad-double number representing π
const pi_qd = [3.141592653589793, 1.2246467991473532e-16];
// True value = 3.141592653589793 + 0.0000000000000001224...
//            = 3.14159265358979323846... (more digits!)
```

This gives approximately 31 decimal digits of precision—enough for zooms beyond 10^30.

## Error-Free Transformations

The foundation of double-double arithmetic is a set of operations that compute *exact* results by splitting the answer into a high part and a low (error) part.

### Two-Sum: Exact Addition

When adding two floats `a` and `b`, the standard `a + b` rounds the result. The lost bits can be recovered:

```javascript
function slow2Sum(a, b) {
  let s = a + b;            // Rounded sum
  let c = s - a;            // What we actually added to a
  return [s, (a - (s - c)) + (b - c)];  // s + error = exact a + b
}
```

The formula looks circular, but it works because intermediate values are computed in full precision, then rounded. The expression `(a - (s - c)) + (b - c)` exactly computes what was lost in the rounding.

There's also a faster version when we know `|a| >= |b|`:

```javascript
function fast2Sum(a, b) {
  let s = a + b;
  let t = b - (s - a);      // Exact error term
  return [s, t];
}
```

### Two-Product: Exact Multiplication

Multiplication is trickier. The product of two 53-bit mantissas needs up to 106 bits to represent exactly. The solution involves *splitting* each number into high and low halves:

```javascript
function qdSplit(a) {
  const c = 134217729 * a;  // 134217729 = 2^27 + 1 (Veltkamp-Dekker constant)
  const x = c - (c - a);       // High 26 bits
  const y = a - x;             // Low 27 bits
  return [x, y];
}
```

The magic number 134217729 = 2^27 + 1 forces a split at bit 27. After multiplying `a` by this constant and subtracting appropriately, we get `x` (the high half) with its low 27 bits cleared, and `y = a - x` (the low half).

With both numbers split, exact multiplication becomes:

```javascript
function twoProduct(a, b) {
  let p = a * b;              // Rounded product
  let [ah, al] = qdSplit(a);  // Split a into high/low
  let [bh, bl] = qdSplit(b);  // Split b into high/low
  // Exact error: ah*bh - p + ah*bl + al*bh + al*bl
  let err = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return [p, err];
}
```

The expression computes what was lost in the rounding of `a * b`. Each individual term (`ah * bh`, etc.) fits in a double because the half-width parts have only ~27 significant bits each.

## Double-Double Operations

With these building blocks, we can implement arithmetic on double-double pairs.

### Addition

```javascript
function qdAdd(a, b) {
  let [a1, a0] = a;           // Unpack [hi, lo]
  let [b1, b0] = b;
  let [h1, h2] = slow2Sum(a1, b1);  // Add high parts
  let [l1, l2] = slow2Sum(a0, b0);  // Add low parts
  let [v1, v2] = fast2Sum(h1, h2 + l1);  // Combine
  return fast2Sum(v1, v2 + l2);
}
```

The algorithm first sums the high parts (a1, b1) and low parts (a0, b0) separately, each time calculating the error. Then, it carefully combines these partial sums and their errors to produce the final high and low components of the result.

### Multiplication

```javascript
function qdMul(a, b) {
  let [a1, a0] = a;
  let [b1, b0] = b;
  let [p1, p2] = twoProduct(a1, b1);  // Exact product of high parts
  return fast2Sum(p1, p2 + a1 * b0 + b1 * a0);  // Add cross terms
}
```

The dominant term is `a1 * b1` (the product of the high parts). The cross terms `a1 * b0` and `b1 * a0` contribute to the low part. The term `a0 * b0` is small enough to ignore.

### Division via Newton-Raphson

Division uses iterative refinement. Starting with an approximate reciprocal, Newton-Raphson doubles the precision with each iteration:

```javascript
function qdReciprocal(b, iters = 2) {
  let x = [1 / b[0], 0];  // Initial approximation
  for (let i = 0; i < iters; i++) {
    // Newton-Raphson: x_new = x * (2 - x * b)
    x = qdMul(x, qdSub([2, 0], qdMul(x, b)));
  }
  return x;
}
```

Two iterations typically suffice to achieve full double-double precision.

## Complex Numbers in Quad Precision

The Mandelbrot iteration `z = z² + c` involves complex numbers. The explorer represents a complex quad-precision number as a 4-element array: `[re_hi, re_lo, im_hi, im_lo]`.

### Complex Multiplication

```javascript
function qdcMul(a, b) {
  // (a_re + i*a_im) * (b_re + i*b_im)
  // = (a_re*b_re - a_im*b_im) + i*(a_re*b_im + a_im*b_re)
  let ac = qdMul([a[0], a[1]], [b[0], b[1]]);   // a_re * b_re
  let bd = qdMul([a[2], a[3]], [b[2], b[3]]);   // a_im * b_im
  let adbc = qdMul(
    qdAdd([a[0], a[1]], [a[2], a[3]]),
    qdAdd([b[0], b[1]], [b[2], b[3]])
  );  // (a_re + a_im) * (b_re + b_im)
  let real = qdSub(ac, bd);
  let imag = qdSub(adbc, qdAdd(ac, bd));  // Karatsuba trick
  return [real[0], real[1], imag[0], imag[1]];
}
```

This uses a Karatsuba-like identity to compute the imaginary part with three multiplications instead of the four that would be required by a naive implementation, improving performance.

### Complex Squaring (Optimized)

Since `z²` is the most common operation in Mandelbrot iteration, there's an optimized version:

```javascript
function qdcSquare(a) {
  let a0a0 = qdSquare([a[0], a[1]]);   // re²
  let a1a1 = qdSquare([a[2], a[3]]);   // im²
  let a0a1 = qdMul([a[0], a[1]], [a[2], a[3]]);  // re * im
  let real = qdSub(a0a0, a1a1);        // re² - im²
  let imag = qdDouble(a0a1);            // 2 * re * im
  return [real[0], real[1], imag[0], imag[1]];
}
```

## Parsing High-Precision Coordinates

URL coordinates are parsed into quad-precision to preserve all significant digits:

```javascript
function qdParse(s) {
  // Parse digit by digit, accumulating in quad precision
  let result = [0, 0];
  for (let digit of s) {
    result = qdAdd(qdMul(result, [10, 0]), [parseInt(digit), 0]);
  }
  // Handle exponent and sign...
  return result;
}
```

By building the number incrementally in quad precision, digits beyond the 15th (which would be lost in a standard `parseFloat`) are preserved in the `lo` component.

## In-Place Array Operations

For performance-critical inner loops, the code provides "array in-place" variants that avoid allocating new arrays:

```javascript
function AqdAdd(r, i, a1, a2, b1, b2) {
  // Writes result to r[i] and r[i+1]
  Aslow2Sum(r, i, a1, b1);
  const h1 = r[i], h2 = r[i+1];
  Aslow2Sum(r, i, a2, b2);
  const l1 = r[i], l2 = r[i+1];
  Afast2Sum(r, i, h1, h2 + l1);
  const v1 = r[i], v2 = r[i+1];
  Afast2Sum(r, i, v1, v2 + l2);
}
```

These avoid the overhead of creating `[hi, lo]` arrays on every operation, which matters when computing millions of iterations per second.

## Where Quad Precision Is Used

1. **Reference Orbit Computation:** The central reference point's orbit is computed in full quad precision (`qdcSquare`, `qdcAdd`). This orbit serves as the high-precision backbone for all perturbation calculations.

2. **Coordinate Parsing:** URL parameters like `c=-0.743643887037158704752191506114774+0.131825904205311970493132056385139i` are parsed in quad precision.

3. **View Compositing:** When overlaying a child view on its parent at deep zoom, the offset calculation uses quad precision to avoid catastrophic cancellation.

4. **Movie Interpolation:** The Catmull-Rom spline functions (`catmullRom1D`) use quad precision to ensure smooth camera paths even at extreme zooms.

## Performance Considerations

Quad-precision operations are 10-20× slower than standard float64. The explorer minimizes this cost by:

1. **Computing one reference orbit in quad precision** while computing all other pixels as float64 perturbations from that reference.

2. **Using GPU float32** for the bulk of the work, with the CPU handling only the high-precision reference.

3. **Lazy orbit extension:** The reference orbit is computed incrementally, only when needed.

## References

- [Dekker, T. J. (1971). "A floating-point technique for extending the available precision"](https://link.springer.com/article/10.1007/BF01397083) - The original paper introducing double-double arithmetic
- [Hida, Li, Bailey (2000). "Library for Double-Double and Quad-Double Arithmetic"](https://www.davidhbailey.com/dhbpapers/qd.pdf) - The QD library paper that popularized these techniques
- [Veltkamp splitting](https://en.wikipedia.org/wiki/Quadruple-precision_floating-point_format#Double-double_arithmetic) - Wikipedia overview

## Next Steps

- [ALGORITHMS.md](ALGORITHMS.md): How perturbation theory uses the reference orbit
- [GPU-SHADERS.md](GPU-SHADERS.md): How the GPU handles deep zoom with float32 + rebasing
- [COMPUTATION.md](COMPUTATION.md): The overall computation architecture

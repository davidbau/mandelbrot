# Oct-Precision Arithmetic

While quad-precision (~31 decimal digits) handles zooms up to 10^30, exploring even deeper requires more precision. Oct-precision extends the double-double technique to use *four* doubles, achieving approximately 62 decimal digits of precision—enough for zooms beyond 10^60.

## When Oct Precision Is Needed

The explorer automatically selects the appropriate board type based on zoom level:

| Zoom Level | Board Type (GPU) | Board Type (CPU) | Precision |
|------------|------------------|------------------|-----------|
| z < 10^7   | GpuBoard         | CpuBoard         | float32/64 direct |
| 10^7 - 10^30 | GpuZhuoranBoard | PerturbationBoard | float32/64 perturbation, quad reference |
| > 10^30   | AdaptiveGpuBoard | OctZhuoranBoard  | float32/64 perturbation, oct reference (~62 digits) |

## The Quad-Double Representation

An oct-precision number is stored as a 4-element array `[a0, a1, a2, a3]` where:
- `a0` is the highest-order component
- `a1`, `a2`, `a3` are progressively smaller corrections
- The true value is `a0 + a1 + a2 + a3`

Each component has approximately 53 bits of precision, but they're arranged so their ranges don't overlap. Together, they provide roughly 212 bits of precision (4 × 53 = 212).

```javascript
// An oct-precision number (conceptual)
const x_oct = [
  1.2345678901234567e+10,   // a0: main value
  1.234567890123e-6,         // a1: first correction
  1.23456789e-22,            // a2: second correction
  1.234e-38                  // a3: third correction
];
```

## Complex Numbers in Oct Precision

Complex oct-precision numbers use 8 components: `[r0, r1, r2, r3, i0, i1, i2, i3]` where the first four represent the real part and the last four represent the imaginary part.

## Key Operations

### Renormalization

After arithmetic operations, components may have overlapping ranges. The `toOctRenormalize` function restores the non-overlapping property:

```javascript
function toOctRenormalize(a0, a1, a2, a3) {
  // Cascade two-sum operations to ensure non-overlapping
  [a0, a1] = qd_quick_two_sum(a0, a1);
  [a1, a2] = qd_quick_two_sum(a1, a2);
  [a2, a3] = qd_quick_two_sum(a2, a3);
  // Second pass for full accuracy
  [a0, a1] = qd_quick_two_sum(a0, a1);
  [a1, a2] = qd_quick_two_sum(a1, a2);
  [a0, a1] = qd_quick_two_sum(a0, a1);
  return [a0, a1, a2, a3];
}
```

### Addition

Oct-precision addition combines all components and renormalizes:

```javascript
function toOctAdd(a, b) {
  // Add corresponding components
  let c0 = a[0] + b[0];
  let c1 = a[1] + b[1];
  let c2 = a[2] + b[2];
  let c3 = a[3] + b[3];
  // Renormalize to restore non-overlapping property
  return toOctRenormalize(c0, c1, c2, c3);
}
```

### Multiplication

The product of two oct-precision numbers requires computing many cross-terms:

```javascript
function toOctMul(a, b) {
  // Key cross-products contribute to different precision levels
  // a0*b0 → highest order
  // a0*b1 + a1*b0 → second order
  // a0*b2 + a1*b1 + a2*b0 → third order
  // etc.
  // ... (full implementation in code)
}
```

### Complex Squaring

The critical `z² + c` operation in Mandelbrot iteration uses optimized complex squaring:

```javascript
function toOctcSq(z) {
  const re = [z[0], z[1], z[2], z[3]];
  const im = [z[4], z[5], z[6], z[7]];
  // real = re² - im²
  // imag = 2 * re * im
  const reSq = toOctMul(re, re);
  const imSq = toOctMul(im, im);
  const reIm = toOctMul(re, im);
  const real = toOctSub(reSq, imSq);
  const imag = toOctDouble(reIm);  // 2 * re * im
  return [...real, ...imag];
}
```

## Perturbation Theory at Oct Precision

Like quad precision, oct precision uses perturbation theory to minimize computation:

1. **Reference orbit** is computed in full oct precision at the view center
2. **Delta values** (perturbations from reference) are computed in quad precision
3. **Rebasing** occurs when delta becomes too large relative to reference

This hybrid approach computes millions of pixels efficiently while maintaining ultra-deep precision where needed.

## The OctCpuBoard Class

`OctCpuBoard` implements Mandelbrot computation at oct precision. Key features:

- **Reference perturbation** using Zhuoran's algorithm for stability
- **Cycle detection** for identifying convergent orbits
- **Lazy orbit extension** to compute only as many iterations as needed
- **Epsilon-based convergence** scaled to oct precision

## Performance

Oct-precision operations are approximately 100× slower than standard float64 due to:
- 4× more components to track
- Complex renormalization after each operation
- Cross-term multiplication overhead

The explorer mitigates this by:
1. Using oct precision only when necessary (z > 10^30)
2. Computing one reference orbit in oct precision
3. Using quad precision for perturbations where possible
4. Reducing view resolution at extreme zooms

## Coordinate Accuracy

At z=10^40, adjacent pixels differ by about 10^-40. The oct-precision representation can distinguish coordinates differing by 10^-62, providing ample margin for accurate rendering.

### Parent-Child View Matching

A critical test for precision accuracy is comparing iteration counts between parent and child views at the same coordinates. At z=10^40, the explorer achieves:
- 93%+ exact matches between parent and child views
- 100% matches within ±5 iterations (due to different reference orbits)

## References

- [Bailey, D.H. "QD: A Double-Double/Quad-Double Package"](https://www.davidhbailey.com/dhbpapers/qd.pdf)
- [Hida, Y., Li, X.S., Bailey, D.H. "Algorithms for Quad-Double Precision"](https://www.davidhbailey.com/dhbpapers/qd.pdf)

## See Also

- [MATH.md](MATH.md): Quad-precision (double-double) arithmetic details
- [ALGORITHMS.md](ALGORITHMS.md): Perturbation theory and reference orbits
- [COMPUTATION.md](COMPUTATION.md): Board selection and computation architecture

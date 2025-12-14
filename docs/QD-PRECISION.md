# Quad-Double (QD) Precision Arithmetic

While double-double (DD) precision (~31 decimal digits) handles zooms up to 10^30, exploring even deeper requires more precision. Quad-double (QD) extends the double-double technique to use *four* doubles, achieving approximately 62 decimal digits of precision—enough for zooms beyond 10^60.

This implementation follows the naming conventions of Hida, Li, and Bailey's QD library.

## When QD Precision Is Needed

The explorer automatically selects the appropriate board type based on zoom level:

| Zoom Level | Board Type (GPU) | Board Type (CPU) | Precision |
|------------|------------------|------------------|-----------|
| z < 10^7   | GpuBoard         | CpuBoard         | float32/64 direct |
| 10^7 - 10^30 | GpuZhuoranBoard | PerturbationBoard | float32/64 perturbation, DD reference |
| > 10^30   | AdaptiveGpuBoard | QDZhuoranBoard  | float32/64 perturbation, QD reference (~62 digits) |

## The Quad-Double Representation

A QD-precision number is stored as a 4-element array `[a0, a1, a2, a3]` where:
- `a0` is the highest-order component
- `a1`, `a2`, `a3` are progressively smaller corrections
- The true value is `a0 + a1 + a2 + a3`

Each component has approximately 53 bits of precision, but they're arranged so their ranges don't overlap. Together, they provide roughly 212 bits of precision (4 × 53 = 212).

```javascript
// A QD-precision number (conceptual)
const x_qd = [
  1.2345678901234567e+10,   // a0: main value
  1.234567890123e-6,         // a1: first correction
  1.23456789e-22,            // a2: second correction
  1.234e-38                  // a3: third correction
];
```

## Complex Numbers in QD Precision

Complex QD-precision numbers use 8 components: `[r0, r1, r2, r3, i0, i1, i2, i3]` where the first four represent the real part and the last four represent the imaginary part.

## Key Operations

### Renormalization

After arithmetic operations, components may have overlapping ranges. The `ArqdRenorm` function restores the non-overlapping property:

```javascript
function ArqdRenorm(a, a0, a1, a2, a3) {
  // Cascade two-sum operations to ensure non-overlapping
  [a0, a1] = AquickTwoSum(a0, a1);
  [a1, a2] = AquickTwoSum(a1, a2);
  [a2, a3] = AquickTwoSum(a2, a3);
  // Second pass for full accuracy
  [a0, a1] = AquickTwoSum(a0, a1);
  [a1, a2] = AquickTwoSum(a1, a2);
  [a0, a1] = AquickTwoSum(a0, a1);
  ArqdSet(a, a0, a1, a2, a3);
}
```

### Addition

QD-precision addition combines all components and renormalizes:

```javascript
function toQDAdd(a, b) {
  // Add corresponding components
  let c0 = a[0] + b[0];
  let c1 = a[1] + b[1];
  let c2 = a[2] + b[2];
  let c3 = a[3] + b[3];
  // Renormalize to restore non-overlapping property
  return toQDRenormalize(c0, c1, c2, c3);
}
```

### Multiplication

The product of two QD-precision numbers requires computing many cross-terms. We use Bailey's "sloppy_mul" algorithm which computes all cross-terms that contribute to the final precision:

```javascript
function ArqdMul(r, a, b) {
  // Key cross-products contribute to different precision levels
  // a0*b0 → highest order
  // a0*b1 + a1*b0 → second order
  // a0*b2 + a1*b1 + a2*b0 → third order
  // a0*b3 + a1*b2 + a2*b1 + a3*b0 → fourth order
  // ... (full implementation in code)
}
```

### Complex Squaring

The critical `z² + c` operation in Mandelbrot iteration uses optimized complex squaring:

```javascript
function toQDcSq(z) {
  const re = [z[0], z[1], z[2], z[3]];
  const im = [z[4], z[5], z[6], z[7]];
  // real = re² - im²
  // imag = 2 * re * im
  const reSq = ArqdSquare(re, re);  // Optimized squaring
  const imSq = ArqdSquare(im, im);
  const reIm = ArqdMul(re, im);
  const real = toQDSub(reSq, imSq);
  const imag = toQDDouble(reIm);  // 2 * re * im
  return [...real, ...imag];
}
```

## Perturbation Theory at QD Precision

Like DD precision, QD precision uses perturbation theory to minimize computation:

1. **Reference orbit** is computed in full QD precision at the view center
2. **Delta values** (perturbations from reference) are computed in DD precision
3. **Rebasing** occurs when delta becomes too large relative to reference

This hybrid approach computes millions of pixels efficiently while maintaining ultra-deep precision where needed.

## The QDCpuBoard Class

`QDCpuBoard` implements Mandelbrot computation at QD precision. Key features:

- **Reference perturbation** using Zhuoran's algorithm for stability
- **Cycle detection** for identifying convergent orbits
- **Lazy orbit extension** to compute only as many iterations as needed
- **Epsilon-based convergence** scaled to QD precision

## Performance

QD-precision operations are approximately 100× slower than standard float64 due to:
- 4× more components to track
- Complex renormalization after each operation
- Cross-term multiplication overhead

The explorer mitigates this by:
1. Using QD precision only when necessary (z > 10^30)
2. Computing one reference orbit in QD precision
3. Using DD precision for perturbations where possible
4. Reducing view resolution at extreme zooms

## Coordinate Accuracy

At z=10^40, adjacent pixels differ by about 10^-40. The QD-precision representation can distinguish coordinates differing by 10^-62, providing ample margin for accurate rendering.

### Parent-Child View Matching

A critical test for precision accuracy is comparing iteration counts between parent and child views at the same coordinates. At z=10^47, the explorer achieves:
- 37%+ exact matches between parent and child views
- 60%+ matches within ±1 iteration (due to different reference orbits and subpixel positioning)

## Naming Conventions

This codebase follows the naming conventions of the QD library by Hida, Li, and Bailey:

| Precision | Doubles | Bits | Digits | Prefix | Example |
|-----------|---------|------|--------|--------|---------|
| Double-double (DD) | 2 | ~106 | ~31 | `dd`, `Ardd` | `ddAdd`, `ArddSplit` |
| Quad-double (QD) | 4 | ~212 | ~62 | `qd`, `Arqd` | `toQD`, `ArqdMul` |

The `Ar` prefix denotes "Array" operations that write results to pre-allocated arrays for performance.

## References

- [Bailey, D.H. "QD: A Double-Double/Quad-Double Package"](https://www.davidhbailey.com/dhbpapers/qd.pdf)
- [Hida, Y., Li, X.S., Bailey, D.H. "Algorithms for Quad-Double Precision"](https://www.davidhbailey.com/dhbpapers/qd.pdf)

## See Also

- [MATH.md](MATH.md): Double-double (DD) arithmetic details
- [ALGORITHMS.md](ALGORITHMS.md): Perturbation theory and reference orbits
- [COMPUTATION.md](COMPUTATION.md): Board selection and computation architecture

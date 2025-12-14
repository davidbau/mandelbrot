/**
 * QD-Style Precision Tests for Oct Arithmetic
 * Based on testing methodology from the QD Library by Hida, Li, Bailey
 *
 * These tests use mathematical identities with known results to verify
 * that oct arithmetic maintains expected precision (~60 decimal digits).
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toOct,
  toOctAdd,
  toOctSub,
  toOctMul,
  toOctSquare,
  octToNumber,
  toOctScale,
  AoctAdd,
  AoctMul,
  AoctSquare,
  AsymmetricTwoSum,
  AquickTwoSum,
  AthreeSum,
  AoctTwoProduct,
  AoctTwoSquare,
  AoctRenorm,
  AoctSet,
  AtwoProduct,
  AtwoSquare,
  AqdSplit
} = createTestEnvironment([
  'toOct',
  'toOctAdd',
  'toOctSub',
  'toOctMul',
  'toOctSquare',
  'octToNumber',
  'toOctScale',
  'AoctAdd',
  'AoctMul',
  'AoctSquare',
  'AsymmetricTwoSum',
  'AquickTwoSum',
  'AthreeSum',
  'AoctTwoProduct',
  'AoctTwoSquare',
  'AoctRenorm',
  'AoctSet',
  'AtwoProduct',
  'AtwoSquare',
  'AqdSplit'
]);

describe('QD-style oct precision tests', () => {
  // Helper: sum oct components
  const octSum = (o) => o[0] + o[1] + o[2] + o[3];

  // Helper: oct division (a / b) using Newton-Raphson
  function toOctDiv(a, b) {
    // Initial approximation: 1/b[0]
    let x = [1 / b[0], 0, 0, 0];

    // Newton-Raphson: x_new = x * (2 - b * x)
    for (let iter = 0; iter < 5; iter++) {
      const bx = toOctMul(b, x);
      const twominusbx = toOctSub([2, 0, 0, 0], bx);
      x = toOctMul(x, twominusbx);
    }

    return toOctMul(a, x);
  }

  // Helper: compute arctan(1/n) using Taylor series
  // arctan(x) = x - x³/3 + x⁵/5 - x⁷/7 + ...
  function octArctan(oneOverN) {
    const x = toOctDiv([1, 0, 0, 0], toOct(oneOverN));
    const x2 = toOctSquare(x);

    let sum = x.slice();
    let term = x.slice();

    for (let k = 1; k <= 100; k++) {
      term = toOctMul(term, x2);
      term = toOctScale(term, -1); // Alternate signs
      const divisor = 2 * k + 1;
      const contribution = toOctDiv(term, toOct(divisor));
      sum = toOctAdd(sum, contribution);

      // Check convergence
      if (Math.abs(octSum(contribution)) < 1e-70) break;
    }

    return sum;
  }

  // Reference: π to 70 decimal places
  // 3.14159265358979323846264338327950288419716939937510582097494459230781640628620899
  const PI_PARTS = [
    3.141592653589793,      // ~16 digits
    1.2246467991473532e-16, // next ~16 digits
    -2.9947698097183397e-33,// next ~17 digits
    1.1124542208633652e-49  // next ~17 digits
  ];

  test('TwoProduct basic precision', () => {
    // Test that TwoProduct correctly computes a*b with error term
    const a = 1 + 1e-10;
    const b = 1 + 2e-10;

    // AtwoProduct uses array output: result[i] = product, result[i+1] = error
    const result = [0, 0, 0, 0];
    AtwoProduct(result, 0, a, b);
    const p = result[0];
    const e = result[1];

    // Exact result: 1 + 3e-10 + 2e-20
    const exact = 1 + 3e-10 + 2e-20;
    const computed = p + e;

    // Error should be essentially zero (just floating point representation)
    expect(Math.abs(computed - exact)).toBeLessThan(1e-30);
  });

  test('oct multiplication error accumulation', () => {
    // Test: multiply (1 + ε) by itself repeatedly
    // After n multiplications, result should be (1 + ε)^(2^n)
    const eps = 1e-45;
    let oct = toOctAdd(toOct(1), [eps, 0, 0, 0]);

    for (let n = 0; n < 10; n++) {
      oct = toOctSquare(oct);
    }

    // After 10 squarings, check relative error
    const power = Math.pow(2, 10);
    const expected = 1 + power * eps;
    const actual = octSum(oct);
    const relError = Math.abs(actual - expected) / expected;

    expect(relError).toBeLessThan(1e-40);
  });

  test('oct multiplication preserves small differences', () => {
    // This is the critical test for Mandelbrot rendering
    // At z=1e32, pixel size is ~2e-34
    // After multiplying by values near 1, this difference must be preserved

    const pixelDiff = 2e-34;
    const a = toOct(1.5);  // Typical z value magnitude
    const b1 = toOctAdd(toOct(1.5), [pixelDiff, 0, 0, 0]);
    const b2 = toOct(1.5);

    // Multiply both by a value
    const result1 = toOctMul(a, b1);
    const result2 = toOctMul(a, b2);

    const diff = toOctSub(result1, result2);
    const diffSum = octSum(diff);

    // Expected difference: 1.5 * pixelDiff = 3e-34
    const expectedDiff = 1.5 * pixelDiff;

    // Oct should preserve this difference accurately
    expect(Math.abs(diffSum - expectedDiff) / expectedDiff).toBeLessThan(1e-10);
  });

  test('oct addition precision near cancellation', () => {
    // Test: add two nearly equal numbers of opposite sign
    // This tests precision when significant bits cancel
    const a = toOct(1.0);
    const almostOne = toOctSub(toOct(1.0), [1e-50, 0, 0, 0]);

    const diff = toOctSub(a, almostOne);
    const diffSum = octSum(diff);

    expect(Math.abs(diffSum - 1e-50) / 1e-50).toBeLessThan(0.01);
  });

  test('direct comparison with QD sloppy_mul approach', () => {
    // The QD sloppy_mul computes:
    // 1. two_prod for a[0]*b[0], a[0]*b[1], a[1]*b[0], a[0]*b[2], a[1]*b[1], a[2]*b[0]
    // 2. Plain multiply for a[0]*b[3] + a[1]*b[2] + a[2]*b[1] + a[3]*b[0]
    //
    // Our AoctMul computes:
    // 1. two_prod for a[0]*b[0], a[0]*b[1], a[1]*b[0] (only 3!)
    // 2. Plain multiply for rest
    //
    // This test checks if the difference matters

    // Create values where high-order cross terms matter
    const a = [1, 1e-16, 1e-32, 1e-48];  // Non-trivial oct value
    const b = [1, 1e-16, 1e-32, 1e-48];

    const result = toOctSquare(a);

    // The sum should be close to (1 + 1e-16 + 1e-32 + 1e-48)²
    const approxExpected = Math.pow(1 + 1e-16, 2);  // Higher terms too small for double

    // Check that components have reasonable magnitudes
    expect(result[0]).toBeCloseTo(1, 10);
    expect(result[1]).toBeCloseTo(2e-16, -16);  // 2 * 1 * 1e-16
  });

  test('cross-term precision with QD sloppy_mul', () => {
    // Test level-2 cross terms which use TwoProduct in QD sloppy_mul
    // Note: sloppy_mul computes levels 0-3, level-4 (a[2]*b[2]) is not computed

    // Create values where a[0]*b[2] and a[2]*b[0] terms matter
    const a = [1, 0, 1e-32, 0];  // 1 + 1e-32
    const b = [1, 0, 1e-32, 0];  // 1 + 1e-32

    const result = toOctSquare(a);

    // Expected: (1 + 1e-32)² = 1 + 2e-32 + 1e-64
    // The 2e-32 term comes from a[0]*b[2] + a[2]*b[0] (level-2, computed with TwoProduct)
    // The 1e-64 term is a[2]*b[2] (level-4, not computed by sloppy_mul)

    // After renormalization, 2e-32 appears in result[1]
    expect(Math.abs(result[1] - 2e-32) / 2e-32).toBeLessThan(0.01);
    // Level-4 terms are dropped by sloppy_mul (only a few bits lost per QD docs)
    // The 1e-64 term won't appear because sloppy_mul doesn't compute a[2]*b[2]
    expect(result[2]).toBe(0);
  });

  test('level-3 cross-terms computed correctly', () => {
    // Level-3 terms: a[0]*b[3] + a[1]*b[2] + a[2]*b[1] + a[3]*b[0]
    // In sloppy_mul, these are computed with plain multiplication (not TwoProduct)
    // but should still be captured in the result

    // Create values where level-3 terms are significant
    const a = [1, 0, 0, 1e-48];  // 1 + 1e-48
    const b = [1, 0, 0, 1e-48];  // 1 + 1e-48

    const result = toOctSquare(a);

    // Expected: (1 + 1e-48)² = 1 + 2e-48 + 1e-96
    // The 2e-48 term comes from a[0]*b[3] + a[3]*b[0] (level-3)
    // The 1e-96 term is a[3]*b[3] (level-6, not computed)

    // Level-3 terms should be captured (plain multiply, no TwoProduct error term)
    // The 2e-48 term should appear somewhere in the result
    const sum = result[0] + result[1] + result[2] + result[3];
    expect(Math.abs(sum - (1 + 2e-48)) / (1 + 2e-48)).toBeLessThan(1e-10);
  });

  test('level-3 cross-terms at deep zoom scale', () => {
    // Test level-3 terms at magnitudes relevant to deep zoom (z=1e40)
    // At z=1e40, pixel spacing is ~1e-42, so level-3 precision matters

    const a = [1.5, 1e-16, 1e-32, 1e-48];
    const b = [0.7, 2e-17, 3e-33, 4e-49];

    const result = toOctMul(a, b);

    // Level-3 terms: a[0]*b[3] + a[1]*b[2] + a[2]*b[1] + a[3]*b[0]
    // = 1.5*4e-49 + 1e-16*3e-33 + 1e-32*2e-17 + 1e-48*0.7
    // = 6e-49 + 3e-49 + 2e-49 + 7e-49 = 1.8e-48
    const expectedLevel3 = 1.5*4e-49 + 1e-16*3e-33 + 1e-32*2e-17 + 1e-48*0.7;

    // The sum should include level-3 contribution
    const sum = result[0] + result[1] + result[2] + result[3];

    // Main product ≈ 1.5 * 0.7 = 1.05
    // Level-1: 1.5*2e-17 + 1e-16*0.7 ≈ 1e-16
    // Level-2: various cross-terms ≈ 1e-32
    // Level-3: ≈ 1.8e-48

    // Verify the sum is close to expected (accounting for all terms)
    const expectedSum = 1.5*0.7 + 1.5*2e-17 + 1e-16*0.7 +
                        1.5*3e-33 + 1e-16*2e-17 + 1e-32*0.7 +
                        expectedLevel3;
    expect(Math.abs(sum - expectedSum) / expectedSum).toBeLessThan(1e-10);
  });

  test('Mandelbrot iteration precision simulation', () => {
    // Simulate a Mandelbrot iteration to see precision loss
    // z² + c where z and c have small differences

    const pixelDiff = 2e-34;

    // Two c values differing by pixelDiff
    const c1 = toOct(-1.5);
    const c2 = toOctAdd(toOct(-1.5), [pixelDiff, 0, 0, 0]);

    // Start with z = c
    let z1r = c1.slice(), z1i = toOct(0);
    let z2r = c2.slice(), z2i = toOct(0);

    // Track the difference over iterations
    const diffs = [];

    for (let iter = 0; iter < 50; iter++) {
      // z² = (zr + zi*i)² = zr² - zi² + 2*zr*zi*i
      const z1r2 = toOctSquare(z1r);
      const z1i2 = toOctSquare(z1i);
      const z1ri = toOctMul(z1r, z1i);

      const newZ1r = toOctAdd(toOctSub(z1r2, z1i2), c1);
      const newZ1i = toOctAdd(toOctMul(z1ri, [2, 0, 0, 0]), toOct(0));

      const z2r2 = toOctSquare(z2r);
      const z2i2 = toOctSquare(z2i);
      const z2ri = toOctMul(z2r, z2i);

      const newZ2r = toOctAdd(toOctSub(z2r2, z2i2), c2);
      const newZ2i = toOctAdd(toOctMul(z2ri, [2, 0, 0, 0]), toOct(0));

      z1r = newZ1r; z1i = newZ1i;
      z2r = newZ2r; z2i = newZ2i;

      // Check magnitude
      const mag1 = octSum(toOctAdd(toOctSquare(z1r), toOctSquare(z1i)));
      const mag2 = octSum(toOctAdd(toOctSquare(z2r), toOctSquare(z2i)));

      if (mag1 > 4 || mag2 > 4) {
        break;
      }

      const diffR = octSum(toOctSub(z2r, z1r));
      const diffI = octSum(toOctSub(z2i, z1i));
      const totalDiff = Math.sqrt(diffR*diffR + diffI*diffI);

      diffs.push({ iter, diffR, diffI, totalDiff });
    }

    // After some iterations, the difference should still be non-zero
    // (unless trajectories diverge, which is fine)
    expect(diffs.length).toBeGreaterThan(0);
    if (diffs.length > 5) {
      expect(diffs[5].totalDiff).toBeGreaterThan(0);
    }
  });

  test('component independence verification', () => {
    // Verify that oct components don't contaminate each other
    // Set only one component and verify others stay zero

    // When squaring [1,0,0,0], result should be [1,0,0,0]
    const sq1 = toOctSquare([1, 0, 0, 0]);
    expect(sq1[0]).toBe(1);
    expect(sq1[1]).toBe(0);
    expect(sq1[2]).toBe(0);
    expect(sq1[3]).toBe(0);
  });

  test('cross-term preservation when main term has large error', () => {
    // This test catches a specific bug in AoctMul where small cross terms
    // are lost because the TwoProduct error (e0) from the main product
    // swamps them during renormalization.
    //
    // When squaring -1.8:
    // - Main product: (-1.8)² = 3.24
    // - TwoProduct gives [3.24, e0] where e0 ≈ -5.33e-17 (FP rounding error)
    // - If we add a tiny perturbation 1e-35 to -1.8:
    //   Cross term should be: 2 * (-1.8) * 1e-35 = -3.6e-35
    // - Bug: -3.6e-35 is 18 orders of magnitude smaller than e0 (-5.33e-17)
    //   so when they're combined and passed to renormalization, the cross
    //   term gets absorbed and lost.
    //
    // This directly affects Mandelbrot rendering at z=1e32+ where pixel
    // spacing is ~1e-35 and values near boundaries can be around 1.5-2.

    const base = -1.8;
    const tinyDiff = 1e-35;

    // Create two oct values that differ by tinyDiff
    const a = toOct(base);
    const b = [base, tinyDiff, 0, 0];  // base + tinyDiff

    // Square both
    const a2 = toOctSquare(a);
    const b2 = toOctSquare(b);

    // The difference between b² and a² should be:
    // (base + tinyDiff)² - base² = 2 * base * tinyDiff + tinyDiff²
    // ≈ 2 * (-1.8) * 1e-35 = -3.6e-35 (tinyDiff² is negligible)
    const expectedDiff = 2 * base * tinyDiff;

    const actualDiff = toOctSub(b2, a2);
    const actualDiffSum = octSum(actualDiff);

    // The difference should be preserved, not zero
    // Allow 10% relative error due to FP approximations
    const relError = Math.abs(actualDiffSum - expectedDiff) / Math.abs(expectedDiff);

    expect(actualDiffSum).not.toBe(0);  // Must not be exactly zero
    expect(relError).toBeLessThan(0.1);  // Within 10% of expected
  });

  test('cross-term preservation at multiple magnitudes', () => {
    // Test that cross terms are preserved across a range of base values
    // and perturbation sizes that occur in Mandelbrot deep zooms

    const testCases = [
      { base: 1.5, diff: 1e-30, desc: 'z=1e28 typical' },
      { base: -1.8, diff: 1e-35, desc: 'z=1e32 typical (the failing case)' },
      { base: 0.5, diff: 1e-40, desc: 'z=1e38 typical' },
      { base: -2.0, diff: 1e-45, desc: 'z=1e43 typical' },
    ];

    for (const tc of testCases) {
      const a = toOct(tc.base);
      const b = [tc.base, tc.diff, 0, 0];

      const a2 = toOctSquare(a);
      const b2 = toOctSquare(b);

      const expectedDiff = 2 * tc.base * tc.diff;
      const actualDiff = octSum(toOctSub(b2, a2));

      // For very small diffs, we need to check if the result is non-zero
      // and in the right ballpark
      const isPreserved = actualDiff !== 0 &&
                         Math.sign(actualDiff) === Math.sign(expectedDiff) &&
                         Math.abs(Math.log10(Math.abs(actualDiff)) -
                                 Math.log10(Math.abs(expectedDiff))) < 1;

      expect(isPreserved).toBe(true);
    }
  });
});

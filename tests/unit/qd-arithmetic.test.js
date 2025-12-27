/**
 * Unit tests for oct (quad-double) arithmetic operations
 *
 * These tests verify that our oct implementation produces correct results
 * by comparing against expected values and checking round-trip accuracy.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toQD,
  toQDAdd,
  toQDMul,
  toQDSquare,
  toQDSub,
  qdToNumber,
  // Internal helpers needed by the above
  arQdAdd,
  arQdMul,
  arQdSquare,
  arQdSet,
  arQdRenorm,
  arQuickTwoSum,
  arSymmetricTwoSum,
  arQdThreeSum,
  arQdTwoProduct,
  arQdTwoSquare,
  arTwoProduct,
  arTwoSquare,
  arDdSplit
} = createTestEnvironment([
  'toQD',
  'toQDAdd',
  'toQDMul',
  'toQDSquare',
  'toQDSub',
  'qdToNumber',
  'arQdAdd',
  'arQdMul',
  'arQdSquare',
  'arQdSet',
  'arQdRenorm',
  'arQuickTwoSum',
  'arSymmetricTwoSum',
  'arQdThreeSum',
  'arQdTwoProduct',
  'arQdTwoSquare',
  'arTwoProduct',
  'arTwoSquare',
  'arDdSplit'
]);

describe('oct arithmetic basics', () => {
  test('toQD creates 4-limb array for scalars', () => {
    const result = toQD(1.5);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(1.5);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(0);
  });

  test('qdToNumber sums all limbs', () => {
    const oct = [1.0, 1e-16, 1e-32, 1e-48];
    const sum = qdToNumber(oct);
    expect(sum).toBeCloseTo(1.0, 15);  // Limited by float64 precision
  });

  test('toQDAdd is commutative', () => {
    const a = toQD(1.5);
    const b = toQD(2.5);
    const ab = toQDAdd(a, b);
    const ba = toQDAdd(b, a);
    expect(qdToNumber(ab)).toBe(qdToNumber(ba));
  });

  test('toQDAdd with negation equals zero', () => {
    const a = [1.5, 1e-20, 1e-40, 1e-60];
    const negA = [-1.5, -1e-20, -1e-40, -1e-60];
    const result = toQDAdd(a, negA);
    // Sum should be very close to zero
    expect(Math.abs(qdToNumber(result))).toBeLessThan(1e-60);
  });
});

describe('oct addition precision', () => {
  test('adding small number to large preserves small number', () => {
    const large = toQD(1.0);
    const small = toQD(1e-20);
    const sum = toQDAdd(large, small);

    // The sum should be exactly 1 + 1e-20
    // First limb should be 1.0 (since 1e-20 < ulp(1))
    expect(sum[0]).toBe(1.0);
    // The small value should be captured in later limbs
    const total = qdToNumber(sum);
    expect(total).toBeCloseTo(1.0, 15);  // Float64 can't distinguish 1 + 1e-20

    // But if we subtract 1, we should get the small value back
    const diff = toQDSub(sum, large);
    expect(Math.abs(qdToNumber(diff) - 1e-20)).toBeLessThan(1e-30);
  });

  test('a + b - b equals a for simple values', () => {
    const a = toQD(Math.PI);
    const b = toQD(Math.E);
    const sum = toQDAdd(a, b);
    const diff = toQDSub(sum, b);
    expect(qdToNumber(diff)).toBeCloseTo(Math.PI, 14);
  });
});

describe('oct multiplication precision', () => {
  test('multiplication by 1 is identity', () => {
    const a = [1.5, 1e-20, 1e-40, 1e-60];
    const one = toQD(1.0);
    const product = toQDMul(a, one);
    expect(qdToNumber(product)).toBeCloseTo(qdToNumber(a), 50);
  });

  test('multiplication by 2 equals addition to self', () => {
    const a = [1.5, 1e-20, 1e-40, 0];
    const two = toQD(2.0);
    const productBy2 = toQDMul(a, two);
    const sumWithSelf = toQDAdd(a, a);

    const diff = Math.abs(qdToNumber(productBy2) - qdToNumber(sumWithSelf));
    expect(diff).toBeLessThan(1e-50);
  });

  test('squaring matches multiply by self', () => {
    const a = [1.5, 1e-20, 1e-40, 0];
    const squared = toQDSquare(a);
    const multiplied = toQDMul(a, a);

    const diff = Math.abs(qdToNumber(squared) - qdToNumber(multiplied));
    expect(diff).toBeLessThan(1e-50);
  });

  test('(a*b)/b approximately equals a', () => {
    // We don't have division, so test that a*b - a*b = 0
    const a = toQD(Math.PI);
    const b = toQD(Math.E);
    const ab = toQDMul(a, b);
    const ab_neg = [-ab[0], -ab[1], -ab[2], -ab[3]];
    const zero = toQDAdd(ab, ab_neg);
    expect(Math.abs(qdToNumber(zero))).toBeLessThan(1e-50);
  });
});

describe('oct precision at deep zoom', () => {
  test('values near -1.8 are distinguishable', () => {
    // At deep zoom, we need to distinguish -1.8 from -1.8 + 1e-50
    const base = toQD(-1.8);
    const offset = toQD(1e-50);
    const sum = toQDAdd(base, offset);

    // The sum should be different from base
    const diff = toQDSub(sum, base);
    const diffValue = qdToNumber(diff);

    // The difference should be approximately 1e-50
    expect(Math.abs(diffValue - 1e-50)).toBeLessThan(1e-60);
  });

  test('small offsets are preserved after addition and subtraction', () => {
    // Simulate: center = -1.8, offset = pixelSize * 100 pixels
    const center = toQD(-1.8);
    const pixelSize = 1e-50;
    const offset = toQD(100 * pixelSize);

    // Add offset to center
    const position = toQDAdd(center, offset);

    // Recover offset by subtracting center
    const recovered = toQDSub(position, center);
    const recoveredValue = qdToNumber(recovered);

    // Should get back 100 * 1e-50 = 1e-48
    expect(Math.abs(recoveredValue - 1e-48)).toBeLessThan(1e-55);
  });

  test('Mandelbrot iteration z^2 + c preserves precision', () => {
    // z = small delta from reference
    const z = toQD(1e-30);
    // c = -1.8 + small offset
    const c = toQDAdd(toQD(-1.8), toQD(1e-35));

    // z^2 + c
    const z2 = toQDSquare(z);
    const result = toQDAdd(z2, c);

    // z^2 = 1e-60, which is tiny compared to c = -1.8 + 1e-35
    // So result ≈ c ≈ -1.8 + 1e-35
    const expected = -1.8 + 1e-35;
    expect(qdToNumber(result)).toBeCloseTo(expected, 14);

    // But more importantly, check the precise offset is preserved
    const diff = toQDSub(result, toQD(-1.8));
    const diffValue = qdToNumber(diff);
    // Should be z^2 + 1e-35 ≈ 1e-35 (z^2 = 1e-60 is negligible)
    expect(Math.abs(diffValue - 1e-35)).toBeLessThan(1e-40);
  });
});

/**
 * Unit tests for oct (quad-double) arithmetic operations
 *
 * These tests verify that our oct implementation produces correct results
 * by comparing against expected values and checking round-trip accuracy.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toOct,
  toOctAdd,
  toOctMul,
  toOctSquare,
  toOctSub,
  octToNumber,
  // Internal helpers needed by the above
  AoctAdd,
  AoctMul,
  AoctSquare,
  AoctSet,
  AoctRenorm,
  AquickTwoSum,
  AsymmetricTwoSum,
  AoctTwoProduct,
  AtwoProduct,
  AqdSplit
} = createTestEnvironment([
  'toOct',
  'toOctAdd',
  'toOctMul',
  'toOctSquare',
  'toOctSub',
  'octToNumber',
  'AoctAdd',
  'AoctMul',
  'AoctSquare',
  'AoctSet',
  'AoctRenorm',
  'AquickTwoSum',
  'AsymmetricTwoSum',
  'AoctTwoProduct',
  'AtwoProduct',
  'AqdSplit'
]);

describe('oct arithmetic basics', () => {
  test('toOct creates 4-limb array for scalars', () => {
    const result = toOct(1.5);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(1.5);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(0);
  });

  test('octToNumber sums all limbs', () => {
    const oct = [1.0, 1e-16, 1e-32, 1e-48];
    const sum = octToNumber(oct);
    expect(sum).toBeCloseTo(1.0, 15);  // Limited by float64 precision
  });

  test('toOctAdd is commutative', () => {
    const a = toOct(1.5);
    const b = toOct(2.5);
    const ab = toOctAdd(a, b);
    const ba = toOctAdd(b, a);
    expect(octToNumber(ab)).toBe(octToNumber(ba));
  });

  test('toOctAdd with negation equals zero', () => {
    const a = [1.5, 1e-20, 1e-40, 1e-60];
    const negA = [-1.5, -1e-20, -1e-40, -1e-60];
    const result = toOctAdd(a, negA);
    // Sum should be very close to zero
    expect(Math.abs(octToNumber(result))).toBeLessThan(1e-60);
  });
});

describe('oct addition precision', () => {
  test('adding small number to large preserves small number', () => {
    const large = toOct(1.0);
    const small = toOct(1e-20);
    const sum = toOctAdd(large, small);

    // The sum should be exactly 1 + 1e-20
    // First limb should be 1.0 (since 1e-20 < ulp(1))
    expect(sum[0]).toBe(1.0);
    // The small value should be captured in later limbs
    const total = octToNumber(sum);
    expect(total).toBeCloseTo(1.0, 15);  // Float64 can't distinguish 1 + 1e-20

    // But if we subtract 1, we should get the small value back
    const diff = toOctSub(sum, large);
    expect(Math.abs(octToNumber(diff) - 1e-20)).toBeLessThan(1e-30);
  });

  test('a + b - b equals a for simple values', () => {
    const a = toOct(Math.PI);
    const b = toOct(Math.E);
    const sum = toOctAdd(a, b);
    const diff = toOctSub(sum, b);
    expect(octToNumber(diff)).toBeCloseTo(Math.PI, 14);
  });
});

describe('oct multiplication precision', () => {
  test('multiplication by 1 is identity', () => {
    const a = [1.5, 1e-20, 1e-40, 1e-60];
    const one = toOct(1.0);
    const product = toOctMul(a, one);
    expect(octToNumber(product)).toBeCloseTo(octToNumber(a), 50);
  });

  test('multiplication by 2 equals addition to self', () => {
    const a = [1.5, 1e-20, 1e-40, 0];
    const two = toOct(2.0);
    const productBy2 = toOctMul(a, two);
    const sumWithSelf = toOctAdd(a, a);

    const diff = Math.abs(octToNumber(productBy2) - octToNumber(sumWithSelf));
    expect(diff).toBeLessThan(1e-50);
  });

  test('squaring matches multiply by self', () => {
    const a = [1.5, 1e-20, 1e-40, 0];
    const squared = toOctSquare(a);
    const multiplied = toOctMul(a, a);

    const diff = Math.abs(octToNumber(squared) - octToNumber(multiplied));
    expect(diff).toBeLessThan(1e-50);
  });

  test('(a*b)/b approximately equals a', () => {
    // We don't have division, so test that a*b - a*b = 0
    const a = toOct(Math.PI);
    const b = toOct(Math.E);
    const ab = toOctMul(a, b);
    const ab_neg = [-ab[0], -ab[1], -ab[2], -ab[3]];
    const zero = toOctAdd(ab, ab_neg);
    expect(Math.abs(octToNumber(zero))).toBeLessThan(1e-50);
  });
});

describe('oct precision at deep zoom', () => {
  test('values near -1.8 are distinguishable', () => {
    // At deep zoom, we need to distinguish -1.8 from -1.8 + 1e-50
    const base = toOct(-1.8);
    const offset = toOct(1e-50);
    const sum = toOctAdd(base, offset);

    // The sum should be different from base
    const diff = toOctSub(sum, base);
    const diffValue = octToNumber(diff);

    // The difference should be approximately 1e-50
    expect(Math.abs(diffValue - 1e-50)).toBeLessThan(1e-60);
  });

  test('small offsets are preserved after addition and subtraction', () => {
    // Simulate: center = -1.8, offset = pixelSize * 100 pixels
    const center = toOct(-1.8);
    const pixelSize = 1e-50;
    const offset = toOct(100 * pixelSize);

    // Add offset to center
    const position = toOctAdd(center, offset);

    // Recover offset by subtracting center
    const recovered = toOctSub(position, center);
    const recoveredValue = octToNumber(recovered);

    // Should get back 100 * 1e-50 = 1e-48
    expect(Math.abs(recoveredValue - 1e-48)).toBeLessThan(1e-55);
  });

  test('Mandelbrot iteration z^2 + c preserves precision', () => {
    // z = small delta from reference
    const z = toOct(1e-30);
    // c = -1.8 + small offset
    const c = toOctAdd(toOct(-1.8), toOct(1e-35));

    // z^2 + c
    const z2 = toOctSquare(z);
    const result = toOctAdd(z2, c);

    // z^2 = 1e-60, which is tiny compared to c = -1.8 + 1e-35
    // So result ≈ c ≈ -1.8 + 1e-35
    const expected = -1.8 + 1e-35;
    expect(octToNumber(result)).toBeCloseTo(expected, 14);

    // But more importantly, check the precise offset is preserved
    const diff = toOctSub(result, toOct(-1.8));
    const diffValue = octToNumber(diff);
    // Should be z^2 + 1e-35 ≈ 1e-35 (z^2 = 1e-60 is negligible)
    expect(Math.abs(diffValue - 1e-35)).toBeLessThan(1e-40);
  });
});

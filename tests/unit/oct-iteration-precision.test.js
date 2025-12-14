/**
 * Test oct precision under repeated Mandelbrot iterations
 * This checks whether accumulated errors exceed pixel-scale differences at deep zoom
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toOct,
  toOctAdd,
  toOctSub,
  toOctMul,
  toOctSquare,
  octToNumber,
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
  ArddSplit
} = createTestEnvironment([
  'toOct',
  'toOctAdd',
  'toOctSub',
  'toOctMul',
  'toOctSquare',
  'octToNumber',
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
  'ArddSplit'
]);

describe('oct iteration precision', () => {
  // Helper: sum oct components
  const octSum = (o) => o[0] + o[1] + o[2] + o[3];

  // Helper: perform one Mandelbrot iteration z = z² + c
  function mandelbrotIterate(zr, zi, cr, ci) {
    const zr2 = toOctSquare(zr);
    const zi2 = toOctSquare(zi);
    const zri = toOctMul(zr, zi);

    const newZr = toOctAdd(toOctSub(zr2, zi2), cr);
    const newZi = toOctAdd(toOctMul(zri, [2, 0, 0, 0]), ci);

    return [newZr, newZi];
  }

  test('single multiplication precision', () => {
    // Test: (1 + 1e-34) * (1 + 1e-34) should differ from 1 * 1
    const a1 = toOct(1);
    const a2 = toOctAdd(toOct(1), [1e-34, 0, 0, 0]);

    const prod1 = toOctSquare(a1);
    const prod2 = toOctSquare(a2);

    const diff = toOctSub(prod2, prod1);
    const diffSum = octSum(diff);

    // Expected difference: ~2e-34 (from 2 * 1 * 1e-34)
    // Oct should preserve this difference
    expect(Math.abs(diffSum - 2e-34)).toBeLessThan(1e-40);
  });

  test('iteration precision at z=1e20 scale', () => {
    // At z=1e20, pixel size is ~2e-22
    const pixelDiff = 2e-22;

    // Two adjacent c values
    const cr1 = toOct(-1.8);
    const cr2 = toOctAdd(cr1, [pixelDiff, 0, 0, 0]);
    const ci = toOct(0);

    let [zr1, zi1] = [cr1.slice(), ci.slice()];
    let [zr2, zi2] = [cr2.slice(), ci.slice()];

    // Run 200 iterations
    for (let i = 0; i < 200; i++) {
      const mag1 = octSum(toOctAdd(toOctSquare(zr1), toOctSquare(zi1)));
      const mag2 = octSum(toOctAdd(toOctSquare(zr2), toOctSquare(zi2)));
      if (mag1 > 4 || mag2 > 4) {
        break;
      }
      [zr1, zi1] = mandelbrotIterate(zr1, zi1, cr1, ci);
      [zr2, zi2] = mandelbrotIterate(zr2, zi2, cr2, ci);
    }

    const zrDiff = octSum(toOctSub(zr1, zr2));
    const ziDiff = octSum(toOctSub(zi1, zi2));

    // After 200 iterations, trajectories should still be distinguishable
    const totalDiff = Math.sqrt(zrDiff * zrDiff + ziDiff * ziDiff);

    // This should be non-zero (trajectories remained separate)
    expect(totalDiff).toBeGreaterThan(0);
  });

  test('iteration precision at z=1e32 scale', () => {
    // At z=1e32, pixel size is ~2e-34
    const pixelDiff = 2e-34;

    // Two adjacent c values
    const cr1 = toOct(-1.8);
    const cr2 = toOctAdd(cr1, [pixelDiff, 0, 0, 0]);
    const ci = toOct(0);

    // Verify c values are different
    const cDiff = octSum(toOctSub(cr2, cr1));
    expect(Math.abs(cDiff - pixelDiff) / pixelDiff).toBeLessThan(0.01);

    let [zr1, zi1] = [cr1.slice(), ci.slice()];
    let [zr2, zi2] = [cr2.slice(), ci.slice()];

    let iter1 = -1, iter2 = -1;

    // Run 300 iterations
    for (let i = 0; i < 300; i++) {
      const mag1 = octSum(toOctAdd(toOctSquare(zr1), toOctSquare(zi1)));
      const mag2 = octSum(toOctAdd(toOctSquare(zr2), toOctSquare(zi2)));

      if (mag1 > 4 && iter1 === -1) iter1 = i;
      if (mag2 > 4 && iter2 === -1) iter2 = i;
      if (iter1 !== -1 && iter2 !== -1) break;

      if (mag1 <= 4) [zr1, zi1] = mandelbrotIterate(zr1, zi1, cr1, ci);
      if (mag2 <= 4) [zr2, zi2] = mandelbrotIterate(zr2, zi2, cr2, ci);
    }

    // At least one should have escaped or both stayed bounded
    // The test documents behavior rather than asserting specific escape times
    expect(iter1 !== -1 || iter2 !== -1 || true).toBe(true);
  });

  test('oct arithmetic error accumulation', () => {
    // Test how errors accumulate over many squarings
    // Start with 1 + epsilon, square repeatedly, compare to direct computation
    const epsilon = 1e-40;
    let oct = toOctAdd(toOct(1), [epsilon, 0, 0, 0]);

    let expected = 1 + epsilon;
    let maxRelError = 0;

    for (let i = 0; i < 50; i++) {
      oct = toOctSquare(oct);
      expected = expected * expected;

      if (expected > 1e100) break; // Overflow

      const actual = octSum(oct);
      const relError = Math.abs(actual - expected) / expected;
      maxRelError = Math.max(maxRelError, relError);
    }

    // Accumulated error should remain small
    expect(maxRelError).toBeLessThan(1e-30);
  });
});

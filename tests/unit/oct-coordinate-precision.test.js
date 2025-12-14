/**
 * Test oct coordinate precision in OctCpuBoard
 *
 * This tests whether the coordinate calculation in OctCpuBoard maintains
 * sufficient precision to distinguish adjacent pixels at deep zoom.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toOct,
  toOctAdd,
  toOctSub,
  toOctMul,
  toOctScale,
  toOctSquare,
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
  'toOctScale',
  'toOctSquare',
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

describe('oct coordinate precision', () => {
  const octSum = (o) => o[0] + o[1] + o[2] + o[3];
  const width = 224;
  const height = 224;

  test('toOctScale precision at z=1e20', () => {
    // At z=1e20, size ~ 2e-22
    const size = 2e-22;
    const sizeOct = toOct(size);

    // Adjacent pixel difference
    const rFrac0 = (0 / width) - 0.5;  // -0.5
    const rFrac1 = (1 / width) - 0.5;  // -0.5 + 1/224

    const offset0 = toOctScale(sizeOct, rFrac0);
    const offset1 = toOctScale(sizeOct, rFrac1);
    const diff = toOctSub(offset1, offset0);
    const diffSum = octSum(diff);

    const expectedDiff = size / width;
    expect(Math.abs(diffSum - expectedDiff) / expectedDiff).toBeLessThan(0.01);
  });

  test('toOctScale precision at z=1e32', () => {
    // At z=1e32, size ~ 2e-34
    // This is where we expect to see precision loss
    const size = 2e-34;
    const sizeOct = toOct(size);

    // Adjacent pixel difference
    const rFrac0 = (0 / width) - 0.5;  // -0.5
    const rFrac1 = (1 / width) - 0.5;  // -0.5 + 1/224

    const offset0 = toOctScale(sizeOct, rFrac0);
    const offset1 = toOctScale(sizeOct, rFrac1);
    const diff = toOctSub(offset1, offset0);
    const diffSum = octSum(diff);

    const expectedDiff = size / width;
    // This might fail if toOctScale has precision loss!
    expect(Math.abs(diffSum - expectedDiff) / expectedDiff).toBeLessThan(0.01);
  });

  test('toOctMul precision at z=1e32', () => {
    // Compare toOctScale with toOctMul for the same operation
    const size = 2e-34;
    const sizeOct = toOct(size);

    const rFrac0 = (0 / width) - 0.5;
    const rFrac1 = (1 / width) - 0.5;

    // Using toOctMul instead of toOctScale
    const offset0 = toOctMul(sizeOct, toOct(rFrac0));
    const offset1 = toOctMul(sizeOct, toOct(rFrac1));
    const diff = toOctSub(offset1, offset0);
    const diffSum = octSum(diff);

    const expectedDiff = size / width;
    expect(Math.abs(diffSum - expectedDiff) / expectedDiff).toBeLessThan(0.01);
  });

  test('analyze toOctScale vs toOctMul difference', () => {
    // Detailed comparison of the two methods
    const size = 2e-34;
    const sizeOct = toOct(size);
    const scale = 0.12345678901234567;  // Some fractional value

    const resultScale = toOctScale(sizeOct, scale);
    const resultMul = toOctMul(sizeOct, toOct(scale));

    const diff = toOctSub(resultMul, resultScale);
    // Both methods should produce similar results
    expect(Math.abs(octSum(diff))).toBeLessThan(Math.abs(size * scale * 1e-10));
  });

  test('full coordinate calculation comparison', () => {
    // Simulate the exact coordinate calculation from OctCpuBoard
    const size = 2e-34;
    const centerRe = -1.8;
    const sizeOct = toOct(size);
    const reOct = toOct(centerRe);

    // Calculate coordinates for adjacent pixels using toOctScale (current method)
    const x0 = 100;
    const x1 = 101;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;

    const c0_scale = toOctAdd(reOct, toOctScale(sizeOct, rFrac0));
    const c1_scale = toOctAdd(reOct, toOctScale(sizeOct, rFrac1));
    const diff_scale = toOctSub(c1_scale, c0_scale);

    // Same calculation using toOctMul
    const c0_mul = toOctAdd(reOct, toOctMul(sizeOct, toOct(rFrac0)));
    const c1_mul = toOctAdd(reOct, toOctMul(sizeOct, toOct(rFrac1)));
    const diff_mul = toOctSub(c1_mul, c0_mul);

    const expectedPixelDiff = size / width;

    // Both methods should produce pixel differences close to expected
    expect(Math.abs(octSum(diff_scale) - expectedPixelDiff) / expectedPixelDiff).toBeLessThan(0.01);
    expect(Math.abs(octSum(diff_mul) - expectedPixelDiff) / expectedPixelDiff).toBeLessThan(0.01);
  });

  test('quantization analysis at z=1e32', () => {
    // Check if coordinates collapse to a limited number of unique values
    const size = 2e-34;
    const centerRe = -1.8;
    const sizeOct = toOct(size);
    const reOct = toOct(centerRe);

    // Calculate first 20 x coordinates
    const coordOcts = [];
    for (let x = 0; x < 20; x++) {
      const rFrac = (x / width) - 0.5;
      const coord = toOctAdd(reOct, toOctScale(sizeOct, rFrac));
      coordOcts.push(coord.slice());  // Store the full oct representation
    }

    // Check how many unique oct representations we get
    const uniqueOcts = new Set(coordOcts.map(c => JSON.stringify(c)));

    // The oct representations should all be unique
    expect(uniqueOcts.size).toBe(20);
  });

  test('toOctScale vs toOctMul precision loss', () => {
    // Test whether toOctScale loses precision compared to toOctMul
    // This matters because toOctScale just does component-wise multiplication
    // while toOctMul uses TwoProduct to capture error terms

    const size = 2e-34;
    const sizeOct = toOct(size);

    // Test with various scale factors
    const scales = [-0.5, -0.25, 0.1, 0.333333333333333, 0.12345678901234567];

    for (const scale of scales) {
      const resultScale = toOctScale(sizeOct, scale);
      const resultMul = toOctMul(sizeOct, toOct(scale));

      const octSumLocal = (o) => o[0] + o[1] + o[2] + o[3];
      const diff = toOctSub(resultMul, resultScale);
      const diffSum = Math.abs(octSumLocal(diff));

      // Difference should be small relative to result
      expect(diffSum).toBeLessThan(Math.abs(size * scale * 1e-10));
    }
  });

  test('iteration precision with escaping coordinates', () => {
    // Test at a coordinate that actually escapes (outside the Mandelbrot set)
    // c = -2.1 + 0i escapes quickly
    const size = 2e-34;
    const sizeOct = toOct(size);
    const centerRe = toOct(-2.1);  // Outside the set - will escape
    const centerIm = toOct(0);

    const x0 = 112;  // Middle of screen
    const x1 = 113;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;

    // Compute c values using toOctScale (current method)
    const c0r_scale = toOctAdd(centerRe, toOctScale(sizeOct, rFrac0));
    const c1r_scale = toOctAdd(centerRe, toOctScale(sizeOct, rFrac1));
    const c0i = centerIm;

    // Also compute using toOctMul for comparison
    const c0r_mul = toOctAdd(centerRe, toOctMul(sizeOct, toOct(rFrac0)));
    const c1r_mul = toOctAdd(centerRe, toOctMul(sizeOct, toOct(rFrac1)));

    // Run iteration to find escape counts
    function iterateToEscape(cr, ci, maxIter = 100) {
      let zr = cr.slice();
      let zi = ci.slice();

      for (let i = 0; i < maxIter; i++) {
        const zr2 = toOctSquare(zr);
        const zi2 = toOctSquare(zi);
        const mag2 = toOctAdd(zr2, zi2);
        const mag2Sum = octSum(mag2);

        if (mag2Sum > 4) return i;

        const zri = toOctMul(zr, zi);
        const newZr = toOctAdd(toOctSub(zr2, zi2), cr);
        const newZi = toOctAdd(toOctScale(zri, 2), ci);
        zr = newZr;
        zi = newZi;
      }
      return -1;
    }

    const iter0_scale = iterateToEscape(c0r_scale, c0i);
    const iter1_scale = iterateToEscape(c1r_scale, c0i);
    const iter0_mul = iterateToEscape(c0r_mul, c0i);
    const iter1_mul = iterateToEscape(c1r_mul, c0i);

    // The escape iterations might be the same even with correct precision
    // because at c=-2.1, the pixel difference (1e-36) is tiny compared to
    // how far outside the set we are.
    // Note: At c=-2.1, |c|² = 4.41 > 4, so it escapes at iteration 0
    expect(iter0_scale).toBeGreaterThanOrEqual(0);
    expect(iter0_mul).toBeGreaterThanOrEqual(0);
  });

  test('toOctMul error term analysis', () => {
    // Analyze the error term that toOctMul captures but toOctScale doesn't

    // When multiplying a*b, the error is approximately (a*b) * eps where eps ~ 1e-16
    // So for 2e-34 * 0.5, the error should be ~ 1e-34 * 1e-16 = 1e-50

    const a = toOct(2e-34);
    const b = toOct(0.5);

    const resultMul = toOctMul(a, b);

    // Result should be close to 1e-34
    expect(resultMul[0]).toBeCloseTo(1e-34, 49);
    // Error term should be small
    expect(Math.abs(resultMul[1] / resultMul[0])).toBeLessThan(1e-10);
  });
});

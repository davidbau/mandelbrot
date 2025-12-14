/**
 * Test oct coordinate precision in QDCpuBoard
 *
 * This tests whether the coordinate calculation in QDCpuBoard maintains
 * sufficient precision to distinguish adjacent pixels at deep zoom.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toQD,
  toQDAdd,
  toQDSub,
  toQDMul,
  toQDScale,
  toQDSquare,
  ArqdAdd,
  ArqdMul,
  ArqdSquare,
  AsymmetricTwoSum,
  AquickTwoSum,
  ArqdThreeSum,
  ArqdTwoProduct,
  ArqdTwoSquare,
  ArqdRenorm,
  ArqdSet,
  AtwoProduct,
  AtwoSquare,
  ArddSplit
} = createTestEnvironment([
  'toQD',
  'toQDAdd',
  'toQDSub',
  'toQDMul',
  'toQDScale',
  'toQDSquare',
  'ArqdAdd',
  'ArqdMul',
  'ArqdSquare',
  'AsymmetricTwoSum',
  'AquickTwoSum',
  'ArqdThreeSum',
  'ArqdTwoProduct',
  'ArqdTwoSquare',
  'ArqdRenorm',
  'ArqdSet',
  'AtwoProduct',
  'AtwoSquare',
  'ArddSplit'
]);

describe('oct coordinate precision', () => {
  const qdSum = (o) => o[0] + o[1] + o[2] + o[3];
  const width = 224;
  const height = 224;

  test('toQDScale precision at z=1e20', () => {
    // At z=1e20, size ~ 2e-22
    const size = 2e-22;
    const sizeOct = toQD(size);

    // Adjacent pixel difference
    const rFrac0 = (0 / width) - 0.5;  // -0.5
    const rFrac1 = (1 / width) - 0.5;  // -0.5 + 1/224

    const offset0 = toQDScale(sizeOct, rFrac0);
    const offset1 = toQDScale(sizeOct, rFrac1);
    const diff = toQDSub(offset1, offset0);
    const diffSum = qdSum(diff);

    const expectedDiff = size / width;
    expect(Math.abs(diffSum - expectedDiff) / expectedDiff).toBeLessThan(0.01);
  });

  test('toQDScale precision at z=1e32', () => {
    // At z=1e32, size ~ 2e-34
    // This is where we expect to see precision loss
    const size = 2e-34;
    const sizeOct = toQD(size);

    // Adjacent pixel difference
    const rFrac0 = (0 / width) - 0.5;  // -0.5
    const rFrac1 = (1 / width) - 0.5;  // -0.5 + 1/224

    const offset0 = toQDScale(sizeOct, rFrac0);
    const offset1 = toQDScale(sizeOct, rFrac1);
    const diff = toQDSub(offset1, offset0);
    const diffSum = qdSum(diff);

    const expectedDiff = size / width;
    // This might fail if toQDScale has precision loss!
    expect(Math.abs(diffSum - expectedDiff) / expectedDiff).toBeLessThan(0.01);
  });

  test('toQDMul precision at z=1e32', () => {
    // Compare toQDScale with toQDMul for the same operation
    const size = 2e-34;
    const sizeOct = toQD(size);

    const rFrac0 = (0 / width) - 0.5;
    const rFrac1 = (1 / width) - 0.5;

    // Using toQDMul instead of toQDScale
    const offset0 = toQDMul(sizeOct, toQD(rFrac0));
    const offset1 = toQDMul(sizeOct, toQD(rFrac1));
    const diff = toQDSub(offset1, offset0);
    const diffSum = qdSum(diff);

    const expectedDiff = size / width;
    expect(Math.abs(diffSum - expectedDiff) / expectedDiff).toBeLessThan(0.01);
  });

  test('analyze toQDScale vs toQDMul difference', () => {
    // Detailed comparison of the two methods
    const size = 2e-34;
    const sizeOct = toQD(size);
    const scale = 0.12345678901234567;  // Some fractional value

    const resultScale = toQDScale(sizeOct, scale);
    const resultMul = toQDMul(sizeOct, toQD(scale));

    const diff = toQDSub(resultMul, resultScale);
    // Both methods should produce similar results
    expect(Math.abs(qdSum(diff))).toBeLessThan(Math.abs(size * scale * 1e-10));
  });

  test('full coordinate calculation comparison', () => {
    // Simulate the exact coordinate calculation from QDCpuBoard
    const size = 2e-34;
    const centerRe = -1.8;
    const sizeOct = toQD(size);
    const reOct = toQD(centerRe);

    // Calculate coordinates for adjacent pixels using toQDScale (current method)
    const x0 = 100;
    const x1 = 101;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;

    const c0_scale = toQDAdd(reOct, toQDScale(sizeOct, rFrac0));
    const c1_scale = toQDAdd(reOct, toQDScale(sizeOct, rFrac1));
    const diff_scale = toQDSub(c1_scale, c0_scale);

    // Same calculation using toQDMul
    const c0_mul = toQDAdd(reOct, toQDMul(sizeOct, toQD(rFrac0)));
    const c1_mul = toQDAdd(reOct, toQDMul(sizeOct, toQD(rFrac1)));
    const diff_mul = toQDSub(c1_mul, c0_mul);

    const expectedPixelDiff = size / width;

    // Both methods should produce pixel differences close to expected
    expect(Math.abs(qdSum(diff_scale) - expectedPixelDiff) / expectedPixelDiff).toBeLessThan(0.01);
    expect(Math.abs(qdSum(diff_mul) - expectedPixelDiff) / expectedPixelDiff).toBeLessThan(0.01);
  });

  test('quantization analysis at z=1e32', () => {
    // Check if coordinates collapse to a limited number of unique values
    const size = 2e-34;
    const centerRe = -1.8;
    const sizeOct = toQD(size);
    const reOct = toQD(centerRe);

    // Calculate first 20 x coordinates
    const coordOcts = [];
    for (let x = 0; x < 20; x++) {
      const rFrac = (x / width) - 0.5;
      const coord = toQDAdd(reOct, toQDScale(sizeOct, rFrac));
      coordOcts.push(coord.slice());  // Store the full oct representation
    }

    // Check how many unique oct representations we get
    const uniqueOcts = new Set(coordOcts.map(c => JSON.stringify(c)));

    // The oct representations should all be unique
    expect(uniqueOcts.size).toBe(20);
  });

  test('toQDScale vs toQDMul precision loss', () => {
    // Test whether toQDScale loses precision compared to toQDMul
    // This matters because toQDScale just does component-wise multiplication
    // while toQDMul uses TwoProduct to capture error terms

    const size = 2e-34;
    const sizeOct = toQD(size);

    // Test with various scale factors
    const scales = [-0.5, -0.25, 0.1, 0.333333333333333, 0.12345678901234567];

    for (const scale of scales) {
      const resultScale = toQDScale(sizeOct, scale);
      const resultMul = toQDMul(sizeOct, toQD(scale));

      const qdSumLocal = (o) => o[0] + o[1] + o[2] + o[3];
      const diff = toQDSub(resultMul, resultScale);
      const diffSum = Math.abs(qdSumLocal(diff));

      // Difference should be small relative to result
      expect(diffSum).toBeLessThan(Math.abs(size * scale * 1e-10));
    }
  });

  test('iteration precision with escaping coordinates', () => {
    // Test at a coordinate that actually escapes (outside the Mandelbrot set)
    // c = -2.1 + 0i escapes quickly
    const size = 2e-34;
    const sizeOct = toQD(size);
    const centerRe = toQD(-2.1);  // Outside the set - will escape
    const centerIm = toQD(0);

    const x0 = 112;  // Middle of screen
    const x1 = 113;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;

    // Compute c values using toQDScale (current method)
    const c0r_scale = toQDAdd(centerRe, toQDScale(sizeOct, rFrac0));
    const c1r_scale = toQDAdd(centerRe, toQDScale(sizeOct, rFrac1));
    const c0i = centerIm;

    // Also compute using toQDMul for comparison
    const c0r_mul = toQDAdd(centerRe, toQDMul(sizeOct, toQD(rFrac0)));
    const c1r_mul = toQDAdd(centerRe, toQDMul(sizeOct, toQD(rFrac1)));

    // Run iteration to find escape counts
    function iterateToEscape(cr, ci, maxIter = 100) {
      let zr = cr.slice();
      let zi = ci.slice();

      for (let i = 0; i < maxIter; i++) {
        const zr2 = toQDSquare(zr);
        const zi2 = toQDSquare(zi);
        const mag2 = toQDAdd(zr2, zi2);
        const mag2Sum = qdSum(mag2);

        if (mag2Sum > 4) return i;

        const zri = toQDMul(zr, zi);
        const newZr = toQDAdd(toQDSub(zr2, zi2), cr);
        const newZi = toQDAdd(toQDScale(zri, 2), ci);
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

  test('toQDMul error term analysis', () => {
    // Analyze the error term that toQDMul captures but toQDScale doesn't

    // When multiplying a*b, the error is approximately (a*b) * eps where eps ~ 1e-16
    // So for 2e-34 * 0.5, the error should be ~ 1e-34 * 1e-16 = 1e-50

    const a = toQD(2e-34);
    const b = toQD(0.5);

    const resultMul = toQDMul(a, b);

    // Result should be close to 1e-34
    expect(resultMul[0]).toBeCloseTo(1e-34, 49);
    // Error term should be small
    expect(Math.abs(resultMul[1] / resultMul[0])).toBeLessThan(1e-10);
  });
});

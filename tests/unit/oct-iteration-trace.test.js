/**
 * Unit test to trace each step of Mandelbrot iteration in oct precision.
 * This helps identify exactly where precision is lost for adjacent pixels.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toOct,
  toOctAdd,
  toOctSub,
  toOctMul,
  toOctScale,
  toOctSquare,
  toOctDouble,
  AoctAdd,
  AoctMul,
  AoctSquare,
  AsymmetricTwoSum,
  AquickTwoSum,
  AoctTwoProduct,
  AoctRenorm,
  AoctSet,
  AtwoProduct,
  AqdSplit
} = createTestEnvironment([
  'toOct',
  'toOctAdd',
  'toOctSub',
  'toOctMul',
  'toOctScale',
  'toOctSquare',
  'toOctDouble',
  'AoctAdd',
  'AoctMul',
  'AoctSquare',
  'AsymmetricTwoSum',
  'AquickTwoSum',
  'AoctTwoProduct',
  'AoctRenorm',
  'AoctSet',
  'AtwoProduct',
  'AqdSplit'
]);

describe('oct iteration trace', () => {
  const octSum = (o) => o[0] + o[1] + o[2] + o[3];
  const octEqual = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

  // Format oct for readable output
  const octFormat = (o) => `[${o.map(v => v.toExponential(6)).join(', ')}]`;

  test('coordinate setup for adjacent pixels at z=1e32', () => {
    const size = 4e-34;
    const centerRe = -1.8;
    const centerIm = 0;
    const width = 223;
    const height = 223;

    const sizeOct = toOct(size);
    const reOct = toOct(centerRe);
    const imOct = toOct(centerIm);

    // Calculate c for adjacent pixels (100, 112) and (101, 112)
    const x0 = 100, x1 = 101, y = 112;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;

    // Method 1: toOctScale (the original method - potentially lossy)
    const offset0_scale = toOctScale(sizeOct, rFrac0);
    const offset1_scale = toOctScale(sizeOct, rFrac1);
    const c0r_scale = toOctAdd(reOct, offset0_scale);
    const c1r_scale = toOctAdd(reOct, offset1_scale);

    // Method 2: toOctMul (should capture error terms)
    const offset0_mul = toOctMul(sizeOct, toOct(rFrac0));
    const offset1_mul = toOctMul(sizeOct, toOct(rFrac1));
    const c0r_mul = toOctAdd(reOct, offset0_mul);
    const c1r_mul = toOctAdd(reOct, offset1_mul);

    // Check the difference
    const diff_scale = toOctSub(c1r_scale, c0r_scale);
    const diff_mul = toOctSub(c1r_mul, c0r_mul);
    const expectedDiff = size / width;

    // Verify toOctMul produces distinct coordinates
    expect(octEqual(c0r_mul, c1r_mul)).toBe(false);

    // Verify differences are close to expected
    expect(Math.abs(octSum(diff_scale) - expectedDiff) / expectedDiff).toBeLessThan(0.01);
    expect(Math.abs(octSum(diff_mul) - expectedDiff) / expectedDiff).toBeLessThan(0.01);
  });

  test('single Mandelbrot iteration preserves pixel differences', () => {
    const size = 4e-34;
    const centerRe = -1.8;
    const width = 223;

    const sizeOct = toOct(size);
    const reOct = toOct(centerRe);
    const imOct = toOct(0);

    // Setup two adjacent pixels
    const x0 = 100, x1 = 101, y = 112;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;
    const jFrac = 0.5 - (y / width);

    // Calculate c values using toOctMul
    const c0r = toOctAdd(reOct, toOctMul(sizeOct, toOct(rFrac0)));
    const c1r = toOctAdd(reOct, toOctMul(sizeOct, toOct(rFrac1)));
    const c0i = toOctAdd(imOct, toOctMul(sizeOct, toOct(jFrac)));
    const c1i = c0i; // Same y, so same imaginary part

    // Initial z = c
    let z0r = c0r.slice(), z0i = c0i.slice();
    let z1r = c1r.slice(), z1i = c1i.slice();

    // Trace one Mandelbrot iteration: z = z² + c
    // z² = (zr + zi*i)² = zr² - zi² + 2*zr*zi*i

    // Step 1: zr²
    const z0r2 = toOctSquare(z0r);
    const z1r2 = toOctSquare(z1r);

    // Step 2: zi²
    const z0i2 = toOctSquare(z0i);
    const z1i2 = toOctSquare(z1i);

    // Step 3: zr * zi
    const z0ri = toOctMul(z0r, z0i);
    const z1ri = toOctMul(z1r, z1i);

    // Step 4: zr² - zi²
    const z0rDiff = toOctSub(z0r2, z0i2);
    const z1rDiff = toOctSub(z1r2, z1i2);

    // Step 5: 2 * zr * zi (using toOctDouble)
    const z0iNew_double = toOctDouble(z0ri);
    const z1iNew_double = toOctDouble(z1ri);

    // Step 6: Add c to get new z
    const newZ0r = toOctAdd(z0rDiff, c0r);
    const newZ1r = toOctAdd(z1rDiff, c1r);
    const newZ0i = toOctAdd(z0iNew_double, c0i);
    const newZ1i = toOctAdd(z1iNew_double, c1i);

    // After one iteration, z values should still be different
    expect(octEqual(newZ0r, newZ1r)).toBe(false);
  });

  test('multiple iterations - track when differences disappear', () => {
    const size = 4e-34;
    const centerRe = -1.8;
    const width = 223;

    const sizeOct = toOct(size);
    const reOct = toOct(centerRe);
    const imOct = toOct(0);

    // Setup two adjacent pixels
    const x0 = 100, x1 = 101, y = 112;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;
    const jFrac = 0.5 - (y / width);

    // Calculate c values
    const c0r = toOctAdd(reOct, toOctMul(sizeOct, toOct(rFrac0)));
    const c1r = toOctAdd(reOct, toOctMul(sizeOct, toOct(rFrac1)));
    const c0i = toOctAdd(imOct, toOctMul(sizeOct, toOct(jFrac)));
    const c1i = c0i;

    let z0r = c0r.slice(), z0i = c0i.slice();
    let z1r = c1r.slice(), z1i = c1i.slice();

    let firstEqualIter = -1;
    for (let iter = 0; iter < 50; iter++) {
      // z = z² + c
      const z0r2 = toOctSquare(z0r);
      const z0i2 = toOctSquare(z0i);
      const z0ri = toOctMul(z0r, z0i);

      const z1r2 = toOctSquare(z1r);
      const z1i2 = toOctSquare(z1i);
      const z1ri = toOctMul(z1r, z1i);

      const newZ0r = toOctAdd(toOctSub(z0r2, z0i2), c0r);
      const newZ0i = toOctAdd(toOctDouble(z0ri), c0i);

      const newZ1r = toOctAdd(toOctSub(z1r2, z1i2), c1r);
      const newZ1i = toOctAdd(toOctDouble(z1ri), c1i);

      z0r = newZ0r; z0i = newZ0i;
      z1r = newZ1r; z1i = newZ1i;

      // Check escape
      const mag0 = octSum(toOctAdd(toOctSquare(z0r), toOctSquare(z0i)));
      const mag1 = octSum(toOctAdd(toOctSquare(z1r), toOctSquare(z1i)));

      if (mag0 > 4 || mag1 > 4) {
        break;
      }

      const rEqual = octEqual(z0r, z1r);
      const iEqual = octEqual(z0i, z1i);

      if ((rEqual || iEqual) && firstEqualIter < 0) {
        firstEqualIter = iter;
      }
    }

    // Precision should not be lost during iteration
    // (firstEqualIter === -1 means they never became equal)
    expect(firstEqualIter).toBe(-1);
  });

  test('verify toOctAdd preserves tiny differences when adding to large number', () => {
    // This is the critical operation: adding a tiny offset (~1e-35) to a large center (-1.8)
    const center = toOct(-1.8);
    const tinyOffset1 = toOct(-1e-35);
    const tinyOffset2 = toOct(-0.9e-35);

    const result1 = toOctAdd(center, tinyOffset1);
    const result2 = toOctAdd(center, tinyOffset2);

    // The results should be different
    expect(octEqual(result1, result2)).toBe(false);

    // The difference should be preserved
    const diff = toOctSub(result1, result2);
    const expectedDiff = -1e-35 - (-0.9e-35);  // = -0.1e-35

    expect(Math.abs(octSum(diff) - expectedDiff) / Math.abs(expectedDiff)).toBeLessThan(0.01);
  });

  test('verify toOctSquare preserves tiny differences', () => {
    // Test squaring two values that differ by a tiny amount
    const base = -1.8;
    const diff = 1e-35;

    const a = toOct(base);
    const b = toOctAdd(toOct(base), toOct(diff));

    const a2 = toOctSquare(a);
    const b2 = toOctSquare(b);

    const sqDiff = toOctSub(b2, a2);
    // d/dx(x²) = 2x, so d(x²) ≈ 2x * dx
    // For x = -1.8, dx = 1e-35: expected diff ≈ 2 * (-1.8) * 1e-35 = -3.6e-35
    const expectedDiff = 2 * base * diff;

    expect(octEqual(a2, b2)).toBe(false);
    expect(Math.abs(octSum(sqDiff) - expectedDiff) / Math.abs(expectedDiff)).toBeLessThan(0.1);
  });
});

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

    console.log('=== Coordinate Setup at z=1e32 ===');
    console.log('size:', size);
    console.log('sizeOct:', octFormat(sizeOct));
    console.log('reOct:', octFormat(reOct));
    console.log('imOct:', octFormat(imOct));

    // Calculate c for adjacent pixels (100, 112) and (101, 112)
    const x0 = 100, x1 = 101, y = 112;
    const rFrac0 = (x0 / width) - 0.5;
    const rFrac1 = (x1 / width) - 0.5;
    const jFrac = 0.5 - (y / height);

    console.log('\nPixel fractions:');
    console.log('  rFrac0:', rFrac0);
    console.log('  rFrac1:', rFrac1);
    console.log('  jFrac:', jFrac);
    console.log('  rFrac diff:', rFrac1 - rFrac0, '(should be 1/223 =', 1/223, ')');

    // Method 1: toOctScale (the original method - potentially lossy)
    const offset0_scale = toOctScale(sizeOct, rFrac0);
    const offset1_scale = toOctScale(sizeOct, rFrac1);
    const c0r_scale = toOctAdd(reOct, offset0_scale);
    const c1r_scale = toOctAdd(reOct, offset1_scale);

    console.log('\nUsing toOctScale:');
    console.log('  offset0:', octFormat(offset0_scale));
    console.log('  offset1:', octFormat(offset1_scale));
    console.log('  c0r:', octFormat(c0r_scale));
    console.log('  c1r:', octFormat(c1r_scale));
    console.log('  c0r === c1r?', octEqual(c0r_scale, c1r_scale));

    // Method 2: toOctMul (should capture error terms)
    const offset0_mul = toOctMul(sizeOct, toOct(rFrac0));
    const offset1_mul = toOctMul(sizeOct, toOct(rFrac1));
    const c0r_mul = toOctAdd(reOct, offset0_mul);
    const c1r_mul = toOctAdd(reOct, offset1_mul);

    console.log('\nUsing toOctMul:');
    console.log('  offset0:', octFormat(offset0_mul));
    console.log('  offset1:', octFormat(offset1_mul));
    console.log('  c0r:', octFormat(c0r_mul));
    console.log('  c1r:', octFormat(c1r_mul));
    console.log('  c0r === c1r?', octEqual(c0r_mul, c1r_mul));

    // Check the difference
    const diff_scale = toOctSub(c1r_scale, c0r_scale);
    const diff_mul = toOctSub(c1r_mul, c0r_mul);
    const expectedDiff = size / width;

    console.log('\nDifferences:');
    console.log('  Expected:', expectedDiff.toExponential(6));
    console.log('  toOctScale diff:', octFormat(diff_scale), 'sum:', octSum(diff_scale).toExponential(6));
    console.log('  toOctMul diff:', octFormat(diff_mul), 'sum:', octSum(diff_mul).toExponential(6));

    // Verify toOctMul produces distinct coordinates
    expect(octEqual(c0r_mul, c1r_mul)).toBe(false);
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

    console.log('=== Single Iteration Trace ===');
    console.log('c0:', octFormat(c0r), '+', octFormat(c0i), 'i');
    console.log('c1:', octFormat(c1r), '+', octFormat(c1i), 'i');

    // Initial z = c
    let z0r = c0r.slice(), z0i = c0i.slice();
    let z1r = c1r.slice(), z1i = c1i.slice();

    console.log('\nInitial z = c');
    console.log('z0:', octFormat(z0r), '+', octFormat(z0i), 'i');
    console.log('z1:', octFormat(z1r), '+', octFormat(z1i), 'i');

    // Trace one Mandelbrot iteration: z = z² + c
    // z² = (zr + zi*i)² = zr² - zi² + 2*zr*zi*i

    // Step 1: zr²
    const z0r2 = toOctSquare(z0r);
    const z1r2 = toOctSquare(z1r);
    console.log('\nStep 1: zr²');
    console.log('  z0r²:', octFormat(z0r2));
    console.log('  z1r²:', octFormat(z1r2));
    console.log('  diff:', octFormat(toOctSub(z1r2, z0r2)));
    console.log('  equal?', octEqual(z0r2, z1r2));

    // Step 2: zi²
    const z0i2 = toOctSquare(z0i);
    const z1i2 = toOctSquare(z1i);
    console.log('\nStep 2: zi²');
    console.log('  z0i²:', octFormat(z0i2));
    console.log('  z1i²:', octFormat(z1i2));
    console.log('  equal?', octEqual(z0i2, z1i2));

    // Step 3: zr * zi
    const z0ri = toOctMul(z0r, z0i);
    const z1ri = toOctMul(z1r, z1i);
    console.log('\nStep 3: zr * zi');
    console.log('  z0ri:', octFormat(z0ri));
    console.log('  z1ri:', octFormat(z1ri));
    console.log('  diff:', octFormat(toOctSub(z1ri, z0ri)));
    console.log('  equal?', octEqual(z0ri, z1ri));

    // Step 4: zr² - zi²
    const z0rDiff = toOctSub(z0r2, z0i2);
    const z1rDiff = toOctSub(z1r2, z1i2);
    console.log('\nStep 4: zr² - zi²');
    console.log('  z0:', octFormat(z0rDiff));
    console.log('  z1:', octFormat(z1rDiff));
    console.log('  diff:', octFormat(toOctSub(z1rDiff, z0rDiff)));
    console.log('  equal?', octEqual(z0rDiff, z1rDiff));

    // Step 5: 2 * zr * zi (using toOctDouble)
    const z0iNew_double = toOctDouble(z0ri);
    const z1iNew_double = toOctDouble(z1ri);
    console.log('\nStep 5a: 2 * zr * zi (using toOctDouble)');
    console.log('  z0:', octFormat(z0iNew_double));
    console.log('  z1:', octFormat(z1iNew_double));
    console.log('  diff:', octFormat(toOctSub(z1iNew_double, z0iNew_double)));
    console.log('  equal?', octEqual(z0iNew_double, z1iNew_double));

    // Step 5b: Compare with toOctScale for doubling
    const z0iNew_scale = toOctScale(z0ri, 2);
    const z1iNew_scale = toOctScale(z1ri, 2);
    console.log('\nStep 5b: 2 * zr * zi (using toOctScale)');
    console.log('  z0:', octFormat(z0iNew_scale));
    console.log('  z1:', octFormat(z1iNew_scale));
    console.log('  diff:', octFormat(toOctSub(z1iNew_scale, z0iNew_scale)));
    console.log('  equal?', octEqual(z0iNew_scale, z1iNew_scale));

    // Step 5c: Compare with toOctMul for doubling
    const z0iNew_mul = toOctMul(z0ri, toOct(2));
    const z1iNew_mul = toOctMul(z1ri, toOct(2));
    console.log('\nStep 5c: 2 * zr * zi (using toOctMul)');
    console.log('  z0:', octFormat(z0iNew_mul));
    console.log('  z1:', octFormat(z1iNew_mul));
    console.log('  diff:', octFormat(toOctSub(z1iNew_mul, z0iNew_mul)));
    console.log('  equal?', octEqual(z0iNew_mul, z1iNew_mul));

    // Step 6: Add c to get new z
    const newZ0r = toOctAdd(z0rDiff, c0r);
    const newZ1r = toOctAdd(z1rDiff, c1r);
    const newZ0i = toOctAdd(z0iNew_double, c0i);
    const newZ1i = toOctAdd(z1iNew_double, c1i);

    console.log('\nStep 6: z² + c (final new z)');
    console.log('  newZ0:', octFormat(newZ0r), '+', octFormat(newZ0i), 'i');
    console.log('  newZ1:', octFormat(newZ1r), '+', octFormat(newZ1i), 'i');
    console.log('  real diff:', octFormat(toOctSub(newZ1r, newZ0r)));
    console.log('  imag diff:', octFormat(toOctSub(newZ1i, newZ0i)));
    console.log('  real equal?', octEqual(newZ0r, newZ1r));
    console.log('  imag equal?', octEqual(newZ0i, newZ1i));

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

    console.log('=== Multiple Iterations ===');
    console.log('Initial diff:', octSum(toOctSub(z1r, z0r)).toExponential(3));

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
        console.log(`Iteration ${iter}: ESCAPED (mag0=${mag0.toFixed(2)}, mag1=${mag1.toFixed(2)})`);
        break;
      }

      const rDiff = toOctSub(z1r, z0r);
      const iDiff = toOctSub(z1i, z0i);
      const rEqual = octEqual(z0r, z1r);
      const iEqual = octEqual(z0i, z1i);

      if (iter < 10 || iter % 10 === 0 || rEqual || iEqual) {
        console.log(`Iteration ${iter}: rDiff=${octSum(rDiff).toExponential(3)}, iDiff=${octSum(iDiff).toExponential(3)}, rEqual=${rEqual}, iEqual=${iEqual}`);
      }

      if ((rEqual || iEqual) && firstEqualIter < 0) {
        firstEqualIter = iter;
        console.log(`  *** PRECISION LOST at iteration ${iter} ***`);
      }
    }

    // If precision was lost, the test should fail
    if (firstEqualIter >= 0) {
      console.log(`\nPrecision lost at iteration ${firstEqualIter} - this indicates a bug in oct arithmetic`);
    }
  });

  test('verify toOctAdd preserves tiny differences when adding to large number', () => {
    // This is the critical operation: adding a tiny offset (~1e-35) to a large center (-1.8)
    const center = toOct(-1.8);
    const tinyOffset1 = toOct(-1e-35);
    const tinyOffset2 = toOct(-0.9e-35);

    const result1 = toOctAdd(center, tinyOffset1);
    const result2 = toOctAdd(center, tinyOffset2);

    console.log('=== toOctAdd with tiny offset ===');
    console.log('center:', octFormat(center));
    console.log('offset1:', octFormat(tinyOffset1));
    console.log('offset2:', octFormat(tinyOffset2));
    console.log('result1:', octFormat(result1));
    console.log('result2:', octFormat(result2));
    console.log('diff:', octFormat(toOctSub(result1, result2)));
    console.log('equal?', octEqual(result1, result2));

    // The results should be different
    expect(octEqual(result1, result2)).toBe(false);

    // The difference should be preserved
    const diff = toOctSub(result1, result2);
    const expectedDiff = -1e-35 - (-0.9e-35);  // = -0.1e-35
    console.log('Expected diff:', expectedDiff.toExponential(3));
    console.log('Actual diff sum:', octSum(diff).toExponential(3));

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

    console.log('=== toOctSquare with tiny difference ===');
    console.log('a:', octFormat(a), 'sum:', octSum(a));
    console.log('b:', octFormat(b), 'sum:', octSum(b));
    console.log('a²:', octFormat(a2), 'sum:', octSum(a2));
    console.log('b²:', octFormat(b2), 'sum:', octSum(b2));

    const sqDiff = toOctSub(b2, a2);
    // d/dx(x²) = 2x, so d(x²) ≈ 2x * dx
    // For x = -1.8, dx = 1e-35: expected diff ≈ 2 * (-1.8) * 1e-35 = -3.6e-35
    const expectedDiff = 2 * base * diff;

    console.log('Square diff:', octFormat(sqDiff), 'sum:', octSum(sqDiff).toExponential(3));
    console.log('Expected diff:', expectedDiff.toExponential(3));
    console.log('equal?', octEqual(a2, b2));

    expect(octEqual(a2, b2)).toBe(false);
  });
});

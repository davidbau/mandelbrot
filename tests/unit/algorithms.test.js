/**
 * Unit tests for various algorithmic functions
 * Tests Fibonacci period calculation, quad-double parsing/formatting, and other utilities
 */

const { createTestEnvironment } = require('../utils/extract-code');

// Extract algorithm functions from index.html
const algos = createTestEnvironment([
  'fibonacciPeriod',
  'toSimpleFraction',
  'centersWereLost'
]);

// Extract quad-double functions with all their dependencies
const qdFuncs = createTestEnvironment([
  // Low-level helpers
  'fast2Sum',
  'slow2Sum',
  // Core qd functions
  'toDD',
  'ddAdd',
  'ddNegate',
  'ddSub',
  // Spline interpolation (QD = quad-double precision)
  'catmullRom1DQD',
  'catmullRomSplineQD',
  'toQD',
  'toQDAdd',
  'toQDSub',
  'toQDScale',
  'ArqdAdd',
  'ArqdMul',
  'ArqdSet',
  'ArqdRenorm',
  'ArqdThreeSum',
  'ArqdTwoProduct',
  'AquickTwoSum',
  'AsymmetricTwoSum',
  'AtwoProduct'
]);

describe('Fibonacci Period Algorithm', () => {
  test('fibonacciPeriod should return 1 at Fibonacci checkpoints', () => {
    // Returns 1 at Fibonacci numbers: 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144
    expect(algos.fibonacciPeriod(1)).toBe(1);  // Fib(1) = 1
    expect(algos.fibonacciPeriod(2)).toBe(1);  // Fib(2) = 2
    expect(algos.fibonacciPeriod(3)).toBe(1);  // Fib(3) = 3
    expect(algos.fibonacciPeriod(5)).toBe(1);  // Fib(4) = 5
    expect(algos.fibonacciPeriod(8)).toBe(1);  // Fib(5) = 8
    expect(algos.fibonacciPeriod(13)).toBe(1); // Fib(6) = 13
    expect(algos.fibonacciPeriod(21)).toBe(1); // Fib(7) = 21
    expect(algos.fibonacciPeriod(34)).toBe(1); // Fib(8) = 34
  });

  test('fibonacciPeriod should return distance from previous Fibonacci + 1', () => {
    // Between Fib(3)=3 and Fib(4)=5:
    expect(algos.fibonacciPeriod(4)).toBe(2);  // 4 - 3 + 1 = 2

    // Between Fib(4)=5 and Fib(5)=8:
    expect(algos.fibonacciPeriod(6)).toBe(2);  // 6 - 5 + 1 = 2
    expect(algos.fibonacciPeriod(7)).toBe(3);  // 7 - 5 + 1 = 3

    // Between Fib(5)=8 and Fib(6)=13:
    expect(algos.fibonacciPeriod(9)).toBe(2);   // 9 - 8 + 1 = 2
    expect(algos.fibonacciPeriod(10)).toBe(3);  // 10 - 8 + 1 = 3
    expect(algos.fibonacciPeriod(12)).toBe(5);  // 12 - 8 + 1 = 5
  });

  test('fibonacciPeriod should handle large iteration counts', () => {
    // Period should always be positive and reasonable
    const period = algos.fibonacciPeriod(1000);

    expect(period).toBeGreaterThan(0);
    expect(period).toBeLessThan(1000);
  });

  test('fibonacciPeriod should reset at each Fibonacci number', () => {
    // Check that we reset to 1 at each Fibonacci checkpoint
    const fibs = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
    for (const fib of fibs) {
      expect(algos.fibonacciPeriod(fib)).toBe(1);
    }
  });
});

describe('Continued Fractions - toSimpleFraction', () => {
  test('should convert simple decimals to fractions', () => {
    expect(algos.toSimpleFraction(0.5)).toEqual([1, 2]);
    expect(algos.toSimpleFraction(0.25)).toEqual([1, 4]);
    expect(algos.toSimpleFraction(0.75)).toEqual([3, 4]);
    expect(algos.toSimpleFraction(0.333333)).toEqual([1, 3]);
    expect(algos.toSimpleFraction(0.666666)).toEqual([2, 3]);
  });

  test('should find best rational approximation within maxDenominator', () => {
    // Pi ≈ 3.14159265359
    // Best approximations: 22/7, 333/106, 355/113
    const [num, den] = algos.toSimpleFraction(Math.PI, 10);
    expect(den).toBeLessThanOrEqual(10);
    expect(Math.abs(Math.PI - num/den)).toBeLessThan(0.02);

    const [num2, den2] = algos.toSimpleFraction(Math.PI, 200);
    expect(den2).toBeLessThanOrEqual(200);
    expect(Math.abs(Math.PI - num2/den2)).toBeLessThan(0.001);
  });

  test('should handle exact fractions', () => {
    expect(algos.toSimpleFraction(0.5)).toEqual([1, 2]);
    expect(algos.toSimpleFraction(1.0)).toEqual([1, 1]);
    expect(algos.toSimpleFraction(2.0)).toEqual([2, 1]);
  });

  test('should respect maxDenominator constraint', () => {
    const [_, den] = algos.toSimpleFraction(Math.E, 50);
    expect(den).toBeLessThanOrEqual(50);
  });

  test('should handle golden ratio', () => {
    // φ = (1 + √5) / 2 ≈ 1.618033988
    // Convergents: 1/1, 2/1, 3/2, 5/3, 8/5, 13/8, 21/13...
    const phi = (1 + Math.sqrt(5)) / 2;
    const [num, den] = algos.toSimpleFraction(phi, 20);

    // Should be a good approximation
    expect(Math.abs(phi - num/den)).toBeLessThan(0.01);
    expect(den).toBeLessThanOrEqual(20);
  });

  test('should handle small decimals', () => {
    const [num, den] = algos.toSimpleFraction(0.01, 100);
    expect(num).toBe(1);
    expect(den).toBe(100);
  });
});

describe('Catmull-Rom Spline Interpolation (QD)', () => {
  test('catmullRom1DQD should interpolate at t=0 to p1', () => {
    const p0 = qdFuncs.toQD(0);
    const p1 = qdFuncs.toQD(1);
    const p2 = qdFuncs.toQD(2);
    const p3 = qdFuncs.toQD(3);

    const result = qdFuncs.catmullRom1DQD(p0, p1, p2, p3, 0);
    expect(result[0]).toBeCloseTo(1, 10);
  });

  test('catmullRom1DQD should interpolate at t=1 to p2', () => {
    const p0 = qdFuncs.toQD(0);
    const p1 = qdFuncs.toQD(1);
    const p2 = qdFuncs.toQD(2);
    const p3 = qdFuncs.toQD(3);

    const result = qdFuncs.catmullRom1DQD(p0, p1, p2, p3, 1);
    expect(result[0]).toBeCloseTo(2, 10);
  });

  test('catmullRom1DQD should interpolate smoothly at t=0.5', () => {
    const p0 = qdFuncs.toQD(0);
    const p1 = qdFuncs.toQD(1);
    const p2 = qdFuncs.toQD(2);
    const p3 = qdFuncs.toQD(3);

    const result = qdFuncs.catmullRom1DQD(p0, p1, p2, p3, 0.5);
    // For uniformly spaced points, midpoint should be close to average of p1 and p2
    expect(result[0]).toBeCloseTo(1.5, 1);
  });

  test('catmullRomSplineQD should interpolate 2D points at endpoints', () => {
    const p0 = [qdFuncs.toQD(0), qdFuncs.toQD(0)];
    const p1 = [qdFuncs.toQD(1), qdFuncs.toQD(1)];
    const p2 = [qdFuncs.toQD(2), qdFuncs.toQD(2)];
    const p3 = [qdFuncs.toQD(3), qdFuncs.toQD(3)];

    const result = qdFuncs.catmullRomSplineQD(p0, p1, p2, p3, 0);
    expect(result[0][0]).toBeCloseTo(1, 10);  // x at t=0
    expect(result[1][0]).toBeCloseTo(1, 10);  // y at t=0

    const resultEnd = qdFuncs.catmullRomSplineQD(p0, p1, p2, p3, 1);
    expect(resultEnd[0][0]).toBeCloseTo(2, 10);  // x at t=1
    expect(resultEnd[1][0]).toBeCloseTo(2, 10);  // y at t=1
  });

  test('catmullRomSplineQD should handle non-linear paths', () => {
    // Points forming a corner
    const p0 = [qdFuncs.toQD(0), qdFuncs.toQD(0)];
    const p1 = [qdFuncs.toQD(1), qdFuncs.toQD(0)];
    const p2 = [qdFuncs.toQD(1), qdFuncs.toQD(1)];
    const p3 = [qdFuncs.toQD(0), qdFuncs.toQD(1)];

    // At t=0.5, should be somewhere between p1 and p2
    const result = qdFuncs.catmullRomSplineQD(p0, p1, p2, p3, 0.5);
    expect(result[0][0]).toBeCloseTo(1, 0);  // x should be near 1
    expect(result[1][0]).toBeGreaterThan(0);
    expect(result[1][0]).toBeLessThan(1);
  });
});

describe('URL History - centersWereLost', () => {
  test('should return false for identical centers', () => {
    expect(algos.centersWereLost('-0.5+0i', '-0.5+0i')).toBe(false);
    expect(algos.centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i,-0.6+0.2i')).toBe(false);
  });

  test('should return false when adding centers (zooming deeper)', () => {
    expect(algos.centersWereLost('-0.5+0i', '-0.5+0i,-0.6+0.2i')).toBe(false);
    expect(algos.centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i,-0.6+0.2i,-0.7+0.3i')).toBe(false);
  });

  test('should return true when removing centers', () => {
    expect(algos.centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i')).toBe(true);
    expect(algos.centersWereLost('-0.5+0i,-0.6+0.2i,-0.7+0.3i', '-0.5+0i,-0.6+0.2i')).toBe(true);
  });

  test('should return true when replacing a center', () => {
    expect(algos.centersWereLost('-0.5+0i', '-0.7+0.1i')).toBe(true);
    expect(algos.centersWereLost('-0.5+0i,-0.6+0.2i', '-0.5+0i,-0.7+0.3i')).toBe(true);
  });

  test('should return false for empty to something', () => {
    expect(algos.centersWereLost('', '-0.5+0i')).toBe(false);
    expect(algos.centersWereLost(null, '-0.5+0i')).toBe(false);
  });

  test('should return true for something to empty', () => {
    expect(algos.centersWereLost('-0.5+0i', '')).toBe(true);
  });

  test('should handle complex coordinate formats', () => {
    // Scientific notation
    expect(algos.centersWereLost('1.23e-5+4.56e-7i', '1.23e-5+4.56e-7i')).toBe(false);
    // Negative imaginary
    expect(algos.centersWereLost('-0.5-0.3i', '-0.5-0.3i')).toBe(false);
  });
});
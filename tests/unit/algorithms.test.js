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
  'qdSplit',
  'twoProduct',
  'twoSquare',
  // Core qd functions
  'toQd',
  'qdAdd',
  'qdMul',
  'qdDouble',
  'qdScale',
  'qdSquare',
  'qdNegate',
  'qdSub',
  'qdDiv',
  'qdReciprocal',
  'qdParse',
  'qdPow10',
  'qdFloor',
  'qdCompare',
  'qdLt',
  'qdEq',
  'qdAbs',
  // Constant needed by qdFormat
  'qdTen',
  'qdFormat',
  // Spline interpolation
  'catmullRom1D',
  'catmullRomSpline',
  // Complex quad-double operations
  'toQdc',
  'qdcAdd',
  'qdcSub',
  'qdcMul',
  'qdcDouble',
  'qdcSquare',
  'qdcAbs',
  'qdcPow'
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

describe('Quad-Double Parsing', () => {
  test('qdParse should parse simple integers', () => {
    const result = qdFuncs.qdParse('42');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(42.0);
    expect(result[1]).toBe(0.0);
  });

  test('qdParse should parse decimal numbers', () => {
    const result = qdFuncs.qdParse('3.14159');
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(3.14159, 5);
  });

  test('qdParse should parse scientific notation', () => {
    const result = qdFuncs.qdParse('1.23e-15');
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(1.23e-15, 20);
  });

  test('qdParse should handle negative numbers', () => {
    const result = qdFuncs.qdParse('-2.5');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(-2.5);
  });

  test('qdParse should handle very large numbers', () => {
    const result = qdFuncs.qdParse('1.23e100');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(1.23e100);
  });
});

describe('Quad-Double Formatting', () => {
  test('qdFormat should format simple numbers', () => {
    const formatted = qdFuncs.qdFormat([3.14159, 0.0]);
    expect(formatted).toContain('3.14');
  });

  test('qdFormat should handle scientific notation', () => {
    const formatted = qdFuncs.qdFormat([1.23e-15, 0.0]);
    expect(formatted).toContain('e');
    expect(formatted).toContain('-15');
  });

  test('qdFormat should handle zero', () => {
    const formatted = qdFuncs.qdFormat([0.0, 0.0]);
    expect(formatted).toBe('0');
  });

  test('qdFormat should handle negative numbers', () => {
    const formatted = qdFuncs.qdFormat([-2.5, 0.0]);
    expect(formatted).toContain('-');
    expect(formatted).toContain('2.5');
  });
});

describe('Quad-Double Round-trip', () => {
  test('qdParse and qdFormat should round-trip', () => {
    const original = '3.141592653589793';
    const parsed = qdFuncs.qdParse(original);
    const formatted = qdFuncs.qdFormat(parsed, 15, true);

    // Should be able to parse the formatted value back
    const reparsed = qdFuncs.qdParse(formatted);
    expect(reparsed[0]).toBeCloseTo(parsed[0], 14);
  });

  test('qdParse should handle qdFormat output with scientific notation', () => {
    const original = '1.23456789012345e-100';
    const parsed = qdFuncs.qdParse(original);
    const formatted = qdFuncs.qdFormat(parsed);
    const reparsed = qdFuncs.qdParse(formatted);

    expect(reparsed[0]).toBeCloseTo(parsed[0], 10);
  });
});

describe('Catmull-Rom Spline Interpolation', () => {
  test('catmullRom1D should interpolate at t=0 to p1', () => {
    const p0 = qdFuncs.toQd(0);
    const p1 = qdFuncs.toQd(1);
    const p2 = qdFuncs.toQd(2);
    const p3 = qdFuncs.toQd(3);

    const result = qdFuncs.catmullRom1D(p0, p1, p2, p3, 0);
    expect(result[0]).toBeCloseTo(1, 10);
  });

  test('catmullRom1D should interpolate at t=1 to p2', () => {
    const p0 = qdFuncs.toQd(0);
    const p1 = qdFuncs.toQd(1);
    const p2 = qdFuncs.toQd(2);
    const p3 = qdFuncs.toQd(3);

    const result = qdFuncs.catmullRom1D(p0, p1, p2, p3, 1);
    expect(result[0]).toBeCloseTo(2, 10);
  });

  test('catmullRom1D should interpolate smoothly at t=0.5', () => {
    const p0 = qdFuncs.toQd(0);
    const p1 = qdFuncs.toQd(1);
    const p2 = qdFuncs.toQd(2);
    const p3 = qdFuncs.toQd(3);

    const result = qdFuncs.catmullRom1D(p0, p1, p2, p3, 0.5);
    // For uniformly spaced points, midpoint should be close to average of p1 and p2
    expect(result[0]).toBeCloseTo(1.5, 1);
  });

  test('catmullRomSpline should interpolate 2D points at endpoints', () => {
    const p0 = [qdFuncs.toQd(0), qdFuncs.toQd(0)];
    const p1 = [qdFuncs.toQd(1), qdFuncs.toQd(1)];
    const p2 = [qdFuncs.toQd(2), qdFuncs.toQd(2)];
    const p3 = [qdFuncs.toQd(3), qdFuncs.toQd(3)];

    const result = qdFuncs.catmullRomSpline(p0, p1, p2, p3, 0);
    expect(result[0][0]).toBeCloseTo(1, 10);  // x at t=0
    expect(result[1][0]).toBeCloseTo(1, 10);  // y at t=0

    const resultEnd = qdFuncs.catmullRomSpline(p0, p1, p2, p3, 1);
    expect(resultEnd[0][0]).toBeCloseTo(2, 10);  // x at t=1
    expect(resultEnd[1][0]).toBeCloseTo(2, 10);  // y at t=1
  });

  test('catmullRomSpline should handle non-linear paths', () => {
    // Points forming a corner
    const p0 = [qdFuncs.toQd(0), qdFuncs.toQd(0)];
    const p1 = [qdFuncs.toQd(1), qdFuncs.toQd(0)];
    const p2 = [qdFuncs.toQd(1), qdFuncs.toQd(1)];
    const p3 = [qdFuncs.toQd(0), qdFuncs.toQd(1)];

    // At t=0.5, should be somewhere between p1 and p2
    const result = qdFuncs.catmullRomSpline(p0, p1, p2, p3, 0.5);
    expect(result[0][0]).toBeCloseTo(1, 0);  // x should be near 1
    expect(result[1][0]).toBeGreaterThan(0);
    expect(result[1][0]).toBeLessThan(1);
  });
});

describe('Complex Quad-Double Arithmetic', () => {
  // Helper to create complex quad-double from real and imaginary parts
  function makeComplex(re, im) {
    return qdFuncs.toQdc([re, im]);
  }

  describe('qdcAdd - Complex Addition', () => {
    test('should add two complex numbers', () => {
      // (1 + 2i) + (3 + 4i) = (4 + 6i)
      const a = makeComplex(1, 2);
      const b = makeComplex(3, 4);
      const result = qdFuncs.qdcAdd(a, b);

      expect(result[0]).toBeCloseTo(4, 10);  // real part
      expect(result[2]).toBeCloseTo(6, 10);  // imaginary part
    });

    test('should handle negative numbers', () => {
      // (1 + 2i) + (-3 - 4i) = (-2 - 2i)
      const a = makeComplex(1, 2);
      const b = makeComplex(-3, -4);
      const result = qdFuncs.qdcAdd(a, b);

      expect(result[0]).toBeCloseTo(-2, 10);
      expect(result[2]).toBeCloseTo(-2, 10);
    });
  });

  describe('qdcSub - Complex Subtraction', () => {
    test('should subtract two complex numbers', () => {
      // (5 + 7i) - (2 + 3i) = (3 + 4i)
      const a = makeComplex(5, 7);
      const b = makeComplex(2, 3);
      const result = qdFuncs.qdcSub(a, b);

      expect(result[0]).toBeCloseTo(3, 10);
      expect(result[2]).toBeCloseTo(4, 10);
    });
  });

  describe('qdcMul - Complex Multiplication', () => {
    test('should multiply two complex numbers', () => {
      // (1 + 2i) * (3 + 4i) = (1*3 - 2*4) + (1*4 + 2*3)i = -5 + 10i
      const a = makeComplex(1, 2);
      const b = makeComplex(3, 4);
      const result = qdFuncs.qdcMul(a, b);

      expect(result[0]).toBeCloseTo(-5, 10);
      expect(result[2]).toBeCloseTo(10, 10);
    });

    test('should handle pure real multiplication', () => {
      // (3 + 0i) * (4 + 0i) = 12 + 0i
      const a = makeComplex(3, 0);
      const b = makeComplex(4, 0);
      const result = qdFuncs.qdcMul(a, b);

      expect(result[0]).toBeCloseTo(12, 10);
      expect(result[2]).toBeCloseTo(0, 10);
    });

    test('should handle pure imaginary multiplication', () => {
      // (0 + 2i) * (0 + 3i) = -6 + 0i
      const a = makeComplex(0, 2);
      const b = makeComplex(0, 3);
      const result = qdFuncs.qdcMul(a, b);

      expect(result[0]).toBeCloseTo(-6, 10);
      expect(result[2]).toBeCloseTo(0, 10);
    });
  });

  describe('qdcSquare - Complex Squaring', () => {
    test('should square a complex number', () => {
      // (3 + 4i)^2 = 9 - 16 + 24i = -7 + 24i
      const a = makeComplex(3, 4);
      const result = qdFuncs.qdcSquare(a);

      expect(result[0]).toBeCloseTo(-7, 10);
      expect(result[2]).toBeCloseTo(24, 10);
    });

    test('should square pure imaginary', () => {
      // (0 + 2i)^2 = -4 + 0i
      const a = makeComplex(0, 2);
      const result = qdFuncs.qdcSquare(a);

      expect(result[0]).toBeCloseTo(-4, 10);
      expect(result[2]).toBeCloseTo(0, 10);
    });

    test('should be consistent with qdcMul', () => {
      const a = makeComplex(2.5, -1.7);
      const squared = qdFuncs.qdcSquare(a);
      const multiplied = qdFuncs.qdcMul(a, a);

      expect(squared[0]).toBeCloseTo(multiplied[0], 10);
      expect(squared[2]).toBeCloseTo(multiplied[2], 10);
    });
  });

  describe('qdcDouble - Complex Doubling', () => {
    test('should double a complex number', () => {
      // 2 * (3 + 4i) = 6 + 8i
      const a = makeComplex(3, 4);
      const result = qdFuncs.qdcDouble(a);

      expect(result[0]).toBeCloseTo(6, 10);
      expect(result[2]).toBeCloseTo(8, 10);
    });
  });

  describe('qdcAbs - Complex Absolute Value Squared', () => {
    test('should compute |z|^2', () => {
      // |3 + 4i|^2 = 9 + 16 = 25
      const a = makeComplex(3, 4);
      const result = qdFuncs.qdcAbs(a);

      expect(result[0]).toBeCloseTo(25, 10);
    });

    test('should handle unit circle points', () => {
      // |cos(45°) + i*sin(45°)|^2 = 1
      const angle = Math.PI / 4;
      const a = makeComplex(Math.cos(angle), Math.sin(angle));
      const result = qdFuncs.qdcAbs(a);

      expect(result[0]).toBeCloseTo(1, 10);
    });
  });

  describe('qdcPow - Complex Power', () => {
    test('should compute z^1 = z', () => {
      const a = makeComplex(2, 3);
      const result = qdFuncs.qdcPow(a, 1);

      expect(result[0]).toBeCloseTo(2, 10);
      expect(result[2]).toBeCloseTo(3, 10);
    });

    test('should compute z^2 same as qdcSquare', () => {
      const a = makeComplex(2, 3);
      const pow2 = qdFuncs.qdcPow(a, 2);
      const squared = qdFuncs.qdcSquare(a);

      expect(pow2[0]).toBeCloseTo(squared[0], 10);
      expect(pow2[2]).toBeCloseTo(squared[2], 10);
    });

    test('should compute z^3 correctly', () => {
      // (1 + i)^3 = (1 + i)^2 * (1 + i) = (2i) * (1 + i) = -2 + 2i
      const a = makeComplex(1, 1);
      const result = qdFuncs.qdcPow(a, 3);

      expect(result[0]).toBeCloseTo(-2, 10);
      expect(result[2]).toBeCloseTo(2, 10);
    });

    test('should compute higher powers', () => {
      // i^4 = 1
      const i = makeComplex(0, 1);
      const result = qdFuncs.qdcPow(i, 4);

      expect(result[0]).toBeCloseTo(1, 10);
      expect(result[2]).toBeCloseTo(0, 10);
    });
  });

  describe('Mandelbrot iteration test', () => {
    test('should correctly iterate z^2 + c for known point in set', () => {
      // c = 0 is in the Mandelbrot set (z stays at 0)
      const c = makeComplex(0, 0);
      let z = makeComplex(0, 0);

      for (let i = 0; i < 10; i++) {
        z = qdFuncs.qdcAdd(qdFuncs.qdcSquare(z), c);
      }

      expect(z[0]).toBeCloseTo(0, 10);
      expect(z[2]).toBeCloseTo(0, 10);
    });

    test('should correctly iterate z^2 + c for point escaping set', () => {
      // c = 2 escapes quickly: z1 = 4, z2 = 18, ...
      const c = makeComplex(2, 0);
      let z = makeComplex(0, 0);

      z = qdFuncs.qdcAdd(qdFuncs.qdcSquare(z), c);  // z1 = 0 + 2 = 2
      expect(z[0]).toBeCloseTo(2, 10);

      z = qdFuncs.qdcAdd(qdFuncs.qdcSquare(z), c);  // z2 = 4 + 2 = 6
      expect(z[0]).toBeCloseTo(6, 10);

      z = qdFuncs.qdcAdd(qdFuncs.qdcSquare(z), c);  // z3 = 36 + 2 = 38
      expect(z[0]).toBeCloseTo(38, 10);
    });

    test('should correctly iterate for period-2 point', () => {
      // c = -1: z oscillates between 0 and -1
      const c = makeComplex(-1, 0);
      let z = makeComplex(0, 0);

      z = qdFuncs.qdcAdd(qdFuncs.qdcSquare(z), c);  // z1 = 0 + (-1) = -1
      expect(z[0]).toBeCloseTo(-1, 10);

      z = qdFuncs.qdcAdd(qdFuncs.qdcSquare(z), c);  // z2 = 1 + (-1) = 0
      expect(z[0]).toBeCloseTo(0, 10);

      z = qdFuncs.qdcAdd(qdFuncs.qdcSquare(z), c);  // z3 = 0 + (-1) = -1
      expect(z[0]).toBeCloseTo(-1, 10);
    });
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

describe('Quad-Double Utility Functions', () => {
  describe('qdDiv - Division', () => {
    test('should divide two quad-doubles', () => {
      const a = qdFuncs.toQd(10);
      const b = qdFuncs.toQd(2);
      const result = qdFuncs.qdDiv(a, b);

      expect(result[0]).toBeCloseTo(5, 10);
    });

    test('should handle non-integer division', () => {
      const a = qdFuncs.toQd(1);
      const b = qdFuncs.toQd(3);
      const result = qdFuncs.qdDiv(a, b);

      expect(result[0]).toBeCloseTo(1/3, 14);
    });
  });

  describe('qdReciprocal - Reciprocal', () => {
    test('should compute reciprocal', () => {
      const a = qdFuncs.toQd(4);
      const result = qdFuncs.qdReciprocal(a);

      expect(result[0]).toBeCloseTo(0.25, 14);
    });

    test('should return NaN for zero', () => {
      const zero = qdFuncs.toQd(0);
      const result = qdFuncs.qdReciprocal(zero);

      expect(isNaN(result[0])).toBe(true);
    });
  });

  describe('qdCompare - Comparison', () => {
    test('should return -1 when a < b', () => {
      const a = qdFuncs.toQd(1);
      const b = qdFuncs.toQd(2);
      expect(qdFuncs.qdCompare(a, b)).toBe(-1);
    });

    test('should return 1 when a > b', () => {
      const a = qdFuncs.toQd(5);
      const b = qdFuncs.toQd(3);
      expect(qdFuncs.qdCompare(a, b)).toBe(1);
    });

    test('should return 0 when a == b', () => {
      const a = qdFuncs.toQd(7);
      const b = qdFuncs.toQd(7);
      expect(qdFuncs.qdCompare(a, b)).toBe(0);
    });
  });

  describe('qdLt - Less Than', () => {
    test('should return true when less than scalar', () => {
      const a = qdFuncs.toQd(3);
      expect(qdFuncs.qdLt(a, 5)).toBe(true);
    });

    test('should return false when greater than scalar', () => {
      const a = qdFuncs.toQd(7);
      expect(qdFuncs.qdLt(a, 5)).toBe(false);
    });

    test('should handle equal values', () => {
      const a = qdFuncs.toQd(5);
      expect(qdFuncs.qdLt(a, 5)).toBe(false);
    });
  });

  describe('qdFloor - Floor Function', () => {
    test('should floor positive numbers', () => {
      const a = qdFuncs.toQd(3.7);
      const result = qdFuncs.qdFloor(a);
      expect(result[0]).toBe(3);
    });

    test('should floor negative numbers', () => {
      const a = qdFuncs.toQd(-2.3);
      const result = qdFuncs.qdFloor(a);
      expect(result[0]).toBe(-3);
    });

    test('should handle integers', () => {
      const a = qdFuncs.toQd(5);
      const result = qdFuncs.qdFloor(a);
      expect(result[0]).toBe(5);
    });
  });

  describe('qdPow10 - Power of 10', () => {
    test('should compute positive powers of 10', () => {
      expect(qdFuncs.qdPow10(0)[0]).toBe(1);
      expect(qdFuncs.qdPow10(1)[0]).toBe(10);
      expect(qdFuncs.qdPow10(2)[0]).toBe(100);
      expect(qdFuncs.qdPow10(3)[0]).toBe(1000);
    });

    test('should compute negative powers of 10', () => {
      expect(qdFuncs.qdPow10(-1)[0]).toBeCloseTo(0.1, 14);
      expect(qdFuncs.qdPow10(-2)[0]).toBeCloseTo(0.01, 14);
    });

    test('should handle large exponents', () => {
      const result = qdFuncs.qdPow10(20);
      expect(result[0]).toBeCloseTo(1e20, 5);
    });
  });

  describe('qdAbs - Absolute Value', () => {
    test('should return positive for positive input', () => {
      const a = qdFuncs.toQd(5);
      const result = qdFuncs.qdAbs(a);
      expect(result[0]).toBe(5);
    });

    test('should return positive for negative input', () => {
      const a = qdFuncs.toQd(-5);
      const result = qdFuncs.qdAbs(a);
      expect(result[0]).toBe(5);
    });

    test('should handle zero', () => {
      const a = qdFuncs.toQd(0);
      const result = qdFuncs.qdAbs(a);
      expect(result[0]).toBe(0);
    });
  });
});

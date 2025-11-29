/**
 * Unit tests for various algorithmic functions
 * Tests Fibonacci period calculation, quad-double parsing/formatting, and other utilities
 */

const { createTestEnvironment } = require('../utils/extract-code');

// Extract algorithm functions from index.html
const algos = createTestEnvironment([
  'fibonacciPeriod',
  'toSimpleFraction'
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
  'qdFormat'
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

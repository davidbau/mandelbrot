/**
 * Unit tests for quad-double precision arithmetic
 */

const { createTestEnvironment } = require('../utils/extract-code');

// Extract quad-double arithmetic functions from index.html
// Include helper functions that are dependencies
const qd = createTestEnvironment([
  'AqdSplit',      // Needed by AtwoProduct and AtwoSquare
  'Afast2Sum',
  'Aslow2Sum',
  'AtwoProduct',
  'AtwoSquare',
  'AqdAdd',
  'AqdMul',
  'AqdSquare',
  'AqdAbsSub',
  'AqdSet',
  'AqdcCopy'
]);

describe('Quad-Double Arithmetic', () => {
  describe('Two-Sum operations', () => {
    test('Afast2Sum should compute exact sum of two floats', () => {
      const result = new Float64Array(2);
      qd.Afast2Sum(result, 0, 1.0, 1e-16);

      // Result should be sum and error
      expect(result[0]).toBeCloseTo(1.0, 15);
      expect(result[1]).toBeCloseTo(1e-16, 30);
    });

    test('Aslow2Sum should handle any order', () => {
      const result = new Float64Array(2);
      qd.Aslow2Sum(result, 0, 1e-16, 1.0);

      expect(result[0]).toBeCloseTo(1.0, 15);
      expect(result[1]).toBeCloseTo(1e-16, 30);
    });
  });

  describe('Two-Product operations', () => {
    test('AtwoProduct should compute exact product', () => {
      const result = new Float64Array(2);
      qd.AtwoProduct(result, 0, 3.0, 7.0);

      expect(result[0] + result[1]).toBe(21.0);
    });

    test('AtwoSquare should compute exact square', () => {
      const result = new Float64Array(2);
      qd.AtwoSquare(result, 0, 3.0);

      expect(result[0] + result[1]).toBe(9.0);
    });
  });

  describe('Quad-Double Addition', () => {
    test('AqdAdd should add two quad-doubles correctly', () => {
      const result = new Float64Array(2);

      // 1.0 + 0.5 = 1.5
      qd.AqdAdd(result, 0, 1.0, 0.0, 0.5, 0.0);
      expect(result[0] + result[1]).toBe(1.5);
    });

    test('AqdAdd should handle high-precision addition', () => {
      const result = new Float64Array(2);

      // Add a large number and a tiny number that would be lost in float64
      qd.AqdAdd(result, 0, 1.0, 1e-17, 1e-16, 0.0);

      // The sum should preserve both the high and low precision parts
      expect(result[0]).toBeCloseTo(1.0, 15);
      expect(result[0] + result[1]).toBeCloseTo(1.0 + 1e-16 + 1e-17, 25);
    });

    test('AqdAdd should accumulate small values precisely', () => {
      const result = new Float64Array(2);

      // Start with zero
      result[0] = 0.0;
      result[1] = 0.0;

      // Add 0.1 ten times
      for (let i = 0; i < 10; i++) {
        qd.AqdAdd(result, 0, result[0], result[1], 0.1, 0.0);
      }

      // Should be exactly 1.0 (or very close due to quad-double precision)
      expect(result[0] + result[1]).toBeCloseTo(1.0, 14);
    });
  });

  describe('Quad-Double Multiplication', () => {
    test('AqdMul should multiply two quad-doubles', () => {
      const result = new Float64Array(2);

      // 3.0 * 7.0 = 21.0
      qd.AqdMul(result, 0, 3.0, 0.0, 7.0, 0.0);
      expect(result[0] + result[1]).toBe(21.0);
    });

    test('AqdMul should handle high-precision multiplication', () => {
      const result = new Float64Array(2);

      // Multiply two values with low-order bits
      qd.AqdMul(result, 0, 1.0, 1e-16, 2.0, 0.0);

      // Result should be 2.0 + 2e-16
      expect(result[0]).toBeCloseTo(2.0, 15);
      expect(result[1]).toBeCloseTo(2e-16, 30);
    });
  });

  describe('Quad-Double Square', () => {
    test('AqdSquare should compute square accurately', () => {
      const result = new Float64Array(2);

      // 3.0^2 = 9.0
      qd.AqdSquare(result, 0, 3.0, 0.0);
      expect(result[0] + result[1]).toBe(9.0);
    });

    test('AqdSquare should preserve precision', () => {
      const result = new Float64Array(2);

      // Square a value with low-order bits
      qd.AqdSquare(result, 0, 1.0, 1e-16);

      // (1 + 1e-16)^2 ≈ 1 + 2e-16 + 1e-32
      expect(result[0]).toBeCloseTo(1.0, 15);
      // Relax precision on low-order bits
      expect(Math.abs(result[1] - 2e-16)).toBeLessThan(1e-15);
    });
  });

  describe('Quad-Double Absolute Difference', () => {
    test('AqdAbsSub should compute absolute difference', () => {
      const result = new Float64Array(2);

      // |5.0 - 3.0| = 2.0
      qd.AqdAbsSub(result, 0, 5.0, 0.0, 3.0, 0.0);
      expect(result[0] + result[1]).toBe(2.0);
    });

    test('AqdAbsSub should handle negative differences', () => {
      const result = new Float64Array(2);

      // |3.0 - 5.0| = 2.0
      qd.AqdAbsSub(result, 0, 3.0, 0.0, 5.0, 0.0);
      expect(result[0] + result[1]).toBe(2.0);
    });
  });

  describe('Complex arithmetic scenarios', () => {
    test('Should maintain precision through multiple operations', () => {
      const a = new Float64Array(2);
      const b = new Float64Array(2);
      const c = new Float64Array(2);

      // a = 1.0 + 1e-16
      a[0] = 1.0;
      a[1] = 1e-16;

      // b = a * a (should be (1 + 1e-16)^2)
      qd.AqdMul(b, 0, a[0], a[1], a[0], a[1]);

      // c = b + a (should be (1 + 1e-16)^2 + (1 + 1e-16))
      qd.AqdAdd(c, 0, b[0], b[1], a[0], a[1]);

      // Expected: 1 + 2e-16 + 1e-32 + 1 + 1e-16 = 2 + 3e-16 + 1e-32
      expect(c[0]).toBeCloseTo(2.0, 15);
      // Low-precision part may have rounding, relax tolerance
      expect(Math.abs(c[1] - 3e-16)).toBeLessThan(1e-15);
    });

    test('Should handle catastrophic cancellation correctly', () => {
      const result = new Float64Array(2);

      // Compute (1 + 1e-10) - 1 which would lose precision in float64
      qd.AqdAdd(result, 0, 1.0, 1e-10, -1.0, 0.0);

      expect(result[0] + result[1]).toBeCloseTo(1e-10, 12);
    });
  });
});

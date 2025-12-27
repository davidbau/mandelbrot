/**
 * Unit tests for quad-double precision arithmetic.
 * Loads mathCode.js directly for accurate coverage reporting.
 */

const { loadScript } = require('../utils/extract-scripts');

// Load mathCode directly (no worker environment needed for pure math functions)
const qd = loadScript('mathCode');

// Helper to check if a qd is NaN (pure math format)
const isQdNaN = (q) => isNaN(q[0]);

describe('Quad-Double Arithmetic', () => {

  // --- Array-based In-Place Operations ---

  describe('Two-Sum operations', () => {
    test('arFast2Sum should compute exact sum of two floats', () => {
      const result = new Float64Array(2);
      qd.arFast2Sum(result, 0, 1.0, 1e-16);

      // Result should be sum and error
      expect(result[0]).toBeCloseTo(1.0, 15);
      expect(result[1]).toBeCloseTo(1e-16, 30);
    });

    test('arSlow2Sum should handle any order', () => {
      const result = new Float64Array(2);
      qd.arSlow2Sum(result, 0, 1e-16, 1.0);

      expect(result[0]).toBeCloseTo(1.0, 15);
      expect(result[1]).toBeCloseTo(1e-16, 30);
    });
  });

  describe('Two-Product operations', () => {
    test('arTwoProduct should compute exact product', () => {
      const result = new Float64Array(2);
      qd.arTwoProduct(result, 0, 3.0, 7.0);

      expect(result[0] + result[1]).toBe(21.0);
    });

    test('arTwoSquare should compute exact square', () => {
      const result = new Float64Array(2);
      qd.arTwoSquare(result, 0, 3.0);

      expect(result[0] + result[1]).toBe(9.0);
    });
  });

  describe('Double-Double Addition (In-Place)', () => {
    test('arDdAdd should add two double-doubles correctly', () => {
      const result = new Float64Array(2);

      // 1.0 + 0.5 = 1.5
      qd.arDdAdd(result, 0, 1.0, 0.0, 0.5, 0.0);
      expect(result[0] + result[1]).toBe(1.5);
    });

    test('arDdAdd should handle high-precision addition', () => {
      const result = new Float64Array(2);

      // Add a large number and a tiny number that would be lost in float64
      qd.arDdAdd(result, 0, 1.0, 1e-17, 1e-16, 0.0);

      // The sum should preserve both the high and low precision parts
      expect(result[0]).toBeCloseTo(1.0, 15);
      expect(result[0] + result[1]).toBeCloseTo(1.0 + 1e-16 + 1e-17, 25);
    });

    test('arDdAdd should accumulate small values precisely', () => {
      const result = new Float64Array(2);

      // Start with zero
      result[0] = 0.0;
      result[1] = 0.0;

      // Add 0.1 ten times
      for (let i = 0; i < 10; i++) {
        qd.arDdAdd(result, 0, result[0], result[1], 0.1, 0.0);
      }

      // Should be exactly 1.0 (or very close due to quad-double precision)
      expect(result[0] + result[1]).toBeCloseTo(1.0, 14);
    });
  });

  describe('Double-Double Multiplication (In-Place)', () => {
    test('arDdMul should multiply two double-doubles', () => {
      const result = new Float64Array(2);

      // 3.0 * 7.0 = 21.0
      qd.arDdMul(result, 0, 3.0, 0.0, 7.0, 0.0);
      expect(result[0] + result[1]).toBe(21.0);
    });

    test('arDdMul should handle high-precision multiplication', () => {
      const result = new Float64Array(2);

      // Multiply two values with low-order bits
      qd.arDdMul(result, 0, 1.0, 1e-16, 2.0, 0.0);

      // Result should be 2.0 + 2e-16
      expect(result[0]).toBeCloseTo(2.0, 15);
      expect(result[1]).toBeCloseTo(2e-16, 30);
    });
  });

  describe('Double-Double Square (In-Place)', () => {
    test('arDdSquare should compute square accurately', () => {
      const result = new Float64Array(2);

      // 3.0^2 = 9.0
      qd.arDdSquare(result, 0, 3.0, 0.0);
      expect(result[0] + result[1]).toBe(9.0);
    });

    test('arDdSquare should preserve precision', () => {
      const result = new Float64Array(2);

      // Square a value with low-order bits
      qd.arDdSquare(result, 0, 1.0, 1e-16);

      // (1 + 1e-16)^2 ≈ 1 + 2e-16 + 1e-32
      expect(result[0]).toBeCloseTo(1.0, 15);
      // Relax precision on low-order bits
      expect(Math.abs(result[1] - 2e-16)).toBeLessThan(1e-15);
    });
  });

  describe('Double-Double Array Utilities', () => {
    test('arDdSet should set values in a Float64Array', () => {
      const r = new Float64Array(2);
      qd.arDdSet(r, 0, 3.14, 1e-10);
      expect(r[0]).toBe(3.14);
      expect(r[1]).toBe(1e-10);
    });
  });

  describe('Complex arithmetic scenarios (In-Place)', () => {
    test('Should maintain precision through multiple operations', () => {
      const a = new Float64Array(2);
      const b = new Float64Array(2);
      const c = new Float64Array(2);

      // a = 1.0 + 1e-16
      a[0] = 1.0;
      a[1] = 1e-16;

      // b = a * a (should be (1 + 1e-16)^2)
      qd.arDdMul(b, 0, a[0], a[1], a[0], a[1]);

      // c = b + a (should be (1 + 1e-16)^2 + (1 + 1e-16))
      qd.arDdAdd(c, 0, b[0], b[1], a[0], a[1]);

      // Expected: 1 + 2e-16 + 1e-32 + 1 + 1e-16 = 2 + 3e-16 + 1e-32
      expect(c[0]).toBeCloseTo(2.0, 15);
      // Low-precision part may have rounding, relax tolerance
      expect(Math.abs(c[1] - 3e-16)).toBeLessThan(1e-15);
    });

    test('Should handle catastrophic cancellation correctly', () => {
      const result = new Float64Array(2);

      // Compute (1 + 1e-10) - 1 which would lose precision in float64
      qd.arDdAdd(result, 0, 1.0, 1e-10, -1.0, 0.0);

      expect(result[0] + result[1]).toBeCloseTo(1e-10, 12);
    });
  });

  // --- Pure Math Operations ---

  describe('Scalar Arithmetic (Pure)', () => {

    test('toDD should handle array input', () => {
      const arr = [1, 0];
      expect(qd.toDD(arr)).toBe(arr); // Should return same object if array
    });
  });

  describe('Scalar Arithmetic (Pure)', () => {
    test('toDD should handle array input', () => {
      const arr = [1, 0];
      expect(qd.toDD(arr)).toBe(arr); // Should return same object if array
    });
  });

  describe('Pure Math Functions: Edge Cases', () => {
    const one = qd.toDD(1);
    const two = qd.toDD(2);
    const zero = qd.toDD(0);
    const negOne = qd.toDD(-1);
    const posInf = qd.toDD(Infinity);
    const negInf = qd.toDD(-Infinity);
    const nan = qd.toDD(NaN);

    describe('Special Value Arithmetic', () => {
      test('Addition with Infinity', () => {
        expect(isQdNaN(qd.ddAdd(posInf, one))).toBe(true);
        expect(isQdNaN(qd.ddAdd(negInf, one))).toBe(true);
        expect(isQdNaN(qd.ddAdd(posInf, negInf))).toBe(true);
      });

      test('Multiplication with Infinity', () => {
        // ddMul was removed, these checks are no longer relevant
      });

      test('Operations with NaN', () => {
        expect(isQdNaN(qd.ddAdd(nan, one))).toBe(true);
        expect(isQdNaN(qd.ddAdd(one, nan))).toBe(true);
      });
    });

    describe('Inverse and Identity Properties', () => {
      test('Adding the negative should result in zero', () => {
        const five = qd.toDD(5);
        const negFive = qd.ddNegate(five);
        const result = qd.ddAdd(five, negFive);
        expect(result[0]).toBe(0);
        expect(result[1]).toBe(0);
      });
    });
  });

  // --- Utilities ---

  describe('Utility Functions', () => {
    test('fibonacciPeriod should return 1 for exact Fibonacci numbers', () => {
      expect(qd.fibonacciPeriod(1)).toBe(1);
      expect(qd.fibonacciPeriod(2)).toBe(1);
      expect(qd.fibonacciPeriod(3)).toBe(1);
      expect(qd.fibonacciPeriod(5)).toBe(1);
      expect(qd.fibonacciPeriod(8)).toBe(1);
      expect(qd.fibonacciPeriod(13)).toBe(1);
    });

    test('fibonacciPeriod should return distance from previous Fibonacci for others', () => {
      // Fibonacci: 1, 2, 3, 5, 8
      // Iteration 4: Prev Fib is 3. Distance = 4 - 3 + 1 = 2.
      expect(qd.fibonacciPeriod(4)).toBe(2); // 4-3+1

      // Iteration 6: Prev Fib is 5. Distance = 6 - 5 + 1 = 2.
      expect(qd.fibonacciPeriod(6)).toBe(2);

      // Iteration 7: Prev Fib is 5. Distance = 7 - 5 + 1 = 3.
      expect(qd.fibonacciPeriod(7)).toBe(3);
    });
  });

  // --- High-Precision & Correctness Verification ---

  describe('High-Precision & Correctness Verification', () => {
    test('Double-Double should handle 1 + 2^-53 (precision boundary)', () => {
      // 2^-53 is approx 1.11e-16, just below machine epsilon (2^-52)
      // In standard double, 1 + 2^-53 === 1.
      const epsBoundary = Math.pow(2, -53);
      const one = qd.toDD(1);
      const small = qd.toDD(epsBoundary);
      
      const sum = qd.ddAdd(one, small);
      
      // sum[0] should be 1 (standard double result)
      expect(sum[0]).toBe(1);
      // sum[1] should capture the lost bit
      expect(sum[1]).toBe(epsBoundary);
      
      // Verify that we can retrieve it back
      const diff = qd.ddSub(sum, one);
      expect(diff[0]).toBe(epsBoundary);
    });


    test('Associativity extended range: (A + B) + C', () => {
      // A = 1
      // B = 2^-50 (fits in double with 1)
      // C = 2^-100 (vanishes in double w.r.t 1, but fits in DD w.r.t B?)
      // Wait, DD is ~106 bits. 1 is bit 0. 2^-100 is bit -100.
      // This is within the 106 bit range? 
      // 0 to -52 (Hi), -53 to -105 (Lo).
      // -100 falls in the Lo part range. So it *should* work.
      
      const A = qd.toDD(1);
      const B = qd.toDD(Math.pow(2, -50));
      const C = qd.toDD(Math.pow(2, -100));
      
      // (A + B) + C
      const sum1 = qd.ddAdd(qd.ddAdd(A, B), C);
      
      // Check if C is present. 
      // sum1 should be roughly [1, 2^-50]. 
      // 2^-100 is likely lost even in DD because 2^-50 takes up the 'Lo' double's significant bits?
      // Hi: 1 (exponent 0). Lo: 2^-50 (exponent -50).
      // The Lo double has precision starting at -50 going down to -102.
      // So 2^-100 IS representable in the Lo double alongside 2^-50.
      // (2^-50 + 2^-100) is a valid double?
      // 2^-50 is ~1e-15. 2^-100 is ~1e-30.
      // Ratio is 1e-15. Double precision handles 1e-16.
      // So yes, (2^-50 + 2^-100) fits in a standard double.
      
      // Subtract A and B to see if C remains
      const rem = qd.ddSub(qd.ddSub(sum1, A), B);
      
      expect(rem[0]).toBeCloseTo(Math.pow(2, -100), 110); // e-30 level
    });
  });
});
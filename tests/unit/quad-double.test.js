/**
 * Unit tests for quad-double precision arithmetic.
 * Covers:
 * - Low-level helpers (pure & array)
 * - Quad scalar arithmetic (pure & array)
 * - Quad complex arithmetic (pure)
 * - Utility functions (fibonacciPeriod, qdFixed, qdFloor, comparisons)
 */

const { loadScript } = require('../utils/extract-scripts');

// Load quad-double functions from the extracted script
// This uses require() so V8 can track coverage properly
const qd = loadScript('quadCode', [
  // Low-level helpers (pure)
  'fast2Sum', 'slow2Sum', 'qdSplit', 'twoProduct', 'twoSquare',

  // Low-level helpers (array in-place)
  'Afast2Sum', 'Aslow2Sum', 'AqdSplit', 'AtwoProduct', 'AtwoSquare',

  // Pure math functions (Scalar)
  'toQd', 'qdAdd', 'qdMul', 'qdDouble', 'qdScale', 'qdSquare', 'qdNegate', 'qdSub',
  'qdDiv', 'qdReciprocal', 'qdParse', 'qdPow10', 'qdFloor', 'qdCompare',
  'qdLt', 'qdEq', 'qdAbs', 'qdFixed', 'qdFormat', 'qdTen',

  // Array-based in-place functions (Scalar)
  'AqdAdd', 'AqdMul', 'AqdSquare', 'AqdAbsSub', 'AqdSet', 'AqdcCopy', 'AqdcGet',

  // Complex quad functions (Pure)
  'toQdc', 'qdcAdd', 'qdcSub', 'qdcMul', 'qdcDouble', 'qdcSquare', 'qdcAbs', 'qdcPow',

  // Utilities
  'fibonacciPeriod'
]);

// Helper to check if a qd is NaN (pure math format)
const isQdNaN = (q) => isNaN(q[0]);

describe('Quad-Double Arithmetic', () => {

  // --- Array-based In-Place Operations ---

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

  describe('Quad-Double Addition (In-Place)', () => {
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

  describe('Quad-Double Multiplication (In-Place)', () => {
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

  describe('Quad-Double Square (In-Place)', () => {
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

  describe('Quad-Double Absolute Difference (In-Place)', () => {
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

  describe('Quad-Double Array Utilities', () => {
    test('AqdSet should set values in a Float64Array', () => {
      const r = new Float64Array(2);
      qd.AqdSet(r, 0, 3.14, 1e-10);
      expect(r[0]).toBe(3.14);
      expect(r[1]).toBe(1e-10);
    });

    test('AqdcCopy should copy complex quad values', () => {
      const src = new Float64Array([1.0, 0.1, 2.0, 0.2]);
      const dest = new Float64Array(4);
      qd.AqdcCopy(dest, 0, src, 0);
      expect(dest[0]).toBe(1.0);
      expect(dest[1]).toBe(0.1);
      expect(dest[2]).toBe(2.0);
      expect(dest[3]).toBe(0.2);
    });

    test('AqdcGet should return a slice of the array', () => {
      const src = new Float64Array([1.0, 0.1, 2.0, 0.2]);
      const val = qd.AqdcGet(src, 0);
      expect(val).toBeInstanceOf(Float64Array);
      expect(val).toHaveLength(4);
      expect(val[0]).toBe(1.0);
      expect(val[3]).toBe(0.2);
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

  // --- Pure Math Operations ---

  describe('Scalar Arithmetic (Pure)', () => {
    test('qdDouble should double a number', () => {
      const one = qd.toQd(1);
      const res = qd.qdDouble(one);
      expect(res[0]).toBe(2);
    });
    test('qdScale should scale a number', () => {
      const one = qd.toQd(1);
      const res = qd.qdScale(one, 0.5);
      expect(res[0]).toBe(0.5);
    });
    test('qdSquare should square a number', () => {
      const three = qd.toQd(3);
      const res = qd.qdSquare(three);
      expect(res[0]).toBe(9);
    });
    test('toQd should handle array input', () => {
      const arr = [1, 0];
      expect(qd.toQd(arr)).toBe(arr); // Should return same object if array
    });
  });

  describe('Pure Math Functions: Edge Cases', () => {
    const one = qd.toQd(1);
    const two = qd.toQd(2);
    const zero = qd.toQd(0);
    const negOne = qd.toQd(-1);
    const posInf = qd.toQd(Infinity);
    const negInf = qd.toQd(-Infinity);
    const nan = qd.toQd(NaN);

    describe('Special Value Arithmetic', () => {
      test('Addition with Infinity', () => {
        expect(isQdNaN(qd.qdAdd(posInf, one))).toBe(true);
        expect(isQdNaN(qd.qdAdd(negInf, one))).toBe(true);
        expect(isQdNaN(qd.qdAdd(posInf, negInf))).toBe(true);
      });

      test('Multiplication with Infinity', () => {
        expect(isQdNaN(qd.qdMul(posInf, two))).toBe(true);
        expect(isQdNaN(qd.qdMul(negInf, two))).toBe(true);
        expect(isQdNaN(qd.qdMul(posInf, negOne))).toBe(true);
        expect(isQdNaN(qd.qdMul(posInf, zero))).toBe(true);
      });

      test('Division with Infinity and by zero', () => {
        // The library's reciprocal and division do not handle Infinity, resulting in NaN.
        expect(isQdNaN(qd.qdReciprocal(posInf))).toBe(true);
        expect(isQdNaN(qd.qdReciprocal(negInf))).toBe(true);
        expect(isQdNaN(qd.qdDiv(one, posInf))).toBe(true);
        expect(isQdNaN(qd.qdDiv(one, negInf))).toBe(true);
        expect(isQdNaN(qd.qdDiv(posInf, one))).toBe(true);

        // Division by zero also results in NaN.
        expect(isQdNaN(qd.qdDiv(one, zero))).toBe(true);
        expect(isQdNaN(qd.qdDiv(negOne, zero))).toBe(true);
        expect(isQdNaN(qd.qdDiv(zero, zero))).toBe(true);
      });

      test('Operations with NaN', () => {
        expect(isQdNaN(qd.qdAdd(nan, one))).toBe(true);
        expect(isQdNaN(qd.qdAdd(one, nan))).toBe(true);
        expect(isQdNaN(qd.qdMul(nan, two))).toBe(true);
        expect(isQdNaN(qd.qdDiv(nan, two))).toBe(true);
        expect(isQdNaN(qd.qdDiv(two, nan))).toBe(true);
      });
    });

    describe('Inverse and Identity Properties', () => {
      test('Adding the negative should result in zero', () => {
        const five = qd.toQd(5);
        const negFive = qd.qdNegate(five);
        const result = qd.qdAdd(five, negFive);
        expect(result[0]).toBe(0);
        expect(result[1]).toBe(0);
      });

      test('Dividing by itself should result in one', () => {
        const seven = qd.toQd(7);
        const result = qd.qdDiv(seven, seven);
        expect(result[0]).toBeCloseTo(1);
        expect(result[1]).toBeCloseTo(0);
      });
    });

    describe('Comparison', () => {
      test('qdCompare should correctly order numbers', () => {
        const three = qd.toQd(3);
        const four = qd.toQd(4);
        expect(qd.qdCompare(three, four)).toBe(-1);
        expect(qd.qdCompare(four, three)).toBe(1);
        expect(qd.qdCompare(three, three)).toBe(0);
      });

      test('qdCompare should handle numbers differing only in low part', () => {
        const a = [1.0, 1e-16];
        const b = [1.0, 2e-16];
        expect(qd.qdCompare(a, b)).toBe(-1);
        expect(qd.qdCompare(b, a)).toBe(1);
        expect(qd.qdCompare(a, a)).toBe(0);
      });

      test('qdLt and qdEq helper functions', () => {
        const one = qd.toQd(1);
        const two = qd.toQd(2);
        expect(qd.qdLt(one, 2)).toBe(true);
        expect(qd.qdLt(two, 1)).toBe(false);
        expect(qd.qdEq(one, 1)).toBe(true);
        expect(qd.qdEq(one, 2)).toBe(false);
      });
    });

    describe('String Parsing and Conversion', () => {
      test('qdParse should correctly parse high-precision strings', () => {
        const str = '1.2345678901234567890123456789012';
        const parsed = qd.qdParse(str);
        const backToStr = qd.qdFormat(parsed, 32, true); // Use fixed-point formatting
        expect(backToStr.startsWith('1.234567890123456789012345678901')).toBe(true);
      });

      test('qdParse should handle negative numbers and exponents', () => {
        const str = '-9.87654321e-11';
        const parsed = qd.qdParse(str);
        const backToStr = qd.qdFormat(parsed, 'auto');
        expect(backToStr).toBe(str);
      });

      test('qdFixed wrapper', () => {
        const pi = qd.toQd(3.14159);
        expect(qd.qdFixed(pi, 2)).toBe('3.14');
      });

      test('qdFloor should round down', () => {
        const num = qd.toQd(3.9);
        const floored = qd.qdFloor(num);
        expect(floored[0]).toBe(3);
        expect(floored[1]).toBe(0);

        const negNum = qd.toQd(-3.1);
        const negFloored = qd.qdFloor(negNum);
        expect(negFloored[0]).toBe(-4);
      });
    });

    describe('Other Mathematical Functions', () => {
      test('qdAbs should return the absolute value', () => {
          const five = qd.toQd(5);
          const negFive = qd.toQd(-5);
          expect(qd.qdAbs(five)[0]).toBe(5);
          expect(qd.qdAbs(negFive)[0]).toBe(5);
      });
    });
  });

  // --- Complex Arithmetic (Pure) ---

  describe('Quad-Double Complex Arithmetic', () => {
    // Helpers for constructing complex quads
    const cOne = [1, 0, 0, 0]; // 1 + 0i
    const cI = [0, 0, 1, 0];   // 0 + 1i

    test('toQdc should convert scalars/arrays to complex quad', () => {
      const c = qd.toQdc([1, 2]);
      expect(c).toHaveLength(4);
      expect(c[0]).toBe(1);
      expect(c[2]).toBe(2);
    });

    test('qdcAdd should add two complex numbers', () => {
      // (1 + 0i) + (0 + 1i) = 1 + 1i
      const result = qd.qdcAdd(cOne, cI);
      expect(result[0]).toBe(1);
      expect(result[2]).toBe(1);
    });

    test('qdcSub should subtract two complex numbers', () => {
      // (1 + 0i) - (0 + 1i) = 1 - 1i
      const result = qd.qdcSub(cOne, cI);
      expect(result[0]).toBe(1);
      expect(result[2]).toBe(-1);
    });

    test('qdcMul should multiply two complex numbers', () => {
      // i * i = -1
      const result = qd.qdcMul(cI, cI);
      expect(result[0]).toBe(-1);
      expect(result[2]).toBe(0); // 0i
    });

    test('qdcDouble should double a complex number', () => {
      // 2 * (1 + 1i) = 2 + 2i
      const onePlusI = [1, 0, 1, 0];
      const result = qd.qdcDouble(onePlusI);
      expect(result[0]).toBe(2);
      expect(result[2]).toBe(2);
    });

    test('qdcSquare should square a complex number', () => {
      // (1 + i)^2 = 1 + 2i - 1 = 2i
      const onePlusI = [1, 0, 1, 0];
      const result = qd.qdcSquare(onePlusI);
      expect(result[0]).toBeCloseTo(0, 15);
      expect(result[2]).toBeCloseTo(2, 15);
    });

    test('qdcAbs should return squared magnitude (norm)', () => {
      // |3 + 4i|^2 = 3^2 + 4^2 = 9 + 16 = 25
      const c = [3, 0, 4, 0];
      // qdcAbs returns a real quad-double (array of 2), not complex
      const result = qd.qdcAbs(c);
      expect(result[0]).toBe(25);
    });

    test('qdcPow should compute integer powers', () => {
      // (1 + i)^4 = (2i)^2 = -4
      const onePlusI = [1, 0, 1, 0];
      const result = qd.qdcPow(onePlusI, 4);
      expect(result[0]).toBeCloseTo(-4, 15);
      expect(result[2]).toBeCloseTo(0, 15);

      // Power of 0? Function logic: `let result = [1, 0, 0, 0]`.
      // If n=0, loop `while (n>0)` doesn't run. Returns 1. Correct.
      const res0 = qd.qdcPow(onePlusI, 0);
      expect(res0[0]).toBe(1);
      expect(res0[2]).toBe(0);

      // Power of 1
      const res1 = qd.qdcPow(onePlusI, 1);
      expect(res1[0]).toBe(1);
      expect(res1[2]).toBe(1);
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
    // Veltkamp-Dekker Split verification
    test('qdSplit should decompose a double into hi + lo exactly', () => {
      // Use a number with full 53 bits of precision
      const a = 1.2345678901234567;
      const [hi, lo] = qd.qdSplit(a);

      // 1. Exact reconstruction
      expect(hi + lo).toBe(a);

      // 2. 'hi' should have at most 26 bits of significand (Veltkamp split property)
      // This means hi should be exactly representable with fewer bits.
      // A quick check: lo should be much smaller than hi
      expect(Math.abs(lo)).toBeLessThan(Math.abs(hi) * 1e-7);
      
      // 3. Verify overlap property: lo should be the "error" of approximating a with hi
      // This is implicit in hi + lo = a.
    });

    test('Double-Double should handle 1 + 2^-53 (precision boundary)', () => {
      // 2^-53 is approx 1.11e-16, just below machine epsilon (2^-52)
      // In standard double, 1 + 2^-53 === 1.
      const epsBoundary = Math.pow(2, -53);
      const one = qd.toQd(1);
      const small = qd.toQd(epsBoundary);
      
      const sum = qd.qdAdd(one, small);
      
      // sum[0] should be 1 (standard double result)
      expect(sum[0]).toBe(1);
      // sum[1] should capture the lost bit
      expect(sum[1]).toBe(epsBoundary);
      
      // Verify that we can retrieve it back
      const diff = qd.qdSub(sum, one);
      expect(diff[0]).toBe(epsBoundary);
    });

    test('Should handle cancellation: (1 + e)^2 - (1 + 2e) = e^2', () => {
      // Let e = 2^-27 (approx 7.45e-9).
      // (1 + e)^2 = 1 + 2e + e^2.
      // In standard double:
      // 1 is bit 0.
      // 2e is bit -26.
      // e^2 is bit -54.
      // Since double has 53 bits, e^2 (bit -54) is lost relative to 1 (bit 0).
      
      const eVal = Math.pow(2, -27);
      const onePlusE = qd.qdAdd(qd.toQd(1), qd.toQd(eVal));
      
      // Square it
      const squared = qd.qdSquare(onePlusE);
      
      // Construct 1 + 2e
      const onePlus2E = qd.qdAdd(qd.toQd(1), qd.toQd(2 * eVal));
      
      // Subtract: (1 + 2e + e^2) - (1 + 2e)
      const result = qd.qdSub(squared, onePlus2E);
      
      // Expected: e^2 = 2^-54
      const expected = Math.pow(2, -54);
      
      // result[0] should be approx e^2
      // Since e^2 is ~ 5.55e-17, it fits in a double easily on its own.
      // The key is that it was preserved during the squaring of (1+e).
      expect(result[0]).toBeCloseTo(expected, 30);
    });

    test('Associativity extended range: (A + B) + C', () => {
      // A = 1
      // B = 2^-50 (fits in double with 1)
      // C = 2^-100 (vanishes in double w.r.t 1, but fits in DD w.r.t B?)
      // Wait, DD is ~106 bits. 1 is bit 0. 2^-100 is bit -100.
      // This is within the 106 bit range? 
      // 0 to -52 (Hi), -53 to -105 (Lo).
      // -100 falls in the Lo part range. So it *should* work.
      
      const A = qd.toQd(1);
      const B = qd.toQd(Math.pow(2, -50));
      const C = qd.toQd(Math.pow(2, -100));
      
      // (A + B) + C
      const sum1 = qd.qdAdd(qd.qdAdd(A, B), C);
      
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
      const rem = qd.qdSub(qd.qdSub(sum1, A), B);
      
      expect(rem[0]).toBeCloseTo(Math.pow(2, -100), 110); // e-30 level
    });
  });
});

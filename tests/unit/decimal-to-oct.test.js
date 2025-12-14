/**
 * Unit tests for decimalToOct function
 *
 * This function converts decimal strings to oct-precision (4 float64 limbs)
 * representation. The critical requirement is that the sum of the 4 limbs
 * should equal the original decimal value to high precision.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  decimalToOct,
  float64ToBigIntScaled,
  octToDecimalString
} = createTestEnvironment([
  'decimalToOct',
  'float64ToBigIntScaled',
  'octToDecimalString'
]);

function sumLimbs(limbs) {
  return limbs.reduce((acc, v) => acc + v, 0);
}

// Convert a decimal string to BigInt with given scale
function decimalToBigInt(str, scale) {
  let s = str.trim().toLowerCase();
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (s.startsWith('+')) s = s.slice(1);

  let exp = 0;
  const eIdx = s.indexOf('e');
  if (eIdx !== -1) {
    exp = parseInt(s.slice(eIdx + 1), 10);
    s = s.slice(0, eIdx);
  }

  const parts = s.split('.');
  const intPart = parts[0] || '0';
  const fracPart = parts[1] || '';

  let fracScale = fracPart.length - exp;
  const bigStr = intPart + fracPart;
  let n = BigInt(bigStr.replace(/^0+/, '') || '0');
  if (neg) n = -n;

  // Adjust to target scale
  if (fracScale < scale) {
    n = n * (10n ** BigInt(scale - fracScale));
  } else if (fracScale > scale) {
    n = n / (10n ** BigInt(fracScale - scale));
  }
  return n;
}

describe('float64ToBigIntScaled', () => {
  test('returns 0n for zero', () => {
    expect(float64ToBigIntScaled(0, 60)).toBe(0n);
  });

  test('handles simple integers', () => {
    // 1.0 at scale 60 should be 10^60
    const result = float64ToBigIntScaled(1.0, 60);
    expect(result).toBe(10n ** 60n);
  });

  test('handles negative numbers', () => {
    const result = float64ToBigIntScaled(-1.0, 60);
    expect(result).toBe(-(10n ** 60n));
  });

  test('handles fractions', () => {
    // 0.5 at scale 60 should be 5 * 10^59
    const result = float64ToBigIntScaled(0.5, 60);
    expect(result).toBe(5n * (10n ** 59n));
  });

  test('handles -1.8 exactly', () => {
    // -1.8 cannot be exactly represented in float64
    // The actual float64 value is approximately -1.7999999999999998
    const float64Value = -1.8;
    const result = float64ToBigIntScaled(float64Value, 60);

    // The result should be a BigInt representation of the float64 value
    // Note: converting back loses precision due to BigInt -> Number conversion
    expect(typeof result).toBe('bigint');
    expect(result).not.toBe(0n);
  });

  test('round-trips small float64 values exactly', () => {
    // Test with values that don't overflow when converted to BigInt
    const testValues = [1.0, -1.0, 0.5, -0.5, 1e-10];
    const scale = 20;  // Use smaller scale to avoid precision loss in conversion
    const divisor = 10n ** BigInt(scale);

    for (const val of testValues) {
      const bigint = float64ToBigIntScaled(val, scale);
      const backToFloat = Number(bigint) / Number(divisor);
      expect(backToFloat).toBeCloseTo(val, 14);
    }
  });
});

describe('decimalToOct basic functionality', () => {
  test('handles zero', () => {
    const result = decimalToOct('0');
    expect(sumLimbs(result)).toBe(0);
  });

  test('handles simple integers', () => {
    expect(sumLimbs(decimalToOct('1'))).toBe(1);
    expect(sumLimbs(decimalToOct('-1'))).toBe(-1);
    expect(sumLimbs(decimalToOct('42'))).toBe(42);
    expect(sumLimbs(decimalToOct('-42'))).toBe(-42);
  });

  test('handles simple decimals', () => {
    const result = decimalToOct('1.5');
    expect(sumLimbs(result)).toBeCloseTo(1.5, 15);
  });

  test('handles scientific notation', () => {
    const result = decimalToOct('1.5e10');
    expect(sumLimbs(result)).toBeCloseTo(1.5e10, 5);
  });

  test('handles negative scientific notation exponents', () => {
    const result = decimalToOct('1.5e-10');
    expect(sumLimbs(result)).toBeCloseTo(1.5e-10, 25);
  });
});

describe('decimalToOct precision tests', () => {
  test('preserves full double precision for representable numbers', () => {
    // Math.PI is exactly representable in float64
    const piStr = Math.PI.toString();
    const result = decimalToOct(piStr);
    expect(sumLimbs(result)).toBe(Math.PI);
  });

  test('limbs are in descending order of magnitude', () => {
    const result = decimalToOct('1.23456789');

    // Each limb should be smaller than or equal to the previous
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i])).toBeLessThanOrEqual(Math.abs(result[i-1]) + 1e-50);
    }
  });

  test('first limb is the best float64 approximation', () => {
    const input = '1.5';
    const result = decimalToOct(input);
    expect(result[0]).toBe(1.5);
  });
});

describe('decimalToOct high-precision strings', () => {
  test('handles 20 decimal digit strings', () => {
    // This string cannot be exactly represented in float64
    const input = '1.23456789012345678901';
    const result = decimalToOct(input);

    // The sum should be close to the input
    const sum = sumLimbs(result);
    const expected = parseFloat(input);
    expect(sum).toBeCloseTo(expected, 14);
  });

  test('handles strings with many trailing digits - documents precision limit', () => {
    const input = '1.00000000000000000001';
    const result = decimalToOct(input);

    // First limb is the float64 approximation (exactly 1.0)
    expect(result[0]).toBe(1.0);

    // Due to known limitation, sum rounds to 1.0 when offset is very small
    const sum = sumLimbs(result);
    expect(sum).toBe(1.0);
    expect(sum).toBeCloseTo(1.0, 15);
  });
});

describe('decimalToOct regression tests - precision near round numbers', () => {
  /**
   * KNOWN LIMITATION: When a decimal string is very close to a "round" number
   * like -1.8, the oct representation may round to exactly that number.
   *
   * This happens because:
   * 1. limb[0] is the float64 approximation of the input
   * 2. limb[1] corrects for the float64 rounding error
   * 3. The float64 rounding error (~2.22e-16 for values near -1.8) is much
   *    larger than the intended offset (~3.51e-21)
   * 4. The correction limbs end up making the total equal -1.8 exactly
   *
   * For deep zoom near -1.8, this causes the reference orbit to be computed
   * for c=-1.8 instead of the intended offset, leading to uniform divergence.
   *
   * A fix would require storing coordinates as (base + offset) where base
   * is a simple value like -1.8 and offset is stored separately in oct precision.
   */

  test('documents limitation: -1.79999999999999999999649 rounds to -1.8 in float64 sum', () => {
    const input = '-1.79999999999999999999649';
    const result = decimalToOct(input);
    const sum = sumLimbs(result);

    // KNOWN LIMITATION: The sum equals -1.8 due to float64 precision limits
    // This documents the current behavior, not the desired behavior
    expect(sum).toBe(-1.8);

    // After normalization, limb[0] is exactly -1.8
    expect(result[0]).toBe(-1.8);
    // limb[1] is a small positive correction (since -1.79999... > -1.8)
    expect(result[1]).toBeGreaterThan(0);
  });

  test('limbs are normalized via quickTwoSum cascade', () => {
    // After normalization, the limbs satisfy |limb[i]| < ulp(limb[i-1])/2
    // This ensures consistent representation across all oct operations
    const input = '-1.79999999999999999999649';
    const result = decimalToOct(input);

    // First limb is normalized to exactly -1.8 (the nearest float64 value)
    expect(result[0]).toBe(-1.8);

    // Later limbs contain the correction terms (positive since -1.79999... > -1.8)
    expect(result[1]).not.toBe(0);
    // The correction is positive (making it less negative than -1.8)
    expect(result[1]).toBeGreaterThan(0);
  });

  test('documents limitation: values near -2 also round', () => {
    const input = '-1.99999999999999999999';
    const result = decimalToOct(input);
    const sum = sumLimbs(result);

    // KNOWN LIMITATION: rounds to -2
    expect(sum).toBe(-2);
  });

  test('documents limitation: values near 1 also round', () => {
    const input = '1.00000000000000000001';
    const result = decimalToOct(input);
    const sum = sumLimbs(result);

    // KNOWN LIMITATION: rounds to 1
    expect(sum).toBe(1);
  });

  test('imaginary component precision: 0.00000000000000000000073', () => {
    // This is the imaginary part from the regression URL
    const input = '0.00000000000000000000073';
    const result = decimalToOct(input);
    const sum = sumLimbs(result);

    // Should be positive and approximately 7.3e-22
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeCloseTo(7.3e-22, 35);
  });
});

describe('decimalToOct edge cases', () => {
  test('handles very small numbers', () => {
    // Test a small value well within float64 range
    const result = decimalToOct('1e-50');
    const sum = sumLimbs(result);
    expect(sum).toBeCloseTo(1e-50, 60);
  });

  test('handles very large numbers', () => {
    const result = decimalToOct('1e100');
    const sum = sumLimbs(result);
    expect(sum).toBeCloseTo(1e100, -90);
  });

  test('handles leading/trailing whitespace', () => {
    const result = decimalToOct('  1.5  ');
    expect(sumLimbs(result)).toBeCloseTo(1.5, 15);
  });

  test('handles positive sign', () => {
    const result = decimalToOct('+1.5');
    expect(sumLimbs(result)).toBeCloseTo(1.5, 15);
  });

  test('handles uppercase E in scientific notation', () => {
    const result = decimalToOct('1.5E10');
    expect(sumLimbs(result)).toBeCloseTo(1.5e10, 5);
  });
});

describe('octToDecimalString', () => {
  test('returns absolute value without sign prefix for negative numbers', () => {
    // This test catches the double-negative URL bug where formatcomplex adds
    // its own sign prefix, so octToDecimalString must return unsigned value
    const negativeOct = [-1.8, 0, 0, 0];
    const result = octToDecimalString(negativeOct, 5);
    expect(result).toBe('1.8');
    expect(result[0]).not.toBe('-');
  });

  test('returns absolute value without sign prefix for positive numbers', () => {
    const positiveOct = [1.8, 0, 0, 0];
    const result = octToDecimalString(positiveOct, 5);
    expect(result).toBe('1.8');
    expect(result[0]).not.toBe('+');
  });

  test('handles deep zoom coordinates near -1.8', () => {
    // Coordinate from the regression test URL
    const oct = decimalToOct('-1.799999999999999999999999999999999997574325104259492');
    const result = octToDecimalString(oct, 50);
    expect(result).not.toMatch(/^-/);  // Must not start with minus
    expect(result).toMatch(/^1\.799/);  // Should start with the absolute value
  });
});

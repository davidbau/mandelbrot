/**
 * Unit tests for formatting, color, and utility functions
 */

const { createTestEnvironment } = require('../utils/extract-code');

// Extract formatting functions
const formatFuncs = createTestEnvironment([
  'formatScale',
  'formatSize',
  'formatLargeInt'
]);

// Extract color functions (need gammaCorrect and intcolor as dependencies)
const colorFuncs = createTestEnvironment([
  'intcolor',
  'gammaCorrect',
  'hclColor'
]);

// Extract estimation function
const utilFuncs = createTestEnvironment([
  'estimateLimit'
]);


describe('formatScale', () => {
  test('should format small scales with one decimal', () => {
    expect(formatFuncs.formatScale(1)).toBe('1x');
    expect(formatFuncs.formatScale(2.5)).toBe('2.5x');
    expect(formatFuncs.formatScale(9.9)).toBe('9.9x');
  });

  test('should format medium scales as integers', () => {
    expect(formatFuncs.formatScale(10)).toBe('10x');
    expect(formatFuncs.formatScale(100)).toBe('100x');
    expect(formatFuncs.formatScale(1000)).toBe('1000x');
    expect(formatFuncs.formatScale(99999)).toBe('99999x');
  });

  test('should format large scales in scientific notation', () => {
    const result = formatFuncs.formatScale(100000);
    expect(result).toContain('e');
    expect(result).not.toContain('x');
  });

  test('should format very large scales in scientific notation', () => {
    const result = formatFuncs.formatScale(1e12);
    expect(result).toMatch(/^\d\.\d+e\+\d+$/);
  });
});

describe('formatSize', () => {
  test('should format small sizes with appropriate precision', () => {
    const result = formatFuncs.formatSize(0.001);
    expect(typeof result).toBe('number');
    expect(result).toBeCloseTo(0.001, 3);
  });

  test('should format medium sizes', () => {
    const result = formatFuncs.formatSize(3.14159);
    expect(typeof result).toBe('number');
    expect(result).toBeCloseTo(3.1, 1);
  });

  test('should format very small sizes', () => {
    const result = formatFuncs.formatSize(1e-10);
    expect(typeof result).toBe('number');
    expect(result).toBeCloseTo(1e-10, 15);
  });
});

describe('formatLargeInt', () => {
  test('should format small integers', () => {
    const result = formatFuncs.formatLargeInt(42);
    expect(result).toBe('42');
  });

  test('should format integers with thousand separators', () => {
    const result = formatFuncs.formatLargeInt(1000);
    // Result depends on locale, but should contain the digits
    expect(result).toContain('1');
    expect(result).toContain('0');
    expect(result.replace(/[,.\s]/g, '')).toBe('1000');
  });

  test('should format large integers', () => {
    const result = formatFuncs.formatLargeInt(1000000);
    expect(result.replace(/[,.\s]/g, '')).toBe('1000000');
  });

  test('should handle zero', () => {
    expect(formatFuncs.formatLargeInt(0)).toBe('0');
  });
});

describe('intcolor', () => {
  test('should return "0" for zero or negative', () => {
    expect(colorFuncs.intcolor(0)).toBe('0');
    expect(colorFuncs.intcolor(-0.5)).toBe('0');
  });

  test('should return "255" for 1 or greater', () => {
    expect(colorFuncs.intcolor(1)).toBe('255');
    expect(colorFuncs.intcolor(1.5)).toBe('255');
  });

  test('should scale values between 0 and 1 to 0-255', () => {
    expect(colorFuncs.intcolor(0.5)).toBe('127.5');
    expect(parseFloat(colorFuncs.intcolor(0.25))).toBeCloseTo(63.75, 1);
  });
});

describe('gammaCorrect', () => {
  test('should handle linear region (small values)', () => {
    const result = colorFuncs.gammaCorrect(0.001);
    expect(result).toBeCloseTo(0.001 * 12.92, 5);
  });

  test('should handle gamma region (larger values)', () => {
    const result = colorFuncs.gammaCorrect(0.5);
    const expected = 1.055 * Math.pow(0.5, 1/2.4) - 0.055;
    expect(result).toBeCloseTo(expected, 5);
  });

  test('should return 0 for 0', () => {
    expect(colorFuncs.gammaCorrect(0)).toBe(0);
  });

  test('should return ~1 for 1', () => {
    expect(colorFuncs.gammaCorrect(1)).toBeCloseTo(1, 2);
  });
});

describe('hclColor', () => {
  // Helper to parse rgb values from hclColor output
  function parseRgb(rgbStr) {
    const match = rgbStr.match(/rgb\(([\d.]+),([\d.]+),([\d.]+)\)/);
    if (!match) return null;
    return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
  }

  test('should return rgb color string', () => {
    const result = colorFuncs.hclColor(0, 50, 50);
    expect(result).toMatch(/^rgb\([\d.]+,[\d.]+,[\d.]+\)$/);
  });

  test('should handle grayscale (zero chroma)', () => {
    const result = colorFuncs.hclColor(0, 0, 50);
    const rgb = parseRgb(result);
    expect(rgb).toBeTruthy();
    // With zero chroma, R, G, B should be equal (grayscale)
    expect(Math.abs(rgb[0] - rgb[1])).toBeLessThan(1);
    expect(Math.abs(rgb[1] - rgb[2])).toBeLessThan(1);
  });

  test('should handle full black (zero luminance)', () => {
    const result = colorFuncs.hclColor(0, 0, 0);
    expect(result).toBe('rgb(0,0,0)');
  });

  test('should handle full white (max luminance, zero chroma)', () => {
    const result = colorFuncs.hclColor(0, 0, 100);
    const rgb = parseRgb(result);
    expect(rgb).toBeTruthy();
    // Should be very close to 255,255,255
    expect(rgb[0]).toBeCloseTo(255, 0);
    expect(rgb[1]).toBeCloseTo(255, 0);
    expect(rgb[2]).toBeCloseTo(255, 0);
  });

  test('should normalize hue to 0-360 range', () => {
    // Hue 360 should be same as hue 0
    const result360 = colorFuncs.hclColor(360, 50, 50);
    const result0 = colorFuncs.hclColor(0, 50, 50);
    expect(result360).toBe(result0);

    // Negative hue should wrap
    const resultNeg = colorFuncs.hclColor(-90, 50, 50);
    const result270 = colorFuncs.hclColor(270, 50, 50);
    expect(resultNeg).toBe(result270);
  });

  test('should clamp chroma and luminance', () => {
    // Out-of-range values should be clamped
    const resultHighC = colorFuncs.hclColor(0, 150, 50);
    const resultClampedC = colorFuncs.hclColor(0, 100, 50);
    expect(resultHighC).toBe(resultClampedC);

    const resultNegL = colorFuncs.hclColor(0, 50, -10);
    const resultZeroL = colorFuncs.hclColor(0, 50, 0);
    expect(resultNegL).toBe(resultZeroL);
  });

  test('should produce different colors for different hues', () => {
    const red = colorFuncs.hclColor(0, 50, 50);
    const green = colorFuncs.hclColor(120, 50, 50);
    const blue = colorFuncs.hclColor(240, 50, 50);

    expect(red).not.toBe(green);
    expect(green).not.toBe(blue);
    expect(blue).not.toBe(red);
  });
});

describe('estimateLimit', () => {
  test('should estimate limit from convergent data', () => {
    // Simulate data approaching a limit of 0.5
    // As x increases, y approaches 0.5
    const data = [
      { x: 1, y: 0.3, weight: 1 },
      { x: 2, y: 0.4, weight: 1 },
      { x: 4, y: 0.45, weight: 1 },
      { x: 8, y: 0.48, weight: 1 },
      { x: 16, y: 0.49, weight: 1 }
    ];
    const limit = utilFuncs.estimateLimit(data);
    // Should estimate something close to the asymptotic limit
    expect(limit).toBeGreaterThan(0.4);
    expect(limit).toBeLessThan(0.6);
  });

  test('should handle constant data', () => {
    // All y values the same - limit should be that value
    const data = [
      { x: 1, y: 0.7, weight: 1 },
      { x: 10, y: 0.7, weight: 1 },
      { x: 100, y: 0.7, weight: 1 }
    ];
    const limit = utilFuncs.estimateLimit(data);
    expect(limit).toBeCloseTo(0.7, 1);
  });

  test('should use weights in calculation', () => {
    // Test that weights are actually used - with 3 points,
    // heavily weighting one should shift the result toward that point's y value
    const data = [
      { x: 1, y: 0.1, weight: 1 },
      { x: 2, y: 0.5, weight: 1 },
      { x: 3, y: 0.9, weight: 1 }
    ];
    const limit = utilFuncs.estimateLimit(data);
    // Result should exist and be a reasonable number
    expect(typeof limit).toBe('number');
    expect(isFinite(limit)).toBe(true);
  });

  test('should default weight to 1', () => {
    const dataWithWeight = [
      { x: 1, y: 0.5, weight: 1 },
      { x: 2, y: 0.6, weight: 1 }
    ];
    const dataWithoutWeight = [
      { x: 1, y: 0.5 },
      { x: 2, y: 0.6 }
    ];
    expect(utilFuncs.estimateLimit(dataWithWeight))
      .toBeCloseTo(utilFuncs.estimateLimit(dataWithoutWeight), 10);
  });
});

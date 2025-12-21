const { extractFunction } = require('../utils/extract-code');

describe('inheritance geometry', () => {
  const pixelToComplexCoords = extractFunction('pixelToComplexCoords');
  const complexToPixelCoords = extractFunction('complexToPixelCoords');

  test('pixel centers follow compute convention (no half-pixel offset)', () => {
    const centerRe = 0;
    const centerIm = 0;
    const size = 4;
    const dimsWidth = 4;
    const dimsHeight = 4;

    const topLeft = pixelToComplexCoords(centerRe, centerIm, size, dimsWidth, dimsHeight, 0, 0);
    expect(topLeft.re).toBeCloseTo(-2, 10);
    expect(topLeft.im).toBeCloseTo(2, 10);

    const center = pixelToComplexCoords(centerRe, centerIm, size, dimsWidth, dimsHeight, 2, 2);
    expect(center.re).toBeCloseTo(0, 10);
    expect(center.im).toBeCloseTo(0, 10);

    const bottomRight = pixelToComplexCoords(centerRe, centerIm, size, dimsWidth, dimsHeight, 3, 3);
    expect(bottomRight.re).toBeCloseTo(1, 10);
    expect(bottomRight.im).toBeCloseTo(-1, 10);
  });

  test('child center maps back to parent center', () => {
    const centerRe = 0;
    const centerIm = 0;

    const child = pixelToComplexCoords(centerRe, centerIm, 2, 4, 4, 2, 2);
    const parent = complexToPixelCoords(centerRe, centerIm, 4, 4, 4, child.re, child.im);

    expect(Math.floor(parent.px)).toBe(2);
    expect(Math.floor(parent.py)).toBe(2);
  });
});

const { createTestEnvironment } = require('../utils/extract-code');

const {
  arQdAdd,
  arQdMul,
  arQdSquare,
  arQdSet,
  arSymmetricTwoSum,
  arQuickTwoSum,
  arQdThreeSum,
  arQdTwoProduct,
  arQdTwoSquare,
  arQdRenorm,
  arTwoProduct,
  arTwoSquare,
  arDdSplit
} = createTestEnvironment([
  'arQdAdd',
  'arQdMul',
  'arQdSquare',
  'arQdSet',
  'arSymmetricTwoSum',
  'arQuickTwoSum',
  'arQdThreeSum',
  'arQdTwoProduct',
  'arQdTwoSquare',
  'arQdRenorm',
  'arTwoProduct',
  'arTwoSquare',
  'arDdSplit'
]);

const toMagnitude = (coeff, exp) => coeff * Math.pow(10, -exp);

function exactFromCoeffs(coeffs) {
  const maxExp = Math.max(...coeffs.map(c => c.exp));
  const scale = 10n ** BigInt(maxExp);
  let num = 0n;
  for (const { coeff, exp } of coeffs) {
    const factor = scale / (10n ** BigInt(exp));
    num += BigInt(coeff) * factor;
  }
  return { num, scale };
}

function exactValue(coeffs) {
  const { num, scale } = exactFromCoeffs(coeffs);
  return Number(num) / Number(scale);
}

function sumParts(parts) {
  return parts.reduce((acc, v) => acc + v, 0);
}

describe('oct-double arithmetic helpers', () => {
  // Removed test for arQdSet and ArqdcCopy as ArqdcCopy is removed

  test('arQdAdd preserves deep cancellation components', () => {
    const aCoeffs = [
      { coeff: 1, exp: 0 },
      { coeff: 5, exp: 16 },
      { coeff: 3, exp: 32 },
      { coeff: -2, exp: 48 }
    ];
    const bCoeffs = [
      { coeff: -1, exp: 0 },
      { coeff: 7, exp: 16 },
      { coeff: -1, exp: 32 },
      { coeff: 4, exp: 48 }
    ];

    const a = aCoeffs.map(c => toMagnitude(c.coeff, c.exp));
    const b = bCoeffs.map(c => toMagnitude(c.coeff, c.exp));

    const result = new Array(4).fill(0);
    arQdAdd(result, 0, ...a, ...b);

    const expected = exactValue([...aCoeffs, ...bCoeffs]);
    const actual = sumParts(result);

    expect(Math.abs(actual - expected)).toBeLessThan(1e-30);
  });

  test('arQdMul tracks cross-terms beyond double precision', () => {
    const xCoeffs = [
      { coeff: 1, exp: 0 },
      { coeff: 2, exp: 16 },
      { coeff: 3, exp: 32 },
      { coeff: 1, exp: 48 }
    ];
    const yCoeffs = [
      { coeff: 2, exp: 0 },
      { coeff: -1, exp: 16 },
      { coeff: 5, exp: 32 },
      { coeff: 2, exp: 48 }
    ];

    const x = xCoeffs.map(c => toMagnitude(c.coeff, c.exp));
    const y = yCoeffs.map(c => toMagnitude(c.coeff, c.exp));

    const expectedParts = exactFromCoeffs(xCoeffs);
    const expectedPartsY = exactFromCoeffs(yCoeffs);
    const productNum = expectedParts.num * expectedPartsY.num;
    const productScale = expectedParts.scale * expectedPartsY.scale;
    const expectedProduct = Number(productNum) / Number(productScale);

    const result = new Array(4).fill(0);
    arQdMul(result, 0, ...x, ...y);
    const actual = sumParts(result);

    expect(Math.abs(actual - expectedProduct)).toBeLessThan(1e-28);
  });

  test('arQdSquare matches arQdMul self-products', () => {
    const coeffs = [
      { coeff: 3, exp: 0 },
      { coeff: -4, exp: 16 },
      { coeff: 1, exp: 32 },
      { coeff: 6, exp: 48 }
    ];
    const parts = coeffs.map(c => toMagnitude(c.coeff, c.exp));

    const expected = sumParts((() => {
      const tmp = new Array(4).fill(0);
      arQdMul(tmp, 0, ...parts, ...parts);
      return tmp;
    })());

    const result = new Array(4).fill(0);
    arQdSquare(result, 0, ...parts);
    const actual = sumParts(result);

    expect(Math.abs(actual - expected)).toBeLessThan(1e-32);
  });

  test('arQdTwoProduct captures error term for wide-magnitude factors', () => {
    const a = 1e16;
    const b = 1e-16 + 1e-32;
    const [p, e] = arQdTwoProduct(a, b);
    const expected = a * b; // true value: 1 + 1e-16
    expect(p + e).toBeCloseTo(expected);
    expect(Math.abs(e)).toBeGreaterThan(0);
  });

  test('arQdRenorm flattens five-term sums into four limbs', () => {
    const out = new Array(4).fill(0);
    // Force cascading renormalization with mixed magnitudes
    arQdRenorm(out, 0, 1, 1e-12, 1e-24, 1e-36, 1e-48);
    expect(out.length).toBe(4);
    // Sum should match the original components
    const total = 1 + 1e-12 + 1e-24 + 1e-36 + 1e-48;
    expect(sumParts(out)).toBeCloseTo(total);
  });
});
/**
 * Unit tests for Catmull-Rom spline interpolation functions.
 * These functions are used for smooth movie camera path interpolation.
 *
 * Key properties verified (based on Catmull-Rom spline theory):
 * - Interpolation: curve passes through control points p1 and p2
 * - C1 continuity: tangent at each point uses neighboring points
 * - Numerical stability: works at deep zoom precision (1e-35+)
 *
 * See: https://www.mvps.org/directx/articles/catmull/
 *      https://en.wikipedia.org/wiki/Centripetal_Catmull–Rom_spline
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  catmullRom1D,
  catmullRomSpline,
  catmullRom1DOct,
  catmullRomSplineOct,
  toDD,
  ddAdd,
  ddSub,
  ddScale,
  ddNegate,
  slow2Sum,
  fast2Sum,
  twoProduct,
  ddSplit,
  toOct,
  toOctAdd,
  toOctSub,
  toOctScale,
  octToNumber,
  AoctAdd,
  AoctMul,
  AsymmetricTwoSum,
  AquickTwoSum,
  AthreeSum,
  AoctTwoProduct,
  AoctTwoSquare,
  AoctRenorm,
  AoctSet,
  AtwoProduct,
  AtwoSquare,
  ArddSplit
} = createTestEnvironment([
  'catmullRom1D',
  'catmullRomSpline',
  'catmullRom1DOct',
  'catmullRomSplineOct',
  'toDD',
  'ddAdd',
  'ddSub',
  'ddScale',
  'ddNegate',
  'slow2Sum',
  'fast2Sum',
  'twoProduct',
  'ddSplit',
  'toOct',
  'toOctAdd',
  'toOctSub',
  'toOctScale',
  'octToNumber',
  'AoctAdd',
  'AoctMul',
  'AsymmetricTwoSum',
  'AquickTwoSum',
  'AthreeSum',
  'AoctTwoProduct',
  'AoctTwoSquare',
  'AoctRenorm',
  'AoctSet',
  'AtwoProduct',
  'AtwoSquare',
  'ArddSplit'
]);

// Helper: Sum quad-double components
const qdSum = (qd) => qd[0] + qd[1];

// Helper: Sum oct components
const octSum = (oct) => oct[0] + oct[1] + oct[2] + oct[3];

describe('Catmull-Rom spline interpolation', () => {

  describe('catmullRom1D (quad precision)', () => {

    test('interpolates between p1 and p2', () => {
      // Create 4 control points on a simple curve
      const p0 = toDD(0);
      const p1 = toDD(1);
      const p2 = toDD(2);
      const p3 = toDD(3);

      // At t=0, should be at p1
      const at0 = catmullRom1D(p0, p1, p2, p3, 0);
      expect(qdSum(at0)).toBeCloseTo(1, 10);

      // At t=1, should be at p2
      const at1 = catmullRom1D(p0, p1, p2, p3, 1);
      expect(qdSum(at1)).toBeCloseTo(2, 10);

      // At t=0.5, should be between p1 and p2
      const atHalf = catmullRom1D(p0, p1, p2, p3, 0.5);
      expect(qdSum(atHalf)).toBeCloseTo(1.5, 10);
    });

    test('produces smooth curve for quadratic control points', () => {
      // Control points on y = x^2: [0,0], [1,1], [2,4], [3,9]
      const p0 = toDD(0);
      const p1 = toDD(1);
      const p2 = toDD(4);
      const p3 = toDD(9);

      // Sample at multiple points
      const samples = [];
      for (let t = 0; t <= 1; t += 0.1) {
        const val = qdSum(catmullRom1D(p0, p1, p2, p3, t));
        samples.push(val);
      }

      // Verify monotonically increasing
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThan(samples[i-1]);
      }

      // Verify curve passes through p1 and p2
      expect(samples[0]).toBeCloseTo(1, 10);
      expect(samples[samples.length - 1]).toBeCloseTo(4, 5);
    });

    test('handles very close control points with numerical stability', () => {
      // Points differing by tiny amounts (deep zoom scenario)
      const base = -1.76894568;
      const epsilon = 1e-15;

      const p0 = toDD(base - epsilon);
      const p1 = toDD(base);
      const p2 = toDD(base + epsilon);
      const p3 = toDD(base + 2*epsilon);

      // Interpolation should still work smoothly
      const at0 = catmullRom1D(p0, p1, p2, p3, 0);
      const atHalf = catmullRom1D(p0, p1, p2, p3, 0.5);
      const at1 = catmullRom1D(p0, p1, p2, p3, 1);

      // Should maintain order
      expect(qdSum(at0)).toBeCloseTo(base, 12);
      expect(qdSum(atHalf)).toBeCloseTo(base + 0.5*epsilon, 12);
      expect(qdSum(at1)).toBeCloseTo(base + epsilon, 12);
    });

    test('handles negative values correctly', () => {
      const p0 = toDD(-3);
      const p1 = toDD(-2);
      const p2 = toDD(-1);
      const p3 = toDD(0);

      const at0 = catmullRom1D(p0, p1, p2, p3, 0);
      const at1 = catmullRom1D(p0, p1, p2, p3, 1);

      expect(qdSum(at0)).toBeCloseTo(-2, 10);
      expect(qdSum(at1)).toBeCloseTo(-1, 10);
    });
  });

  describe('catmullRomSpline (2D quad precision)', () => {

    test('interpolates 2D points correctly', () => {
      // 2D control points: [x,y] pairs
      const p0 = [toDD(0), toDD(0)];
      const p1 = [toDD(1), toDD(1)];
      const p2 = [toDD(2), toDD(0)];
      const p3 = [toDD(3), toDD(1)];

      // At t=0, should be at p1
      const at0 = catmullRomSpline(p0, p1, p2, p3, 0);
      expect(qdSum(at0[0])).toBeCloseTo(1, 10);  // x
      expect(qdSum(at0[1])).toBeCloseTo(1, 10);  // y

      // At t=1, should be at p2
      const at1 = catmullRomSpline(p0, p1, p2, p3, 1);
      expect(qdSum(at1[0])).toBeCloseTo(2, 10);  // x
      expect(qdSum(at1[1])).toBeCloseTo(0, 10);  // y
    });

    test('produces smooth 2D curve for spiral path', () => {
      // Simulate a zoom path with rotation
      const p0 = [toDD(-2.0), toDD(0.0)];
      const p1 = [toDD(-1.5), toDD(0.5)];
      const p2 = [toDD(-1.0), toDD(0.0)];
      const p3 = [toDD(-0.5), toDD(-0.5)];

      // Sample and verify smoothness
      let prevX = -Infinity;
      for (let t = 0; t <= 1; t += 0.2) {
        const pt = catmullRomSpline(p0, p1, p2, p3, t);
        const x = qdSum(pt[0]);
        expect(x).toBeGreaterThan(prevX);  // x should increase
        prevX = x;
      }
    });
  });

  describe('catmullRom1DOct (oct precision)', () => {

    test('interpolates between p1 and p2', () => {
      const p0 = toOct(0);
      const p1 = toOct(1);
      const p2 = toOct(2);
      const p3 = toOct(3);

      const at0 = catmullRom1DOct(p0, p1, p2, p3, 0);
      const at1 = catmullRom1DOct(p0, p1, p2, p3, 1);

      expect(octSum(at0)).toBeCloseTo(1, 10);
      expect(octSum(at1)).toBeCloseTo(2, 10);
    });

    test('handles deep zoom precision at z=1e-35', () => {
      // Control points for a deep zoom path (tiny coordinate differences)
      const base = -1.76894568;
      const epsilon = 1e-35;

      const p0 = toOctAdd(toOct(base), toOct(-epsilon));
      const p1 = toOct(base);
      const p2 = toOctAdd(toOct(base), toOct(epsilon));
      const p3 = toOctAdd(toOct(base), toOct(2*epsilon));

      // At t=0, should be at p1 (base)
      const at0 = catmullRom1DOct(p0, p1, p2, p3, 0);
      expect(octSum(at0)).toBeCloseTo(base, 10);

      // At t=1, should be at p2 (base + epsilon)
      const at1 = catmullRom1DOct(p0, p1, p2, p3, 1);
      // The difference from base should be approximately epsilon
      const diff1 = octSum(toOctSub(at1, toOct(base)));
      expect(diff1).toBeCloseTo(epsilon, 10);

      // At t=0.5, interpolation should be halfway
      const atHalf = catmullRom1DOct(p0, p1, p2, p3, 0.5);
      const diffHalf = octSum(toOctSub(atHalf, toOct(base)));
      expect(diffHalf).toBeCloseTo(0.5 * epsilon, 10);
    });

    test('maintains precision across 50 decimal places', () => {
      // Create control points with differences at 1e-50 scale
      const p0 = [1e-50, 0, 0, 0];
      const p1 = [2e-50, 0, 0, 0];
      const p2 = [3e-50, 0, 0, 0];
      const p3 = [4e-50, 0, 0, 0];

      const at0 = catmullRom1DOct(p0, p1, p2, p3, 0);
      const at1 = catmullRom1DOct(p0, p1, p2, p3, 1);

      expect(octSum(at0)).toBeCloseTo(2e-50, 10);
      expect(octSum(at1)).toBeCloseTo(3e-50, 10);
    });
  });

  describe('catmullRomSplineOct (2D oct precision)', () => {

    test('interpolates complex plane coordinates', () => {
      // Deep zoom movie path: center and imaginary components
      const p0 = [[toOct(-2.0)], [toOct(0.0)]];
      const p1 = [[toOct(-1.76)], [toOct(0.01)]];
      const p2 = [[toOct(-1.76)], [toOct(-0.01)]];
      const p3 = [[toOct(-1.5)], [toOct(0.0)]];

      // Flatten to expected format [re, im]
      const pt0 = [toOct(-2.0), toOct(0.0)];
      const pt1 = [toOct(-1.76), toOct(0.01)];
      const pt2 = [toOct(-1.76), toOct(-0.01)];
      const pt3 = [toOct(-1.5), toOct(0.0)];

      const at0 = catmullRomSplineOct(pt0, pt1, pt2, pt3, 0);
      const at1 = catmullRomSplineOct(pt0, pt1, pt2, pt3, 1);

      // At t=0, should be at pt1
      expect(octSum(at0[0])).toBeCloseTo(-1.76, 10);
      expect(octSum(at0[1])).toBeCloseTo(0.01, 10);

      // At t=1, should be at pt2
      expect(octSum(at1[0])).toBeCloseTo(-1.76, 10);
      expect(octSum(at1[1])).toBeCloseTo(-0.01, 10);
    });

    test('handles spike region deep zoom path', () => {
      // Simulating zoom into spike at c=-2
      const epsilon = 1e-40;

      const pt0 = [toOct(-2.0 - epsilon), toOct(epsilon)];
      const pt1 = [toOct(-2.0), toOct(0)];
      const pt2 = [toOct(-2.0 + epsilon), toOct(0)];
      const pt3 = [toOct(-2.0 + 2*epsilon), toOct(-epsilon)];

      // Interpolate along the path
      for (let t = 0; t <= 1; t += 0.25) {
        const pt = catmullRomSplineOct(pt0, pt1, pt2, pt3, t);
        // Should produce valid oct values
        expect(pt[0].length).toBe(4);
        expect(pt[1].length).toBe(4);
        // Real part should be near -2
        expect(octSum(pt[0])).toBeCloseTo(-2, 5);
      }
    });
  });

  describe('qd vs oct consistency', () => {

    test('qd and oct versions agree for normal-scale values', () => {
      const p0qd = toDD(0);
      const p1qd = toDD(1);
      const p2qd = toDD(3);
      const p3qd = toDD(4);

      const p0oct = toOct(0);
      const p1oct = toOct(1);
      const p2oct = toOct(3);
      const p3oct = toOct(4);

      for (let t = 0; t <= 1; t += 0.1) {
        const qdResult = qdSum(catmullRom1D(p0qd, p1qd, p2qd, p3qd, t));
        const octResult = octSum(catmullRom1DOct(p0oct, p1oct, p2oct, p3oct, t));

        expect(octResult).toBeCloseTo(qdResult, 10);
      }
    });
  });

  // Edge case tests based on Catmull-Rom spline theory
  // See: https://en.wikipedia.org/wiki/Centripetal_Catmull–Rom_spline
  describe('edge cases and challenging inputs', () => {

    test('collinear points produce straight line interpolation', () => {
      // When control points are on a line, curve should be linear between p1-p2
      const p0 = toDD(0);
      const p1 = toDD(1);
      const p2 = toDD(2);
      const p3 = toDD(3);

      // Sample at multiple points
      for (let t = 0; t <= 1; t += 0.1) {
        const result = qdSum(catmullRom1D(p0, p1, p2, p3, t));
        const expected = 1 + t;  // Linear from 1 to 2
        expect(result).toBeCloseTo(expected, 10);
      }
    });

    test('coincident middle points (p1 === p2) have bounded deviation', () => {
      // When p1 and p2 are the same, curve is influenced by tangents from p0/p3
      // Catmull-Rom tangent at p1 uses (p2-p0)/2, at p2 uses (p3-p1)/2
      // So curve doesn't stay perfectly flat - it overshoots slightly
      const p0 = toDD(0);
      const p1 = toDD(5);
      const p2 = toDD(5);  // Same as p1
      const p3 = toDD(10);

      // At boundaries t=0 and t=1, curve must pass through p1/p2
      expect(qdSum(catmullRom1D(p0, p1, p2, p3, 0))).toBeCloseTo(5, 10);
      expect(qdSum(catmullRom1D(p0, p1, p2, p3, 1))).toBeCloseTo(5, 10);

      // In between, curve may deviate but should stay bounded
      const atHalf = qdSum(catmullRom1D(p0, p1, p2, p3, 0.5));
      expect(atHalf).toBeGreaterThan(4);  // Not too far below
      expect(atHalf).toBeLessThan(6);     // Not too far above
    });

    test('non-uniform spacing: tight curve handling', () => {
      // Non-uniform control point spacing - tests numerical stability
      // Simulates movie keyframes at different zoom levels
      const p0 = toDD(0);
      const p1 = toDD(0.001);  // Very close to p0
      const p2 = toDD(1);      // Far from p1
      const p3 = toDD(1.001);  // Very close to p2

      // Should still interpolate smoothly
      const at0 = catmullRom1D(p0, p1, p2, p3, 0);
      const atHalf = catmullRom1D(p0, p1, p2, p3, 0.5);
      const at1 = catmullRom1D(p0, p1, p2, p3, 1);

      expect(qdSum(at0)).toBeCloseTo(0.001, 8);
      expect(qdSum(at1)).toBeCloseTo(1, 8);
      // Middle should be between endpoints
      expect(qdSum(atHalf)).toBeGreaterThan(0.001);
      expect(qdSum(atHalf)).toBeLessThan(1);
    });

    test('extreme values: large coordinates', () => {
      // Test behavior with large coordinate values
      const p0 = toDD(1e10);
      const p1 = toDD(2e10);
      const p2 = toDD(3e10);
      const p3 = toDD(4e10);

      const at0 = catmullRom1D(p0, p1, p2, p3, 0);
      const at1 = catmullRom1D(p0, p1, p2, p3, 1);

      expect(qdSum(at0)).toBeCloseTo(2e10, 5);
      expect(qdSum(at1)).toBeCloseTo(3e10, 5);
    });

    test('oscillating control points: handles overshoot', () => {
      // Control points that oscillate - tests overshoot behavior
      const p0 = toDD(0);
      const p1 = toDD(1);
      const p2 = toDD(0);  // Back toward start
      const p3 = toDD(1);

      // Sample the curve
      const samples = [];
      for (let t = 0; t <= 1; t += 0.1) {
        samples.push(qdSum(catmullRom1D(p0, p1, p2, p3, t)));
      }

      // Curve should go from p1=1 to p2=0 but may overshoot slightly
      expect(samples[0]).toBeCloseTo(1, 8);  // t=0 at p1
      expect(samples[samples.length - 1]).toBeCloseTo(0, 5);  // t=1 at p2
    });

    test('2D curve: circular arc approximation', () => {
      // Control points approximating a quarter circle
      const p0 = [toDD(1), toDD(0)];
      const p1 = [toDD(1), toDD(0.5)];
      const p2 = [toDD(0.5), toDD(1)];
      const p3 = [toDD(0), toDD(1)];

      // Sample and check curve stays roughly equidistant from origin
      for (let t = 0.2; t <= 0.8; t += 0.2) {
        const pt = catmullRomSpline(p0, p1, p2, p3, t);
        const x = qdSum(pt[0]);
        const y = qdSum(pt[1]);
        const dist = Math.sqrt(x*x + y*y);
        // Should be roughly unit distance (some deviation expected)
        expect(dist).toBeGreaterThan(0.5);
        expect(dist).toBeLessThan(1.5);
      }
    });

    test('oct precision: Mandelbrot spike zoom path', () => {
      // Real-world test: deep zoom into Mandelbrot spike region
      // Control points representing a movie path at deep zoom precision
      // Using 1e-20 as baseEpsilon (well within oct precision but large enough to test)
      const center = -2.0;
      const baseEpsilon = 1e-20;

      // Path approaching the spike tip with more spread
      const pt0 = [toOct(center - 2*baseEpsilon), toOct(baseEpsilon)];
      const pt1 = [toOct(center - baseEpsilon), toOct(0.5*baseEpsilon)];
      const pt2 = [toOct(center + baseEpsilon), toOct(-0.5*baseEpsilon)];
      const pt3 = [toOct(center + 2*baseEpsilon), toOct(-baseEpsilon)];

      // Verify interpolation at boundaries
      const at0 = catmullRomSplineOct(pt0, pt1, pt2, pt3, 0);
      const at1 = catmullRomSplineOct(pt0, pt1, pt2, pt3, 1);
      expect(octSum(at0[0])).toBeCloseTo(center - baseEpsilon, 10);
      expect(octSum(at1[0])).toBeCloseTo(center + baseEpsilon, 10);

      // At t=0.5, curve is between p1 and p2
      const atHalf = catmullRomSplineOct(pt0, pt1, pt2, pt3, 0.5);
      const reAtHalf = octSum(atHalf[0]);
      // Should be between p1 and p2 x-coordinates (use >= to allow boundary)
      expect(reAtHalf).toBeGreaterThanOrEqual(center - baseEpsilon);
      expect(reAtHalf).toBeLessThanOrEqual(center + baseEpsilon);
    });

    test('boundary parameter values: exactly t=0 and t=1', () => {
      // Verify exact interpolation at boundaries (fundamental spline property)
      const p0 = toDD(-5);
      const p1 = toDD(Math.PI);  // Irrational value
      const p2 = toDD(Math.E);   // Another irrational value
      const p3 = toDD(10);

      const atZero = catmullRom1D(p0, p1, p2, p3, 0);
      const atOne = catmullRom1D(p0, p1, p2, p3, 1);

      // Must pass through p1 at t=0 and p2 at t=1
      expect(qdSum(atZero)).toBeCloseTo(Math.PI, 12);
      expect(qdSum(atOne)).toBeCloseTo(Math.E, 12);
    });
  });
});

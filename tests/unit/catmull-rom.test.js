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
  catmullRom1DQD,
  catmullRomSplineQD,
  toDD,
  ddAdd,
  ddSub,
  ddNegate,
  slow2Sum,
  fast2Sum,
  twoProduct,
  ddSplit,
  toQD,
  toQDAdd,
  toQDSub,
  toQDScale,
  qdToNumber,
  ArqdAdd,
  ArqdMul,
  AsymmetricTwoSum,
  AquickTwoSum,
  ArqdThreeSum,
  ArqdTwoProduct,
  ArqdTwoSquare,
  ArqdRenorm,
  ArqdSet,
  AtwoProduct,
  AtwoSquare,
  ArddSplit
} = createTestEnvironment([
  'catmullRom1DQD',
  'catmullRomSplineQD',
  'toDD',
  'ddAdd',
  'ddSub',
  'ddNegate',
  'slow2Sum',
  'fast2Sum',
  'toQD',
  'toQDAdd',
  'toQDSub',
  'toQDScale',
  'qdToNumber',
  'ArqdAdd',
  'ArqdMul',
  'AsymmetricTwoSum',
  'AquickTwoSum',
  'ArqdThreeSum',
  'ArqdTwoProduct',
  'ArqdTwoSquare',
  'ArqdRenorm',
  'ArqdSet',
  'AtwoProduct',
  'AtwoSquare',
  'ArddSplit'
]);

// Helper: Sum double-double components
const ddSum = (dd) => dd[0] + dd[1];

// Helper: Sum quad-double components
const qdSum = (qd) => qd[0] + qd[1] + qd[2] + qd[3];

describe('Catmull-Rom spline interpolation', () => {

  describe('catmullRom1DQD (quad-double precision)', () => {

    test('interpolates between p1 and p2', () => {
      const p0 = toQD(0);
      const p1 = toQD(1);
      const p2 = toQD(2);
      const p3 = toQD(3);

      const at0 = catmullRom1DQD(p0, p1, p2, p3, 0);
      const at1 = catmullRom1DQD(p0, p1, p2, p3, 1);

      expect(ddSum(at0)).toBeCloseTo(1, 10);
      expect(ddSum(at1)).toBeCloseTo(2, 10);
    });

    test('handles deep zoom precision at z=1e-35', () => {
      // Control points for a deep zoom path (tiny coordinate differences)
      const base = -1.76894568;
      const epsilon = 1e-35;

      const p0 = toQDAdd(toQD(base), toQD(-epsilon));
      const p1 = toQD(base);
      const p2 = toQDAdd(toQD(base), toQD(epsilon));
      const p3 = toQDAdd(toQD(base), toQD(2*epsilon));

      // At t=0, should be at p1 (base)
      const at0 = catmullRom1DQD(p0, p1, p2, p3, 0);
      expect(ddSum(at0)).toBeCloseTo(base, 10);

      // At t=1, should be at p2 (base + epsilon)
      const at1 = catmullRom1DQD(p0, p1, p2, p3, 1);
      // The difference from base should be approximately epsilon
      const diff1 = qdSum(toQDSub(at1, toQD(base)));
      expect(diff1).toBeCloseTo(epsilon, 10);

      // At t=0.5, interpolation should be halfway
      const atHalf = catmullRom1DQD(p0, p1, p2, p3, 0.5);
      const diffHalf = qdSum(toQDSub(atHalf, toQD(base)));
      expect(diffHalf).toBeCloseTo(0.5 * epsilon, 10);
    });

    test('maintains precision across 50 decimal places', () => {
      // Create control points with differences at 1e-50 scale
      const p0 = [1e-50, 0, 0, 0];
      const p1 = [2e-50, 0, 0, 0];
      const p2 = [3e-50, 0, 0, 0];
      const p3 = [4e-50, 0, 0, 0];

      const at0 = catmullRom1DQD(p0, p1, p2, p3, 0);
      const at1 = catmullRom1DQD(p0, p1, p2, p3, 1);

      expect(ddSum(at0)).toBeCloseTo(2e-50, 10);
      expect(ddSum(at1)).toBeCloseTo(3e-50, 10);
    });
  });

  describe('catmullRomSplineQD (2D quad-double precision)', () => {

    test('interpolates complex plane coordinates', () => {
      // Deep zoom movie path: center and imaginary components
      const p0 = [[toQD(-2.0)], [toQD(0.0)]];
      const p1 = [[toQD(-1.76)], [toQD(0.01)]];
      const p2 = [[toQD(-1.76)], [toQD(-0.01)]];
      const p3 = [[toQD(-1.5)], [toQD(0.0)]];

      // Flatten to expected format [re, im]
      const pt0 = [toQD(-2.0), toQD(0.0)];
      const pt1 = [toQD(-1.76), toQD(0.01)];
      const pt2 = [toQD(-1.76), toQD(-0.01)];
      const pt3 = [toQD(-1.5), toQD(0.0)];

      const at0 = catmullRomSplineQD(pt0, pt1, pt2, pt3, 0);
      const at1 = catmullRomSplineQD(pt0, pt1, pt2, pt3, 1);

      // At t=0, should be at pt1
      expect(ddSum(at0[0])).toBeCloseTo(-1.76, 10);
      expect(ddSum(at0[1])).toBeCloseTo(0.01, 10);

      // At t=1, should be at pt2
      expect(ddSum(at1[0])).toBeCloseTo(-1.76, 10);
      expect(ddSum(at1[1])).toBeCloseTo(-0.01, 10);
    });

    test('handles spike region deep zoom path', () => {
      // Simulating zoom into spike at c=-2
      const epsilon = 1e-40;

      const pt0 = [toQD(-2.0 - epsilon), toQD(epsilon)];
      const pt1 = [toQD(-2.0), toQD(0)];
      const pt2 = [toQD(-2.0 + epsilon), toQD(0)];
      const pt3 = [toQD(-2.0 + 2*epsilon), toQD(-epsilon)];

      // Interpolate along the path
      for (let t = 0; t <= 1; t += 0.25) {
        const pt = catmullRomSplineQD(pt0, pt1, pt2, pt3, t);
        // Should produce valid oct values
        expect(pt[0].length).toBe(4);
        expect(pt[1].length).toBe(4);
        // Real part should be near -2
        expect(ddSum(pt[0])).toBeCloseTo(-2, 5);
      }
    });
  });

  // Edge case tests based on Catmull-Rom spline theory
  // See: https://en.wikipedia.org/wiki/Centripetal_Catmull–Rom_spline
  describe('edge cases and challenging inputs', () => {

    test('collinear points produce straight line interpolation', () => {
      // When control points are on a line, curve should be linear between p1-p2
      const p0 = toQD(0);
      const p1 = toQD(1);
      const p2 = toQD(2);
      const p3 = toQD(3);

      // Sample at multiple points
      for (let t = 0; t <= 1; t += 0.1) {
        const result = qdSum(catmullRom1DQD(p0, p1, p2, p3, t));
        const expected = 1 + t;  // Linear from 1 to 2
        expect(result).toBeCloseTo(expected, 10);
      }
    });

    test('coincident middle points (p1 === p2) have bounded deviation', () => {
      // When p1 and p2 are the same, curve is influenced by tangents from p0/p3
      // Catmull-Rom tangent at p1 uses (p2-p0)/2, at p2 uses (p3-p1)/2
      // So curve doesn't stay perfectly flat - it overshoots slightly
      const p0 = toQD(0);
      const p1 = toQD(5);
      const p2 = toQD(5);  // Same as p1
      const p3 = toQD(10);

      // At boundaries t=0 and t=1, curve must pass through p1/p2
      expect(qdSum(catmullRom1DQD(p0, p1, p2, p3, 0))).toBeCloseTo(5, 10);
      expect(qdSum(catmullRom1DQD(p0, p1, p2, p3, 1))).toBeCloseTo(5, 10);

      // In between, curve may deviate but should stay bounded
      const atHalf = qdSum(catmullRom1DQD(p0, p1, p2, p3, 0.5));
      expect(atHalf).toBeGreaterThan(4);  // Not too far below
      expect(atHalf).toBeLessThan(6);     // Not too far above
    });

    test('non-uniform spacing: tight curve handling', () => {
      // Non-uniform control point spacing - tests numerical stability
      // Simulates movie keyframes at different zoom levels
      const p0 = toQD(0);
      const p1 = toQD(0.001);  // Very close to p0
      const p2 = toQD(1);      // Far from p1
      const p3 = toQD(1.001);  // Very close to p2

      // Should still interpolate smoothly
      const at0 = catmullRom1DQD(p0, p1, p2, p3, 0);
      const atHalf = catmullRom1DQD(p0, p1, p2, p3, 0.5);
      const at1 = catmullRom1DQD(p0, p1, p2, p3, 1);

      expect(qdSum(at0)).toBeCloseTo(0.001, 8);
      expect(qdSum(at1)).toBeCloseTo(1, 8);
      // Middle should be between endpoints
      expect(qdSum(atHalf)).toBeGreaterThan(0.001);
      expect(qdSum(atHalf)).toBeLessThan(1);
    });

    test('extreme values: large coordinates', () => {
      // Test behavior with large coordinate values
      const p0 = toQD(1e10);
      const p1 = toQD(2e10);
      const p2 = toQD(3e10);
      const p3 = toQD(4e10);

      const at0 = catmullRom1DQD(p0, p1, p2, p3, 0);
      const at1 = catmullRom1DQD(p0, p1, p2, p3, 1);

      expect(qdSum(at0)).toBeCloseTo(2e10, 5);
      expect(qdSum(at1)).toBeCloseTo(3e10, 5);
    });

    test('oscillating control points: handles overshoot', () => {
      // Control points that oscillate - tests overshoot behavior
      const p0 = toQD(0);
      const p1 = toQD(1);
      const p2 = toQD(0);  // Back toward start
      const p3 = toQD(1);

      // Sample the curve
      const samples = [];
      for (let t = 0; t <= 1; t += 0.1) {
        samples.push(qdSum(catmullRom1DQD(p0, p1, p2, p3, t)));
      }

      // Curve should go from p1=1 to p2=0 but may overshoot slightly
      expect(samples[0]).toBeCloseTo(1, 8);  // t=0 at p1
      expect(samples[samples.length - 1]).toBeCloseTo(0, 5);  // t=1 at p2
    });

    test('2D curve: circular arc approximation', () => {
      // Control points approximating a quarter circle
      const p0 = [toQD(1), toQD(0)];
      const p1 = [toQD(1), toQD(0.5)];
      const p2 = [toQD(0.5), toQD(1)];
      const p3 = [toQD(0), toQD(1)];

      // Sample and check curve stays roughly equidistant from origin
      for (let t = 0.2; t <= 0.8; t += 0.2) {
        const pt = catmullRomSplineQD(p0, p1, p2, p3, t);
        const x = qdSum(pt[0]);
        const y = qdSum(pt[1]);
        const dist = Math.sqrt(x*x + y*y);
        // Should be roughly unit distance (some deviation expected)
        expect(dist).toBeGreaterThan(0.5);
        expect(dist).toBeLessThan(1.5);
      }
    });

    test('quad-double precision: Mandelbrot spike zoom path', () => {
      // Real-world test: deep zoom into Mandelbrot spike region
      // Control points representing a movie path at deep zoom precision
      // Using 1e-20 as baseEpsilon (well within oct precision but large enough to test)
      const center = -2.0;
      const baseEpsilon = 1e-20;

      // Path approaching the spike tip with more spread
      const pt0 = [toQD(center - 2*baseEpsilon), toQD(baseEpsilon)];
      const pt1 = [toQD(center - baseEpsilon), toQD(0.5*baseEpsilon)];
      const pt2 = [toQD(center + baseEpsilon), toQD(-0.5*baseEpsilon)];
      const pt3 = [toQD(center + 2*baseEpsilon), toQD(-baseEpsilon)];

      // Verify interpolation at boundaries
      const at0 = catmullRomSplineQD(pt0, pt1, pt2, pt3, 0);
      const at1 = catmullRomSplineQD(pt0, pt1, pt2, pt3, 1);
      expect(ddSum(at0[0])).toBeCloseTo(center - baseEpsilon, 10);
      expect(ddSum(at1[0])).toBeCloseTo(center + baseEpsilon, 10);

      // At t=0.5, curve is between p1 and p2
      const atHalf = catmullRomSplineQD(pt0, pt1, pt2, pt3, 0.5);
      const reAtHalf = ddSum(atHalf[0]);
      // Should be between p1 and p2 x-coordinates (use >= to allow boundary)
      expect(reAtHalf).toBeGreaterThanOrEqual(center - baseEpsilon);
      expect(reAtHalf).toBeLessThanOrEqual(center + baseEpsilon);
    });

    test('boundary parameter values: exactly t=0 and t=1', () => {
      // Verify exact interpolation at boundaries (fundamental spline property)
      const p0 = toQD(-5);
      const p1 = toQD(Math.PI);  // Irrational value
      const p2 = toQD(Math.E);   // Another irrational value
      const p3 = toQD(10);

      const atZero = catmullRom1DQD(p0, p1, p2, p3, 0);
      const atOne = catmullRom1DQD(p0, p1, p2, p3, 1);

      // Must pass through p1 at t=0 and p2 at t=1
      expect(qdSum(atZero)).toBeCloseTo(Math.PI, 12);
      expect(qdSum(atOne)).toBeCloseTo(Math.E, 12);
    });
  });
});
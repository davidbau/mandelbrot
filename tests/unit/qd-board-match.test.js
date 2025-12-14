/**
 * Test that QDZhuoranBoard (perturbation) matches QDCpuBoard (direct) iteration counts.
 * Uses extracted functions to test the core iteration logic on a small 8x8 grid.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toQD,
  toQDAdd,
  toQDSub,
  toQDMul,
  toQDScale,
  toQDSquare,
  toQDDouble,
  qdToNumber,
  ArqdAdd,
  ArqdMul,
  ArqdSquare,
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
  'toQD',
  'toQDAdd',
  'toQDSub',
  'toQDMul',
  'toQDScale',
  'toQDSquare',
  'toQDDouble',
  'qdToNumber',
  'ArqdAdd',
  'ArqdMul',
  'ArqdSquare',
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

describe('oct board iteration match', () => {
  const GRID_SIZE = 8;
  const MAX_ITER = 500;
  const ESCAPE_RADIUS = 4;

  // Helper: sum oct components
  const qdSum = (o) => o[0] + o[1] + o[2] + o[3];

  // Direct iteration (like QDCpuBoard)
  function iterateDirect(cr, ci, maxIter) {
    let zr = cr.slice();
    let zi = ci.slice();

    for (let i = 0; i < maxIter; i++) {
      const zr2 = toQDSquare(zr);
      const zi2 = toQDSquare(zi);
      const mag = qdSum(toQDAdd(zr2, zi2));

      if (mag > ESCAPE_RADIUS) {
        return i + 1;  // Escaped at iteration i+1
      }

      const zri = toQDMul(zr, zi);
      zr = toQDAdd(toQDSub(zr2, zi2), cr);
      zi = toQDAdd(toQDDouble(zri), ci);
    }

    return 0;  // Didn't escape
  }

  // Perturbation iteration (like QDZhuoranBoard)
  // Uses reference orbit + delta iteration
  function iteratePerturbation(cr, ci, refOrbitR, refOrbitI, maxIter) {
    // Delta from reference center
    const dr = toQDSub(cr, refOrbitR[0]);
    const di = toQDSub(ci, refOrbitI[0]);

    let deltaR = dr.slice();
    let deltaI = di.slice();

    for (let i = 0; i < maxIter && i < refOrbitR.length - 1; i++) {
      // Full z = reference + delta
      const zr = toQDAdd(refOrbitR[i], deltaR);
      const zi = toQDAdd(refOrbitI[i], deltaI);

      const mag = qdSum(toQDAdd(toQDSquare(zr), toQDSquare(zi)));
      if (mag > ESCAPE_RADIUS) {
        return i + 1;
      }

      // Delta iteration: delta' = 2*ref*delta + delta^2 + dc
      // For real: deltaR' = 2*refR*deltaR - 2*refI*deltaI + deltaR^2 - deltaI^2 + dcR
      // For imag: deltaI' = 2*refR*deltaI + 2*refI*deltaR + 2*deltaR*deltaI + dcI
      const refR = refOrbitR[i];
      const refI = refOrbitI[i];

      const twoRefR = toQDDouble(refR);
      const twoRefI = toQDDouble(refI);
      const deltaR2 = toQDSquare(deltaR);
      const deltaI2 = toQDSquare(deltaI);
      const deltaRI = toQDMul(deltaR, deltaI);

      const newDeltaR = toQDAdd(
        toQDAdd(
          toQDSub(toQDMul(twoRefR, deltaR), toQDMul(twoRefI, deltaI)),
          toQDSub(deltaR2, deltaI2)
        ),
        dr
      );

      const newDeltaI = toQDAdd(
        toQDAdd(
          toQDAdd(toQDMul(twoRefR, deltaI), toQDMul(twoRefI, deltaR)),
          toQDDouble(deltaRI)
        ),
        di
      );

      deltaR = newDeltaR;
      deltaI = newDeltaI;
    }

    return 0;
  }

  // Compute reference orbit at center
  function computeRefOrbit(cr, ci, maxIter) {
    const orbitR = [cr.slice()];
    const orbitI = [ci.slice()];

    let zr = cr.slice();
    let zi = ci.slice();

    for (let i = 0; i < maxIter; i++) {
      const zr2 = toQDSquare(zr);
      const zi2 = toQDSquare(zi);
      const mag = qdSum(toQDAdd(zr2, zi2));

      if (mag > ESCAPE_RADIUS) break;

      const zri = toQDMul(zr, zi);
      zr = toQDAdd(toQDSub(zr2, zi2), cr);
      zi = toQDAdd(toQDDouble(zri), ci);

      orbitR.push(zr.slice());
      orbitI.push(zi.slice());
    }

    return { orbitR, orbitI };
  }

  test('direct vs perturbation at z=1e40 near c=-1.9999', () => {
    const centerR = -1.9999;
    const centerI = 0;
    const size = 1e-40;

    const centerOctR = toQD(centerR);
    const centerOctI = toQD(centerI);

    // Compute reference orbit at center
    const { orbitR, orbitI } = computeRefOrbit(centerOctR, centerOctI, MAX_ITER);

    let matches = 0;

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const rFrac = (x / GRID_SIZE) - 0.5;
        const iFrac = 0.5 - (y / GRID_SIZE);

        const cr = toQDAdd(centerOctR, toQDScale(toQD(size), rFrac));
        const ci = toQDAdd(centerOctI, toQDScale(toQD(size), iFrac));

        const directIter = iterateDirect(cr, ci, MAX_ITER);
        const perturbIter = iteratePerturbation(cr, ci, orbitR, orbitI, MAX_ITER);

        if (directIter === perturbIter) {
          matches++;
        }
      }
    }

    // All pixels should match exactly
    expect(matches).toBe(GRID_SIZE * GRID_SIZE);
  });

  test('direct vs perturbation at z=1e32 near c=-1.8', () => {
    const centerR = -1.8;
    const centerI = 0;
    const size = 1e-32;

    const centerOctR = toQD(centerR);
    const centerOctI = toQD(centerI);

    const { orbitR, orbitI } = computeRefOrbit(centerOctR, centerOctI, MAX_ITER);

    let matches = 0;

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const rFrac = (x / GRID_SIZE) - 0.5;
        const iFrac = 0.5 - (y / GRID_SIZE);

        const cr = toQDAdd(centerOctR, toQDScale(toQD(size), rFrac));
        const ci = toQDAdd(centerOctI, toQDScale(toQD(size), iFrac));

        const directIter = iterateDirect(cr, ci, MAX_ITER);
        const perturbIter = iteratePerturbation(cr, ci, orbitR, orbitI, MAX_ITER);

        if (directIter === perturbIter) matches++;
      }
    }

    expect(matches).toBe(GRID_SIZE * GRID_SIZE);
  });
});

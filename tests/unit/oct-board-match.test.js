/**
 * Test that OctZhuoranBoard (perturbation) matches OctCpuBoard (direct) iteration counts.
 * Uses extracted functions to test the core iteration logic on a small 8x8 grid.
 */

const { createTestEnvironment } = require('../utils/extract-code');

const {
  toOct,
  toOctAdd,
  toOctSub,
  toOctMul,
  toOctScale,
  toOctSquare,
  toOctDouble,
  octToNumber,
  AoctAdd,
  AoctMul,
  AoctSquare,
  AsymmetricTwoSum,
  AquickTwoSum,
  AthreeSum,
  AoctTwoProduct,
  AoctTwoSquare,
  AoctRenorm,
  AoctSet,
  AtwoProduct,
  AtwoSquare,
  AqdSplit
} = createTestEnvironment([
  'toOct',
  'toOctAdd',
  'toOctSub',
  'toOctMul',
  'toOctScale',
  'toOctSquare',
  'toOctDouble',
  'octToNumber',
  'AoctAdd',
  'AoctMul',
  'AoctSquare',
  'AsymmetricTwoSum',
  'AquickTwoSum',
  'AthreeSum',
  'AoctTwoProduct',
  'AoctTwoSquare',
  'AoctRenorm',
  'AoctSet',
  'AtwoProduct',
  'AtwoSquare',
  'AqdSplit'
]);

describe('oct board iteration match', () => {
  const GRID_SIZE = 8;
  const MAX_ITER = 500;
  const ESCAPE_RADIUS = 4;

  // Helper: sum oct components
  const octSum = (o) => o[0] + o[1] + o[2] + o[3];

  // Direct iteration (like OctCpuBoard)
  function iterateDirect(cr, ci, maxIter) {
    let zr = cr.slice();
    let zi = ci.slice();

    for (let i = 0; i < maxIter; i++) {
      const zr2 = toOctSquare(zr);
      const zi2 = toOctSquare(zi);
      const mag = octSum(toOctAdd(zr2, zi2));

      if (mag > ESCAPE_RADIUS) {
        return i + 1;  // Escaped at iteration i+1
      }

      const zri = toOctMul(zr, zi);
      zr = toOctAdd(toOctSub(zr2, zi2), cr);
      zi = toOctAdd(toOctDouble(zri), ci);
    }

    return 0;  // Didn't escape
  }

  // Perturbation iteration (like OctZhuoranBoard)
  // Uses reference orbit + delta iteration
  function iteratePerturbation(cr, ci, refOrbitR, refOrbitI, maxIter) {
    // Delta from reference center
    const dr = toOctSub(cr, refOrbitR[0]);
    const di = toOctSub(ci, refOrbitI[0]);

    let deltaR = dr.slice();
    let deltaI = di.slice();

    for (let i = 0; i < maxIter && i < refOrbitR.length - 1; i++) {
      // Full z = reference + delta
      const zr = toOctAdd(refOrbitR[i], deltaR);
      const zi = toOctAdd(refOrbitI[i], deltaI);

      const mag = octSum(toOctAdd(toOctSquare(zr), toOctSquare(zi)));
      if (mag > ESCAPE_RADIUS) {
        return i + 1;
      }

      // Delta iteration: delta' = 2*ref*delta + delta^2 + dc
      // For real: deltaR' = 2*refR*deltaR - 2*refI*deltaI + deltaR^2 - deltaI^2 + dcR
      // For imag: deltaI' = 2*refR*deltaI + 2*refI*deltaR + 2*deltaR*deltaI + dcI
      const refR = refOrbitR[i];
      const refI = refOrbitI[i];

      const twoRefR = toOctDouble(refR);
      const twoRefI = toOctDouble(refI);
      const deltaR2 = toOctSquare(deltaR);
      const deltaI2 = toOctSquare(deltaI);
      const deltaRI = toOctMul(deltaR, deltaI);

      const newDeltaR = toOctAdd(
        toOctAdd(
          toOctSub(toOctMul(twoRefR, deltaR), toOctMul(twoRefI, deltaI)),
          toOctSub(deltaR2, deltaI2)
        ),
        dr
      );

      const newDeltaI = toOctAdd(
        toOctAdd(
          toOctAdd(toOctMul(twoRefR, deltaI), toOctMul(twoRefI, deltaR)),
          toOctDouble(deltaRI)
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
      const zr2 = toOctSquare(zr);
      const zi2 = toOctSquare(zi);
      const mag = octSum(toOctAdd(zr2, zi2));

      if (mag > ESCAPE_RADIUS) break;

      const zri = toOctMul(zr, zi);
      zr = toOctAdd(toOctSub(zr2, zi2), cr);
      zi = toOctAdd(toOctDouble(zri), ci);

      orbitR.push(zr.slice());
      orbitI.push(zi.slice());
    }

    return { orbitR, orbitI };
  }

  test('direct vs perturbation at z=1e40 near c=-1.9999', () => {
    const centerR = -1.9999;
    const centerI = 0;
    const size = 1e-40;

    const centerOctR = toOct(centerR);
    const centerOctI = toOct(centerI);

    // Compute reference orbit at center
    const { orbitR, orbitI } = computeRefOrbit(centerOctR, centerOctI, MAX_ITER);

    let matches = 0;

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const rFrac = (x / GRID_SIZE) - 0.5;
        const iFrac = 0.5 - (y / GRID_SIZE);

        const cr = toOctAdd(centerOctR, toOctScale(toOct(size), rFrac));
        const ci = toOctAdd(centerOctI, toOctScale(toOct(size), iFrac));

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

    const centerOctR = toOct(centerR);
    const centerOctI = toOct(centerI);

    const { orbitR, orbitI } = computeRefOrbit(centerOctR, centerOctI, MAX_ITER);

    let matches = 0;

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const rFrac = (x / GRID_SIZE) - 0.5;
        const iFrac = 0.5 - (y / GRID_SIZE);

        const cr = toOctAdd(centerOctR, toOctScale(toOct(size), rFrac));
        const ci = toOctAdd(centerOctI, toOctScale(toOct(size), iFrac));

        const directIter = iterateDirect(cr, ci, MAX_ITER);
        const perturbIter = iteratePerturbation(cr, ci, orbitR, orbitI, MAX_ITER);

        if (directIter === perturbIter) matches++;
      }
    }

    expect(matches).toBe(GRID_SIZE * GRID_SIZE);
  });
});

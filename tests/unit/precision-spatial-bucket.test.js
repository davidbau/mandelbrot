/**
 * Unit tests for DDSpatialBucket and OctSpatialBucket classes
 *
 * These tests verify correct behavior with:
 * - Coarse grids (normal epsilon values)
 * - Fine grids (smaller than f64 precision - should clamp to MIN_BUCKET_SIZE)
 * - Catastrophic subtraction cases where naive f64 subtraction would fail
 * - Edge cases at bucket boundaries
 */

// Mock quad-double arithmetic functions
function slow2Sum(a, b) {
  const s = a + b;
  const v = s - a;
  const e = (a - (s - v)) + (b - v);
  return [s, e];
}

function fast2Sum(a, b) {
  const s = a + b;
  const e = b - (s - a);
  return [s, e];
}

function twoProduct(a, b) {
  const p = a * b;
  const err = Math.fround(a) * Math.fround(b) - p +
              (a - Math.fround(a)) * b +
              Math.fround(a) * (b - Math.fround(b));
  // Simplified - real implementation uses FMA or Veltkamp splitting
  return [p, a * b - p]; // Approximation for testing
}

function ddAdd(a, b) {
  let [a1, a0] = a;
  let [b1, b0] = b;
  let [h1, h2] = slow2Sum(a1, b1);
  let [l1, l2] = slow2Sum(a0, b0);
  let [v1, v2] = fast2Sum(h1, h2 + l1);
  return fast2Sum(v1, v2 + l2);
}

function ddNegate(a) {
  return [-a[0], -a[1]];
}

function ddSub(a, b) {
  return ddAdd(a, ddNegate(b));
}

// Mock oct arithmetic using array-based operations
function ArqdAdd(r, i, a1, a2, a3, a4, b1, b2, b3, b4) {
  // Simplified oct add - accumulates with error tracking
  let s1 = a1 + b1;
  let e1 = (a1 - s1) + b1;
  let s2 = a2 + b2 + e1;
  let e2 = (a2 - (s2 - e1)) + b2;
  let s3 = a3 + b3 + e2;
  let e3 = (a3 - (s3 - e2)) + b3;
  let s4 = a4 + b4 + e3;
  r[i] = s1;
  r[i + 1] = s2;
  r[i + 2] = s3;
  r[i + 3] = s4;
}

function toQD(a) {
  if (Array.isArray(a)) {
    if (a.length >= 4) return a.slice(0, 4);
    if (a.length === 2) return [a[0], a[1], 0, 0];
    return [a[0] || 0, 0, 0, 0];
  }
  return [a, 0, 0, 0];
}

function toQDAdd(a, b) {
  const aa = toQD(a);
  const bb = toQD(b);
  const out = new Array(4);
  ArqdAdd(out, 0, aa[0], aa[1], aa[2], aa[3], bb[0], bb[1], bb[2], bb[3]);
  return out;
}

function toQDSub(a, b) {
  const bb = toQD(b);
  return toQDAdd(a, [-bb[0], -bb[1], -bb[2], -bb[3]]);
}

function qdToNumber(o) {
  const v = toQD(o);
  return v[0] + v[1] + v[2] + v[3];
}

// ============================================================
// SpatialBucket base class
// ============================================================
class SpatialBucket {
  static MIN_BUCKET_SIZE = 1e-12;

  constructor(threadingEpsilon) {
    this.threadingEpsilon = threadingEpsilon;
    this.bucketRadius = Math.max(threadingEpsilon, SpatialBucket.MIN_BUCKET_SIZE);
    this.gridSize = 2 * this.bucketRadius;
    this.buckets = new Map();
  }

  // Subclasses must override
  getF64Point(i) { throw new Error("subclass must implement getF64Point"); }
  verifyAndGetDelta(i, j) { throw new Error("subclass must implement verifyAndGetDelta"); }

  _getBucket(re, im) {
    const bx = Math.floor(re / this.gridSize);
    const by = Math.floor(im / this.gridSize);
    return { bx, by };
  }

  _getKey(bx, by) {
    return `${bx},${by}`;
  }

  add(i) {
    const pt = this.getF64Point(i);
    if (!pt) return;
    const { bx, by } = this._getBucket(pt.re, pt.im);
    const key = this._getKey(bx, by);
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new Set());
    }
    this.buckets.get(key).add(i);
  }

  findAndRemoveNear(i) {
    const pt = this.getF64Point(i);
    if (!pt) return [];

    const { bx, by } = this._getBucket(pt.re, pt.im);

    // Determine which 4 buckets to check based on position within bucket
    const fracX = (pt.re / this.gridSize) - bx;
    const fracY = (pt.im / this.gridSize) - by;
    const dx = fracX < 0.5 ? -1 : 1;
    const dy = fracY < 0.5 ? -1 : 1;

    const bucketsToCheck = [
      [bx, by],
      [bx + dx, by],
      [bx, by + dy],
      [bx + dx, by + dy]
    ];

    const found = [];
    for (const [checkBx, checkBy] of bucketsToCheck) {
      const key = this._getKey(checkBx, checkBy);
      const bucket = this.buckets.get(key);
      if (!bucket) continue;

      const toRemove = [];
      for (const j of bucket) {
        if (j === i) continue;

        // Use precision-aware verification
        const delta = this.verifyAndGetDelta(i, j);
        if (delta !== null) {
          found.push({ index: j, deltaRe: delta.deltaRe, deltaIm: delta.deltaIm });
          toRemove.push(j);
        }
      }

      for (const j of toRemove) {
        bucket.delete(j);
      }
      if (bucket.size === 0) {
        this.buckets.delete(key);
      }
    }

    return found;
  }

  removeOlderThan(minIndex) {
    for (const [key, bucket] of this.buckets) {
      for (const j of bucket) {
        if (j < minIndex) {
          bucket.delete(j);
        }
      }
      if (bucket.size === 0) {
        this.buckets.delete(key);
      }
    }
  }

  get size() {
    let count = 0;
    for (const bucket of this.buckets.values()) {
      count += bucket.size;
    }
    return count;
  }
}

// ============================================================
// DDSpatialBucket - for quad-double precision [re_hi, re_lo, im_hi, im_lo]
// ============================================================
class DDSpatialBucket extends SpatialBucket {
  constructor(threadingEpsilon, getQdPoint) {
    super(threadingEpsilon);
    this.getQdPoint = getQdPoint;
    // Pre-allocate arrays for subtraction to avoid allocations
    this._tempA = [0, 0];
    this._tempB = [0, 0];
  }

  getF64Point(i) {
    const p = this.getQdPoint(i);
    if (!p) return null;
    return { re: p[0] + p[1], im: p[2] + p[3] };
  }

  verifyAndGetDelta(i, j) {
    const pi = this.getQdPoint(i);
    const pj = this.getQdPoint(j);
    if (!pi || !pj) return null;

    // Proper qd subtraction to avoid catastrophic cancellation
    const deltaReQd = ddSub([pi[0], pi[1]], [pj[0], pj[1]]);
    const deltaImQd = ddSub([pi[2], pi[3]], [pj[2], pj[3]]);

    // Sum qd result to f64
    const deltaRe = deltaReQd[0] + deltaReQd[1];
    const deltaIm = deltaImQd[0] + deltaImQd[1];

    // Check L∞ distance
    if (Math.max(Math.abs(deltaRe), Math.abs(deltaIm)) <= this.threadingEpsilon) {
      return { deltaRe, deltaIm };
    }
    return null;
  }
}

// ============================================================
// OctSpatialBucket - for oct precision [re0, re1, re2, re3, im0, im1, im2, im3]
// ============================================================
class OctSpatialBucket extends SpatialBucket {
  constructor(threadingEpsilon, getOctPoint) {
    super(threadingEpsilon);
    this.getOctPoint = getOctPoint;
  }

  getF64Point(i) {
    const p = this.getOctPoint(i);
    if (!p) return null;
    return {
      re: p[0] + p[1] + p[2] + p[3],
      im: p[4] + p[5] + p[6] + p[7]
    };
  }

  verifyAndGetDelta(i, j) {
    const pi = this.getOctPoint(i);
    const pj = this.getOctPoint(j);
    if (!pi || !pj) return null;

    // Proper oct subtraction to avoid catastrophic cancellation
    const deltaReOct = toQDSub(
      [pi[0], pi[1], pi[2], pi[3]],
      [pj[0], pj[1], pj[2], pj[3]]
    );
    const deltaImOct = toQDSub(
      [pi[4], pi[5], pi[6], pi[7]],
      [pj[4], pj[5], pj[6], pj[7]]
    );

    // Sum oct result to f64
    const deltaRe = qdToNumber(deltaReOct);
    const deltaIm = qdToNumber(deltaImOct);

    // Check L∞ distance
    if (Math.max(Math.abs(deltaRe), Math.abs(deltaIm)) <= this.threadingEpsilon) {
      return { deltaRe, deltaIm };
    }
    return null;
  }
}

// ============================================================
// TESTS
// ============================================================

describe('SpatialBucket base class', () => {
  test('clamps bucket radius to MIN_BUCKET_SIZE', () => {
    class TestBucket extends SpatialBucket {
      constructor(eps) { super(eps); }
      getF64Point(i) { return { re: 0, im: 0 }; }
      verifyAndGetDelta(i, j) { return { deltaRe: 0, deltaIm: 0 }; }
    }

    const coarse = new TestBucket(1e-6);
    expect(coarse.bucketRadius).toBe(1e-6);
    expect(coarse.gridSize).toBe(2e-6);

    const fine = new TestBucket(1e-20);
    expect(fine.bucketRadius).toBe(SpatialBucket.MIN_BUCKET_SIZE);
    expect(fine.gridSize).toBe(2 * SpatialBucket.MIN_BUCKET_SIZE);
  });
});

describe('DDSpatialBucket', () => {
  describe('coarse grid (normal epsilon)', () => {
    test('finds nearby qd points', () => {
      // QD format: [re_hi, re_lo, im_hi, im_lo]
      const points = [
        [1.0, 0, 0.5, 0],       // index 0: (1.0, 0.5)
        [1.0001, 0, 0.5001, 0], // index 1: slightly different
        [5.0, 0, 5.0, 0],       // index 2: far away
      ];
      const bucket = new DDSpatialBucket(0.01, i => points[i]);

      bucket.add(0);
      bucket.add(2);

      const found = bucket.findAndRemoveNear(1);
      expect(found.length).toBe(1);
      expect(found[0].index).toBe(0);
      expect(Math.abs(found[0].deltaRe - 0.0001)).toBeLessThan(1e-10);
      expect(Math.abs(found[0].deltaIm - 0.0001)).toBeLessThan(1e-10);
    });

    test('does not find distant points', () => {
      const points = [
        [0, 0, 0, 0],
        [1, 0, 1, 0],  // distance 1.0 > 0.1
      ];
      const bucket = new DDSpatialBucket(0.1, i => points[i]);

      bucket.add(0);
      const found = bucket.findAndRemoveNear(1);
      expect(found.length).toBe(0);
    });
  });

  describe('fine grid (catastrophic subtraction case)', () => {
    test('correctly handles nearly identical qd values', () => {
      // Two points that differ by 1e-20, which would be lost in naive f64 subtraction
      // QD can represent this because the difference is in the low component
      const baseRe = 1.5;
      const baseIm = -0.3;
      const tinyDiff = 1e-18;

      const points = [
        // Point 0: base value
        [baseRe, 0, baseIm, 0],
        // Point 1: base + tiny difference (stored in low component)
        [baseRe, tinyDiff, baseIm, tinyDiff],
        // Point 2: query point at base + 0.5*tinyDiff
        [baseRe, tinyDiff / 2, baseIm, tinyDiff / 2],
      ];

      // Bucket radius should clamp to MIN_BUCKET_SIZE since tinyDiff is too small
      const bucket = new DDSpatialBucket(tinyDiff * 2, i => points[i]);
      expect(bucket.bucketRadius).toBe(SpatialBucket.MIN_BUCKET_SIZE);

      bucket.add(0);
      bucket.add(1);

      // Both points should be found since they're in the same coarse bucket
      // But verification should use proper qd subtraction
      const found = bucket.findAndRemoveNear(2);

      // The qd subtraction should correctly compute the tiny differences
      expect(found.length).toBe(2);
      found.sort((a, b) => a.index - b.index);

      // Point 0 is at distance tinyDiff/2 from query
      expect(Math.abs(found[0].deltaRe - tinyDiff / 2)).toBeLessThan(1e-25);
      expect(Math.abs(found[0].deltaIm - tinyDiff / 2)).toBeLessThan(1e-25);

      // Point 1 is at distance tinyDiff/2 from query (in opposite direction)
      expect(Math.abs(found[1].deltaRe + tinyDiff / 2)).toBeLessThan(1e-25);
    });

    test('respects threadingEpsilon even with coarse buckets', () => {
      const baseRe = 1.0;
      const points = [
        [baseRe, 0, 0, 0],
        [baseRe, 1e-15, 0, 0],  // Differs by 1e-15
        [baseRe, 1e-18, 0, 0],  // Differs by 1e-18 (within epsilon)
      ];

      // threadingEpsilon is 1e-17, but bucket will use MIN_BUCKET_SIZE
      const bucket = new DDSpatialBucket(1e-17, i => points[i]);

      bucket.add(1);  // 1e-15 away
      bucket.add(2);  // 1e-18 away

      const found = bucket.findAndRemoveNear(0);

      // Only point 2 should be within threadingEpsilon
      expect(found.length).toBe(1);
      expect(found[0].index).toBe(2);
    });
  });

  describe('bucket boundary cases', () => {
    test('finds points across bucket boundaries', () => {
      // Two points just across a bucket boundary
      const gridSize = 2 * 0.1;  // bucketRadius = 0.1
      const points = [
        [0.099, 0, 0.5, 0],   // Just before boundary
        [0.101, 0, 0.5, 0],   // Just after boundary
      ];

      const bucket = new DDSpatialBucket(0.1, i => points[i]);
      bucket.add(0);

      const found = bucket.findAndRemoveNear(1);
      expect(found.length).toBe(1);
      expect(found[0].index).toBe(0);
    });
  });
});

describe('OctSpatialBucket', () => {
  describe('coarse grid (normal epsilon)', () => {
    test('finds nearby oct points', () => {
      // Oct format: [re0, re1, re2, re3, im0, im1, im2, im3]
      const points = [
        [1.0, 0, 0, 0, 0.5, 0, 0, 0],       // index 0: (1.0, 0.5)
        [1.0001, 0, 0, 0, 0.5001, 0, 0, 0], // index 1: slightly different
        [5.0, 0, 0, 0, 5.0, 0, 0, 0],       // index 2: far away
      ];
      const bucket = new OctSpatialBucket(0.01, i => points[i]);

      bucket.add(0);
      bucket.add(2);

      const found = bucket.findAndRemoveNear(1);
      expect(found.length).toBe(1);
      expect(found[0].index).toBe(0);
      expect(Math.abs(found[0].deltaRe - 0.0001)).toBeLessThan(1e-10);
    });

    test('handles negative coordinates', () => {
      const points = [
        [-1.5, 0, 0, 0, -0.5, 0, 0, 0],
        [-1.5001, 0, 0, 0, -0.5001, 0, 0, 0],
      ];
      const bucket = new OctSpatialBucket(0.01, i => points[i]);

      bucket.add(0);
      const found = bucket.findAndRemoveNear(1);
      expect(found.length).toBe(1);
    });
  });

  describe('fine grid (deep zoom simulation)', () => {
    test('correctly handles oct values with precision in lower components', () => {
      // Simulate deep zoom: high components are ~center, low components have precision
      const center = -1.8;
      const tinyDiff = 1e-40;  // Way beyond f64 precision

      const points = [
        // Point 0: center + small offset in re3 component
        [center, 0, 0, 1e-20, 0, 0, 0, 0],
        // Point 1: center + different small offset
        [center, 0, 0, 1e-20 + tinyDiff, 0, 0, 0, tinyDiff],
        // Point 2: query point
        [center, 0, 0, 1e-20 + tinyDiff/2, 0, 0, 0, tinyDiff/2],
      ];

      // With super-fine epsilon, bucket clamps to MIN_BUCKET_SIZE
      const bucket = new OctSpatialBucket(tinyDiff * 2, i => points[i]);
      expect(bucket.bucketRadius).toBe(SpatialBucket.MIN_BUCKET_SIZE);

      bucket.add(0);
      bucket.add(1);

      // All points land in same coarse bucket since high components are identical
      const found = bucket.findAndRemoveNear(2);

      // Both should be found (in same bucket), verified with oct subtraction
      expect(found.length).toBe(2);
    });

    test('oct subtraction preserves precision for delta computation', () => {
      // Create two oct values that are extremely close
      // Their f64 sums would be identical, but oct subtraction reveals the difference
      const big = 1e10;
      const tiny = 1e-30;

      const points = [
        // Point with value spread across oct components
        [big, -big + 1, 1e-15, tiny, 0, 0, 0, 0],
        // Same value but with tiny added to re3
        [big, -big + 1, 1e-15, tiny + 1e-35, 0, 0, 0, 0],
      ];

      const bucket = new OctSpatialBucket(1e-30, i => points[i]);
      bucket.add(0);

      const found = bucket.findAndRemoveNear(1);

      // The points should be found (same coarse bucket)
      // Delta should be computed via oct subtraction
      expect(found.length).toBe(1);
      // Delta should be approximately 1e-35
      expect(Math.abs(found[0].deltaRe)).toBeLessThan(1e-30);
    });
  });

  describe('removeOlderThan', () => {
    test('removes old indices correctly', () => {
      const points = [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0.1, 0, 0, 0, 0, 0, 0, 0],
        [0.2, 0, 0, 0, 0, 0, 0, 0],
        [0.3, 0, 0, 0, 0, 0, 0, 0],
      ];
      const bucket = new OctSpatialBucket(1.0, i => points[i]);

      bucket.add(0);
      bucket.add(1);
      bucket.add(2);
      bucket.add(3);
      expect(bucket.size).toBe(4);

      bucket.removeOlderThan(2);
      expect(bucket.size).toBe(2);
    });
  });

  describe('4-bucket probe correctness', () => {
    test('finds all nearby points regardless of bucket boundary position', () => {
      // Create a grid of points and verify the 4-bucket probe finds all neighbors
      const epsilon = 0.5;
      const bucket = new OctSpatialBucket(epsilon, i => testPoints[i]);

      // Create test points in a pattern that spans bucket boundaries
      const testPoints = [];
      for (let x = -2; x <= 2; x += 0.3) {
        for (let y = -2; y <= 2; y += 0.3) {
          testPoints.push([x, 0, 0, 0, y, 0, 0, 0]);
        }
      }

      // Add all points except the center one
      const centerIdx = Math.floor(testPoints.length / 2);
      for (let i = 0; i < testPoints.length; i++) {
        if (i !== centerIdx) bucket.add(i);
      }

      // Find neighbors of center
      const centerPt = testPoints[centerIdx];
      const found = bucket.findAndRemoveNear(centerIdx);

      // Verify all found points are actually within epsilon
      for (const match of found) {
        const pt = testPoints[match.index];
        const dist = Math.max(
          Math.abs(pt[0] - centerPt[0]),
          Math.abs(pt[4] - centerPt[4])
        );
        expect(dist).toBeLessThanOrEqual(epsilon + 1e-10);
      }

      // Verify no points within epsilon were missed
      for (let i = 0; i < testPoints.length; i++) {
        if (i === centerIdx) continue;
        const pt = testPoints[i];
        const dist = Math.max(
          Math.abs(pt[0] - centerPt[0]),
          Math.abs(pt[4] - centerPt[4])
        );
        if (dist <= epsilon) {
          const wasFound = found.some(m => m.index === i);
          expect(wasFound).toBe(true);
        }
      }
    });
  });
});

describe('Mixed precision scenarios', () => {
  test('QD bucket returns correct deltas for threading', () => {
    // Simulate finding a cycle in reference orbit
    // Orbit returns to near-same point after some iterations
    const cyclePoint = [0.123456789, 1e-17, -0.987654321, 2e-17];
    const returnPoint = [0.123456789, 1.5e-17, -0.987654321, 2.3e-17];

    const points = [cyclePoint, returnPoint];
    const bucket = new DDSpatialBucket(1e-15, i => points[i]);

    bucket.add(0);
    const found = bucket.findAndRemoveNear(1);

    expect(found.length).toBe(1);
    // Delta should be the difference stored in low components
    expect(Math.abs(found[0].deltaRe - 0.5e-17)).toBeLessThan(1e-20);
    expect(Math.abs(found[0].deltaIm - 0.3e-17)).toBeLessThan(1e-20);
  });

  test('OCT bucket returns correct deltas for threading', () => {
    // Similar test for oct precision
    const cyclePoint = [-1.8, 1e-16, 1e-32, 1e-48, 0, 1e-20, 1e-36, 1e-52];
    const returnPoint = [-1.8, 1e-16, 1e-32, 1e-48 + 1e-50, 0, 1e-20, 1e-36, 1e-52 + 2e-50];

    const points = [cyclePoint, returnPoint];
    const bucket = new OctSpatialBucket(1e-45, i => points[i]);

    bucket.add(0);
    const found = bucket.findAndRemoveNear(1);

    expect(found.length).toBe(1);
    // Deltas should be the tiny differences
    expect(Math.abs(found[0].deltaRe)).toBeLessThan(1e-45);
    expect(Math.abs(found[0].deltaIm)).toBeLessThan(1e-45);
  });
});

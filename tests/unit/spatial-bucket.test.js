/**
 * Unit tests for SpatialBucket base class
 *
 * Tests the core spatial bucketing logic using a simple F64SpatialBucket subclass.
 * For precision-aware tests (DDSpatialBucket, OctSpatialBucket), see precision-spatial-bucket.test.js
 */

// Base SpatialBucket class (matches index.html implementation)
class SpatialBucket {
  static MIN_BUCKET_SIZE = 1e-12;

  constructor(threadingEpsilon) {
    this.threadingEpsilon = threadingEpsilon;
    this.bucketRadius = Math.max(threadingEpsilon, SpatialBucket.MIN_BUCKET_SIZE);
    this.gridSize = 2 * this.bucketRadius;
    this.buckets = new Map();
  }

  getF64Point(i) { throw new Error("subclass must implement getF64Point"); }
  verifyAndGetDelta(i, j) { throw new Error("subclass must implement verifyAndGetDelta"); }

  getBucket(re, im) {
    const bx = Math.floor(re / this.gridSize);
    const by = Math.floor(im / this.gridSize);
    return { bx, by };
  }

  getKey(bx, by) {
    return `${bx},${by}`;
  }

  add(i) {
    const pt = this.getF64Point(i);
    if (!pt) return;
    const { bx, by } = this.getBucket(pt.re, pt.im);
    const key = this.getKey(bx, by);
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new Set());
    }
    this.buckets.get(key).add(i);
  }

  findAndRemoveNear(i) {
    const pt = this.getF64Point(i);
    if (!pt) return [];

    const { bx, by } = this.getBucket(pt.re, pt.im);
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
      const key = this.getKey(checkBx, checkBy);
      const bucket = this.buckets.get(key);
      if (!bucket) continue;

      const toRemove = [];
      for (const j of bucket) {
        if (j === i) continue;

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

/**
 * Simple F64SpatialBucket for testing - uses plain f64 {re, im} points
 */
class F64SpatialBucket extends SpatialBucket {
  constructor(threadingEpsilon, getPoint) {
    super(threadingEpsilon);
    this.getPoint = getPoint;
  }

  getF64Point(i) {
    return this.getPoint(i);
  }

  verifyAndGetDelta(i, j) {
    const pi = this.getPoint(i);
    const pj = this.getPoint(j);
    if (!pi || !pj) return null;

    const deltaRe = pi.re - pj.re;
    const deltaIm = pi.im - pj.im;

    if (Math.max(Math.abs(deltaRe), Math.abs(deltaIm)) <= this.threadingEpsilon) {
      return { deltaRe, deltaIm };
    }
    return null;
  }
}

// Helper to extract just indices from findAndRemoveNear results
function extractIndices(results) {
  return results.map(r => r.index);
}

describe('SpatialBucket', () => {
  describe('basic operations', () => {
    test('add and find single point', () => {
      const points = [{ re: 0.5, im: 0.5 }];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      expect(sb.size).toBe(1);
    });

    test('findAndRemoveNear finds nearby point', () => {
      const points = [
        { re: 0.5, im: 0.5 },
        { re: 0.6, im: 0.6 }  // within distance 0.1
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(extractIndices(found)).toEqual([0]);
      expect(sb.size).toBe(0);  // removed
    });

    test('findAndRemoveNear does not find distant point', () => {
      const points = [
        { re: 0.0, im: 0.0 },
        { re: 5.0, im: 5.0 }  // far away
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(found).toEqual([]);
      expect(sb.size).toBe(1);  // not removed
    });

    test('findAndRemoveNear returns deltas', () => {
      const points = [
        { re: 1.0, im: 2.0 },
        { re: 1.1, im: 2.2 }
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(found.length).toBe(1);
      expect(found[0].index).toBe(0);
      expect(Math.abs(found[0].deltaRe - 0.1)).toBeLessThan(1e-10);
      expect(Math.abs(found[0].deltaIm - 0.2)).toBeLessThan(1e-10);
    });
  });

  describe('L∞ distance behavior', () => {
    test('finds point at exactly threadingEpsilon distance', () => {
      const points = [
        { re: 0.0, im: 0.0 },
        { re: 1.0, im: 0.0 }  // exactly at distance 1.0
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(extractIndices(found)).toEqual([0]);
    });

    test('does not find point just beyond threadingEpsilon', () => {
      const points = [
        { re: 0.0, im: 0.0 },
        { re: 1.001, im: 0.0 }  // just beyond
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(found).toEqual([]);
    });

    test('L∞ uses max of |dx|, |dy|', () => {
      const points = [
        { re: 0.0, im: 0.0 },
        { re: 0.5, im: 0.9 }  // L2 = 1.03, L∞ = 0.9
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(extractIndices(found)).toEqual([0]);  // L∞ = 0.9 <= 1.0
    });
  });

  describe('bucket edge cases', () => {
    test('finds point across bucket boundary', () => {
      // Points in different buckets but close together
      const points = [
        { re: 0.99, im: 0.5 },  // bucket (0, 0)
        { re: 1.01, im: 0.5 }   // bucket (1, 0), but only 0.02 away
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(extractIndices(found)).toEqual([0]);
    });

    test('finds point across diagonal bucket boundary', () => {
      const points = [
        { re: 0.99, im: 0.99 },  // bucket (0, 0)
        { re: 1.01, im: 1.01 }   // bucket (1, 1)
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);

      expect(extractIndices(found)).toEqual([0]);
    });

    test('4-bucket probe finds all nearby points', () => {
      // Point in center, some neighbors nearby, some far
      // With threadingEpsilon=0.5, gridSize=1.0
      const points = [
        { re: 1.5, im: 1.5 },   // query point
        { re: 0.5, im: 0.5 },   // distance 1.0 > 0.5, too far
        { re: 1.2, im: 1.5 },   // distance 0.3 <= 0.5, within range
        { re: 1.5, im: 1.2 },   // distance 0.3 <= 0.5, within range
        { re: 2.5, im: 2.5 },   // distance 1.0 > 0.5, too far
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(0.5, getPoint);

      sb.add(1);
      sb.add(2);
      sb.add(3);
      sb.add(4);

      const found = sb.findAndRemoveNear(0);
      const indices = extractIndices(found).sort((a, b) => a - b);

      expect(indices).toEqual([2, 3]);
    });
  });

  describe('removeOlderThan', () => {
    test('removes old indices', () => {
      const points = [
        { re: 0.1, im: 0.1 },
        { re: 0.2, im: 0.2 },
        { re: 0.3, im: 0.3 },
        { re: 0.4, im: 0.4 },
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      sb.add(1);
      sb.add(2);
      sb.add(3);
      expect(sb.size).toBe(4);

      sb.removeOlderThan(2);
      expect(sb.size).toBe(2);

      // Verify indices 0, 1 are gone; 2, 3 remain
      const found = sb.findAndRemoveNear(3);
      expect(extractIndices(found)).toEqual([2]);
    });

    test('handles empty buckets after removal', () => {
      const points = [{ re: 0.5, im: 0.5 }];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      sb.removeOlderThan(1);

      expect(sb.size).toBe(0);
      expect(sb.buckets.size).toBe(0);  // bucket should be deleted
    });
  });

  describe('multiple points', () => {
    test('finds all nearby points in one call', () => {
      const points = [
        { re: 0.0, im: 0.0 },
        { re: 0.1, im: 0.1 },
        { re: 0.2, im: 0.2 },
        { re: 5.0, im: 5.0 },  // far
        { re: 0.15, im: 0.15 } // query point
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      sb.add(1);
      sb.add(2);
      sb.add(3);

      const found = sb.findAndRemoveNear(4);
      const indices = extractIndices(found).sort((a, b) => a - b);

      expect(indices).toEqual([0, 1, 2]);
      expect(sb.size).toBe(1);  // only index 3 remains
    });
  });

  describe('different threadingEpsilon sizes', () => {
    const testEpsilon = (epsilon) => {
      test(`threadingEpsilon=${epsilon}: finds points within range`, () => {
        const halfEps = epsilon / 2;
        const points = [
          { re: 0.0, im: 0.0 },
          { re: halfEps, im: halfEps },  // within range
        ];
        const getPoint = (i) => points[i];
        const sb = new F64SpatialBucket(epsilon, getPoint);

        sb.add(0);
        const found = sb.findAndRemoveNear(1);
        expect(extractIndices(found)).toEqual([0]);
      });

      test(`threadingEpsilon=${epsilon}: rejects points outside range`, () => {
        const justOutside = epsilon * 1.1;
        const points = [
          { re: 0.0, im: 0.0 },
          { re: justOutside, im: 0.0 },  // outside range
        ];
        const getPoint = (i) => points[i];
        const sb = new F64SpatialBucket(epsilon, getPoint);

        sb.add(0);
        const found = sb.findAndRemoveNear(1);
        expect(found).toEqual([]);
      });
    };

    // Test various epsilon sizes (note: very small values clamp to MIN_BUCKET_SIZE)
    [0.001, 0.01, 0.1, 1.0, 10.0, 100.0].forEach(testEpsilon);
  });

  describe('MIN_BUCKET_SIZE clamping', () => {
    test('clamps tiny threadingEpsilon to MIN_BUCKET_SIZE', () => {
      const points = [{ re: 0, im: 0 }];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1e-20, getPoint);

      expect(sb.bucketRadius).toBe(SpatialBucket.MIN_BUCKET_SIZE);
      expect(sb.gridSize).toBe(2 * SpatialBucket.MIN_BUCKET_SIZE);
    });

    test('does not clamp normal threadingEpsilon', () => {
      const points = [{ re: 0, im: 0 }];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1e-6, getPoint);

      expect(sb.bucketRadius).toBe(1e-6);
      expect(sb.gridSize).toBe(2e-6);
    });
  });

  describe('negative coordinates', () => {
    test('handles negative coordinates', () => {
      const points = [
        { re: -0.5, im: -0.5 },
        { re: -0.4, im: -0.4 },
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);
      expect(extractIndices(found)).toEqual([0]);
    });

    test('handles mixed positive/negative coordinates', () => {
      const points = [
        { re: -0.1, im: 0.1 },
        { re: 0.1, im: -0.1 },
      ];
      const getPoint = (i) => points[i];
      const sb = new F64SpatialBucket(1.0, getPoint);

      sb.add(0);
      const found = sb.findAndRemoveNear(1);
      expect(extractIndices(found)).toEqual([0]);
    });
  });
});

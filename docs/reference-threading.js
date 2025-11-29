#!/usr/bin/env node

// Reference Orbit Threading Utility
// Shared code for computing threaded reference orbits
// Used by both CPU and GPU implementations

/**
 * ReferenceOrbitThreading
 *
 * Manages threading structure for a reference orbit to enable robust cycle detection.
 * The threading pre-computes which orbit points are close to each other, allowing
 * runtime convergence checking even when rebasing prevents exact ref_iter matching.
 *
 * Threading is computed incrementally as the reference orbit extends.
 */
class ReferenceOrbitThreading {
  constructor(epsilon) {
    // Threading parameters
    const floatPrecision = 1e-7;  // Float32 precision
    const maxCycleLength = 1e5;   // Maximum detectable cycle length

    // epsilon3: as large as possible while keeping single-precision ability to calculate at epsilon precision
    this.epsilon3 = epsilon * 1e7 / Math.sqrt(maxCycleLength);
    this.bucketSize = 2 * this.epsilon3;
    this.threadingWindowSize = Math.floor(maxCycleLength);

    // Threading data structures
    this.refThreading = [];       // Array of {next: index, deltaRe: float32, deltaIm: float32}
    this.spatialBuckets = new Map();  // Hash grid for O(1) neighbor lookup

    // Minimum jump distance to avoid trivial consecutive-point threading
    this.minJump = 10;
  }

  /**
   * Get spatial bucket key for a point
   */
  getBucketKey(re, im) {
    const bx = Math.floor(re / this.bucketSize);
    const by = Math.floor(im / this.bucketSize);
    return `${bx},${by}`;
  }

  /**
   * Add point to spatial buckets
   */
  addToBucket(index, re, im) {
    const key = this.getBucketKey(re, im);
    if (!this.spatialBuckets.has(key)) {
      this.spatialBuckets.set(key, []);
    }
    this.spatialBuckets.get(key).push(index);

    // Remove old points outside the threading window
    if (index >= this.threadingWindowSize) {
      // We'll need the refOrbit to get old point coordinates
      // This cleanup will be handled by the caller
    }
  }

  /**
   * Remove point from spatial buckets (for windowing)
   */
  removeFromBucket(index, re, im) {
    const key = this.getBucketKey(re, im);
    const bucket = this.spatialBuckets.get(key);
    if (bucket) {
      const pos = bucket.indexOf(index);
      if (pos >= 0) {
        bucket.splice(pos, 1);
      }
      if (bucket.length === 0) {
        this.spatialBuckets.delete(key);
      }
    }
  }

  /**
   * Find nearest PAST neighbor within epsilon3 distance
   * Returns the index of the most recent past point that is close enough
   *
   * @param {number} currentIndex - Current orbit index
   * @param {number} re - Real part of current point
   * @param {number} im - Imaginary part of current point
   * @returns {number} Index of nearest past neighbor, or -1 if none found
   */
  findNearestNeighbor(currentIndex, re, im) {
    const bx = Math.floor(re / this.bucketSize);
    const by = Math.floor(im / this.bucketSize);

    let nearest = -1;
    let nearestDist = this.epsilon3;

    // Search this bucket and 8 neighbors (3x3 grid)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${bx + dx},${by + dy}`;
        const bucket = this.spatialBuckets.get(neighborKey);
        if (!bucket) continue;

        for (const j of bucket) {
          // Only consider past points that are far enough back
          if (j >= currentIndex || currentIndex - j < this.minJump) continue;

          // Caller must provide a way to get point coordinates
          // We'll return the index and let caller compute distance
          if (j > nearest) {
            nearest = j;  // Most recent past point in range
          }
        }
      }
    }

    return nearest;
  }

  /**
   * Process a new reference orbit point and update threading
   *
   * @param {number} currentIndex - Index of the new point
   * @param {number} re - Real part of the new point
   * @param {number} im - Imaginary part of the new point
   * @param {Function} getPoint - Function(index) that returns {re, im} for orbit point
   */
  addOrbitPoint(currentIndex, re, im, getPoint) {
    // Find nearest past neighbor
    const pastNeighbor = this.findNearestNeighbor(currentIndex, re, im);

    // Verify distance if we found a candidate
    let finalNeighbor = -1;
    if (pastNeighbor >= 0) {
      const pastPoint = getPoint(pastNeighbor);
      const deltaRe = re - pastPoint.re;
      const deltaIm = im - pastPoint.im;
      const dist = Math.max(Math.abs(deltaRe), Math.abs(deltaIm));

      if (dist <= this.epsilon3) {
        finalNeighbor = pastNeighbor;
      }
    }

    // Initialize current point's thread (no forward thread yet)
    this.refThreading.push({next: -1, deltaRe: 0, deltaIm: 0});

    // If we found a past neighbor, update THAT point's thread to point forward to us
    if (finalNeighbor >= 0) {
      const pastPoint = getPoint(finalNeighbor);
      this.refThreading[finalNeighbor] = {
        next: currentIndex,
        deltaRe: Math.fround(re - pastPoint.re),
        deltaIm: Math.fround(im - pastPoint.im)
      };
    }

    // Add this point to buckets for future searches
    this.addToBucket(currentIndex, re, im);

    // Clean up old points outside the window
    if (currentIndex >= this.threadingWindowSize) {
      const oldIndex = currentIndex - this.threadingWindowSize;
      const oldPoint = getPoint(oldIndex);
      if (oldPoint) {
        this.removeFromBucket(oldIndex, oldPoint.re, oldPoint.im);
      }
    }
  }

  /**
   * Get threading data for a specific index
   */
  getThread(index) {
    if (index < 0 || index >= this.refThreading.length) {
      return {next: -1, deltaRe: 0, deltaIm: 0};
    }
    return this.refThreading[index];
  }

  /**
   * Get all threading data (for uploading to GPU)
   */
  getAllThreads() {
    return this.refThreading;
  }

  /**
   * Get statistics about threading quality
   */
  getStats() {
    let withThreads = 0;
    let withoutThreads = 0;
    let maxJump = 0;
    let totalJump = 0;

    for (let i = 0; i < this.refThreading.length; i++) {
      const thread = this.refThreading[i];
      if (thread.next >= 0) {
        withThreads++;
        const jump = thread.next - i;
        maxJump = Math.max(maxJump, jump);
        totalJump += jump;
      } else {
        withoutThreads++;
      }
    }

    const avgJump = withThreads > 0 ? totalJump / withThreads : 0;
    const threadingRate = this.refThreading.length > 0
      ? withThreads / this.refThreading.length
      : 0;

    return {
      totalPoints: this.refThreading.length,
      withThreads,
      withoutThreads,
      threadingRate,
      maxJump,
      avgJump,
      epsilon3: this.epsilon3,
      bucketSize: this.bucketSize
    };
  }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReferenceOrbitThreading };
}

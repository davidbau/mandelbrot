#!/usr/bin/env node

// Standalone ZhuoranBoard implementation with threading support
// This file extracts ZhuoranBoard and dependencies for command-line testing

// Shared reference orbit threading utility
const { ReferenceOrbitThreading } = require('./reference-threading.js');

// =============================================================================
// Quad-double precision math functions
// =============================================================================

function toQd(x) {
  return Array.isArray(x) ? x : [x, 0];
}

function Afast2Sum(r, i, a, b) {
  let s = a + b;
  r[i] = s;
  r[i+1] = b - (s - a);
}

function Aslow2Sum(r, i, a, b) {
  let s = a + b;
  let c = s - a;
  r[i] = s;
  r[i+1] = (a - (s - c)) + (b - c);
}

function AqdSplit(r, i, a) {
  const c = (134217729) * a;  // 2^27 + 1, Veltkamp-Dekker constant
  const x = c - (c - a);
  const y = a - x;
  r[i] = x;
  r[i+1] = y;
}

function AtwoProduct(r, i, a, b) {
  const p = a * b;
  AqdSplit(r, i, a);
  const ah = r[i];
  const al = r[i+1];
  AqdSplit(r, i, b);
  const bh = r[i];
  const bl = r[i+1];
  const err = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  r[i] = p;
  r[i+1] = err;
}

function AtwoSquare(r, i, a) {
  const p = a * a;
  AqdSplit(r, i, a);
  const ah = r[i];
  const al = r[i+1];
  const err = ((ah * ah - p) + 2 * ah * al) + al * al;
  r[i] = p;
  r[i+1] = err;
}

function AqdAdd(r, i, a1, a2, b1, b2) {
  Aslow2Sum(r, i, a1, b1);
  const h1 = r[i];
  const h2 = r[i+1];
  Aslow2Sum(r, i, a2, b2);
  const l1 = r[i];
  const l2 = r[i+1];
  Afast2Sum(r, i, h1, h2 + l1);
  const v1 = r[i];
  const v2 = r[i+1];
  Afast2Sum(r, i, v1, v2 + l2);
}

function AqdMul(r, i, a1, a2, b1, b2) {
  AtwoProduct(r, i, a1, b1);
  const p1 = r[i];
  const p2 = r[i+1];
  Afast2Sum(r, i, p1, p2 + a1 * b2 + b1 * a2);
}

function AqdSet(r, i, a1, a2) {
  r[i] = a1;
  r[i+1] = a2;
}

function AqdSquare(r, i, a1, a2) {
  AtwoSquare(r, i, a1);
  const p1 = r[i];
  const p2 = r[i+1];
  Afast2Sum(r, i, p1, p2 + 2 * a1 * a2);
}

// =============================================================================
// Period detection function
// =============================================================================

function figurePeriod(iteration) {
  // Returns 1 plus the number of iterations since the most recent multiple
  // of a high power-of-two-exceeding-3/4-digits-of(iteration).
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

// =============================================================================
// Minimal Board base class
// =============================================================================

class Board {
  constructor(k, size, re, im, config, id) {
    this.k = k;
    this.sizes = [size, toQd(re), toQd(im)];
    this.id = id;
    this.config = config;

    this.it = 1;
    this.un = config.dims2;
    this.di = 0;
    this.ch = 0;
    this.effort = 1;

    this.pix = this.sizes[0] / this.config.dims;
    this.epsilon = Math.min(1e-12, this.pix / 10);
    this.epsilon2 = Math.min(1e-9, this.pix * 10);

    this.lastTime = 0;
    this.changeList = [];
    this.updateSize = 0;

    this.nn = new Array(this.config.dims2).fill(0);
    this.pp = new Array(this.config.dims2).fill(0);
    this.cc = [];
    this.zz = [];
    this.bb = [];
    this.hasCheckpoint = new Array(this.config.dims2).fill(false);
    this.checkpointIter = new Array(this.config.dims2).fill(0);
  }

  inspike(re, im) {
    return (im == 0.0 && re > -2.0 && re < -1.401155 &&
            this.config.exponent == 2);
  }

  queueChanges(changes) {
    if (changes !== null) {
      this.changeList.push(changes);
      this.updateSize += changes.nn.length + changes.vv.length;
    }
  }

  unfinished() {
    return this.un;
  }
}

// =============================================================================
// ZhuoranBoard with threading support
// =============================================================================

class ZhuoranBoard extends Board {
  constructor(k, size, re, im, config, id) {
    super(k, size, re, im, config, id);
    // Reference orbit data (quad-double precision)
    this.maxRefIterations = 10000;
    this.refOrbit = [];
    this.refOrbitEscaped = false;
    this.refIterations = 0;

    // Reference point (center of image)
    const refRe = toQd(re);
    const refIm = toQd(im);
    this.refC = [refRe[0], refRe[1], refIm[0], refIm[1]];

    // Per-pixel data
    this.dc = [];
    this.dz = [];
    this.refIter = [];
    this.pixelIndexes = [];
    this.maxRefIter = 1;

    // Working array for quad-double operations
    this.tt = new Array(16);

    // Threading utility for robust cycle detection
    this.threading = new ReferenceOrbitThreading(this.epsilon);

    // Initialize reference orbit with z = 0 and z = c
    this.refOrbit.push([0, 0, 0, 0]);  // Iteration 0: z = 0
    this.refOrbit.push(this.refC.slice());  // Iteration 1: z = 0^2 + c = c
    this.refIterations = 1;

    // Initialize threading data (no thread for first two points)
    this.threading.refThreading.push({next: -1, deltaRe: 0, deltaIm: 0});  // Iteration 0
    this.threading.refThreading.push({next: -1, deltaRe: 0, deltaIm: 0});  // Iteration 1

    this.initPixels(size, re, im);
    this.effort = 2;
  }

  extendReferenceOrbit() {
    // Compute one more iteration of the reference orbit in quad-double precision
    const lastIndex = this.refIterations;
    const last = this.refOrbit[lastIndex];
    const tt = this.tt;

    const r1 = last[0];
    const r2 = last[1];
    const j1 = last[2];
    const j2 = last[3];

    // Check for escape
    AqdSquare(tt, 0, r1, r2);                    // rsq = r**2
    AqdSquare(tt, 2, j1, j2);                    // jsq = j**2
    AqdAdd(tt, 4, tt[0], tt[1], tt[2], tt[3]);   // d = rsq + jsq

    if (tt[4] > 1e10) {
      this.refOrbitEscaped = true;
      return;
    }

    // Compute z^n for general exponent
    AqdMul(tt, 6, 2 * r1, 2 * r2, j1, j2);       // ja = 2*r*j
    AqdAdd(tt, 8, tt[0], tt[1], -tt[2], -tt[3]); // ra = rsq - jsq

    for (let ord = 2; ord < this.config.exponent; ord++) {
      AqdMul(tt, 0, j1, j2, tt[6], tt[7]);         // j * ja
      AqdMul(tt, 2, r1, r2, tt[8], tt[9]);         // r * ra
      AqdAdd(tt, 4, -tt[0], -tt[1], tt[2], tt[3]); // rt = r*ra - j*ja
      AqdMul(tt, 0, r1, r2, tt[6], tt[7]);         // r * ja
      AqdMul(tt, 2, j1, j2, tt[8], tt[9]);         // j * ra
      AqdAdd(tt, 6, tt[0], tt[1], tt[2], tt[3]);   // ja = r*ja + j*ra
      AqdSet(tt, 8, tt[4], tt[5]);                 // ra = rt
    }

    // Add c to get next z
    const newZ = [0, 0, 0, 0];
    AqdAdd(newZ, 0, tt[8], tt[9], this.refC[0], this.refC[1]);      // real part
    AqdAdd(newZ, 2, tt[6], tt[7], this.refC[2], this.refC[3]);      // imag part

    this.refOrbit.push(newZ);
    this.refIterations++;

    // THREADING: Add new point using shared threading utility
    const re = newZ[0] + newZ[1];
    const im = newZ[2] + newZ[3];
    const currentIndex = this.refIterations;

    // Helper function to get orbit point coordinates
    const getPoint = (index) => {
      if (index < 0 || index >= this.refOrbit.length) return null;
      const p = this.refOrbit[index];
      return { re: p[0] + p[1], im: p[2] + p[3] };
    };

    this.threading.addOrbitPoint(currentIndex, re, im, getPoint);

    // Grow array if needed
    if (this.refIterations >= this.maxRefIterations) {
      this.maxRefIterations *= 2;
    }
  }

  initPixels(size, re, im) {
    const pix = size / this.config.dims;
    const dims = this.config.dims;
    const refRe = this.refC[0] + this.refC[1];
    const refIm = this.refC[2] + this.refC[3];
    const re_double = Array.isArray(re) ? (re[0] + re[1]) : re;
    const im_double = Array.isArray(im) ? (im[0] + im[1]) : im;

    for (let y = 0; y < dims; y++) {
      const yFrac = (0.5 - y / dims);
      const ci = im_double + yFrac * size;
      const dci = ci - refIm;
      for (let x = 0; x < dims; x++) {
        const xFrac = (x / dims - 0.5);
        const cr = re_double + xFrac * size;
        const dcr = cr - refRe;
        const index = y * dims + x;
        this.dc[index * 2] = dcr;
        this.dc[index * 2 + 1] = dci;
        this.dz[index * 2] = dcr;
        this.dz[index * 2 + 1] = dci;
        this.refIter[index] = 1;
        this.pixelIndexes.push(index);
        if (this.inspike(cr, ci)) {
          this.ch += 1;
        }
      }
    }
  }

  iterate() {
    let changes = null;
    // Extend reference orbit if needed
    const targetRefIterations = Math.max(this.it + 100, this.maxRefIter + 100);
    while (!this.refOrbitEscaped && this.refIterations < targetRefIterations) {
      this.extendReferenceOrbit();
    }

    // Iterate all active pixels
    const newPixelIndexes = [];
    for (const index of this.pixelIndexes) {
      if (this.nn[index]) continue;
      const result = this.iteratePixel(index);
      if (result !== 0) {
        if (!changes) {
          changes = { iter: this.it, nn: [], vv: [] };
        }
        if (result > 0) {
          changes.nn.push(index);
          this.nn[index] = this.it;
          this.di += 1;
          this.un -= 1;
        } else {
          const index2 = index * 2;
          const nextRefIter = this.refIter[index] + 1;
          const ref = nextRefIter < this.refOrbit.length ? this.refOrbit[nextRefIter] : this.refOrbit[this.refOrbit.length - 1];
          const refR = ref ? (ref[0] + ref[1]) : 0;
          const refI = ref ? (ref[2] + ref[3]) : 0;
          changes.vv.push({
            index: index,
            z: [refR + this.dz[index2], refI + this.dz[index2 + 1]],
            p: this.pp[index]
          });
          this.nn[index] = -this.it;
          this.un -= 1;
          if (this.inspike(
            this.dc[index2] + this.refC[0] + this.refC[1],
            this.dc[index2 + 1] + this.refC[2] + this.refC[3]
          ) && this.ch > 0) {
            this.ch -= 1;
          }
        }
      } else {
        newPixelIndexes.push(index);
      }
    }
    this.pixelIndexes = newPixelIndexes;

    if (this.pixelIndexes.length > this.un * 1.25) {
      this.pixelIndexes = this.pixelIndexes.filter(i => !this.nn[i]);
    }
    this.it++;
    this.queueChanges(changes);
  }

  shouldRebase(index) {
    const index2 = index * 2;
    const dr = this.dz[index2];
    const di = this.dz[index2 + 1];
    const refIter = this.refIter[index];

    if (refIter === 0) return false;
    if (refIter >= this.refOrbit.length || !this.refOrbit[refIter]) return false;

    const ref = this.refOrbit[refIter];
    const refR = ref[0] + ref[1];
    const refI = ref[2] + ref[3];

    const dzNorm = Math.max(Math.abs(dr), Math.abs(di));
    const totalR = refR + dr;
    const totalI = refI + di;
    const totalNorm = Math.max(Math.abs(totalR), Math.abs(totalI));

    return totalNorm < dzNorm * 2.0;
  }

  iteratePixel(index) {
    const index2 = index * 2;
    let refIter = this.refIter[index];

    if (refIter >= this.refOrbit.length) {
      if (this.refOrbitEscaped) {
        const lastRef = this.refOrbit[this.refOrbit.length - 1];
        const lastRefR = lastRef[0] + lastRef[1];
        const lastRefI = lastRef[2] + lastRef[3];
        const dr = this.dz[index2];
        const di = this.dz[index2 + 1];
        this.dz[index2] = Math.fround(lastRefR + dr);
        this.dz[index2 + 1] = Math.fround(lastRefI + di);
        this.refIter[index] = 0;
        refIter = 0;
      } else {
        return 1;
      }
    }

    if (this.shouldRebase(index)) {
      const ref = this.refOrbit[refIter];
      const refR = ref[0] + ref[1];
      const refI = ref[2] + ref[3];
      const dr = this.dz[index2];
      const di = this.dz[index2 + 1];
      this.dz[index2] = Math.fround(refR + dr);
      this.dz[index2 + 1] = Math.fround(refI + di);
      this.refIter[index] = 0;
      refIter = 0;
    }

    const ref = this.refOrbit[refIter];
    if (!ref) return 0;

    const refR = ref[0] + ref[1];
    const refI = ref[2] + ref[3];
    const dr = this.dz[index2];
    const di = this.dz[index2 + 1];

    // Perturbation iteration
    const dzSqR = Math.fround(Math.fround(dr * dr) - Math.fround(di * di));
    const dzSqI = Math.fround(2 * Math.fround(dr * di));
    const twoZrefDzR = Math.fround(2 * Math.fround(Math.fround(dr * refR) - Math.fround(di * refI)));
    const twoZrefDzI = Math.fround(2 * Math.fround(Math.fround(dr * refI) + Math.fround(di * refR)));
    const newDr = Math.fround(Math.fround(twoZrefDzR + dzSqR) + this.dc[index2]);
    const newDi = Math.fround(Math.fround(twoZrefDzI + dzSqI) + this.dc[index2 + 1]);

    this.dz[index2] = newDr;
    this.dz[index2 + 1] = newDi;

    // Check divergence
    const nextRefIter = refIter + 1;
    if (nextRefIter >= this.refOrbit.length) return 1;

    const nextRef = this.refOrbit[nextRefIter];
    const nextRefR = nextRef[0] + nextRef[1];
    const nextRefI = nextRef[2] + nextRef[3];
    const totalR = nextRefR + newDr;
    const totalI = nextRefI + newDi;
    const totalMag2 = totalR * totalR + totalI * totalI;

    if (totalMag2 > 4) {
      return 1;  // Diverged
    }

    // CONVERGENCE DETECTION using threading
    const justUpdatedCheckpoint = (figurePeriod(this.it) == 1);
    if (justUpdatedCheckpoint) {
      this.bb[index2] = Math.fround(dr);
      this.bb[index2 + 1] = Math.fround(di);
      this.hasCheckpoint[index] = true;
      this.checkpointIter[index] = refIter;
      this.pp[index] = 0;
    }

    // CONVERGENCE CHECK: Use thread-following to detect cycles
    if (this.hasCheckpoint[index] && !justUpdatedCheckpoint) {
      const checkpoint_dr = this.bb[index2];
      const checkpoint_di = this.bb[index2 + 1];
      const checkpointRefIter = this.checkpointIter[index];

      // Method 1: Direct refIter match (fast path for non-rebased pixels)
      if (refIter === checkpointRefIter) {
        const dzDiffR = Math.fround(Math.fround(dr) - Math.fround(checkpoint_dr));
        const dzDiffI = Math.fround(Math.fround(di) - Math.fround(checkpoint_di));
        const db = Math.max(Math.abs(dzDiffR), Math.abs(dzDiffI));

        if (db <= this.epsilon2) {
          if (!this.pp[index]) {
            this.pp[index] = this.it;
          }
          if (db <= this.epsilon) {
            return -1;  // Converged
          }
        }
      }

      // Method 2: Thread-following (for pixels that have rebased)
      // Follow threads from checkpoint to see if we can reach current refIter
      if (!this.DISABLE_THREADING_FOR_TEST && checkpointRefIter < this.threading.refThreading.length) {
        let current = checkpointRefIter;
        let deltaRe = 0;
        let deltaIm = 0;
        const maxSteps = Math.floor(Math.sqrt(this.threading.threadingWindowSize));  // sqrt(k)
        let steps = 0;

        // Follow threads forward from checkpoint
        while (steps < maxSteps && current >= 0 && current < this.threading.refThreading.length) {
          const thread = this.threading.refThreading[current];
          if (thread.next < 0) break;  // No more threads

          // Accumulate delta
          deltaRe = Math.fround(deltaRe + thread.deltaRe);
          deltaIm = Math.fround(deltaIm + thread.deltaIm);
          current = thread.next;
          steps++;

          // Check if we're close to current refIter
          if (Math.abs(current - refIter) <= 10) {  // Within 10 iterations
            // Compute total difference: thread_delta + (current_dz - checkpoint_dz)
            const dzDiffR = Math.fround(Math.fround(dr) - Math.fround(checkpoint_dr));
            const dzDiffI = Math.fround(Math.fround(di) - Math.fround(checkpoint_di));
            const totalDiffR = Math.fround(deltaRe + dzDiffR);
            const totalDiffI = Math.fround(deltaIm + dzDiffI);
            const db = Math.max(Math.abs(totalDiffR), Math.abs(totalDiffI));

            if (db <= this.epsilon2) {
              if (!this.pp[index]) {
                this.pp[index] = this.it;
              }
              if (db <= this.epsilon) {
                return -1;  // Converged via threading!
              }
            }
            break;  // Don't keep checking further threads
          }
        }
      }
    }

    this.refIter[index]++;
    if (this.refIter[index] > this.maxRefIter) {
      this.maxRefIter = this.refIter[index];
    }
    return 0;
  }
}

// =============================================================================
// Export for testing
// =============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ZhuoranBoard, figurePeriod };
}

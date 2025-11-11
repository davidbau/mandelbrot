#!/usr/bin/env node

// Node.js test script for Mandelbrot convergence detection
// Extracts code from index.html to test CpuBoard and ZhuoranBoard

//////////// quad-precision (qd, double double) utilities ///////////

function toQd(x) {
  return Array.isArray(x) ? x : [x, 0];
}

function toQdc(c) {
  if (c.length == 4) { return c; }
  const r = toQd(c[0]);
  const j = toQd(c[1]);
  return [r[0], r[1], j[0], j[1]];
}

function fast2Sum(a, b) {
  let s = a + b;
  let t = b - (s - a);
  return [s, t];
}

function slow2Sum(a, b) {
  let s = a + b;
  let c = s - a;
  return [s, (a - (s - c)) + (b - c)];
}

function qdSplit(a) {
  const c = (134217729) * a;  // 2^27 + 1, Veltkamp-Dekker constant
  const x = c - (c - a);
  const y = a - x;
  return [x, y];
}

function twoProduct(a, b) {
  let p = a * b;
  let [ah, al] = qdSplit(a);
  let [bh, bl] = qdSplit(b);
  let err = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return [p, err];
}

function twoSquare(a) {
  let p = a * a;
  let [ah, al] = qdSplit(a);
  let err = ((ah * ah - p) + 2 * ah * al) + al * al;
  return [p, err];
}

function qdAdd(a, b) {
  let [a1, a0] = a;
  let [b1, b0] = b;
  let [h1, h2] = slow2Sum(a1, b1);
  let [l1, l2] = slow2Sum(a0, b0);
  let [v1, v2] = fast2Sum(h1, h2 + l1);
  return fast2Sum(v1, v2 + l2);
}

function qdMul(a, b) {
  let [a1, a0] = a;
  let [b1, b0] = b;
  let [p1, p2] = twoProduct(a1, b1);
  return fast2Sum(p1, p2 + a1 * b0 + b1 * a0);
}

function qdDouble(a) {
  return [a[0] * 2, a[1] * 2];
}

function qdScale(q, s) {
  let [q1, q0] = q;
  let [p1, p2] = twoProduct(q1, s);
  return fast2Sum(p1, p2 + s * q0);
}

function qdSquare(a) {
  let [a1, a0] = a;
  let [p1, p2] = twoSquare(a1);
  return fast2Sum(p1, p2 + 2 * a1 * a0);
}

// Array in-place quad precision, allows fast computation
// by avoiding array constructors

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

// Additional shared utility function for tracking cycles.

function figurePeriod(iteration) {
  // Returns 1 plus the number of iterations since the most recent multiple
  // of a high power-of-two-exceeding-3/4-digits-of(iteration).
  let tail = 1;
  if (iteration) while (Math.pow(Math.floor(iteration / tail), 3) > tail) { tail *= 2; }
  return iteration - (Math.floor(iteration / tail) * tail) + 1
}

//////////// Board Classes ///////////

class Board {
  constructor(k, size, re, im, config, id) {
    this.k = k;    // Number in explorer
    this.sizes = [size, toQd(re), toQd(im)];
    this.id = id;  // Random ID
    this.config = config;  // Global config

    this.it = 1;            // Current iteration
    this.un = config.dims * config.dims; // Unfinished pixels
    this.di = 0;            // Diverged pixels
    this.ch = 0;            // Chaotic pixels
    this.effort = 1;        // Work-per pixel

    this.pix = this.sizes[0] / this.config.dims;
    this.epsilon = Math.min(1e-12, this.pix / 10);
    this.epsilon2 = Math.min(1e-9, this.pix * 10);

    this.lastTime = 0;      // Time last message sent out
    this.changeList = [];   // List of new data to send
    this.updateSize = 0;    // Amount of data to send

    // Initialize arrays
    this.nn = new Array(config.dims * config.dims).fill(0);
    this.pp = new Array(config.dims * config.dims).fill(0);
    this.cc = [];
    this.zz = [];
    this.bb = [];
    this.hasCheckpoint = new Array(config.dims * config.dims).fill(false);  // Track if bb checkpoint is valid
    this.checkpointIter = new Array(config.dims * config.dims).fill(0);  // Iteration when checkpoint was saved
  }

  queueChanges(changes) {
    if (changes !== null) {
      this.changeList.push(changes);
      this.updateSize += changes.nn.length + changes.vv.length;
    }
  }

  inspike(re, im) {
    // We do not iterate infinitely for chaotic points in the spike.
    return (im == 0.0 && re > -2.0 && re < -1.401155 &&
            this.config.exponent == 2);
  }

  inspikeQdA(re1, re2, im1, im2) {
    // We do not iterate infinitely for chaotic points in the spike.
    return (im1 + im2 == 0.0 && re1 >= -2.0 && re1 < -1.401155 &&
            this.config.exponent == 2);
  }

  unfinished() {
    // Chaotic points in the spike counted as finished after 100000 iterations.
    const result = Math.max(0, this.un + (this.it < 100000 ? 0 : -this.ch));
    return result;
  }
}

class CpuBoard extends Board {
  constructor(k, size, re, im, config, id) {
    super(k, size, re, im, config, id);

    // Convert re and im to quad-double if they're scalars
    if (typeof re === 'number') re = toQd(re);
    if (typeof im === 'number') im = toQd(im);

    // Initialize board
    for (let y = 0; y < this.config.dims; y++) {
      const jFrac = (0.5 - (y / this.config.dims));
      const j = jFrac * size + im[0];
      for (let x = 0; x < this.config.dims; x++) {
        const rFrac = ((x / this.config.dims) - 0.5);
        const r = rFrac * size + re[0];
        this.cc.push(r, j);
        if (this.inspike(r, j)) {
          this.ch += 1;
        }
      }
    }

    this.zz = this.cc.slice();
    this.bb = this.cc.slice();
    this.ss = Array(config.dims * config.dims).fill(null).map((_, i) => i);
  }

  iterate() {
    let changes = null;

    const results = [0, 0, 0];
    let s = this.ss;    // speedy list of indexes to compute
    // head and tail factor i into an odd num and largest power of 2.
    if (figurePeriod(this.it) == 1) {
      for (let t = 0; t < s.length; ++t) {
        let m = s[t];
        if (this.nn[m]) continue;
        this.bb[m * 2] = this.zz[m * 2];
        this.bb[m * 2 + 1] = this.zz[m * 2 + 1];
        this.pp[m] = 0;

      }
    }
    for (let t = 0; t < s.length; ++t) {
      const index = s[t];
      const computeResult = this.compute(index);
      if (computeResult !== 0) {
        if (!changes) {
          changes = { iter: this.it, nn: [], vv: [] };
        }
        if (computeResult < 0) {
          changes.vv.push({
            index: index,
            z: [this.zz[index * 2], this.zz[index * 2 + 1]],
            p: this.pp[index]
          });
        } else {
          changes.nn.push(index);
        }
      }
    }
    if (changes) {
      this.un -= changes.nn.length + changes.vv.length; // newly finished
      this.di += changes.nn.length; // diverged
    }
    if (s.length > this.un * 1.25) {
      this.compact();
    }

    this.it++;
    this.queueChanges(changes);
  }

  compact() {
    this.ss = this.ss.filter(i => !this.nn[i]);
  }

  compute(m) {
    if (this.nn[m]) return 0;
    const m2 = m * 2;
    const m2i = m2 + 1;
    const r = this.zz[m2];
    const j = this.zz[m2i];
    const r2 = r * r;
    const j2 = j * j;
    if (r2 + j2 > 4.0) {
      this.nn[m] = this.it;
      return 1;
    }
    let ra = r2 - j2;
    let ja = 2 * r * j;
    for (let ord = 2; ord < this.config.exponent; ord++) {
      let rt = r * ra - j * ja;
      ja = r * ja + j * ra;
      ra = rt;
    }
    ra += this.cc[m2];
    ja += this.cc[m2i];
    this.zz[m2] = ra;
    this.zz[m2i] = ja;
    const rb = this.bb[m2];
    const jb = this.bb[m2i];
    const db = Math.abs(rb - ra) + Math.abs(jb - ja);
    if (db <= this.epsilon2) {
      if (!this.pp[m]) { this.pp[m] = this.it; }
      if (db <= this.epsilon) {
        this.nn[m] = -this.it;
        if (this.inspike(this.cc[m2], this.cc[m2i]) && this.ch > 0) {
          this.ch -= 1;
        }
        return -1;
      }
    }
    return 0;
  }
}

class ZhuoranBoard extends Board {
  constructor(k, size, re, im, config, id) {
    super(k, size, re, im, config, id);

    // Reference orbit data (quad-double precision)
    this.maxRefIterations = 10000;  // Will grow dynamically
    this.refOrbit = [];  // Array of [r_high, r_low, i_high, i_low] for each iteration
    this.refOrbitEscaped = false;
    this.refIterations = 0;  // Current length of reference orbit

    // Reference point (center of image)
    const refRe = toQd(re);
    const refIm = toQd(im);
    this.refC = [refRe[0], refRe[1], refIm[0], refIm[1]];

    // CHECKPOINT INFRASTRUCTURE for convergence detection
    // Save reference orbit at power-of-2 iterations (1, 2, 4, 8, 16...)
    this.refCheckpoints = new Map();  // ref_iter -> [r_hi, r_lo, i_hi, i_lo]

    // Per-pixel checkpoint data
    const dims2 = config.dims * config.dims;
    this.checkpointRefIter = new Uint32Array(dims2).fill(0);  // Last checkpoint ref_iter
    this.checkpointDz = new Float64Array(dims2 * 2).fill(0);  // dz at checkpoint

    // Per-pixel data (double precision)
    this.dc = [];  // Delta c from reference point [real, imag] pairs
    this.dz = [];  // Current perturbation delta [real, imag] pairs
    this.refIter = [];  // Which iteration of reference each pixel is following
    this.pixelIndexes = [];  // Active pixel indices
    this.maxRefIter = 1;  // Track maximum refIter to avoid scanning all pixels

    // Working array for quad-double operations
    this.tt = new Array(16);

    // Initialize reference orbit with z = 0 and z = c
    this.refOrbit.push([0, 0, 0, 0]);  // Iteration 0: z = 0
    this.refOrbit.push(this.refC.slice());  // Iteration 1: z = 0^2 + c = c
    this.refIterations = 1;  // We have computed 1 iteration beyond z=0

    // Save first checkpoint at iteration 1
    this.refCheckpoints.set(1, this.refC.slice());

    this.initPixels(size, re, im);
    this.effort = 2;  // Slightly lower than PerturbationBoard since simpler
  }

  initPixels(size, re, im) {
    const pix = size / this.config.dims;
    const dims = this.config.dims;
    const refRe = this.refC[0] + this.refC[1];
    const refIm = this.refC[2] + this.refC[3];

    // BUG FIX: re and im might be quad-double arrays, convert to regular doubles
    const re_double = Array.isArray(re) ? (re[0] + re[1]) : re;
    const im_double = Array.isArray(im) ? (im[0] + im[1]) : im;

    // Initialize all pixels as perturbations from the reference point
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
        // CpuBoard starts with z = c (skipping the trivial first iteration where 0^2+c=c)
        // So we start at refIter=1 where refOrbit[1] = c_ref
        // With dz = dc, we get: z = c_ref + dc = c (correct!)
        this.dz[index * 2] = dcr;
        this.dz[index * 2 + 1] = dci;
        this.refIter[index] = 1;  // Start at iteration 1 (z = c)
        this.pixelIndexes.push(index);

        // Check for spike
        if (this.inspike(cr, ci)) {
          this.ch += 1;
        }
      }
    }
  }

  findNearPeriodicCheckpoints() {
    // Find all checkpoints where the reference orbit is near-periodic
    // Compare current reference position to all saved checkpoints in quad-double precision
    // Returns array of checkpoint ref_iters where orbit is near-periodic

    const nearPeriodicCheckpoints = [];
    const currentRefIter = this.refIterations;

    if (currentRefIter >= this.refOrbit.length) {
      return nearPeriodicCheckpoints;
    }

    const currentRef = this.refOrbit[currentRefIter];
    const currentR1 = currentRef[0];
    const currentR2 = currentRef[1];
    const currentI1 = currentRef[2];
    const currentI2 = currentRef[3];

    // Epsilon for near-periodic detection in quad-double precision
    // Much tighter than pixel epsilon since we're in high precision
    // But not so tight that we miss actual near-periodicity
    const nearPeriodicEpsilon = 1e-15;  // Relaxed from 1e-25 for testing

    // Check all saved checkpoints
    for (const [checkpointRefIter, checkpointRef] of this.refCheckpoints.entries()) {
      // Don't compare with current iteration
      if (checkpointRefIter >= currentRefIter) {
        continue;
      }

      const checkR1 = checkpointRef[0];
      const checkR2 = checkpointRef[1];
      const checkI1 = checkpointRef[2];
      const checkI2 = checkpointRef[3];

      // Compute delta in quad-double precision
      const tt = this.tt;
      AqdAdd(tt, 0, currentR1, currentR2, -checkR1, -checkR2);  // delta_r
      AqdAdd(tt, 2, currentI1, currentI2, -checkI1, -checkI2);  // delta_i

      // Compute magnitude using Chebyshev norm (max of absolute values)
      const deltaR = Math.abs(tt[0] + tt[1]);
      const deltaI = Math.abs(tt[2] + tt[3]);
      const deltaMag = Math.max(deltaR, deltaI);

      if (deltaMag < nearPeriodicEpsilon) {
        nearPeriodicCheckpoints.push(checkpointRefIter);
      }
    }

    return nearPeriodicCheckpoints;
  }

  iterate() {
    let changes = null;

    // Step 1: Extend reference orbit if needed and not escaped
    // Use cached maxRefIter to avoid scanning all pixels every iteration
    const targetRefIterations = Math.max(this.it + 100, this.maxRefIter + 100);

    while (!this.refOrbitEscaped && this.refIterations < targetRefIterations) {
      this.extendReferenceOrbit();
    }

    // Step 2: Find near-periodic checkpoints for convergence detection
    const nearPeriodicCheckpoints = this.findNearPeriodicCheckpoints();

    // Step 3: Iterate all active pixels using perturbation
    const newPixelIndexes = [];
    for (const index of this.pixelIndexes) {
      if (this.nn[index]) continue;  // Skip finished pixels

      const result = this.iteratePixel(index, nearPeriodicCheckpoints);

      if (result !== 0) {
        if (!changes) {
          changes = { iter: this.it, nn: [], vv: [] };
        }

        if (result > 0) {
          // Diverged
          changes.nn.push(index);
          this.nn[index] = this.it;
          this.di += 1;
          this.un -= 1;
        } else {
          // Converged
          const index2 = index * 2;
          // Report the CURRENT z position after the iteration
          // Note: refIter was NOT incremented (returned before increment)
          // newDz corresponds to refIter+1
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

    // Compact if needed
    if (this.pixelIndexes.length > this.un * 1.25) {
      this.pixelIndexes = this.pixelIndexes.filter(i => !this.nn[i]);
    }

    this.it++;
    this.queueChanges(changes);
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

    // tt[4] is the high part of the magnitude squared (tt[5] is just the low correction)
    // Use very large escape radius for reference orbit to support all pixel iterations
    // Reference must stay valid longer than any pixel, so use much larger threshold
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

    // Save checkpoint at power-of-2 iterations
    const ref_iter = this.refIterations;
    if (ref_iter > 0 && (ref_iter & (ref_iter - 1)) === 0) {
      // ref_iter is a power of 2
      this.refCheckpoints.set(ref_iter, newZ.slice());
    }

    // Grow array if needed
    if (this.refIterations >= this.maxRefIterations) {
      this.maxRefIterations *= 2;
    }
  }

  iteratePixel(index, nearPeriodicCheckpoints) {
    const index2 = index * 2;
    let refIter = this.refIter[index];

    // Ensure reference orbit exists for this iteration
    if (refIter >= this.refOrbit.length) {
      // Need more reference orbit iterations
      if (this.refOrbitEscaped) {

        // Reference has escaped, can't extend further
        // Imagina's approach: Rebase to beginning of reference orbit
        // This allows continued use of perturbation theory

        // Get current z value
        const lastRef = this.refOrbit[this.refOrbit.length - 1];
        const lastRefR = lastRef[0] + lastRef[1];
        const lastRefI = lastRef[2] + lastRef[3];
        const dr = this.dz[index2];
        const di = this.dz[index2 + 1];

        // Set dz to current total position (Imagina's VecResetAndSync)
        this.dz[index2] = lastRefR + dr;
        this.dz[index2 + 1] = lastRefI + di;

        // Restart from iteration 0 (where z_ref = 0)
        this.refIter[index] = 0;
        refIter = 0;

        // DON'T reset convergence checkpoint - total z is continuous
        // this.hasCheckpoint[index] = false;
        // this.pp[index] = 0;

        // Continue with perturbation iteration from the top
        // (don't return, fall through to normal iteration code below)
      } else {
        // This shouldn't happen with proper reference orbit extension
        console.warn(`Pixel ${index} needs refIter ${refIter} but orbit length is ${this.refOrbit.length}`);
        return 1;  // Mark as diverged only if unexpected
      }
    }

    // Check if we need to rebase (Zhuoran's key innovation)
    if (this.shouldRebase(index)) {
      // Imagina's rebasing: set dz = z_total and restart from refIter = 0
      const ref = this.refOrbit[refIter];
      const refR = ref[0] + ref[1];
      const refI = ref[2] + ref[3];
      const dr = this.dz[index2];
      const di = this.dz[index2 + 1];

      // Set dz to current total position (z_ref + dz)
      this.dz[index2] = refR + dr;
      this.dz[index2 + 1] = refI + di;

      // Restart from iteration 0 (where z_ref = 0)
      this.refIter[index] = 0;
      refIter = 0;

      // DON'T reset convergence checkpoint after rebasing!
      // The checkpoint stores total z position, which is continuous across rebasing
      // (since we set dz = z_total and ref[0] = 0, so z = 0 + dz_total = z_total)
      // this.hasCheckpoint[index] = false;  // KEEP the checkpoint!
      // this.pp[index] = 0;  // KEEP the period tracking!
    }

    // Get reference orbit value for current iteration
    const ref = this.refOrbit[refIter];
    if (!ref) {
      // Safety check - this shouldn't happen with the fix above
      console.error(`Missing reference orbit at iteration ${refIter}`);
      return 0;
    }
    const refR = ref[0] + ref[1];  // Convert quad to double
    const refI = ref[2] + ref[3];

    // Perturbation iteration: dz = 2 * dz * z_ref + dz^2 + dc
    const dr = this.dz[index2];
    const di = this.dz[index2 + 1];

    // Save the OLD z value (before this iteration) for checkpoint timing
    // This matches CpuBoard's behavior where bb is set BEFORE computing the new z
    const oldZR = refR + dr;
    const oldZI = refI + di;

    // Compute dz^2
    const dzSqR = dr * dr - di * di;
    const dzSqI = 2 * dr * di;

    // Compute 2 * dz * z_ref
    const twoZrefDzR = 2 * (dr * refR - di * refI);
    const twoZrefDzI = 2 * (dr * refI + di * refR);

    // New dz = 2 * dz * z_ref + dz^2 + dc
    const newDr = twoZrefDzR + dzSqR + this.dc[index2];
    const newDi = twoZrefDzI + dzSqI + this.dc[index2 + 1];

    // Update dz first before checking divergence
    this.dz[index2] = newDr;
    this.dz[index2 + 1] = newDi;

    // Now check for divergence with the updated values
    // IMPORTANT: The new z value is refOrbit[refIter+1] + newDz, not refOrbit[refIter] + newDz!
    // We used refOrbit[refIter] to COMPUTE newDz, but the result corresponds to the NEXT reference iteration
    const nextRefIter = refIter + 1;
    if (nextRefIter >= this.refOrbit.length) {
      // This shouldn't happen because we extend the reference orbit beforehand
      console.error(`nextRefIter ${nextRefIter} >= refOrbit.length ${this.refOrbit.length}`);
      return 1;
    }
    const nextRef = this.refOrbit[nextRefIter];
    const nextRefR = nextRef[0] + nextRef[1];
    const nextRefI = nextRef[2] + nextRef[3];

    // Use escape radius 2 (magnitude² > 4)
    const totalR = nextRefR + newDr;
    const totalI = nextRefI + newDi;
    const totalMag2 = totalR * totalR + totalI * totalI;

    if (totalMag2 > 4) {
      return 1;  // Diverged
    }

    // CONVERGENCE DETECTION using figurePeriod checkpoints
    // Like CpuBoard: UPDATE checkpoint when figurePeriod==1, but CHECK every iteration
    // IMPORTANT: Check convergence BEFORE incrementing refIter
    // We already computed nextRefIter above (= refIter + 1)

    // Step 1: Update checkpoint at figurePeriod intervals
    const justUpdatedCheckpoint = (figurePeriod(this.it) == 1);
    if (justUpdatedCheckpoint) {
      // Use the OLD z value (before computing this iteration) to match CpuBoard's timing
      // CpuBoard sets bb at the START of iterate(), before computing the new z
      this.bb[index2] = oldZR;
      this.bb[index2 + 1] = oldZI;
      this.hasCheckpoint[index] = true;
      this.checkpointIter[index] = this.it;  // Record when checkpoint was saved
      this.pp[index] = 0;

    }

    // Step 2: Check convergence EVERY iteration (if we have a checkpoint and didn't just update it)
    if (this.hasCheckpoint[index] && !justUpdatedCheckpoint) {
      // Current z position (we already computed totalR, totalI above)
      const zCurrentR = totalR;
      const zCurrentI = totalI;

      const deltaR = zCurrentR - this.bb[index2];
      const deltaI = zCurrentI - this.bb[index2 + 1];
      const db = Math.abs(deltaR) + Math.abs(deltaI);

      if (db <= this.epsilon2) {
        if (!this.pp[index]) {
          // Record iteration number when first detected, like CpuBoard does
          this.pp[index] = this.it;
        }
        if (db <= this.epsilon) {
          // Return -1 BEFORE incrementing refIter
          return -1;  // Converged
        }
      }
    }

    // Update reference iteration counter (dz was already updated above)
    // This happens AFTER convergence check, so if we converged, we never get here
    this.refIter[index]++;

    // Save per-pixel checkpoint at power-of-2 ref_iter values
    const currentRefIter = this.refIter[index];
    if (currentRefIter > 0 && (currentRefIter & (currentRefIter - 1)) === 0) {
      // currentRefIter is a power of 2 - save checkpoint
      this.checkpointRefIter[index] = currentRefIter;
      this.checkpointDz[index2] = newDr;
      this.checkpointDz[index2 + 1] = newDi;
    }

    // Update cached maximum to avoid scanning all pixels
    if (this.refIter[index] > this.maxRefIter) {
      this.maxRefIter = this.refIter[index];
    }

    return 0;  // Continue iterating
  }

  shouldRebase(index) {
    // Zhuoran's rebasing condition using Chebyshev norm (Imagina's optimization)
    // Rebase when max(|z_total|) < max(|dz|)
    // This detects when we're near the critical point (0 for Mandelbrot)
    const index2 = index * 2;
    const dr = this.dz[index2];
    const di = this.dz[index2 + 1];

    const refIter = this.refIter[index];

    // Don't rebase if we're already at iteration 0 (start of reference orbit)
    if (refIter === 0) {
      return false;
    }

    // Check if reference orbit exists for this iteration
    if (refIter >= this.refOrbit.length || !this.refOrbit[refIter]) {
      return false; // Can't check, don't rebase
    }

    const ref = this.refOrbit[refIter];
    const refR = ref[0] + ref[1];
    const refI = ref[2] + ref[3];

    // Compute Chebyshev norm (L-infinity norm) - cheaper than magnitude squared
    const dzNorm = Math.max(Math.abs(dr), Math.abs(di));
    const totalR = refR + dr;
    const totalI = refI + di;
    const totalNorm = Math.max(Math.abs(totalR), Math.abs(totalI));

    // Rebase when orbit approaches critical point (0)
    // More aggressive threshold: rebase when totalNorm < 2 * dzNorm
    return totalNorm < dzNorm * 2;
  }

  getCurrentRefZ(index) {
    const refIter = this.refIter[index];
    if (refIter <= this.refIterations && this.refOrbit[refIter]) {
      return this.refOrbit[refIter];
    }
    return [0, 0, 0, 0];
  }
}

//////////// Test Driver ///////////

// Only run tests if this file is executed directly
if (require.main === module) {

// Test configuration
const testConfig = {
  c: [-0.24019862, 0.83739891],  // Complex center
  s: 0.00000768,  // Scale
  dims: 64,  // Grid size
  exponent: 2,
  unknownColor: 0,
  colorTheme: 0
};

const maxIterations = 2000;

// Test both boards
console.log('=== Testing CpuBoard ===');
const cpuBoard = new CpuBoard(0, testConfig.s, testConfig.c[0], testConfig.c[1], testConfig, 'test-cpu');
const cpuConverged = testBoard(cpuBoard, 'CpuBoard', maxIterations);

console.log('\n=== Testing ZhuoranBoard ===');
const zhuoranBoard = new ZhuoranBoard(0, testConfig.s, testConfig.c[0], testConfig.c[1], testConfig, 'test-zhuoran');
const zhuoranConverged = testBoard(zhuoranBoard, 'ZhuoranBoard', maxIterations);

// Compare converged positions
console.log('\n=== Comparing Converged Positions ===');
if (cpuConverged.length > 0 && zhuoranConverged.length > 0) {
  // Build maps for quick lookup
  const cpuMap = new Map(cpuConverged.map(c => [c.index, c]));
  const zhuoranMap = new Map(zhuoranConverged.map(c => [c.index, c]));

  // Find common converged pixels
  const commonIndices = cpuConverged.filter(c => zhuoranMap.has(c.index)).map(c => c.index);

  console.log(`Common converged pixels: ${commonIndices.length}`);

  if (commonIndices.length > 0) {
    // Find pixels with period 27 in both boards
    const period27Indices = commonIndices.filter(idx => {
      return cpuMap.get(idx).period === 27 && zhuoranMap.get(idx).period === 27;
    });

    console.log(`Pixels with period 27 in both boards: ${period27Indices.length}`);

    if (period27Indices.length > 0) {
      const samplesToCheck = Math.min(5, period27Indices.length);
      console.log(`\nComparing positions for ${samplesToCheck} period-27 pixels:`);

      for (let i = 0; i < samplesToCheck; i++) {
        const idx = period27Indices[i];
        const cpuPoint = cpuMap.get(idx);
        const zhuoranPoint = zhuoranMap.get(idx);

        const deltaR = Math.abs(cpuPoint.z[0] - zhuoranPoint.z[0]);
        const deltaI = Math.abs(cpuPoint.z[1] - zhuoranPoint.z[1]);
        const delta = Math.sqrt(deltaR * deltaR + deltaI * deltaI);

        console.log(`Pixel ${idx}:`);
        console.log(`  CpuBoard:     z=(${cpuPoint.z[0].toFixed(10)}, ${cpuPoint.z[1].toFixed(10)})`);
        console.log(`  ZhuoranBoard: z=(${zhuoranPoint.z[0].toFixed(10)}, ${zhuoranPoint.z[1].toFixed(10)})`);
        console.log(`  Delta: ${delta.toExponential(3)}`);
      }
    }

    // Compare positions for first few common pixels
    const samplesToCheck = Math.min(5, commonIndices.length);
    console.log(`\nComparing positions for first ${samplesToCheck} common pixels (any period):`);

    for (let i = 0; i < samplesToCheck; i++) {
      const idx = commonIndices[i];
      const cpuPoint = cpuMap.get(idx);
      const zhuoranPoint = zhuoranMap.get(idx);

      const deltaR = Math.abs(cpuPoint.z[0] - zhuoranPoint.z[0]);
      const deltaI = Math.abs(cpuPoint.z[1] - zhuoranPoint.z[1]);
      const delta = Math.sqrt(deltaR * deltaR + deltaI * deltaI);

      // Compute pixel coordinates
      const x = idx % testConfig.dims;
      const y = Math.floor(idx / testConfig.dims);
      const xFrac = (x / testConfig.dims - 0.5);
      const yFrac = (0.5 - y / testConfig.dims);
      const cR = testConfig.c[0] + xFrac * testConfig.s;
      const cI = testConfig.c[1] + yFrac * testConfig.s;

      console.log(`Pixel ${idx} at grid (${x}, ${y}), c=(${cR.toFixed(10)}, ${cI.toFixed(10)}):`);
      console.log(`  CpuBoard:     period=${cpuPoint.period}, z=(${cpuPoint.z[0].toFixed(10)}, ${cpuPoint.z[1].toFixed(10)})`);
      console.log(`    checkpoint: bb=(${cpuBoard.bb[idx*2].toFixed(10)}, ${cpuBoard.bb[idx*2+1].toFixed(10)})`);
      console.log(`  ZhuoranBoard: period=${zhuoranPoint.period}, z=(${zhuoranPoint.z[0].toFixed(10)}, ${zhuoranPoint.z[1].toFixed(10)})`);
      console.log(`    checkpoint: bb=(${zhuoranBoard.bb[idx*2].toFixed(10)}, ${zhuoranBoard.bb[idx*2+1].toFixed(10)})`);
      console.log(`  Delta: ${delta.toExponential(3)}`);
    }
  }
}

function testBoard(board, name, maxIter) {
  for (let i = 0; i < maxIter; i++) {
    board.iterate();

    if (i % 100 === 0) {
      console.log(`${name} iter=${i}: un=${board.un} di=${board.di}`);
    }
  }

  console.log(`\n${name} Final Results:`);
  console.log(`  Total iterations: ${maxIter}`);
  console.log(`  Diverged: ${board.di}`);
  console.log(`  Unfinished: ${board.un}`);
  console.log(`  Converged: ${testConfig.dims * testConfig.dims - board.un - board.di}`);

  // Find converged points and their positions
  const converged = [];
  for (let i = 0; i < board.nn.length; i++) {
    if (board.nn[i] < 0) {
      // Get the converged position from changeList
      let zPos = null;
      for (const changes of board.changeList) {
        if (changes.vv) {
          const match = changes.vv.find(v => v.index === i);
          if (match) {
            zPos = match.z;
            break;
          }
        }
      }
      converged.push({
        index: i,
        iteration: -board.nn[i],
        period: board.pp[i] || 0,
        z: zPos
      });
    }
  }

  if (converged.length > 0) {
    console.log(`\n  Converged points: ${converged.length}`);
    const periodCounts = {};
    converged.forEach(c => {
      periodCounts[c.period] = (periodCounts[c.period] || 0) + 1;
    });
    console.log(`  Periods detected:`, periodCounts);
  } else {
    console.log(`  NO CONVERGENCE DETECTED`);
  }

  return converged;
}

} // end if (require.main === module)

// Export classes for use in other modules
module.exports = { CpuBoard, ZhuoranBoard, Board };

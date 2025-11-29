# Iteration Count Discrepancy Analysis

## Problem
At the point -0.7501512+0.0845409i:
- **CpuBoard**: 38 iterations (correct reference)
- **GpuBoard**: 39 iterations (+1 off)
- **GpuZhuoranBoard**: 37 iterations (-1 off)

## Root Cause Analysis

### CpuBoard (Correct Implementation)
```javascript
// From index.html lines 2719-2758
compute(m) {
  // ... load current z ...
  const r2 = r * r;
  const j2 = j * j;
  if (r2 + j2 > 4.0) {
    this.nn[m] = this.it;  // Record CURRENT iteration
    return 1;  // Diverged
  }
  // Compute NEXT z
  // ...  this.zz[m2] = ra;
  this.zz[m2i] = ja;
  // ...
}

// In iterate() method (line 2711):
this.it++;  // Increment AFTER computing all pixels
```

**Flow:**
1. Check if CURRENT z diverges
2. If diverged, record `this.it` (current iteration number)
3. Otherwise, compute NEXT z
4. After all pixels computed, increment `this.it++`

**Semantics:** Iteration N means "z has been iterated N times from z=c"

### GpuBoard (Off by +1)
```wgsl
// From index.html lines 4014-4053
for (var i = 0u; i < params.iterations_per_batch; i++) {
  iter++;  // ❌ BUG: Increment FIRST
  // ...
  let zr2 = zr * zr;
  let zi2 = zi * zi;
  if (zr2 + zi2 > 4.0) {
    status[index] = 1u;  // Diverged - records INCREMENTED iter
    break;
  }
  // Compute next z
  zr = ra + cr;
  zi = ja + ci;
  // ...
}
```

**Bug:** `iter++` happens BEFORE the divergence check. So when checking z_n, iter has already been incremented to n+1, causing it to record one iteration too many.

**Fix:** Move `iter++` to the END of the loop, after divergence check and z computation.

### GpuZhuoranBoard (Off by -1)
```wgsl
// From index.html lines 4873-5070
for (var batch_iter = 0u; batch_iter < params.iterations_per_batch; batch_iter++) {
  iter++;  // Increment first

  // ... rebasing logic ...

  // Compute NEW dz and z_total
  // (lines 4917-4964)  let next_ref_iter = ref_iter + 1u;
  let z_total_r = next_refr + dzr;  // This is NEW z
  let z_total_i = next_refi + dzi;

  // Check divergence on NEW z (after iteration)
  if (mag_sq > 4.0) {
    statusAndPeriod[index] = vec2<u32>(1u, pp);  // Diverged
    break;
  }

  // ... convergence detection ...

  ref_iter++;  // Increment ref_iter at end
}
```

**Bug:** The shader checks the NEW z (after computing iteration) but never checks the INITIAL z.

**Flow for first iteration:**
1. iter++ (iter = 1)
2. Compute z_1 from z_0
3. Check if z_1 diverges
4. If diverged, record iter = 1

The problem: z_0 (initial z = c) is never checked! If z_0 should diverge at iteration 0, it won't be detected until z_1 is computed and checked, recording iteration 1 instead.

**Fix:** Add an initial divergence check BEFORE the loop starts, or restructure to check CURRENT z before computing NEXT z.

## Recommended Fixes

### Fix for GpuBoard (lines ~4014-4070)
Move `iter++` from the beginning to the end of the loop:

```wgsl
for (var i = 0u; i < params.iterations_per_batch; i++) {
  // Check divergence BEFORE incrementing
  let zr2 = zr * zr;
  let zi2 = zi * zi;
  if (zr2 + zi2 > 4.0) {
    status[index] = 1u;  // Diverged
    break;
  }

  // ... compute next z ...
  zr = ra + cr;
  zi = ja + ci;

  // ... convergence check ...

  iter++;  // ✅ Increment AFTER checks and computation
}
```

### Fix for GpuZhuoranBoard (lines ~4873-5070)
Two options:

**Option A:** Add initial divergence check before loop
```wgsl
// Before the batch loop, check initial z
let init_total_r = refOrbit[ref_iter * 2u] + dzr;
let init_total_i = refOrbit[ref_iter * 2u + 1u] + dzi;
if (init_total_r * init_total_r + init_total_i * init_total_i > 4.0) {
  statusAndPeriod[index] = vec2<u32>(1u, pp);
  iterations[index] = iter;
  return;  // Early exit
}

// Then continue with normal loop
for (var batch_iter = 0u; ...) {
  iter++;
  // ... rest of loop ...
}
```

**Option B:** Restructure to check current z, then compute next
```wgsl
for (var batch_iter = 0u; batch_iter < params.iterations_per_batch; batch_iter++) {
  // Check CURRENT z first (before incrementing iter)
  let curr_offset = ref_iter * 2u;
  let curr_total_r = refOrbit[curr_offset] + dzr;
  let curr_total_i = refOrbit[curr_offset + 1u] + dzi;
  if (curr_total_r * curr_total_r + curr_total_i * curr_total_i > 4.0) {
    statusAndPeriod[index] = vec2<u32>(1u, pp);
    break;
  }

  iter++;  // Increment after check but before computation

  // ... compute next dz ...
  // ... convergence check using OLD dz ...

  ref_iter++;
}
```

Option B is preferred as it maintains consistency with CpuBoard's semantics.

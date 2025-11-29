# Convergence Period Bug Analysis and Fix

## Problem Report
User reported that at location `s=4.9152e-10&c=-0.1649419353259+1.0393473948033i`, pixels in period-304 bulb were reporting incorrect periods (multiples of 304 like 608, 912, etc.) instead of the correct period 304.

## Root Cause

### The Bug
In WebGPUZhuoranBoard's WGSL shader, the `pp` (period) variable was **not persisted across GPU compute batches** when a pixel was in the "getting close" convergence state.

### How Convergence Detection Works
1. When `figurePeriod(iter) == 1`: Update checkpoint with current z position, set `pp = 0`
2. Every iteration: Check if `db` (distance to checkpoint) `<= epsilon2` (getting close threshold)
   - If yes and `pp == 0`: Record `pp = iter` (first time we got close)
   - If yes and `db <= epsilon`: CONVERGED with period `pp`

### The Problem
**CPU ZhuoranBoard (CORRECT):**
```javascript
// pp persists across iterate() calls
if (!this.pp[index]) {
  this.pp[index] = this.it;  // Record when first detected
}
// Next iterate(): this.pp[index] still has the value
```

**GPU WebGPUZhuoranBoard (BUGGY - BEFORE FIX):**
```wgsl
// Load pp at start of batch
var pp = statusAndPeriod[index].y;  // pp=0

// During batch iteration
if (db <= epsilon2) {
  if (pp == 0u) {
    pp = iter;  // Set pp=304
  }
  if (db <= epsilon) {
    // Converged - write pp
    statusAndPeriod[index] = vec2<u32>(2u, pp);
    break;
  }
}
// But if not yet converged, pp is NEVER written back!

// Next batch: Load pp again
var pp = statusAndPeriod[index].y;  // pp=0 again! pp lost!

// Later when actually converges at iter=608
if (db <= epsilon2) {
  if (pp == 0u) {
    pp = 608;  // WRONG! Should still be 304
  }
  // Reports period 608 instead of 304
}
```

## The Fix

At the end of each GPU compute batch, write back `pp` even for pixels that haven't converged yet:

```wgsl
// Write back state - pack into combined buffers
iterations[index] = iter;
dzAndCheckpoint[index] = vec4<f32>(dzr, dzi, bbr, bbi);
refIter[index] = ref_iter;
checkpointIter[index] = checkpoint_iter_val;
// Write back pp even if not converged (so it persists across batches)
if (statusAndPeriod[index].x == 0u) {
  statusAndPeriod[index] = vec2<u32>(0u, pp);
}
```

This ensures that once `pp` is set when we first get close (`db <= epsilon2`), it persists across all subsequent batches until convergence.

## Verification

Command-line testing confirmed:
- ✅ CpuBoard and ZhuoranBoard (CPU) produce identical results
- ✅ The bug was isolated to WebGPUZhuoranBoard (GPU) implementation

The fix makes GPU behavior match CPU behavior by properly persisting the `pp` value across compute passes.

## Impact

This bug caused pixels to report higher period multiples (608, 912, 1216 = 2×304, 3×304, 4×304, etc.) because `pp` kept resetting to the current iteration number instead of remembering when convergence was first detected.

With the fix, periods will now be correctly reported based on when convergence was **first** detected approaching the checkpoint, matching the CPU implementation.

## File Modified
- `index.html` (lines 4373-4376): Added pp persistence for non-converged pixels

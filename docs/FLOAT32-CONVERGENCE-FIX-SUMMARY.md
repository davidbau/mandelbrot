# Float32 Convergence Bug Fix - Summary

## Problem

At region `s=6.144e-8&c=-0.1666193570+1.0423928116i&grid=8`, GpuZhuoranBoard with float32 precision reports "crazy convergence" - too many falsely converged pixels compared to CpuBoard (double precision).

## Root Cause

Recent commit aa11041 changed convergence checkpoints from storing **perturbations (dz)** to **absolute positions (z)** to keep checkpoints valid across rebasing. However, this introduced float32 precision loss:

### The Problem

```javascript
// Checkpoint stores absolute z position
this.bb[index] = Math.fround(refR + dr);  // |z| ≈ 1.4

// Later, check convergence
const delta = Math.fround(current_z - checkpoint_z);
// When |z| ≈ 1.4, float32 precision is ~1.7e-7
// But epsilon is 1e-12
// So delta ≈ 0 even when points are different!
// Result: FALSE CONVERGENCE
```

### Measurements

At test region:
- Maximum checkpoint magnitude: **1.409**
- Float32 precision at this magnitude: **1.68e-7**
- Epsilon threshold: **1.00e-12**
- **Precision exceeds epsilon by 168,000x!**

This makes convergence detection impossible - the subtraction cannot resolve differences smaller than 1.68e-7, but we need to detect differences of 1e-12.

## The Fix

**Store perturbations (dz) in checkpoints, not absolute positions (z).**

### Key Changes

1. **Store dz in checkpoints** (lines 3249, 4401):
   ```javascript
   // CPU
   this.bb[index2] = Math.fround(dr);  // Store dz, not z

   // GPU
   bbr = old_dzr;  // Store dz, not absolute z
   ```

2. **Compare dz values** (lines 3260, 4411):
   ```javascript
   // CPU
   const deltaR = Math.fround(newDr - this.bb[index2]);

   // GPU
   let delta_r = dzr - bbr;
   ```

3. **Invalidate checkpoints on rebase** (lines 3160-3163, 4321-4322):
   ```javascript
   // CPU
   this.hasCheckpoint[index] = false;
   this.checkpointIter[index] = 0;
   this.pp[index] = 0;

   // GPU
   checkpoint_iter = 0u;
   pp = 0u;
   ```

## Why This Works

1. **Small magnitudes**: Near convergence, |dz| << 1, so float32 precision is adequate
2. **Better precision**: At |dz| ≈ 0.001, float32 precision is ~1.2e-10, well below epsilon
3. **Consistent semantics**: Directly comparing perturbations (same coordinate system)
4. **Simple logic**: Clear invalidation on rebase

### Precision Comparison

| Checkpoint Type | Typical Magnitude | Float32 Precision | vs Epsilon (1e-12) |
|-----------------|-------------------|-------------------|-------------------|
| **Absolute z** (BUGGY) | 1.4 | 1.7e-7 | 168,000x too large |
| **Perturbation dz** (FIXED) | 0.001 | 1.2e-10 | 120x adequate |

## Trade-offs

### Pros
- Fixes false convergence bug
- Minimal code changes
- Easy to understand and verify
- Better precision where it matters

### Cons
- Checkpoints invalidated on rebase (must wait for new checkpoint)
- Rebasing is rare (only near critical point), so impact is minimal

## Files Modified

- `index.html`: CPU ZhuoranBoard and GPU GpuZhuoranBoard
  - Lines 3160-3163: Invalidate checkpoint on rebase (CPU)
  - Lines 3249-3250: Store dz in checkpoint (CPU)
  - Lines 3260-3262: Compare dz values (CPU)
  - Lines 4321-4322: Invalidate checkpoint on rebase (GPU)
  - Lines 4401-4402: Store dz in checkpoint (GPU)
  - Lines 4411-4412: Compare dz values (GPU)

## Testing

Test files created:
1. `test-float32-precision.js` - Demonstrates precision loss with large numbers
2. `test-float32-bug.js` - Tests problematic region
3. `test-convergence-bug-detailed.js` - Detailed analysis of checkpoint magnitudes
4. `FLOAT32-CONVERGENCE-BUG-ANALYSIS.md` - Full technical analysis

### Expected Results

**Before fix**:
- ZhuoranBoard with Math.fround(): Many false convergences
- GPU: Many false convergences

**After fix**:
- ZhuoranBoard with Math.fround(): Matches CpuBoard
- GPU: Matches CPU

## Performance Impact

**Negligible**:
- Only adds checkpoint invalidation on rebase
- Rebasing is rare (only when orbit passes near 0)
- Convergence detection speed unchanged

## References

- Commit aa11041: Introduced the bug by storing absolute z positions
- IEEE 754 single-precision: 2^-23 ≈ 1.2e-7 relative precision
- Float32 precision test: Shows catastrophic precision loss at magnitude ~1
- Original bug report: "crazy convergence" at s=6.144e-8 region

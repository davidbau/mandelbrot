# Float32 Convergence Detection Bug Analysis

## Problem Summary

At region `s=6.144e-8&c=-0.1666193570+1.0423928116i&grid=8`, GpuZhuoranBoard (float32) reports too many converged points compared to CpuBoard (double precision). This is "crazy convergence" - false positive convergence detection.

## Root Cause

### The Issue
Current checkpoint-based convergence detection stores **absolute z positions**:
```javascript
// Store checkpoint (absolute position)
this.bb[index2] = Math.fround(refR + dr);  // Total z position
this.bb[index2 + 1] = Math.fround(refI + di);

// Later, check convergence
const deltaR = Math.fround(totalR - this.bb[index2]);
const deltaI = Math.fround(totalI - this.bb[index2 + 1]);
const db = Math.fround(Math.abs(deltaR) + Math.abs(deltaI));
if (db <= epsilon) {
  return -1;  // Converged
}
```

### Why This Fails with Float32

**Problem**: When `|z|` is large (e.g., |z| ≈ 1.4), subtracting two nearby float32 values loses precision:

| Checkpoint magnitude | Float32 precision | Epsilon | Precision vs Epsilon |
|---------------------|-------------------|---------|---------------------|
| 0.1 | 1.2e-8 | 1e-12 | 12,000x |
| 1.0 | 1.2e-7 | 1e-12 | 120,000x |
| 1.4 | 1.7e-7 | 1e-12 | **167,000x** |

At checkpoint magnitude ~1.4:
- Float32 can only distinguish values that differ by ~1.7e-7
- Epsilon threshold is 1e-12
- **The computed delta is always ≈ 0**, even when points are actually different!
- This causes **FALSE CONVERGENCE**

### Demonstration

```javascript
// Simulate checkpoint comparison
const checkpoint = 1.4;
const current = 1.4 + 1e-10;  // Should detect difference

// Double precision (correct)
const delta_double = current - checkpoint;  // = 1e-10 ✓

// Float32 (buggy)
const ckpt_f32 = Math.fround(checkpoint);
const curr_f32 = Math.fround(current);
const delta_f32 = Math.fround(curr_f32 - ckpt_f32);  // = 0 ✗

// Result: delta_f32 = 0 < epsilon, so converged!
```

### Test Results

Test at `c=-0.166619357+1.0423928116i, size=6.144e-8`:
- Maximum checkpoint magnitude: **1.409**
- Float32 precision at this magnitude: **1.68e-7**
- Epsilon threshold: **1.00e-12**
- **Precision exceeds epsilon by 168,000x!**

This means the subtraction `z_current - z_checkpoint` in float32 **cannot resolve differences smaller than 1.68e-7**, but convergence detection requires resolving differences of **1e-12**. Impossible!

## Why This Wasn't a Problem Before

The recent fix (commit aa11041) changed checkpoint storage from **perturbations (dz)** to **absolute positions (z)**:

**Before (dz storage)**:
- Checkpoints stored: `bb = dz` (perturbation from reference)
- Comparison: `delta = current_dz - checkpoint_dz`
- Magnitudes: Small when near convergence (|dz| << 1)
- Float32 precision: Adequate ✓

**After (absolute z storage)**:
- Checkpoints stored: `bb = z_ref + dz` (absolute position)
- Comparison: `delta = current_z - checkpoint_z`
- Magnitudes: Can be large (|z| ≈ 1-2 in many regions)
- Float32 precision: **Inadequate** ✗

The change was made to keep checkpoints valid across rebasing (when reference orbit changes). But it introduced precision loss with float32!

## Proposed Solutions

### Option 1: Store dz in Checkpoints, Invalidate on Rebase (RECOMMENDED)

**Approach**: Revert to storing perturbations (dz), but invalidate checkpoints when rebasing.

**Pros**:
- Small magnitude values → float32 precision adequate
- Minimal code changes
- Simple to understand and verify

**Cons**:
- Need to invalidate checkpoints on rebase
- Slightly slower convergence detection after rebase (must wait for new checkpoint)

**Implementation**:
```wgsl
// Store dz (perturbation), not absolute z
bbr = dzr;
bbi = dzi;

// On rebase: invalidate checkpoint
if (should_rebase) {
  dzr = total_z_r;  // Set dz = z_total
  dzi = total_z_i;
  ref_iter = 0u;
  checkpoint_iter = 0u;  // ← INVALIDATE checkpoint
  pp = 0u;
}

// Check convergence: compare dz values
let delta_r = dzr - bbr;
let delta_i = dzi - bbi;
let db = abs(delta_r) + abs(delta_i);
```

### Option 2: Tighter Rebasing Threshold

**Approach**: Rebase more aggressively to keep |z| < 0.1, reducing precision loss.

**Pros**:
- Keeps current checkpoint approach
- Reduces (but doesn't eliminate) precision issues

**Cons**:
- More frequent rebasing → higher overhead
- Doesn't fully solve the problem (still loses precision)
- Complex to tune threshold

### Option 3: Skip Convergence Checks When |z| is Large

**Approach**: Only check convergence when `|z| < threshold` (e.g., 0.1).

**Pros**:
- Simple addition to current code
- Avoids precision loss by not checking at bad times

**Cons**:
- Misses some convergence detections
- Harder to reason about correctness
- May delay convergence detection significantly

### Option 4: Use Relative Distance Metric

**Approach**: Compare `|delta| / |z|` instead of `|delta|` alone.

**Pros**:
- Scale-independent comparison
- Works at any magnitude

**Cons**:
- Changes convergence semantics
- May miss convergence when |z| ≈ 0
- Complex epsilon tuning

## Recommended Fix: Option 1

Store **dz perturbations** in checkpoints and invalidate on rebase.

### Why This Works

1. **Small magnitudes**: When converging, |dz| << 1, so float32 precision is adequate
2. **Consistent semantics**: Comparing perturbations directly (not absolute positions)
3. **Simple**: Clear when checkpoints are valid/invalid
4. **Testable**: Easy to verify with existing test infrastructure

### Changes Required

**CPU ZhuoranBoard** (`index.html` lines ~3240-3260):
```javascript
if (justUpdatedCheckpoint) {
  // Store dz (perturbation), not absolute z
  this.bb[index2] = Math.fround(dr);
  this.bb[index2 + 1] = Math.fround(di);
  this.hasCheckpoint[index] = true;
  this.checkpointIter[index] = this.it;
  this.pp[index] = 0;
}

if (this.hasCheckpoint[index] && !justUpdatedCheckpoint) {
  // Compare current dz to checkpoint dz
  const deltaR = Math.fround(newDr - this.bb[index2]);
  const deltaI = Math.fround(newDi - this.bb[index2 + 1]);
  const db = Math.fround(Math.abs(deltaR) + Math.abs(deltaI));
  if (db <= this.epsilon2) {
    // ...convergence detection...
  }
}
```

**Rebasing** (lines ~3145-3160):
```javascript
if (this.shouldRebase(index)) {
  // Set dz to absolute position
  this.dz[index2] = Math.fround(refR + dr);
  this.dz[index2 + 1] = Math.fround(refI + di);
  this.refIter[index] = 0;
  refIter = 0;

  // INVALIDATE checkpoint after rebase
  this.hasCheckpoint[index] = false;
  this.checkpointIter[index] = 0;
  this.pp[index] = 0;
}
```

**GPU Shader** (similar changes in WGSL):
```wgsl
// Store dz in checkpoint
bbr = dzr;
bbi = dzi;

// On rebase: invalidate
if (should_rebase) {
  checkpoint_iter = 0u;  // Invalidate
}

// Compare dz values
let delta_r = dzr - bbr;
let delta_i = dzi - bbi;
```

## Testing Strategy

1. **Test with Math.fround()**: Verify CPU ZhuoranBoard with fix matches CpuBoard
2. **Test at problematic region**: `s=6.144e-8&c=-0.1666193570+1.0423928116i`
3. **Compare convergence counts**: Should match between boards
4. **Check period correctness**: Periods should match
5. **Test deep zoom**: Verify still works after rebasing

## Performance Impact

- Negligible: Only adds checkpoint invalidation on rebase
- Rebasing is already rare (only when orbit passes near 0)
- Convergence detection remains the same speed

## References

- Commit aa11041: "Fix GpuZhuoranBoard convergence detection by storing absolute z positions"
  - This introduced the bug (unintentionally)
- Float32 precision: 2^-23 ≈ 1.2e-7 relative precision
- IEEE 754 single-precision format

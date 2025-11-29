# GPU Board Size Limit Fix

## Problem
When the GPU board grows too large (dims >= 4096), it stops working and reports "no pixels" being processed.

## Root Cause
WebGPU has a maximum buffer size limit (typically 256 MB, varies by device). When the board dimensions grow too large:

1. **Buffer size exceeds limits**: At dims=4096, the largest buffer (`dzAndCheckpoint` in `GpuZhuoranBoard`) requires 256 MB:
   - dims² = 16,777,216 pixels
   - 16 bytes per pixel (4 floats: dz.x, dz.y, bb.x, bb.y)
   - Total: 268.4 MB

2. **Silent failure**: `createBuffer()` throws an exception, caught by `initGPU()`, leaving `isGPUReady = false`

3. **No computation**: The `iterate()` method returns early when `!isGPUReady`, so no pixels are ever processed

4. **Stuck state**: Board reports `un = dims²` (all pixels unfinished) indefinitely

## Solution
Added three layers of protection:

### 1. Pre-creation size check (`GpuBaseBoard.isSafeDims()`)
```javascript
static isSafeDims(dims) {
  const dims2 = dims * dims;
  const maxSafeBufferSize = 200 * 1024 * 1024;  // 200 MB (conservative)
  const largestBufferSize = dims2 * 4 * 4;      // 16 bytes per pixel
  return largestBufferSize <= maxSafeBufferSize;
}
```

### 2. Board creation fallback
Modified board creation logic to check size limits before creating GPU boards:
```javascript
const gpuSafe = GpuBaseBoard.isSafeDims(data.config.dims);
if (enableGPU && webGPUAvailable && gpuSafe) {
  // Create GPU board
} else {
  // Fall back to CPU board
}
```

### 3. Buffer creation validation
Added size checks in `createBuffers()` methods to throw clear errors if buffers would exceed limits.

## Results

### Safe Dimensions
- dims ≤ 3600: **SAFE** (197.8 MB) - GPU acceleration works
- dims ≥ 4096: **UNSAFE** (256+ MB) - automatically falls back to CPU

### Behavior
- **Before fix**: GPU board fails silently, reports no pixels, stuck forever
- **After fix**: Automatically uses CPU board for large dims with informative console message

### Console Messages
```
Board 123: dims=4096 too large for GPU (would need 256.0 MB), using CPU
```

## Testing
Run `test-gpu-size-limit.js` to verify the size limit logic:
```bash
node test-gpu-size-limit.js
```

Run `test-large-board.js` to see detailed buffer size analysis:
```bash
node test-large-board.js
```

## Technical Details

### Buffer Sizes by Dimension
| dims | pixels      | Largest Buffer | Total Buffers | GPU Safe? |
|------|-------------|----------------|---------------|-----------|
| 2048 | 4.2M        | 64 MB          | 176 MB        | ✓ Yes     |
| 3072 | 9.4M        | 144 MB         | 396 MB        | ✓ Yes     |
| 3600 | 13.0M       | 198 MB         | 432 MB        | ✓ Yes     |
| 4096 | 16.8M       | 256 MB         | 704 MB        | ✗ No      |
| 8192 | 67.1M       | 1024 MB        | 2816 MB       | ✗ No      |

### Conservative 200 MB Limit
The fix uses 200 MB instead of 256 MB because:
- WebGPU spec requires ≥256 MB, but devices may have lower practical limits
- Leaves headroom for other GPU resources
- Some devices may reject buffers at exactly the limit
- Better to be conservative and fall back gracefully

## Files Modified
- `index.html`:
  - Added `GpuBaseBoard.isSafeDims()` static method
  - Added size validation in `GpuBoard.createBuffers()`
  - Added size validation in `GpuZhuoranBoard.createBuffers()`
  - Modified board creation logic to check size before creating GPU boards
  - Improved error messages in `initGPU()`

## Files Created
- `test-gpu-size-limit.js` - Validates size limit logic
- `test-large-board.js` - Analyzes buffer sizes for different dims
- `GPU-SIZE-LIMIT-FIX.md` - This document

# WebGPUZhuoranBoard Performance Analysis

## Identified Bottlenecks

### 1. **Multiple Buffer Readbacks Per Frame** (CRITICAL)
**Location:** index.html:4519-4522
```javascript
const iterationsData = await this.readBuffer(this.buffers.iterations, Uint32Array);
const statusAndPeriodData = await this.readBuffer(this.buffers.statusAndPeriod, Uint32Array);
const dzAndCheckpointData = await this.readBuffer(this.buffers.dzAndCheckpoint, Float32Array);
const refIterData = await this.readBuffer(this.buffers.refIter, Uint32Array);
```
**Impact:** Reading 4 large buffers every compute pass. For 64x64 grid = ~100KB transferred per frame
**Fix:** Only read buffers when pixels change state (diverge/converge), not every frame

### 2. **Staging Buffer Recreation** (HIGH)
**Location:** index.html:4578-4591
```javascript
async readBuffer(buffer, TypedArrayConstructor) {
  const stagingBuffer = this.device.createBuffer({...});  // Created fresh every call
  // ... use buffer ...
  stagingBuffer.destroy();  // Destroyed after use
}
```
**Impact:** Creating/destroying GPU buffers is expensive, happens 4x per frame
**Fix:** Reuse persistent staging buffers

### 3. **CPU-Side Result Processing** (HIGH)
**Location:** index.html:4526-4568
```javascript
for (let i = 0; i < dims2; i++) {
  const status = statusAndPeriodData[i * 2];
  // ... process every pixel on CPU ...
}
```
**Impact:** CPU processes all pixels even though most haven't changed
**Fix:** Track changes in GPU, only readback changed pixels

### 4. **Redundant Reference Orbit Upload** (MEDIUM)
**Location:** index.html:4479
```javascript
this.device.queue.writeBuffer(this.buffers.refOrbit, 0, refOrbitF32);
```
**Impact:** Uploads entire reference orbit every frame even if unchanged
**Fix:** Track lastUploadedRefIterations, only upload new data

### 5. **Double Reference Orbit Lookups** (MEDIUM)
**Location:** Shader lines 4304-4305 and 4326-4327
```wgsl
// Read ref orbit for rebasing check
let refr = refOrbit[ref_offset2];
let refi = refOrbit[ref_offset2 + 1u];
// ... compute new dz ...
// Read NEXT ref orbit value again
let next_refr = refOrbit[next_ref_offset];
let next_refi = refOrbit[next_ref_offset + 1u];
```
**Impact:** Redundant memory reads in tight loop
**Fix:** Read once, reuse values

### 6. **Small Batch Sizes** (LOW)
**Location:** index.html:4488
```javascript
const iterationsPerBatch = Math.min(1000, Math.floor(1111211 / Math.max(this.un, 1)));
```
**Impact:** With many active pixels, batch size can be very small (e.g., 271 iters for 4096 pixels)
**Fix:** Use more reasonable batch size, let GPU stay busy longer

## Recommended Optimizations (Ordered by Impact)

### Priority 1: Reduce Buffer Readbacks
- Only read iterations + statusAndPeriod buffers
- Don't read dzAndCheckpoint and refIter unless needed for debugging
- Only read back every 5-10 frames when pixels are still computing

### Priority 2: Reuse Staging Buffers
- Create persistent staging buffers in initGPU()
- Reuse them in readBuffer()
- Only recreate if size changes

### Priority 3: Track Reference Orbit Changes
- Add `this.lastUploadedRefIterations` field
- Only upload new portion of reference orbit
- Use `writeBuffer(buffer, offset, data)` for partial uploads

### Priority 4: Optimize Shader Memory Access
- Read reference orbit values once per iteration
- Eliminate redundant lookups
- Cache next_ref values

### Priority 5: Increase Batch Size
- Use formula that keeps batch size reasonable: `Math.min(1000, Math.max(100, 1111211 / this.un))`
- Ensures minimum 100 iterations per batch

## Expected Performance Gains

- **Reduce buffer readbacks:** 3-5x speedup (biggest impact)
- **Reuse staging buffers:** 1.5-2x speedup
- **Track ref orbit changes:** 1.2-1.5x speedup
- **Optimize shader:** 1.1-1.3x speedup
- **Increase batch size:** 1.1-1.2x speedup

**Combined estimated speedup: 5-10x improvement**

# GPU Batch Locking: Preventing Shader Race Conditions

## Problem Statement

WebGPU provides no ordering guarantees between separate `queue.submit()` calls. When the CPU submits batches faster than the GPU completes them, multiple batches can execute concurrently or out-of-order:

```
CPU submits:  [C0-S0]  [C1-S1]  [C2-S2]
              ↓        ↓        ↓
GPU might:   [C0-------|C1-----|C2---]
                    [S0]    [S1]  [S2]
             (overlapping execution)
```

This creates data races:
- C1 may read pixel state while C0 is still writing
- S0 may report results that include partial C1 writes
- Results may arrive out-of-order (acceptable) or corrupted (not acceptable)

## Solution: Guard-Acquire-Release Lock with Per-Buffer-Index batch_active

Add a GPU-side lock that ensures mutual exclusion between batches.

### Key Insight: Per-Buffer-Index batch_active

A naive implementation uses a single shared `batch_active` flag. This fails because:

```
Submit1 queued: [Guard1, Compute1, Staging1]
Submit2 queued: [Guard2, Compute2, Staging2]

GPU might execute:
  Guard1 (sets batch_active=1, lock=1)
  Guard2 (lock=1, so sets batch_active=0)  ← runs before Compute1!
  Compute1 (reads batch_active=0) ← WRONG
```

The fix: use per-buffer-index batch_active flags that match the double-buffering system:

```
batch_active[0] for buffer index 0
batch_active[1] for buffer index 1
```

Guard1 (buffer 0) writes `batch_active[0]=1`, Compute1 reads `batch_active[0]`
Guard2 (buffer 1) writes `batch_active[1]=0`, Compute2 reads `batch_active[1]`

They don't interfere because they use different array slots. And by the time buffer 0
is reused, the previous buffer-0 batch is complete (double-buffering guarantee).

### Lock Buffer Layout

```
struct LockBuffer {
  lock: atomic<u32>,          // 0=unlocked, 1=locked
  batch_active_0: atomic<u32>, // Batch active for buffer index 0
  batch_active_1: atomic<u32>, // Batch active for buffer index 1
  collision_count: atomic<u32>, // Stats: number of collisions
}
```

### Guard Shader

```wgsl
struct GuardParams {
  buffer_index: u32,  // 0 or 1, matches double-buffering index
}

@compute @workgroup_size(1)
fn guard_main() {
  // Try to acquire lock
  let prev = atomicCompareExchangeWeak(&lockBuf.lock, 0u, 1u).old_value;
  let is_active = select(0u, 1u, prev == 0u);

  // Write to per-buffer-index batch_active
  if (params.buffer_index == 0u) {
    atomicStore(&lockBuf.batch_active_0, is_active);
  } else {
    atomicStore(&lockBuf.batch_active_1, is_active);
  }

  if (prev != 0u) {
    atomicAdd(&lockBuf.collision_count, 1u);
  }
}
```

### Compute Shader

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  // Check per-buffer-index batch_active
  var batch_active: u32;
  if (params.buffer_index == 0u) {
    batch_active = atomicLoad(&lockBuf.batch_active_0);
  } else {
    batch_active = atomicLoad(&lockBuf.batch_active_1);
  }
  if (batch_active == 0u) {
    return;  // Batch skipped due to collision
  }

  // ... normal iteration work ...
}
```

### Staging Shader

The staging shader releases the lock after copying results:

```wgsl
@compute @workgroup_size(256)
fn staging_main(@builtin(local_invocation_id) local_id: vec3<u32>) {
  // ... copy results ...

  if (tid == 0u) {
    // Release the batch lock
    atomicStore(&lockBuf.lock, 0u);
  }
}
```

### Dispatch Sequence

```javascript
const bufferIndex = this.readbackBufferIndex;

// Pass buffer_index through params
paramsU32[BUFFER_INDEX_OFFSET] = bufferIndex;
this.device.queue.writeBuffer(this.buffers.params, 0, paramsBuffer);

const commandEncoder = this.device.createCommandEncoder();

// G: Guard shader - try to acquire lock, set batch_active[bufferIndex]
this.queueGuardPass(commandEncoder, bufferIndex);

// C: Compute shader - check batch_active[bufferIndex], skip if 0
const computePass = commandEncoder.beginComputePass();
computePass.setPipeline(this.pipeline);
computePass.setBindGroup(0, this.bindGroup);
computePass.dispatchWorkgroups(workgroupsX, workgroupsY);
computePass.end();

// S: Staging shader - copy results, release lock
this.queueResultsReadback(commandEncoder, bufferIndex);

this.device.queue.submit([commandEncoder.finish()]);
```

## Implementation Details

### Guard Bind Groups

Two guard bind groups are created (one per buffer index):

```javascript
this.guardBindGroups = [
  this.device.createBindGroup({
    layout: this.guardPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: this.buffers.guardParams[0] } },
      { binding: 1, resource: { buffer: this.buffers.lock } }
    ],
    label: 'Guard bind group 0'
  }),
  this.device.createBindGroup({
    layout: this.guardPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: this.buffers.guardParams[1] } },
      { binding: 1, resource: { buffer: this.buffers.lock } }
    ],
    label: 'Guard bind group 1'
  })
];
```

### Params Struct Updates

Each compute shader's Params struct includes `buffer_index`:

```wgsl
struct Params {
  // ... existing fields ...
  checkpoint_count: u32,
  buffer_index: u32,      // 0 or 1, for per-buffer batch_active
  // ... checkpoints and other fields ...
}
```

## Performance Impact

**Expected overhead per batch:**
- G shader: 1 workgroup, 1 thread, ~10 GPU cycles
- Atomic check in C: 1 atomic load per thread, ~4 cycles
- Lock release in S: 1 atomic store, ~10 cycles

Total: negligible compared to iteration work (thousands of cycles per pixel).

**Collision frequency:**
- Rare under normal operation (GPU faster than CPU submit rate)
- More common during initial ramp-up or on slow GPUs
- Each collision costs one batch worth of work

## Files Modified

- `index.html`: GpuBaseBoard, GpuBoard, GpuZhuoranBoard, GpuAdaptiveBoard
  - Lock buffer creation in `initResultsReadback()`
  - Guard shader and pipeline in `createStagingPipeline()`
  - Per-buffer guard bind groups
  - `queueGuardPass(commandEncoder, bufferIndex)` method
  - Compute shader LockBuffer struct and batch_active check
  - Params struct with buffer_index field
  - JavaScript params writing with buffer_index

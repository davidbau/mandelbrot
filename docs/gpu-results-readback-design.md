# GPU Results Readback Design

## Overview

This document describes the design for GPU results readback with proper batch ordering guarantees, ensuring that results sent to the view are always in monotonically increasing iteration order.

## Problem Statement

GPU shader workgroups complete in arbitrary order. When pixels finish (escape/converge), they write to a shared results buffer via `atomicAdd`. This means:
- Results from different batches can interleave
- Within a batch, results arrive in arbitrary order
- The view receives out-of-order iteration updates, causing visual stripes

## Design Goals

1. Results sent to view must be in monotonically increasing iteration order
2. Maintain GPU parallelism (don't block on readback)
3. Minimize memory overhead and complexity
4. GPU determines what to copy (CPU cannot know at queue time)

---

## Two Async Information Flows

The GPU communicates with the CPU through two asynchronous flows:

### Flow 1: Batch Metadata (Fast)
- **What**: Header containing `firstEmpty` (total results count) and chunk info
- **When**: Available immediately when staging buffer is mapped
- **Use**: Determines batch boundaries (`batchPixelCount = newFirstEmpty - prevFirstEmpty`)

### Flow 2: Pixel Results (Slow)
- **What**: The actual pixel data records
- **When**: Streamed over potentially multiple readbacks
- **Use**: Processed and attributed to batches based on Flow 1 boundaries

The key insight is that Flow 1 arrives quickly and tells us the batch size, allowing us to set up batch tracking before Flow 2's data arrives.

---

## Two-Shader Pipeline

The GPU pipeline consists of two compute shaders per batch:

### Shader 1: Main Compute Shader
- Iterates all active pixels
- Pixels that finish (escape/converge) atomicAdd on `firstEmpty` to get a slot
- Writes result record to `results[slot]`

### Shader 2: Staging Shader
- Runs immediately after main shader (same command buffer)
- Reads atomic counters to determine what needs to be staged
- Copies a chunk of results from main area to pre-staging area
- Writes explicit header metadata

**Why two shaders?**
- `copyBufferToBuffer` requires CPU to specify source offset at queue time
- But CPU doesn't know where results end until GPU finishes
- Solution: GPU (staging shader) decides what to copy, writes to fixed pre-staging area
- CPU then copies pre-staging area (fixed, predetermined location) to staging buffer

---

## Buffer Structures

### Results Buffer (GPU-side)

The results buffer has three regions:

```
┌─────────────────────────────────────────────────────────────┐
│ Header (32 bytes)                                           │
│   Offset 0:  firstEmpty (atomic<u32>) - next write slot     │
│   Offset 4:  lastStaged (atomic<u32>) - last staged index   │
│   Offset 8:  active_count (u32)                             │
│   Offset 12: start_iter (u32)                               │
│   Offset 16: iterations_per_batch (u32)                     │
│   Offset 20-31: reserved                                    │
├─────────────────────────────────────────────────────────────┤
│ Main Results Area                                           │
│   Offset 32: results[0..maxResults]                         │
│   Written by main shader via atomicAdd slot allocation      │
├─────────────────────────────────────────────────────────────┤
│ Pre-Staging Area (fixed size = chunkSize records + header)  │
│   Offset P:  staging header (16 bytes)                      │
│     - firstEmpty (u32): total results at batch end          │
│     - countInChunk (u32): records in this chunk             │
│     - chunkStartIndex (u32): where this chunk starts        │
│     - reserved (u32)                                        │
│   Offset P+16: staging records[0..chunkSize-1]              │
│   Written by staging shader                                 │
└─────────────────────────────────────────────────────────────┘
```

Where `P = 32 + (maxResults * recordBytes)`.

### Staging Shader Design

**Thread count**: Multiple workgroups with 256 threads each.

**Algorithm**:
```wgsl
@compute @workgroup_size(256)
fn staging_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let tid = gid.x;

    // Read current state
    let totalResults = atomicLoad(&header.firstEmpty);
    let alreadyStaged = atomicLoad(&header.lastStaged);

    // Compute chunk bounds
    let chunkStart = alreadyStaged;
    let available = totalResults - alreadyStaged;
    let countInChunk = min(available, CHUNK_SIZE);

    if (tid == 0u) {
        // Thread 0: write staging header
        preStagingHeader.firstEmpty = totalResults;
        preStagingHeader.countInChunk = countInChunk;
        preStagingHeader.chunkStartIndex = chunkStart;

        // Update lastStaged for next batch
        atomicStore(&header.lastStaged, chunkStart + countInChunk);
    }

    // All threads: copy records (each handles one record)
    if (tid < countInChunk) {
        let srcIndex = chunkStart + tid;
        preStagingRecords[tid] = mainResults[srcIndex];
    }
}
```

### Readback Staging Buffers (pair, for double-buffering)

Size: Header (16 bytes) + chunkSize records.

**Double-buffering mechanism:**
- Two staging buffers (index 0 and 1) alternate between GPU-write and CPU-read
- While GPU copies to staging buffer A, CPU reads from staging buffer B
- After each batch: flip `readbackBufferIndex = 1 - readbackBufferIndex`

---

## Worker-Side Batch Tracking

### Data Structures

```javascript
// Queue of batches awaiting complete readback
batchesToReadback: [
  {
    startIter: number,          // First iteration of this batch
    endIter: number,            // Last iteration + 1 (half-open interval)
    remainingPixelCount: number // Pixels still to receive
  },
  ...
]

// Accumulated results for current head batch
batchResultsRead: []

// Tracking state
previousBatchEndIter: number,   // Previous batch's end iteration
previousFirstEmpty: number,     // For computing batch pixel count
```

### Processing Flow (processResultsData)

The core algorithm processes results in a clean nested loop:

**Step 1: Outer Loop - Process Batches in Order**
```javascript
while (batchesToReadback.length > 0) {
  const batch = batchesToReadback[0];

  // Step 2: Flush precomputed points before this batch
  if (precomputed) {
    flushPrecomputedUpTo(previousBatchEndIter - 1);
  }

  // Step 3: Inner loop - collect results for this batch
  while (batch.remainingPixelCount > 0 && dataIndex < count) {
    // Parse result, update board state
    batchResultsRead.push(change);
    batch.remainingPixelCount--;
    dataIndex++;
  }

  // Step 4: Check if batch complete
  if (batch.remainingPixelCount > 0) {
    break;  // Wait for more data
  }

  // Step 5: Flush and queue complete batch
  flushPrecomputedUpTo(batch.endIter - 1);
  mergeSortAndQueue(batchResultsRead, changeList);
  batchResultsRead = [];
  previousBatchEndIter = batch.endIter;
  batchesToReadback.shift();
}
```

---

## Pixel Count Tracking

### `un` (Unknown/Unreported)

Pixels that haven't been sent to the view yet:

```javascript
un = (activeCount - deadSinceCompaction) + pendingPrecomputed + pendingInBatchResults
```

Where:
- `activeCount` = total pixels sent to GPU
- `deadSinceCompaction` = pixels finished and processed via readback
- `pendingPrecomputed` = precomputed pixels waiting to be flushed
- `pendingInBatchResults` = results in `batchResultsRead` not yet in changeList

**Note**: The `pendingInBatchResults` term is crucial. Without it, `un` drops prematurely when results are read back but not yet flushed to changeList, causing the view to show incorrect progress.

### Update Timing

`un` is updated in `processResultsData`:
```javascript
const pendingPrecomputed = this.precomputed ? this.precomputed.getPendingCount() : 0;
const pendingInBatchResults = this.batchResultsRead.length;
this.un = (this.activeCount - this.deadSinceCompaction) + pendingPrecomputed + pendingInBatchResults;
```

---

## Memory Optimization: On-Demand stagingPixels

The `stagingPixels` buffer (used for serialization/deserialization) is created on-demand rather than pre-allocated:

```javascript
async readPixelBuffer() {
  // Create temporary staging buffer only when needed
  const stagingBuffer = this.device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    label: 'Temp staging for serialization'
  });

  // Copy, map, read...

  // Destroy immediately after use
  stagingBuffer.destroy();
  return pixelData;
}
```

This saves ~2x pixel buffer size in GPU memory during normal operation, since serialization is rare.

---

## Period Encoding

When a pixel converges, the GPU shader stores the iteration at which convergence was first detected. This is used with `fibonacciPeriod()` to compute the actual period.

### Convention
- GPU shader stores `period = iter` (iteration when convergence detected)
- CPU uses this value directly for `this.pp[origIndex]`
- `fibonacciPeriod(pp)` computes actual period based on Fibonacci checkpoint structure

### Board-Specific Notes
- **GpuBoard**: Uses `period` directly (was incorrectly using `period + 1`, fixed)
- **GpuZhuoranBoard/AdaptiveGpuBoard**: Use `period - 1` because their convergence check tests the *previous* iteration's state

All boards should produce identical `rawP` values for the same pixel, validated by the `converged-z-position` test.

---

## Invariants

1. **Batch ordering**: Results in buffer at indices `[batchStart, batchEnd)` all belong to one batch
2. **Iteration bounds**: All results from batch B have `iter >= B.startIter` and `iter < B.endIter`
3. **Monotonic sends**: View receives changes sorted by iteration, never out of order
4. **Complete batches only**: Worker never sends partial batch to view
5. **Staging coherence**: Staging shader sees all writes from main shader (same command buffer)
6. **No late results**: Once a batch is flushed, no results from that batch's iteration range should appear later
7. **No duplicate pixels**: Each pixel index appears exactly once in results (validated by test)

---

## Implementation Status

### GPU/Shader
- [x] Main shader: write results via atomicAdd on `firstEmpty`
- [x] Add `lastStaged` atomic counter to header
- [x] Create staging shader
- [x] Staging shader: read counters, copy chunk, write staging header
- [x] Add pre-staging area to results buffer
- [x] Queue staging pass after main pass
- [x] Fixed copyBufferToBuffer from pre-staging to staging

### Worker Changes
- [x] Add `batchesToReadback` queue
- [x] Parse staging header fields (firstEmpty, countInChunk, chunkStartIndex)
- [x] Enqueue batch with computed size
- [x] Accumulate changes per batch via `batchResultsRead`
- [x] Flush complete batches (remainingPixelCount <= 0)
- [x] Sort before sending
- [x] Verify iteration bounds (debug mode)
- [x] Correct `un` calculation including `pendingInBatchResults`
- [x] On-demand stagingPixels (memory optimization)
- [x] Remove dead compactBuffers code

### Testing
- [x] Verify no duplicate pixel indices (gpu-batch-invariants test)
- [x] Verify iterations in monotonic order (gpu-batch-invariants test)
- [x] Verify view.un matches actual unknown count
- [x] Verify period encoding matches CpuBoard (converged-z-position test)
- [x] Test GpuBoard, GpuZhuoranBoard, AdaptiveGpuBoard all pass

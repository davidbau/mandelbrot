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
│ Header (16 bytes)                                           │
│   Offset 0:  firstEmpty (atomic<u32>) - next write slot     │
│   Offset 4:  lastStaged (atomic<u32>) - last staged index   │
│   Offset 8:  reserved (u32)                                 │
│   Offset 12: reserved (u32)                                 │
├─────────────────────────────────────────────────────────────┤
│ Main Results Area                                           │
│   Offset 16: results[0..maxResults]                         │
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

Where `P = 16 + (maxResults * recordBytes)`.

### Staging Shader Design

**Thread count**: `chunkSize + 1` threads in a single workgroup (or multiple workgroups if chunkSize > 256).

**Thread responsibilities**:
- Thread 0: Write staging header
- Threads 1..chunkSize: Each copies one record (if within valid range)

**Algorithm**:
```wgsl
@compute @workgroup_size(CHUNK_SIZE + 1)
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
    } else {
        // Threads 1..chunkSize: copy records
        let recordIndex = tid - 1u;
        if (recordIndex < countInChunk) {
            let srcIndex = chunkStart + recordIndex;
            preStagingRecords[recordIndex] = mainResults[srcIndex];
        }
    }
}
```

### Readback Staging Buffers (pair, for double-buffering)

Size: Header (16 bytes) + chunkSize records.

**Double-buffering mechanism:**
- Two staging buffers (index 0 and 1) alternate between GPU-write and CPU-read
- While GPU copies to staging buffer A, CPU reads from staging buffer B
- After each batch: flip `readbackBufferIndex = 1 - readbackBufferIndex`

```
Timeline:
  Batch 1: main shader → staging shader → copy pre-staging to staging[0] → submit
  Batch 2: main shader → staging shader → copy pre-staging to staging[1] → submit
           ↳ CPU reads staging[0] header (gets batch 1 metadata)
           ↳ CPU reads staging[0] records (processes batch 1 chunk)
  Batch 3: main shader → staging shader → copy pre-staging to staging[0] → submit
           ↳ CPU reads staging[1] header (gets batch 2 metadata)
           ↳ CPU reads staging[1] records (processes batch 2 chunk)
  ...
```

**Staging buffer layout:**
```
Offset 0:  firstEmpty (u32)       - Total results at batch end
Offset 4:  countInChunk (u32)     - Number of records in this chunk
Offset 8:  chunkStartIndex (u32)  - Where this chunk starts in results buffer
Offset 12: reserved (u32)
Offset 16: records[0..chunkSize-1] - Copied result records
```

### Command Buffer Structure

Each batch submits a command buffer with:
```javascript
const commandEncoder = device.createCommandEncoder();

// 1. Main compute pass
const mainPass = commandEncoder.beginComputePass();
mainPass.setPipeline(mainPipeline);
mainPass.setBindGroup(0, mainBindGroup);
mainPass.dispatchWorkgroups(workgroupsX, workgroupsY);
mainPass.end();

// 2. Staging compute pass
const stagingPass = commandEncoder.beginComputePass();
stagingPass.setPipeline(stagingPipeline);
stagingPass.setBindGroup(0, stagingBindGroup);
stagingPass.dispatchWorkgroups(Math.ceil((chunkSize + 1) / 256));
stagingPass.end();

// 3. Copy pre-staging to staging buffer (fixed, predetermined)
commandEncoder.copyBufferToBuffer(
    resultsBuffer, preStagingOffset,
    stagingBuffers[readbackIndex], 0,
    stagingBufferSize
);

device.queue.submit([commandEncoder.finish()]);
```

---

## Worker-Side Batch Tracking

### Data Structures

```javascript
// Queue of batches awaiting complete readback
batchesToReadback: [
  {
    completedIterNumber: number,      // Iteration count when this batch completed
    remainingPixelCount: number,      // Pixels still to receive (decrements toward 0)
    accumulatedChanges: [],           // PixelState records accumulated so far
  },
  ...
]

// Tracking state
previousCompletedIterNumber: number,  // Last completed batch's iteration (for invariants)
```

The **head** of the queue is the batch currently being accumulated.

### Processing Flow

When `processPendingReadback()` is called:

1. **Read staging header**: Get batch metadata from staging buffer
   ```javascript
   const firstEmpty = headerView[0];      // Total results at batch end
   const countInChunk = headerView[1];    // Records in this chunk
   const chunkStartIndex = headerView[2]; // Where this chunk starts
   ```

2. **Compute batch size and enqueue** (if this is a new batch):
   ```javascript
   const batchPixelCount = firstEmpty - previousFirstEmpty;
   batchesToReadback.push({
     completedIterNumber: pendingBatchCompletedIterNumber,
     remainingPixelCount: batchPixelCount,
     accumulatedChanges: []
   });
   previousFirstEmpty = firstEmpty;
   ```

3. **Process chunk records**:
   - Convert each record to changelist item
   - Add to appropriate batch's `accumulatedChanges` via `queueChanges()`
   - Decrement batch's `remainingPixelCount`

4. **Flush complete batches**:
   ```javascript
   while (batchesToReadback.length > 0 &&
          batchesToReadback[0].remainingPixelCount <= 0) {
     const batch = batchesToReadback.shift();

     // Sort by iteration
     batch.accumulatedChanges.sort((a, b) => a.iter - b.iter);

     // Verify invariants
     assert(all changes have iter <= batch.completedIterNumber);
     assert(all changes have iter > previousCompletedIterNumber);

     // Move to changeList for sending to view
     for (const change of batch.accumulatedChanges) {
       changeList.push(change);
     }

     previousCompletedIterNumber = batch.completedIterNumber;
   }
   ```

### Timing in compute()

```javascript
async compute(iterationsPerBatch) {
  // Dispatch GPU work (main shader + staging shader + copy)
  this.device.queue.submit([commandEncoder.finish()]);
  this._baseIt += iterationsPerBatch;

  // Process PREVIOUS batch (uses pendingBatch* values set last frame)
  if (this.pendingReadbackIndex !== null) {
    await this.processPendingReadback();
  }

  // Save state for THIS batch (to be processed next frame)
  this.pendingBatchCompletedIterNumber = this._baseIt;
}
```

---

## Invariants

1. **Batch ordering**: Results in buffer at indices `[batchStart, batchEnd)` all belong to one batch
2. **Iteration bounds**: All results from batch B have `iter <= B.completedIterNumber` and `iter > B-1.completedIterNumber`
3. **Monotonic sends**: View receives changes sorted by iteration, never out of order
4. **Complete batches only**: Worker never sends partial batch to view
5. **Staging coherence**: Staging shader sees all writes from main shader (same command buffer)

---

## Implementation Checklist

### GPU/Shader
- [x] Main shader: write results via atomicAdd on `firstEmpty`
- [ ] Add `lastStaged` atomic counter to header
- [ ] Create staging shader (chunkSize + 1 threads)
- [ ] Staging shader: read counters, copy chunk, write staging header
- [ ] Add pre-staging area to results buffer
- [ ] Queue staging pass after main pass
- [ ] Fixed copyBufferToBuffer from pre-staging to staging

### Worker Changes
- [x] Add `batchesToReadback` queue
- [ ] Parse new staging header fields (firstEmpty, countInChunk, chunkStartIndex)
- [x] Enqueue batch with computed size
- [x] Accumulate changes per batch via `queueChanges()`
- [x] Flush complete batches (remainingPixelCount <= 0)
- [x] Sort before sending
- [x] Verify iteration bounds (debug mode)
- [ ] Remove drainResultsBacklog (no longer needed with explicit staging)

### Testing
- [ ] Verify staging shader copies correct range
- [ ] Verify no out-of-order iterations received by view
- [ ] Verify no visual stripes
- [ ] Test with varying batch sizes and pixel counts
- [ ] Test rapid batch completion (multiple batches in one readback)

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

---

## Two Async Information Flows

The GPU communicates with the CPU through two asynchronous flows:

### Flow 1: Batch Metadata (Fast)
- **What**: Header containing `firstEmpty` (total results count)
- **When**: Available immediately when staging buffer is mapped
- **Use**: Determines batch boundaries (`batchPixelCount = newFirstEmpty - prevFirstEmpty`)

### Flow 2: Pixel Results (Slow)
- **What**: The actual pixel data records
- **When**: Streamed over potentially multiple readbacks
- **Use**: Processed and attributed to batches based on Flow 1 boundaries

The key insight is that Flow 1 arrives quickly and tells us the batch size, allowing us to set up batch tracking before Flow 2's data arrives.

---

## Buffer Structures

### Results Buffer (GPU-side)

Size: Same as initial active pixels buffer (maximum possible results).

```
Offset 0:  firstEmpty (atomic<u32>)      - Next slot for GPU to write (via atomicAdd)
Offset 4:  reserved (u32)
Offset 8:  reserved (u32)
Offset 12: reserved (u32)
Offset 16: records[0..N]                 - PixelState records (finished pixels)
```

Results from batch N appear strictly after results from batch M (for M < N) because:
- Each batch runs to completion before the next batch starts
- `firstEmpty` only increases
- Batch N's results start at wherever `firstEmpty` was when batch N began

### Readback Staging Buffers (pair, for double-buffering)

Size: 1% of results capacity, minimum 256 bytes.

**Double-buffering mechanism:**
- Two staging buffers (index 0 and 1) alternate between GPU-write and CPU-read
- While GPU copies results to staging buffer A, CPU reads from staging buffer B
- After each batch: flip `readbackBufferIndex = 1 - readbackBufferIndex`
- This allows GPU compute and CPU readback to overlap, maximizing parallelism

```
Timeline:
  Batch 1: GPU computes → copy to staging[0] → submit
  Batch 2: GPU computes → copy to staging[1] → submit
           ↳ CPU reads staging[0] header (gets batch 1 size)
           ↳ CPU reads staging[0] records (processes batch 1 data)
  Batch 3: GPU computes → copy to staging[0] → submit
           ↳ CPU reads staging[1] header (gets batch 2 size)
           ↳ CPU reads staging[1] records (processes batch 2 data)
  ...
```

**Buffer layout (mirrors results buffer):**
```
Offset 0:  firstEmpty (u32)              - Total results written (copied from results buffer)
Offset 4:  reserved (u32)
Offset 8:  reserved (u32)
Offset 12: reserved (u32)
Offset 16: records[0..K]                 - Copied PixelState records
```

**Deriving batch information:**

| Value | Source |
|-------|--------|
| `firstEmpty` | GPU writes via atomicAdd, copied to staging buffer header |
| `batchPixelCount` | CPU computes: `currentFirstEmpty - previousFirstEmpty` |
| `completedIterNumber` | CPU knows: `_baseIt` (CPU controls iteration count) |
| `recordsToProcess` | CPU computes: `min(availableRecords, readbackChunkSize)` |

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
batchStartResultIndex: number,        // Where the NEXT batch's results will start
pendingBatchCompletedIterNumber: number,  // completedIterNumber for pending batch
pendingBatchStartResultIndex: number,     // Where pending batch's results started
previousCompletedIterNumber: number,      // Last completed batch's iteration (for invariants)
```

The **head** of the queue is the batch currently being accumulated.

### Processing Flow

When `processPendingReadback()` is called:

1. **Read header**: Get `firstEmpty` (totalCount) from staging buffer
   ```javascript
   const totalCount = headerView[0];
   ```

2. **Compute batch size and enqueue**:
   ```javascript
   const batchPixelCount = totalCount - pendingBatchStartResultIndex;
   batchesToReadback.push({
     completedIterNumber: pendingBatchCompletedIterNumber,
     remainingPixelCount: batchPixelCount,
     accumulatedChanges: []
   });
   ```

3. **Update tracking for next batch**:
   ```javascript
   batchStartResultIndex = totalCount;  // Next batch starts here
   ```

4. **Process payload records** (from Flow 2):
   - Convert each PixelState to changelist item
   - Add to head batch's `accumulatedChanges` via `queueChanges()`
   - Decrement head batch's `remainingPixelCount`

5. **Flush complete batches**:
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

The batch tracking state must be set at the right time relative to `processPendingReadback()`:

```javascript
async compute(iterationsPerBatch) {
  // Dispatch GPU work
  this.device.queue.submit([commandEncoder.finish()]);
  this._baseIt += iterationsPerBatch;

  // Process PREVIOUS batch (uses pendingBatch* values set last frame)
  if (this.pendingReadbackIndex !== null) {
    await this.processPendingReadback();
    // This updates batchStartResultIndex = totalCount
  }

  // Save state for THIS batch (to be processed next frame)
  // Must be AFTER processPendingReadback updates batchStartResultIndex
  this.pendingBatchCompletedIterNumber = this._baseIt;
  this.pendingBatchStartResultIndex = this.batchStartResultIndex;
}
```

### Edge Cases

- **Empty batches** (remainingPixelCount = 0): Handled normally, just flush immediately
- **Multiple batches per readback**: If batches complete quickly, queue may grow; each is processed in order
- **Partial batch data**: If readback chunk is smaller than batch, accumulate across multiple readbacks
- **drainResultsBacklog**: Bypasses batch tracking (sets batchesToReadback = null temporarily) because it reads from a different staging buffer that may contain mixed batch data

---

## Invariants

1. **Batch ordering**: Results in buffer at indices `[batchStart, batchEnd)` all belong to one batch
2. **Iteration bounds**: All results from batch B have `iter <= B.completedIterNumber` and `iter > B-1.completedIterNumber`
3. **Monotonic sends**: View receives changes sorted by iteration, never out of order
4. **Complete batches only**: Worker never sends partial batch to view

---

## Implementation Checklist

### GPU/Shader
- [x] Write `firstEmpty` to results buffer header (via atomicAdd)
- [x] Copy results buffer to staging buffer (existing copyBufferToBuffer)

### Worker Changes
- [x] Add `batchesToReadback` queue
- [x] Read `firstEmpty` from staging buffer header
- [x] Compute `batchPixelCount = firstEmpty - previousFirstEmpty`
- [x] Enqueue batch with computed size
- [x] Accumulate changes per batch via `queueChanges()`
- [x] Flush complete batches (remainingPixelCount <= 0)
- [x] Sort before sending
- [x] Verify iteration bounds (debug mode)
- [x] Handle drainResultsBacklog by bypassing batch tracking

### Testing
- [ ] Verify no out-of-order iterations received by view
- [ ] Verify no visual stripes
- [ ] Test with varying batch sizes and pixel counts
- [ ] Test rapid batch completion (multiple batches in one readback)

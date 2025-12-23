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

## Buffer Structures

### Results Buffer (GPU-side)

Size: Same as initial active pixels buffer (maximum possible results).

```
Offset 0:  firstEmpty (atomic<u32>)      - Next slot for GPU to write
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
           ↳ CPU reads staging[0] (parallel with batch 2 GPU work)
  Batch 3: GPU computes → copy to staging[0] → submit
           ↳ CPU reads staging[1] (parallel with batch 3 GPU work)
  ...
```

**Buffer layout:**
```
Offset 0:  batchReadbackPixelCount (u32) - Pixels finished in THIS batch (may be 0 or many)
Offset 4:  completedIterNumber (u32)     - Last completed iteration at batch end
Offset 8:  validRecordCount (u32)        - Number of records in this payload
Offset 12: reserved (u32)
Offset 16: records[0..K]                 - Copied PixelState records
```

**Header field semantics:**

| Field | Description |
|-------|-------------|
| `batchReadbackPixelCount` | Number of pixels that finished during this batch. May be 0 (no pixels escaped) or large (many escaped). This is the delta for this batch only. |
| `completedIterNumber` | The iteration count at the end of this batch. Always >= previous batch's value + iterationsPerBatch. |
| `validRecordCount` | Number of valid PixelState records in this readback payload. These records may belong to older batches that haven't been fully read yet. |

**Note:** The header fields are computed CPU-side after `onSubmittedWorkDone()`, based on:
- `batchReadbackPixelCount = newTotalCount - previousTotalCount`
- `completedIterNumber = this._baseIt` (current iteration after batch)
- `validRecordCount = records actually copied in this readback`

---

## Worker-Side Batch Tracking

### Data Structures

```javascript
// Queue of batches awaiting complete readback
batchesToReadback: [
  {
    batchNumber: number,              // Monotonically increasing batch ID
    completedIterNumber: number,      // Iteration count when this batch completed
    remainingPixelCount: number,      // Pixels still to receive (decrements toward 0)
    accumulatedChanges: [],           // PixelState records accumulated so far
  },
  ...
]
```

The **head** of the queue is the batch currently being accumulated.

### Processing Flow

When a readback completes:

1. **Read header**: Extract `batchReadbackPixelCount`, `completedIterNumber`, `validRecordCount`

2. **Enqueue new batch** (if `batchReadbackPixelCount` or `completedIterNumber` indicates a new batch):
   ```javascript
   batchesToReadback.push({
     batchNumber: nextBatchNumber++,
     completedIterNumber: completedIterNumber,
     remainingPixelCount: batchReadbackPixelCount,
     accumulatedChanges: []
   });
   ```

3. **Process payload records** (iterate through `validRecordCount` records):
   - Convert each PixelState to changelist item
   - Add to head batch's `accumulatedChanges`
   - Decrement head batch's `remainingPixelCount`

4. **Check for batch completion**:
   ```javascript
   while (batchesToReadback.length > 0 &&
          batchesToReadback[0].remainingPixelCount === 0) {
     const batch = batchesToReadback.shift();

     // Sort by iteration
     batch.accumulatedChanges.sort((a, b) => a.iter - b.iter);

     // Verify invariants
     assert(all changes have iter <= batch.completedIterNumber);
     assert(all changes have iter > previousCompletedIterNumber);

     // Send to view
     sendToView(batch.accumulatedChanges);

     previousCompletedIterNumber = batch.completedIterNumber;
   }
   ```

### Edge Cases

A single readback may contain:
- **Multiple batches**: If several batches completed quickly, queue will have multiple entries
- **One batch**: Normal case
- **Less than one batch**: Partial batch data, accumulate and wait for next readback
- **Zero batches**: Only old records from previous batches (rare)

---

## GPU-Side Logic

### Batch Execution

```
Before batch dispatch:
  batchStartIndex = firstEmpty  // Record where this batch's results will start

During compute:
  if (pixel finished):
    outIndex = atomicAdd(&results.firstEmpty, 1)
    results.records[outIndex] = pixelState

After onSubmittedWorkDone():
  batchEndIndex = firstEmpty  // All results up to here are written
  batchReadbackPixelCount = batchEndIndex - batchStartIndex
```

### Header Update

After each batch completes, before copying to staging:
```
staging.batchReadbackPixelCount = batchEndIndex - batchStartIndex
staging.completedIterNumber = currentIteration
staging.validRecordCount = min(recordsToCopy, stagingCapacity)
```

---

## Invariants

1. **Batch ordering**: Results in buffer at indices `[batchStart, batchEnd)` all belong to one batch
2. **Iteration bounds**: All results from batch B have `iter <= B.completedIterNumber` and `iter > B-1.completedIterNumber`
3. **Monotonic sends**: View receives changes sorted by iteration, never out of order
4. **Complete batches only**: Worker never sends partial batch to view

---

## Implementation Checklist

### Shader Changes
- [ ] Add `batchReadbackPixelCount` computation after batch
- [ ] Add `completedIterNumber` to header
- [ ] Ensure header is updated before staging copy

### Worker Changes
- [ ] Add `batchesToReadback` queue
- [ ] Parse new header fields on readback
- [ ] Accumulate changes per batch
- [ ] Send only when batch complete (remainingPixelCount === 0)
- [ ] Sort before sending
- [ ] Verify iteration bounds (debug mode)

### Testing
- [ ] Verify no out-of-order iterations received by view
- [ ] Verify no visual stripes
- [ ] Test with varying batch sizes and pixel counts
- [ ] Test rapid batch completion (multiple batches in one readback)

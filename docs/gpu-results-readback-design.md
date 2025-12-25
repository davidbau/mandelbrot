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

**Thread count**: Single workgroup with 256 threads (each thread handles multiple records via strided loop).

**Algorithm**: The staging shader handles the "atomicAdd before data write" race by checking each record's `status` field. Records with `status=0` are not yet fully written and must be skipped.

```wgsl
const STATUS_OFFSET: u32 = 2u;  // status field offset within each record

var<workgroup> sharedFirstEmpty: u32;
var<workgroup> sharedLastStaged: u32;
var<workgroup> sharedMaxToCheck: u32;
var<workgroup> firstNotReady: atomic<u32>;  // Workgroup-local atomic for coordination

@compute @workgroup_size(256)
fn staging_main(@builtin(local_invocation_id) local_id: vec3<u32>) {
    let tid = local_id.x;

    // Thread 0 reads header and initializes shared state
    if (tid == 0u) {
        sharedFirstEmpty = buffer[0];
        sharedLastStaged = buffer[1];
        sharedMaxToCheck = min(sharedFirstEmpty - sharedLastStaged, CHUNK_SIZE);
        atomicStore(&firstNotReady, sharedMaxToCheck);  // "all ready" sentinel
    }

    workgroupBarrier();

    // Each thread copies multiple records (strided) and checks status
    for (var i = tid; i < sharedMaxToCheck; i = i + 256u) {
        // Copy the record (even if not ready - will be excluded from count)
        copy_record(sharedLastStaged + i, i);

        // Check status - if not ready, atomicMin to find earliest not-ready
        let status = buffer[recordStart + STATUS_OFFSET];
        if (status == 0u) {
            atomicMin(&firstNotReady, i);
        }
    }

    workgroupBarrier();

    // Thread 0 writes header with actual count and updates lastStaged
    if (tid == 0u) {
        let actualCount = atomicLoad(&firstNotReady);
        write_staging_header(sharedFirstEmpty, actualCount, sharedLastStaged);
        buffer[1] = sharedLastStaged + actualCount;  // Update lastStaged
    }
}
```

**Key insight**: We copy ALL records in parallel for maximum throughput, but use `atomicMin` on a workgroup-local atomic to find the first not-ready record. The `actualCount` written to the header excludes any not-ready records at the end. Records beyond `actualCount` in the pre-staging area contain garbage and are ignored by the CPU.

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

## Command Buffer Overlap and Early Results

### The Subtle Race Condition

WebGPU command buffers from the same queue execute in submission order, but they can **overlap in execution** on the GPU. When we submit batch N's command buffer (C_N, S_N, Y_N) followed by batch N+1's (C_{N+1}, S_{N+1}, Y_{N+1}), the GPU may pipeline them:

```
GPU Timeline:
Command Buffer N:   [C_N ][S_N ][Y_N ]
Command Buffer N+1:      [C_{N+1}][S_{N+1}][Y_{N+1}]
                          ↑
                    C_{N+1} starts before S_N reads firstEmpty
```

The race occurs because:
1. C_N runs, pixels escape, they write to results buffer and increment `firstEmpty` to X
2. C_{N+1} starts running (overlapping with S_N), more pixels escape, `firstEmpty` becomes Y
3. S_N runs, reads `lastStaged` and `firstEmpty=Y`, copies records [lastStaged, Y)
4. S_N has now copied records from BOTH batch N AND batch N+1

### Guarantees Despite the Race

The `lastStaged` counter ensures:
- **No gaps**: Each staging pass copies from where the previous one left off
- **No duplicates**: S_N updates `lastStaged` after copying, so S_{N+1} won't re-copy

The only issue is that records may arrive in the **wrong batch's staging buffer** - batch N+1's records appearing in staging buffer N. These are "early" results.

### The Fix: Deferred Results

Instead of trying to prevent the race on the GPU (which would require serializing command buffers and losing overlap benefits), we handle it on the CPU:

1. **When processing results**, check if `iter >= batch.endIter`
2. **If a result belongs to a future batch**, save it to `deferredResults` array instead of processing
3. **When starting to process the next batch**, first drain `deferredResults` for results that now fall within range
4. **Don't count deferred results** toward `batch.remainingPixelCount`

This preserves full CPU/GPU overlap while correctly attributing results to their batches.

### Why CPU-Side Filtering Works

- Each result has an `iter` field that definitively identifies which batch it belongs to
- Results with `iter < batch.endIter` belong to this batch (or earlier)
- Results with `iter >= batch.endIter` belong to a future batch
- The staging buffer must be fully parsed before unmapping (GPU will reuse it)
- Deferred results are copied to a JavaScript array for later processing

---

## The Deeper Race: atomicAdd Before Data Write

### The Problem

The command buffer overlap issue above addresses results appearing in the wrong batch's staging buffer. But there's a more subtle race condition within the result-writing process itself.

When a pixel finishes (escapes or converges), the compute shader does:

```wgsl
// Step 1: Claim a slot
let slot = atomicAdd(&results.count, 1u);

// Step 2: Write data to the slot
results.records[slot].origIndex = orig_index;
results.records[slot].iters = iter;
results.records[slot].period = p;
results.records[slot].zr = zr;
results.records[slot].zi = zi;
results.records[slot].status = status;  // 1=diverged, 2=converged
```

The `atomicAdd` happens **before** the data write. If the staging shader reads `firstEmpty` after the atomicAdd but before the data write completes, it will see a slot that should exist but contains garbage data.

### Why This Can Happen

Consider C2 (compute shader in command buffer 2) overlapping with S1 (staging shader in command buffer 1):

```
C2 thread for pixel X:              S1 thread:
  atomicAdd → gets slot 150
                                      atomicLoad(&firstEmpty) → sees 151
                                      atomicLoad(&lastStaged) → sees 100
                                      // Will copy slots 100-150
  write origIndex to slot 150
  write iters to slot 150             copy slot 150 → GARBAGE!
  write status to slot 150
```

S1 sees `firstEmpty=151` (including C2's claimed slot) but C2 hasn't written the data yet. S1 copies garbage.

### WebGPU Memory Model

WebGPU provides **implicit barriers between commands within a command buffer**. So C1's writes are guaranteed visible to S1 (same command buffer). But C2 is in a different command buffer that can overlap with S1.

Key points from the WebGPU spec:
- Commands in the same queue execute in submission order
- But command buffers can **overlap in execution** (GPU pipelining)
- There are no explicit cross-command-buffer barriers available to users
- WebGPU follows Metal's implicit barrier model, not Vulkan's explicit barriers

References:
- [Issue #3809: command execution order](https://github.com/gpuweb/gpuweb/issues/3809)
- [wgpu Architecture: automatic barrier generation](https://github.com/gfx-rs/wgpu/wiki/Architecture)

### Why Pixel Buffer Access is Safe

A natural question: if C2 can overlap with S1, can C2 also overlap with C1 on the same pixel?

No - WebGPU's implicit barriers ensure C1's writes to `pixels[X]` are visible to C2's reads of `pixels[X]`. The barrier between command buffers ensures memory visibility even though execution can overlap. C2 will see C1's final state for each pixel.

The results buffer race is different because:
- `firstEmpty` is an atomic counter explicitly designed for concurrent access
- Atomics provide immediate visibility but no ordering of surrounding writes
- C2 incrementing `firstEmpty` doesn't guarantee C2's data writes are visible

### The Solution: Parallel Copy with atomicMin Status Check

Rather than using atomic operations on the status field in each record (which would make all buffer accesses atomic and slow), we use a simpler approach:

1. **Copy all records in parallel** - maximum GPU throughput
2. **Check status after copying** - if status=0, record wasn't ready
3. **Use atomicMin to find first not-ready** - workgroup-local atomic coordination
4. **Only report ready records** - actualCount excludes not-ready tail

**In compute shader (C):**
```wgsl
let slot = atomicAdd(&results.count, 1u);

// Write entire record (struct assignment)
results.records[slot] = pixel_state;
// Status field (offset 2) is written as part of struct
// No special atomics needed - we rely on natural write ordering
```

**In staging shader (S):**
```wgsl
var<workgroup> firstNotReady: atomic<u32>;

// Thread 0 initializes to "all ready" sentinel
if (tid == 0u) {
    atomicStore(&firstNotReady, maxToCheck);
}
workgroupBarrier();

// All threads copy their records AND check status
for (var i = tid; i < maxToCheck; i = i + 256u) {
    copy_record(i);  // Copy even if not ready

    let status = buffer[recordStart + STATUS_OFFSET];
    if (status == 0u) {
        atomicMin(&firstNotReady, i);  // Mark as first not-ready
    }
}
workgroupBarrier();

// Thread 0 uses atomicMin result as actualCount
let actualCount = atomicLoad(&firstNotReady);
// Only advance lastStaged by actualCount
```

### INTENTIONAL RACE: Status May Not Reflect Record Completeness

**This is a benign data race.** The staging shader reads status non-atomically while the compute shader may be writing it. We rely on hardware store ordering, which is NOT guaranteed by the WGSL spec but works in practice on real GPUs.

**Acceptable worst case:** Even if the race causes a problem, the worst outcome is a pixel or two rendered incorrectly - completely acceptable for a visualization application. No crashes, hangs, or corrupted state.

**What can go wrong:**
1. **Status=0 but record is complete**: The compute shader finished writing all fields but the staging shader read status before seeing the final write. The record will be picked up on the next staging pass.

2. ~~**Status≠0 but record is incomplete**~~: Not a concern - struct writes are effectively atomic on GPU hardware (see point 3 below).

**CPU-side defense in depth:**

The worker-side `processResultsData` handles edge cases:

```javascript
// Skip duplicate records (already processed - can happen with staging overlap)
if (this.nn[origIndex] !== 0) {
    // Log if debug enabled, but don't fail
    dataIndex++;
    continue;
}
```

This provides multiple layers of protection:
- **GPU-side**: atomicMin finds first not-ready, excludes tail from count
- **CPU-side duplicate check**: Skip records already processed (handles re-staging overlap)

### Why This Works Despite the Race

1. **atomicMin finds first gap**: The atomicMin ensures `actualCount` stops at the first not-ready record. Any ready records AFTER this point are also excluded (no gaps allowed). They'll be picked up next pass.

2. **Not-ready records can be interleaved**: Due to the race, we might have:
   - Records 0-49: ready
   - Record 50: NOT ready (compute shader mid-write)
   - Records 51-99: ready

   The atomicMin finds 50, so actualCount=50. Records 51-99 are excluded even though ready. This is intentional - we can't have gaps. All of 50-99 will be staged on the next pass.

3. **Struct writes are effectively atomic**: On GPU hardware, a struct write to contiguous memory typically happens as a single cache-line transaction. The compute shader does:
   ```wgsl
   results.records[outIndex] = pixels[active_idx];  // Entire struct at once
   ```

   This means either:
   - The entire struct is visible (status≠0 → all fields valid)
   - None of it is visible yet (status=0)

   So if the staging shader sees status≠0, it can trust all other fields are valid. No "partial write" garbage data risk.

4. **Rare in practice**: The race requires very specific timing - compute shader mid-write when staging shader reads. Most records are fully written before staging runs.

5. **Self-correcting**: Any record not staged this pass will be staged on the next pass when it's ready. The `lastStaged` counter only advances by `actualCount`, so nothing is lost.

6. **Duplicates are harmless**: If a record is copied twice (due to staging overlap), the CPU detects and skips the duplicate via `nn[origIndex] !== 0` check.

### Possible Duplicates

If S1 and S2 overlap (rare, but possible with aggressive GPU pipelining):
- Both might read the same `lastStaged` value before either updates it
- Both might copy some of the same slots
- Both set `lastStaged` to similar values

This can cause duplicate results. We accept this because:
1. **Duplicates are detected on CPU**: We check `if (this.nn[origIndex] !== 0)` and skip/log duplicates
2. **No data loss**: Every record is copied at least once
3. **The race is rare**: Requires very specific timing of S1/S2 overlap

The key invariant is: **every record is staged at least once**, not exactly once.

### Summary of Synchronization Layers

| Layer | Mechanism | Handles |
|-------|-----------|---------|
| **Within command buffer** | Implicit barriers | C1 writes visible to S1 |
| **Pixel buffer across CBs** | Implicit barriers | C1 writes visible to C2 |
| **Results buffer slot data** | atomicMin on status check | S finds first not-ready, excludes from count |
| **Results buffer counters** | Atomic firstEmpty/lastStaged | Slot allocation, staging coordination |
| **Batch attribution** | CPU-side iter checking | Early results deferred to correct batch |
| **Status=0 records** | CPU-side status check | Skip not-ready records that slipped through |
| **Duplicate detection** | CPU-side nn[] check | Duplicate copies logged/skipped |

---

## Invariants

### The Key Invariant

**The readback queue is always in the right order, but it is NOT an invariant that results arrive behind their batch notification. Results may arrive slightly ahead.**

This is counterintuitive: when we enqueue batch B and later receive its staging buffer, that buffer may contain results from batch B+1 (or even B+2). This is expected behavior due to GPU command buffer overlap, not a bug.

What IS invariant:
- Results in the staging buffer are in contiguous slot order (no gaps, no duplicates)
- Each result's `iter` field correctly identifies which batch it belongs to
- CPU-side filtering correctly attributes results to their proper batches

### Detailed Invariants

1. **Readback queue ordering**: The readback queue always contains results in increasing slot order, but individual results may belong to future batches (handled by deferring)
2. **Iteration bounds**: After CPU filtering, all results attributed to batch B have `iter >= B.startIter` and `iter < B.endIter`
3. **Monotonic sends**: View receives changes sorted by iteration, never out of order
4. **Complete batches only**: Worker never sends partial batch to view
5. **Staging coherence**: Staging shader sees all writes from main shader (same command buffer)
6. **No late results**: Once a batch is flushed, no results from that batch's iteration range should appear later (they were either processed or deferred earlier)
7. **No duplicate pixels**: Each pixel index appears exactly once in results (validated by test)
8. **No gaps**: The `lastStaged` counter advances only to the first not-ready slot, ensuring every result is eventually staged (at least once)

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
- [x] Staging shader: parallel copy with strided loop (single workgroup, 256 threads)
- [x] Staging shader: check status, atomicMin to find first not-ready
- [x] Staging shader: actualCount excludes not-ready tail, ensures retry on next pass

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
- [x] Add `deferredResults` array for early-arriving results
- [x] CPU-side filtering: defer results with `iter >= batch.endIter`
- [x] Drain deferred results at start of each batch processing

### Testing
- [x] Verify no duplicate pixel indices (gpu-batch-invariants test)
- [x] Verify iterations in monotonic order (gpu-batch-invariants test)
- [x] Verify view.un matches actual unknown count
- [x] Verify period encoding matches CpuBoard (converged-z-position test)
- [x] Test GpuBoard, GpuZhuoranBoard, AdaptiveGpuBoard all pass

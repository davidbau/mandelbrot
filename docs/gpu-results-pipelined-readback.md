# GPU Pipelined Results Readback (Option B.2)

## Summary
Replace full-buffer GPU -> CPU readback each batch with a pipelined, count-driven
readback that keeps the GPU busy while results are processed one batch behind.
This reduces bandwidth when completed pixels are sparse.

## Goals
- Keep GPU busy (no stalls between batches).
- Reduce readback bandwidth when few pixels complete per batch.
- Preserve current CPU-side update logic (nn/pp, histogram, etc.).
- Remove CPU-mediated compaction from the GPU boards (not part of this round).

## Non-Goals
- No GPU-only compaction of the pixel state buffer.
- No CPU-mediated compaction for GPU boards.
- No changes to existing shader math or convergence logic.

Future work (out of scope for this round): GPU-only compaction, if needed.

## Current Flow (Simplified)
1) GPU compute writes full pixel state buffer.
2) GPU copies full pixel state buffer -> staging buffer.
3) CPU maps staging buffer and processes all pixels.

This copies the entire pixel state every batch, even if few pixels changed.

## Proposed Flow (Option B.2)
Use a results buffer that stores only completed pixels. Read back only the
number of completed pixels each batch. To keep the GPU busy, readback is
one batch behind.

### Buffers
- Pixel state buffer: existing storage buffer (full size).
- Results buffer A/B: new storage buffers (ping-pong), large enough for the
  worst-case number of results (dimsArea entries).
  - Layout:
    - u32 count (entry count)
    - Results[] array of fixed-size entries
- Staging counter A/B: MAP_READ buffer for the count (4 bytes).
- Staging results A/B: MAP_READ buffer for the results (max size).

The results buffer can embed the counter at offset 0, so a separate counter
storage buffer is not required.

### Result Entry Layout
Match the data the CPU currently needs:
- index (u32)
- status (u32) and iter (u32)
- period (u32) if converged
- z values if needed (2 x f32 for dd/gpu, 2 x f32 for pert)

Use a fixed-size entry for easy addressing; include only fields the CPU uses.

## Pipeline Timeline (One-Batch Latency)

GPU timeline:
1) Batch N compute writes results to Results A (counter + entries).
2) Copy counter A -> stagingCounter A.
3) Batch N+1 compute writes results to Results B.
4) Copy counter B -> stagingCounter B.
5) Batch N+2 compute ...
6) (Later) Copy results A -> stagingResults A (partial copy).
7) (Later) Copy results B -> stagingResults B (partial copy).

CPU timeline:
1) While GPU runs batch N, CPU extends refOrbit/speculates.
2) Map stagingCounter A, read countN, unmap.
3) Queue partial copy of results A using countN * entrySize.
4) While GPU runs batch N+1, CPU does refOrbit or other work.
5) Map stagingResults A, process results N, unmap.
6) Repeat for batch N+1 with B.

### Important Property
Results are processed one batch behind, but the GPU never waits for the CPU
because compute for batch N+1 is queued before the partial copy for batch N.

## Interaction with RefOrbit
RefOrbit extension must still happen before dispatch:
- For batch N, CPU extends refOrbit and uploads new iterations (Step 3 today).
- While GPU runs batch N, CPU can speculate for batch N+1.
- At the start of batch N+1, CPU uploads any new refOrbit slices before dispatch.

The results pipeline does not block refOrbit uploads since uploads are queued
before each compute pass.

## Synchronization Notes
- All commands share a single queue; ordering is explicit by submission order.
- Mapping a staging buffer is a sync point. Keep these as small as possible
  (counter only, and then partial results).
- The partial copy of results A happens after batch N+1 compute if queued
  after that compute. This is intentional to keep GPU busy.

## Shared Scheme Across GPU Boards
The same pipelined readback scheme should be used for all three GPU boards
(`GpuBoard`, `GpuZhuoranBoard`, `AdaptiveGpuBoard`). The only variance is the
per-result record size/fields. The refOrbit `iters` buffer is only used by the
Zhuoran boards.

Prefer implementing the scheduling and buffer management in shared base classes
to avoid duplicate logic across board types.

## Required Code Changes (High Level)
- Add results buffers (A/B) and staging buffers for count/results.
- Modify GPU shaders to append completed pixels into results buffers.
  - Use atomic counter to claim an output slot.
- CPU logic:
  - Read counter (A/B) each batch.
  - Queue partial copy of results (A/B) using count.
  - Process results one batch behind.
- Keep existing full pixel state buffer for ongoing iteration state.

## Implementation Sketch

### Results Buffer Layout
Shared header + per-record entries. Each record mirrors the board's PixelState
layout exactly so the CPU can reuse existing field offsets:
- Header: `u32 count` at byte offset 0 (pad to 16 bytes for alignment).
- Records: PixelState entries at fixed stride.

Record sizes:
- `GpuBoard`: 32 bytes (8 fields: orig_index, iter, status, period, zr, zi, base_r, base_i)
- `GpuZhuoranBoard`: 60 bytes (full PixelState)
- `AdaptiveGpuBoard`: 64 bytes (full PixelState + scale)

Keep a fixed stride per board type; expose `RESULT_STRIDE_BYTES` on each class.

### Shader-Side Sequencing (per batch)
1) At batch start, **reset** the results counter to 0.
   - Use a small compute pass or a `queue.writeBuffer` on the first 4 bytes.
2) During compute, when a pixel finishes:
   - `idx = atomicAdd(results.count, 1)`
   - Write a record at `results.records[idx]`.

### CPU-Side Sequencing (per batch)
Within `compute()`:
1) **Pre-dispatch**: extend refOrbit (Zhuoran boards only) and upload new iters.
2) **Dispatch** the GPU compute batch.
3) **Queue counter copy** for this batch’s results buffer to stagingCounter.
4) **Queue next batch** immediately (GPU stays busy).
5) **Map previous batch counter** (one-batch latency), read `count`.
6) **Queue partial copy** of previous batch records (`count * stride`) to stagingResults.
7) **Map previous batch results** (when ready), process records.

### Double-Buffering
Maintain ping-pong buffers for:
- `resultsStorage[2]`
- `stagingCounter[2]`
- `stagingResults[2]`

Use a batch index to select A/B. The CPU always reads buffer `i-1` while GPU
writes buffer `i`.

### Base-Class Responsibilities
Implement a shared helper (likely in `GpuBaseBoard`) to:
- allocate the results/staging buffers
- reset counters
- queue counter/result copies
- map and parse results into a uniform JS structure

Board-specific logic should only define:
- record stride and packing/unpacking of optional payload fields
- how to apply a result record to `nn/pp/z` for that board type

## Risks and Mitigations
- More GPU memory: results buffers sized for worst-case completion.
  - Mitigation: allow max results size to be configurable.
- One-batch latency: UI updates delayed by one batch.
  - Mitigation: keep batch sizes small when user interactions are active.
- Complexity: more buffers and sync points.
  - Mitigation: isolate in a helper class for GPU readback scheduling.

## Open Questions
- What entry format is minimal for CPU processing?
- Should we add a threshold fallback to full-copy?
- What exact per-record layouts do we want for each board type?

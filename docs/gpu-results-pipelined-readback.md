# GPU Results Readback (Queue + Fixed Chunk)

## Summary
Replace per-batch full-buffer readback with a simple queue in GPU memory and a
fixed-size (1%) readback chunk each batch. The CPU reads the queue over time and
catches up if it falls behind. A small header at the start of the readback
buffer carries current GPU state.

## Goals
- Keep GPU busy (no stalls between batches).
- Reduce readback bandwidth when few pixels complete per batch.
- Avoid two-phase “read count then read data” logic.
- Preserve existing CPU-side update logic (nn/pp/z).

## Non-Goals
- No GPU-only compaction in this round.
- No changes to shader math or convergence logic.

## Current Flow (Simplified)
1) GPU compute writes full pixel state buffer.
2) GPU copies full pixel state buffer -> staging buffer.
3) CPU maps staging buffer and processes all pixels.

## Proposed Flow (Queue + Fixed Chunk)
Use a results queue stored in GPU memory. Each batch copies a small fixed chunk
(1% of max results) plus a header to staging. CPU processes as many queue entries
as are available and keeps a read cursor to catch up later.

### Buffers
- Pixel state buffer: existing storage buffer (full size).
- Results queue buffer: storage buffer sized for the maximum number of results.
  - Header (16 bytes):
    - count (atomic u32)
    - active_count (u32)
    - start_iter (u32)
    - iterations_per_batch (u32)
  - Records: fixed-size PixelState entries.
- Staging readback buffers A/B: MAP_READ buffers sized to
  `header + 1% of results`.

### Result Entry Layout
Use the board’s PixelState layout directly:
- `GpuBoard`: 32 bytes (orig_index, iter, status, period, zr, zi, base_r, base_i)
- `GpuZhuoranBoard`: 60 bytes (full PixelState)
- `GpuAdaptiveBoard`: 64 bytes (full PixelState + scale)

### GPU-Side Sequencing (per batch)
1) Thread 0 writes header fields (active_count, start_iter, iterations_per_batch).
2) When a pixel finishes:
   - `idx = atomicAdd(results.count, 1)`
   - write record at `results.records[idx]`
3) No per-batch reset of the count. The queue grows monotonically until complete.

### CPU-Side Sequencing (per batch)
1) Pre-dispatch: extend refOrbit (Zhuoran boards only) and upload new iters.
2) Dispatch compute.
3) Copy header + fixed chunk from results queue into staging.
4) Map staging, read header.count.
5) Process as many records as available from the chunk.
6) Advance read cursor; any backlog is handled in later batches.

### Double-Buffering
Maintain ping-pong staging buffers to avoid mapAsync overlap while GPU work
continues. The results queue buffer itself is single and persistent.

## Interaction with RefOrbit
Unchanged. RefOrbit extension happens before each dispatch; speculative
extension can continue while GPU work runs.

## Synchronization Notes
- All commands are submitted on a single queue.
- Mapping staging buffers is the only sync point; keep them small (1% chunk).
- No “counter read then data read” round-trip. The header is included in every
  fixed-size readback.

## Required Code Changes (High Level)
- Add a results queue buffer and fixed-size staging readback buffers.
- Modify shaders to write header fields and append to the queue.
- CPU logic:
  - Copy a fixed chunk each batch.
  - Use header.count to determine how many entries are valid.
  - Track a read cursor to process entries over time.

## Risks and Mitigations
- Queue is sized for worst-case completion.
  - Mitigation: single allocation reused for the board lifetime.
- CPU might lag behind results.
  - Mitigation: fixed chunk reads eventually catch up; queue never overwrites.

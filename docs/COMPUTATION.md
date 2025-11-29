# Computation Architecture

How work is distributed across threads and GPUs, and how results flow back
to create the final image.

## The Three-Tier Pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│                             MAIN THREAD                              │
│                                                                      │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Grid    │  │ Scheduler │  │    View     │  │     Canvas      │  │
│  │ (manages  │─►│ (assigns  │  │  (pixels,   │─►│    (display)    │  │
│  │  views)   │  │  work)    │  │  histogram) │  │                 │  │
│  └───────────┘  └─────┬─────┘  └──────▲──────┘  └─────────────────┘  │
│                       │               │                              │
└───────────────────────┼───────────────┼──────────────────────────────┘
                        │               │
     createBoard        │               │  changeList
     {k, size, re, im}  │               │  {nn, pp}
                        ▼               │
┌──────────────────────────────────────────────────────────────────────┐
│                            WEB WORKERS                               │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                           Board                                │  │
│  │                                                                │  │
│  │  Arrays:  nn (iterations)  pp (periods)  zz (current z)        │  │
│  │           cc (c values)    bb (checkpoints)                    │  │
│  │                                                                │  │
│  │  Perturbation (deep zoom):  dc, dz, refIter, refOrbit          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                     │                                                │
│       GPU available │                                                │
│                     ▼                                                │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                        GpuBoard                                │  │
│  │                                                                │  │
│  │  Buffers:  iterations (read/write)    staging (for readback)   │  │
│  │            zValues, cValues           uniforms (params)        │  │
│  └────────────────────────┬───────────────────────────────────────┘  │
│                           │                                          │
└───────────────────────────┼──────────────────────────────────────────┘
                            │
       dispatch + readback  │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                           GPU SHADER                                 │
│                                                                      │
│  @compute @workgroup_size(64)                                        │
│  fn main(index):                                                     │
│      if iterations[index] != 0: return     // skip finished          │
│      z = zValues[index]                                              │
│      for batch_size iterations:                                      │
│          z = z² + c                                                  │
│          if |z| > 2: iterations[index] = i; return                   │
│      zValues[index] = z                    // continue next batch    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Data flow summary:**
- Main → Worker: `createBoard` with coordinates and size
- Worker → GPU: buffer writes (z, c values) and compute dispatch
- GPU → Worker: buffer readback (iterations, convergence status)
- Worker → Main: `changeList` with newly finished pixels

## Sparse, Infinite Computation

The explorer computes forever, refining as you watch. The trick is to be smart
about what to compute.

After the first pass, many pixels are already done:
- **Diverged**: escaped to infinity, so we know the escape iteration
- **Converged**: detected a periodic cycle, definitely in the set
- **Chaotic**: still unknown, needs more iterations

The sparse computation only iterates pixels that are still chaotic. This means
90% of the work might be done after 1000 iterations, but we can continue to
1 million iterations for the remaining 10% without wasting time on known pixels.

Consider a 1000×1000 image with one million pixels. Without sparsity, computing
1 million iterations means 10^12 operations. With sparsity, after early divergers
finish (say 90% by iteration 1000), we have only 100,000 active pixels. The next
million iterations cost 10^11 operations. As more pixels finish, cost drops
further. Sparsity makes infinite refinement practical.

## Board Lifecycle

A "Board" is the computational unit, representing one zoom level's worth of
pixel data. It knows how to compute iterations for those pixels.

### Creation

When you click to zoom, the flow is:

1. **Main thread**: Grid creates a new View at the click location
2. **Scheduler**: Picks a worker and sends `createBoard` message
3. **Worker**: Creates appropriate Board type based on zoom depth and GPU availability

**With GPU enabled:**
- Shallow zoom (pixelSize > 1e-6): `GpuBoard` using float32
- Deep zoom (pixelSize ≤ 1e-6): `GpuZhuoranBoard` with perturbation theory

**Without GPU (CPU fallback):**
- Shallow zoom (pixelSize > 1e-12): `CpuBoard` using float64
- Deep zoom (pixelSize ≤ 1e-12): `PerturbationBoard` with quad-double reference

The thresholds differ because GPU uses float32 (loses precision around 1e-6) while
CPU uses float64 (good to about 1e-15). Both switch to perturbation theory when
standard precision fails.

```javascript
// Worker selecting board type
if (gpuAvailable) {
  board = pixelSize > 1e-6 ? new GpuBoard(...) : new GpuZhuoranBoard(...);
} else {
  board = pixelSize > 1e-12 ? new CpuBoard(...) : new PerturbationBoard(...);
}
```

### Computation Loop

Boards compute in batches, sending updates periodically:

```javascript
while (board.un > 0) {
  // Compute a batch of iterations
  const changes = board.compute();

  // Send update every ~300ms
  if (Date.now() - board.lastTime > 300) {
    postMessage({
      type: 'update',
      k: board.k,
      changeList: board.changeList,
      un: board.un,
      di: board.di,
      it: board.it
    });
    board.changeList = [];
    board.lastTime = Date.now();
  }
}
```

### Compaction

As pixels finish, boards "compact" to only track active pixels:

```javascript
compact() {
  // When more than half are done, rebuild active list
  if (this.un < this.pixelIndexes.length / 2) {
    this.pixelIndexes = this.pixelIndexes.filter(i => this.nn[i] === 0);
  }
}
```

This keeps memory usage reasonable and iteration loops tight.

## Data Structures

Each Board maintains several arrays that work together. Typed arrays are 10-100x
faster to iterate than objects, and they transfer directly to GPU buffers without
conversion. The separation also enables selective updates: when a pixel diverges,
only `nn` changes and we don't touch the other arrays.

### Core Arrays

| Array | Type | Purpose |
|-------|------|---------|
| `nn` | Int32 | Iteration count per pixel. 0 = unfinished, >0 = diverged at that iter, <0 = converged |
| `pp` | Int32 | Period of convergence (for `nn < 0` pixels) |
| `cc` | Float64 | Complex c value per pixel [re, im] pairs |
| `zz` | Float64 | Current z value per pixel [re, im] pairs |
| `bb` | Float64 | Checkpoint z value for cycle detection |

### Perturbation Arrays (ZhuoranBoard)

| Array | Type | Purpose |
|-------|------|---------|
| `dc` | Float64 | Delta c from reference point |
| `dz` | Float64 | Current perturbation delta |
| `refIter` | Int32 | Which reference iteration each pixel follows |
| `refOrbit` | Float64×4 | Quad-double reference orbit values |

### GPU Buffers (GpuBoard)

GPU boards use WebGPU buffers for parallel computation:
- Compute buffers (read/write in shader)
- Staging buffers (for CPU readback)
- Uniform buffer (parameters)

## Worker Pool Management

The Scheduler maintains multiple workers for parallel computation. This lets us
compute several zoom levels simultaneously: while you're looking at one view,
deeper views are already computing in other workers. The pool size matches CPU
core count (up to 8) to maximize throughput without oversubscription.

```javascript
class Scheduler {
  constructor() {
    // Start with CPU count workers, up to a reasonable max
    this.numWorkers = Math.min(navigator.hardwareConcurrency || 4, 8);
    this.workers = [];
    this.workerBoards = new Map(); // worker -> Set of board keys
  }
}
```

### Load Balancing

Workers can be idle, busy, or overloaded. As computation progresses, some boards
finish quickly (mostly divergent pixels) while others take much longer (near the
set boundary). The scheduler redistributes boards to keep all workers busy:

```javascript
handleWorkerMessage(worker, message) {
  if (message.type === 'update') {
    // If worker has too many boards and another is idle, transfer
    if (this.workerBoards.get(worker).size > 2) {
      const idleWorker = this.findIdleWorker();
      if (idleWorker) {
        this.transferBoard(worker, idleWorker, message.k);
      }
    }
  }
}
```

### Board Transfers

Boards can move between workers for balancing. This involves serializing
the board state, transferring it, and reconstructing on the new worker:

```javascript
// Serialize board state (excluding large pixel arrays)
serialize() {
  return {
    type: this.constructor.name,
    k: this.k,
    sizes: this.sizes,
    it: this.it,
    un: this.un,
    di: this.di,
    // ... other state
  };
}
```

## GPU Computation

WebGPU boards use compute shaders for massive parallelism:

### Shader Architecture

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.pixel_count) { return; }

  // Skip finished pixels
  if (iterations[index] != 0) { return; }

  // Load z value
  var zr = zValues[index * 2];
  var zi = zValues[index * 2 + 1];

  // Iterate
  for (var i = 0u; i < params.batch_size; i++) {
    // z = z² + c
    let new_zr = zr * zr - zi * zi + cValues[index * 2];
    let new_zi = 2.0 * zr * zi + cValues[index * 2 + 1];
    zr = new_zr;
    zi = new_zi;

    // Check divergence
    if (zr * zr + zi * zi > 4.0) {
      iterations[index] = params.current_iter + i;
      return;
    }
  }

  // Store z for next batch
  zValues[index * 2] = zr;
  zValues[index * 2 + 1] = zi;
}
```

### Batch Size Tuning

GPU batches are sized based on active pixel count:

```javascript
// More pixels → smaller batches (stay responsive)
// Fewer pixels → larger batches (GPU efficiency)
const iterationsPerBatch = Math.min(1000, Math.max(100,
  Math.floor(1111211 / Math.max(this.un, 1))));
```

There is a tradeoff between GPU efficiency and UI responsiveness. Large batches
use the GPU efficiently with less dispatch overhead per iteration, but they block
the CPU from updating the display. Small batches update frequently but waste time
on dispatch overhead.

The constant 1111211 targets roughly 1 million pixel-iterations per batch. With
500,000 active pixels, that means about 2 iterations per batch. With 1000 active
pixels, that means about 1000 iterations per batch. The formula automatically
shifts from "stay responsive" (many pixels, small batches) to "maximize throughput"
(few pixels, large batches) as computation progresses. The min/max bounds of
100-1000 prevent extreme values.

### Buffer Management

GPU boards use persistent staging buffers to avoid allocation overhead:

```javascript
createBuffers() {
  // Staging buffers for CPU readback (created once, reused)
  this.stagingIterations = this.device.createBuffer({
    size: this.pixelCount * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
}
```

## Change Lists

Rather than sending entire pixel arrays, boards send change lists. A 1000×1000
image has a million pixels, but in any batch only thousands finish. Sending the
full array would waste bandwidth and trigger expensive memory copies:

```javascript
{
  nn: [index1, value1, index2, value2, ...],  // Iteration changes
  vv: [index1, period1, index2, period2, ...]  // Period changes
}
```

This minimizes transfer overhead, especially late in computation when
changes are sparse.

## View Updates

When changes arrive on the main thread:

```javascript
updateViewFromWorkerResult(result) {
  const view = this.views[result.k];
  if (!view) return;

  // Apply iteration changes
  for (let i = 0; i < result.changeList.nn.length; i += 2) {
    const index = result.changeList.nn[i];
    const value = result.changeList.nn[i + 1];
    view.nn[index] = value;
  }

  // Update histogram
  view.updateHistogram();

  // Trigger redraw
  this.redrawProcess.requestRedraw(view.k);
}
```

## Computation Priority

The scheduler prioritizes boards based on:

1. **Visibility**: Visible views compute before hidden ones
2. **Unfinished count**: Views with more unknowns get more time
3. **Recency**: Recently clicked views get priority

The view you just clicked should compute first, but older views still need
cycles to finish their remaining pixels. The priority system balances immediate
responsiveness with background completion.

## Performance Optimizations

### Reduced Buffer Readbacks

GPU boards minimize CPU↔GPU data transfer:

```javascript
async compute() {
  // First pass: only read iterations + status (small)
  const iterData = await this.readBuffer(this.buffers.iterations);

  // Second pass: only read expensive data if pixels converged
  if (hasConvergedPixels) {
    const positionData = await this.readBuffer(this.buffers.positions);
    // Process convergence with full data
  }
}
```

### Incremental Reference Orbit

For perturbation boards, reference orbit uploads incrementally:

```javascript
if (this.refIterations > this.lastUploadedRefIterations) {
  // Only upload NEW reference orbit values
  const startIdx = this.lastUploadedRefIterations;
  const newValues = this.refOrbit.slice(startIdx);
  this.device.queue.writeBuffer(this.refOrbitBuffer, startIdx * 8, newValues);
  this.lastUploadedRefIterations = this.refIterations;
}
```

### Sparse Iteration

Once fewer than half the pixels are active, switch to sparse mode:

```javascript
if (this.un < this.config.dimsArea / 2) {
  // Only iterate active pixels
  for (const index of this.pixelIndexes) {
    this.iteratePixel(index);
  }
} else {
  // Iterate all pixels
  for (let i = 0; i < this.config.dimsArea; i++) {
    if (this.nn[i] === 0) {
      this.iteratePixel(i);
    }
  }
}
```

### Quad-Precision Compositing Coordinates

When compositing child views over parents, coordinate calculations must be
precise. At zoom 10^25, the child's center differs from the parent's by perhaps
10^-20 in absolute terms, far below double precision's ~10^-15 relative accuracy.

The child and parent centers are both stored in double-double precision, accurate
to 31 digits. But to composite, we need the *offset* between them, and subtracting
two nearly-equal numbers loses precision catastrophically. If
parentCenter = 0.123456789012345678901234567890 and
childCenter = 0.123456789012345678901234567891, the difference is 10^-30, but
double precision sees them as equal. Without extended precision arithmetic,
the child would appear at the wrong position.

The solution is to use double-double arithmetic for the coordinate mapping, even
though the final pixel positions are screen-resolution integers:

```javascript
calculateParentMapping() {
  const temp = new Float64Array(4);

  // childLeft = childCenterR - childSize / 2
  // Using quad-double addition for precision
  AqdAdd(temp, 0, childCenterR[0], childCenterR[1], -childSize / 2, 0);
  const childLeft = [temp[0], temp[1]];

  // parentLeft = parentCenterR - parentSize / 2
  AqdAdd(temp, 0, parentCenterR[0], parentCenterR[1], -parentSize / 2, 0);
  const parentLeft = [temp[0], temp[1]];

  // sx = ((childLeft - parentLeft) / parentSize) * dimsWidth
  AqdAdd(temp, 0, childLeft[0], childLeft[1], -parentLeft[0], -parentLeft[1]);
  const sx = ((temp[0] + temp[1]) / parentSize) * dimsWidth;

  return { sx, sy, sw, sh };
}
```

The final subtraction `childLeft - parentLeft` would cause catastrophic
cancellation in double precision when subtracting nearly equal large numbers.
By carrying the computation in double-double until the last step, we preserve
enough precision to get correct pixel alignment. The result is then converted
to a screen coordinate, which only needs about 10 bits of precision. The
intermediate precision matters far more than the output precision.

## Error Handling

Workers can crash or WebGPU can fail. The scheduler handles this gracefully:

```javascript
worker.onerror = (error) => {
  console.error('Worker error:', error);
  // Recreate worker
  this.replaceWorker(worker);
  // Redistribute its boards
  for (const k of this.workerBoards.get(worker)) {
    this.reassignBoard(k);
  }
};
```

GPU failures fall back to CPU:

```javascript
try {
  board = new GpuBoard(...);
  await board.init();
} catch (e) {
  console.warn('GPU failed, falling back to CPU');
  board = new CpuBoard(...);
}
```

## Next Steps

- [ALGORITHMS.md](ALGORITHMS.md): The mathematical algorithms inside boards
- [ARCHITECTURE.md](ARCHITECTURE.md): Overall application structure

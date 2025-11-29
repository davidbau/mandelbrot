# Computation Architecture

The Mandelbrot explorer computes fractals incrementally, sparsely, and in parallel.
This document explains how work is distributed across threads and GPUs, how boards
manage their lifecycle, and how results flow back to create the final image.

## The Core Insight: Sparse, Infinite Computation

This explorer computes forever, refining the image as you watch. The trick
is being smart about what to compute.

After the first pass, many pixels are already "done":
- **Diverged**: escaped to infinity (we know the escape iteration)
- **Converged**: detected a periodic cycle (definitely in the set)
- **Chaotic**: still unknown, needs more iterations

The sparse computation only iterates pixels that are still chaotic. This means
90% of the work might be done after 1000 iterations, but we can continue to
1 million iterations for the remaining 10% without wasting time on known pixels.

## Board Lifecycle

A "Board" is the computational unit - it represents one zoom level's worth of
pixel data and knows how to compute iterations for those pixels.

### Creation

When you click to zoom, the flow is:

1. **Main thread**: Grid creates a new View at the click location
2. **Scheduler**: Picks a worker and sends `createBoard` message
3. **Worker**: Creates appropriate Board type based on zoom depth:
   - Shallow zoom (pixelSize > 1e-6): `GpuBoard` or `CpuBoard`
   - Deep zoom (pixelSize ≤ 1e-6): `GpuZhuoranBoard` or `ZhuoranBoard`

```javascript
// Scheduler selecting board type
const pixelSize = data.size / data.config.dims;
if (pixelSize > 1e-6) {
  board = config.enableGPU ? new GpuBoard(...) : new CpuBoard(...);
} else {
  board = config.enableGPU ? new GpuZhuoranBoard(...) : new ZhuoranBoard(...);
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

Each Board maintains several arrays that work together:

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

The Scheduler maintains multiple workers for parallel computation:

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

Workers can be idle, busy, or overloaded. The scheduler redistributes:

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

Rather than sending entire pixel arrays, boards send change lists:

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

## Error Handling

Workers can crash or WebGPU can fail. The scheduler handles gracefully:

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

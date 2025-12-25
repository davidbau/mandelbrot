# WebGL Ping-Pong Design for Gap-Free GPU Iteration

## Executive Summary

This document describes the design for `GlBoard`, a new board implementation using WebGL 2 with ping-pong rendering to achieve gap-free GPU pipelining for Mandelbrot iteration. The key insight is that WebGL's driver-managed synchronization can keep the GPU continuously busy across dependent render passes, eliminating the GPU idle gaps inherent in our WebGPU implementation.

## Background

### The GPU Gap Problem

Our current WebGPU implementation suffers from GPU idle gaps between computation batches:

```
GPU:  [==Batch 0==]      [==Batch 1==]      [==Batch 2==]
                    ↑gap↑            ↑gap↑
CPU:           [map][process][submit]  [map][process][submit]
```

Each batch requires a CPU round-trip: mapping the staging buffer, processing results, and submitting the next command buffer. During this time, the GPU sits idle.

### Why WebGPU Can't Solve This

WebGPU provides synchronization *within* a command buffer (dispatches have implicit memory barriers), but not *across* command buffers. To queue dependent work ahead of time, you need GPU-side synchronization primitives:

| API | Cross-Command-Buffer Sync |
|-----|---------------------------|
| Vulkan | Semaphores, timeline semaphores |
| Metal | MTLEvent, MTLFence |
| CUDA | Stream events |
| WebGPU | **None** |

WebGPU chose not to expose these primitives for safety and portability reasons. The only options in WebGPU are:
1. Put all dispatches in one command buffer (finite, must be pre-recorded)
2. CPU synchronization between command buffers (causes gaps)

See [Appendix A](#appendix-a-why-not-webgpu) for detailed discussion.

### WebGL's Implicit Synchronization

WebGL takes the opposite approach: the driver manages everything. When you issue draw calls:

```javascript
gl.bindFramebuffer(gl.FRAMEBUFFER, fbB);
gl.bindTexture(gl.TEXTURE_2D, texA);  // Read from A
gl.drawArrays(gl.TRIANGLES, 0, 6);     // Write to B
```

The driver:
1. Tracks resource dependencies automatically
2. Batches draw calls into command buffers internally
3. Inserts GPU-side synchronization (fences/semaphores) as needed
4. Keeps the GPU pipeline full

For ping-pong rendering, this means the driver can queue thousands of dependent render passes with no gaps—it has access to the synchronization primitives that WebGPU doesn't expose.

### GPGPU via Fragment Shaders

Before compute shaders, GPU computation was done by:
1. Storing data in textures (as RGBA pixels)
2. Rendering a full-screen quad
3. Fragment shader reads input texture, computes, outputs to render target
4. Ping-pong between two framebuffers

This is less flexible than compute shaders (no shared memory, no arbitrary writes, no atomics), but sufficient for Mandelbrot iteration where each pixel is independent.

### Multiple Render Targets (MRT)

WebGL 2 supports writing to multiple textures simultaneously:

```javascript
gl.drawBuffers([
  gl.COLOR_ATTACHMENT0,  // Output 0
  gl.COLOR_ATTACHMENT1,  // Output 1
  gl.COLOR_ATTACHMENT2,  // Output 2
  gl.COLOR_ATTACHMENT3   // Output 3
]);
```

```glsl
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;
// ...
```

Typical limits:
- `MAX_DRAW_BUFFERS`: 4-8
- Each output: vec4 (4 floats)
- Total: 16-32 floats per pixel

This is sufficient for GpuBoard state (z, iter, status) and GpuZhuoranBoard state (z, dz, iter, refIndex).

## Overall Strategy

### Core Idea

Replace WebGPU compute shaders with WebGL fragment shaders for the iteration loop. The driver handles pipelining, giving us gap-free GPU execution:

```
GPU:  [==Batch 0==][==Batch 1==][==Batch 2==][==Batch 3==]...
                (no gaps - driver manages sync)
CPU:  [queue 100s of batches]...[eventually read results]
```

### Hybrid Approach

WebGL handles the continuous iteration loop. Results are collected less frequently:

1. **Iteration loop** (WebGL, continuous): Fragment shader iterates, updates state
2. **Results collection** (periodic): Read status texture, identify escaped pixels
3. **Canvas update** (periodic): Draw escaped pixels to visible canvas

The iteration never stops for results—we just sample the state periodically.

### Why Not Pure WebGL?

We still use the existing infrastructure (Grid, View, WorkScheduler) for:
- Pixel assignment and view management
- Results processing and canvas rendering
- Coordination with other board types
- Deep zoom with perturbation (future: could add GlZhuoranBoard)

GlBoard is a drop-in replacement for GpuBoard in the board hierarchy.

## Class Hierarchy

```
Board (abstract)
├── CpuBoard
├── GpuBoard (WebGPU)
├── GlBoard (WebGL) ← NEW
├── GpuZhuoranBoard (WebGPU + perturbation)
├── GlZhuoranBoard (WebGL + perturbation) ← FUTURE
└── ... other boards
```

### GlBoard Responsibilities

```javascript
class GlBoard extends Board {
  // WebGL resources
  gl;                    // WebGL2RenderingContext
  program;               // Shader program
  pingFB, pongFB;        // Ping-pong framebuffers
  pingTex, pongTex;      // State textures (RGBA32F)
  resultsTex;            // Escaped pixels texture

  // State
  readFB, writeFB;       // Current read/write assignment
  readTex, writeTex;

  // Methods
  constructor(k, rect, worker)
  initWebGL()
  initShaders()
  initTextures()
  initFramebuffers()

  start(pixels, config)   // Initialize pixel state
  iterate(n)              // Queue n iterations (non-blocking)
  flush()                 // Ensure all iterations complete
  readResults()           // Read escaped pixels

  // Internal
  swapBuffers()           // Ping-pong swap
  queueIteration()        // Submit one iteration pass
}
```

## Data Flow

### Texture Layout (MRT Implementation)

GlBoard uses Multiple Render Targets (MRT) to maintain both iteration state and convergence checkpoint data in parallel. Each ping-pong buffer pair consists of two textures:

**State Texture (RGBA32F, COLOR_ATTACHMENT0):**
```
R: z.real        (float32, current z position)
G: z.imag        (float32)
B: iterations    (float32, integer value, global iteration count when finished)
A: status        (float32: 0=active, 1=escaped, 2=converged)
```

**Checkpoint Texture (RGBA32F, COLOR_ATTACHMENT1):**
```
R: checkpoint_zr  (float32, z position at last Fibonacci checkpoint)
G: checkpoint_zi  (float32)
B: period         (float32, iteration when convergence first detected)
A: (reserved)
```

The MRT framebuffer setup:
```javascript
const fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex, 0);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, checkpointTex, 0);
gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
```

For reading, we create temporary single-texture framebuffers since `gl.readPixels()` reads from a specific attachment.

### Data Flow Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              GlBoard                         │
                    │                                              │
  start(pixels) ───►│  ┌──────────┐      ┌──────────┐            │
                    │  │ Ping Tex │◄────►│ Pong Tex │            │
                    │  │ (state)  │      │ (state)  │            │
                    │  └────┬─────┘      └─────┬────┘            │
                    │       │    ping-pong     │                  │
                    │       ▼                  ▼                  │
                    │  ┌─────────────────────────────┐           │
                    │  │     Fragment Shader          │           │
                    │  │  - Read current z, iter      │           │
                    │  │  - Compute z = z² + c        │           │
                    │  │  - Check escape              │           │
                    │  │  - Write new state           │           │
                    │  └──────────────┬──────────────┘           │
                    │                 │                           │
                    │                 ▼                           │
                    │  ┌──────────────────────────────┐          │
   readResults() ◄──┼──│     Results Texture          │          │
                    │  │  (escaped pixel data)        │          │
                    │  └──────────────────────────────┘          │
                    │                                              │
                    └─────────────────────────────────────────────┘
                                      │
                                      ▼
                              Grid.updateCanvas()
```

### Iteration Data Flow

```
Frame N:
  Read:  pingTex[x,y] → {z, iter, status}
  Compute: if status == active:
             z' = z² + c
             if |z'| > 4: status = escaped, write to resultsTex
             else: iter++
  Write: pongTex[x,y] ← {z', iter, status}

Frame N+1:
  Read:  pongTex[x,y] → {z, iter, status}
  Write: pingTex[x,y] ← {z', iter, status}
  (roles swapped)
```

## MRT Usage

### Current Design (GlBoard, single output)

For the basic GlBoard, we only need 4 floats per pixel, so a single render target suffices:

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_state;      // Current state (ping or pong)
uniform vec2 u_resolution;      // Texture dimensions
uniform vec2 u_cMin;            // Complex plane bounds
uniform vec2 u_cMax;
uniform int u_iterations;       // Iterations this batch
uniform float u_escapeRadius;   // Typically 4.0

out vec4 fragColor;             // New state

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 state = texture(u_state, uv);

  float zr = state.r;
  float zi = state.g;
  float iter = state.b;
  float status = state.a;

  // c from pixel position
  vec2 c = mix(u_cMin, u_cMax, uv);

  if (status == 0.0) {  // Active pixel
    for (int i = 0; i < u_iterations; i++) {
      // z = z² + c
      float zr2 = zr * zr - zi * zi + c.x;
      float zi2 = 2.0 * zr * zi + c.y;
      zr = zr2;
      zi = zi2;
      iter += 1.0;

      if (zr * zr + zi * zi > u_escapeRadius) {
        status = 1.0;  // Escaped
        break;
      }
    }
  }

  fragColor = vec4(zr, zi, iter, status);
}
```

### Future Design (GlZhuoranBoard, MRT)

For perturbation-based boards with more state:

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_state0;     // z, iter, status
uniform sampler2D u_state1;     // dz, refIndex

layout(location = 0) out vec4 out_state0;
layout(location = 1) out vec4 out_state1;

void main() {
  // Read both state textures
  vec4 s0 = texture(u_state0, uv);
  vec4 s1 = texture(u_state1, uv);

  // ... perturbation iteration logic ...

  out_state0 = vec4(new_z, new_iter, new_status);
  out_state1 = vec4(new_dz, new_refIndex, 0.0);
}
```

Framebuffer setup for MRT:
```javascript
gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingFB);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pingTex0, 0);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.pingTex1, 0);
gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
```

## Timeline of a Typical Cycle

### Initialization

```
Time 0ms: GlBoard.constructor()
  - Get WebGL2 context
  - Compile shaders
  - Create ping/pong textures and framebuffers

Time 5ms: GlBoard.start(pixels, config)
  - Upload initial state to ping texture
  - Set uniforms (cMin, cMax, escapeRadius)
```

### Steady-State Iteration

```
Time 10ms: GlBoard.iterate(1000)
  - Queue 1000 draw calls (non-blocking)
  - Each draw: bind read texture, bind write framebuffer, draw quad, swap
  - Driver batches and pipelines internally
  - Returns immediately (GPU works in background)

Time 10ms-500ms: GPU executes iterations
  [=========================================]
  (continuous, no gaps, driver manages sync)

Time 500ms: GlBoard.readResults()
  - gl.readPixels() on state texture
  - Scan for escaped pixels (status == 1)
  - Return changelist to Grid

Time 505ms: Grid.updateCanvas()
  - Draw escaped pixels to canvas

Time 510ms: GlBoard.iterate(1000)
  - Queue more iterations
  - GPU was already working, continues seamlessly
```

### Key Timing Characteristics

| Operation | Blocking? | GPU Idle? |
|-----------|-----------|-----------|
| iterate(n) | No | No |
| readResults() | Yes (gl.readPixels) | Brief |
| Canvas draw | No (separate context) | No |

The `gl.readPixels()` is a sync point, but:
1. We do it infrequently (every 500ms or so)
2. GPU may continue on queued work during the sync
3. We immediately queue more work after

### Comparison with WebGPU

```
WebGPU (current):
GPU: [==B0==]     [==B1==]     [==B2==]     [==B3==]
           ↑gap↑       ↑gap↑       ↑gap↑

WebGL (proposed):
GPU: [==B0==][==B1==][==B2==][==B3==][==B4==][==B5==]...
     (continuous, driver-managed pipelining)
```

## Results Collection Strategy

### The Challenge

WebGL fragment shaders can't do atomicAdd to a results buffer. In WebGPU, we used atomic counters to pack sparse results (escaped pixels) into a dense results buffer—reading only ~1% of the data. Without atomics, a naive approach would read the entire state texture every time, which is prohibitively expensive:

- Full texture (2940×1600): **75 MB** per read at RGBA32F
- Dense results (1% escaped): **750 KB** per read
- **100× bandwidth difference**

Over billions of iterations, each pixel completes at most once. Results are inherently sparse, and bandwidth cost would dominate if we read the full texture.

### Solution: Hierarchical Reduction with Adaptive Readback

We use a two-level tile hierarchy to identify which regions contain escaped pixels, then read only those regions. This adapts automatically to both dense escapes (early in computation) and sparse escapes (later).

#### Hierarchy Structure

For a 2940×1600 viewport with 16×16 tiles:

```
Level 0 (State):    2940×1600 pixels     = 4,704,000 entries (75 MB)
Level 1 (Tiles):    184×100 tiles        = 18,400 entries    (295 KB)
Level 2 (Super):    12×7 super-tiles     = 84 entries        (1.3 KB)
```

Each level reduces by 16×16 = 256×. Two reduction passes get us from millions of pixels to 84 super-tile summaries.

#### Texture Formats

**Level 0 (State Texture, RGBA32F):**
```
R: z.real
G: z.imag
B: iterations
A: status (0=active, 1=escaped, 2=maxiter)
```

**Level 1 (Tile Summary, RGBA32F):**
```
R: escape count in this 16×16 tile (0-256)
G: newly escaped count since last read
B: (reserved)
A: has_escapes flag (1.0 if any escaped, 0.0 otherwise)
```

**Level 2 (Super-Tile Summary, RGBA32F):**
```
R: total escape count in this 16×16 group of tiles
G: newly escaped count
B: (reserved)
A: has_escapes flag
```

#### GPU Reduction Passes

**Pass 1: Level 0 → Level 1 (Tile Reduction)**

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_state;        // Level 0 state texture
uniform sampler2D u_prevTiles;    // Previous tile counts (for "newly escaped")
uniform vec2 u_stateSize;         // State texture dimensions

out vec4 tileInfo;

void main() {
  ivec2 tileCoord = ivec2(gl_FragCoord.xy);
  ivec2 basePixel = tileCoord * 16;

  float escapeCount = 0.0;
  float hasEscapes = 0.0;

  // Sample all 256 pixels in this 16×16 tile
  for (int dy = 0; dy < 16; dy++) {
    for (int dx = 0; dx < 16; dx++) {
      ivec2 pixel = basePixel + ivec2(dx, dy);
      if (pixel.x < int(u_stateSize.x) && pixel.y < int(u_stateSize.y)) {
        vec4 state = texelFetch(u_state, pixel, 0);
        if (state.a == 1.0) {  // Escaped
          escapeCount += 1.0;
          hasEscapes = 1.0;
        }
      }
    }
  }

  // Compare with previous count to find newly escaped
  vec4 prev = texelFetch(u_prevTiles, tileCoord, 0);
  float newlyEscaped = escapeCount - prev.r;

  tileInfo = vec4(escapeCount, newlyEscaped, 0.0, hasEscapes);
}
```

**Pass 2: Level 1 → Level 2 (Super-Tile Reduction)**

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_tiles;        // Level 1 tile texture
uniform vec2 u_tilesSize;         // Tile texture dimensions

out vec4 superTileInfo;

void main() {
  ivec2 superCoord = ivec2(gl_FragCoord.xy);
  ivec2 baseTile = superCoord * 16;

  float totalEscapes = 0.0;
  float totalNew = 0.0;
  float hasEscapes = 0.0;

  // Sample all 256 tiles in this 16×16 super-tile
  for (int dy = 0; dy < 16; dy++) {
    for (int dx = 0; dx < 16; dx++) {
      ivec2 tile = baseTile + ivec2(dx, dy);
      if (tile.x < int(u_tilesSize.x) && tile.y < int(u_tilesSize.y)) {
        vec4 tileData = texelFetch(u_tiles, tile, 0);
        totalEscapes += tileData.r;
        totalNew += tileData.g;
        if (tileData.a > 0.0) hasEscapes = 1.0;
      }
    }
  }

  superTileInfo = vec4(totalEscapes, totalNew, 0.0, hasEscapes);
}
```

#### CPU Adaptive Readback Algorithm

```javascript
readResults() {
  // Step 1: Run GPU reduction passes
  this.runReductionPass1();  // Level 0 → Level 1
  this.runReductionPass2();  // Level 1 → Level 2

  // Step 2: Read tiny Level 2 (84 entries = 1.3 KB)
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.level2FB);
  const superTiles = new Float32Array(12 * 7 * 4);
  gl.readPixels(0, 0, 12, 7, gl.RGBA, gl.FLOAT, superTiles);

  // Step 3: Find super-tiles with escapes
  const activeSuperTiles = [];
  for (let sy = 0; sy < 7; sy++) {
    for (let sx = 0; sx < 12; sx++) {
      const idx = (sy * 12 + sx) * 4;
      const newlyEscaped = superTiles[idx + 1];
      if (newlyEscaped > 0) {
        activeSuperTiles.push({ x: sx, y: sy, count: newlyEscaped });
      }
    }
  }

  if (activeSuperTiles.length === 0) return [];  // No new escapes

  // Step 4: Read Level 1 regions for active super-tiles only
  const activeTiles = [];
  for (const st of activeSuperTiles) {
    // Read 16×16 region of tiles (1 KB each)
    const tileData = new Float32Array(16 * 16 * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.level1FB);
    gl.readPixels(st.x * 16, st.y * 16, 16, 16, gl.RGBA, gl.FLOAT, tileData);

    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        const idx = (ty * 16 + tx) * 4;
        const newlyEscaped = tileData[idx + 1];
        if (newlyEscaped > 0) {
          activeTiles.push({
            x: st.x * 16 + tx,
            y: st.y * 16 + ty,
            count: newlyEscaped
          });
        }
      }
    }
  }

  // Step 5: Read Level 0 pixels for active tiles only
  const changes = [];
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFB);

  for (const tile of activeTiles) {
    // Read 16×16 pixel region (1 KB each at RGBA32F)
    const pixels = new Float32Array(16 * 16 * 4);
    gl.readPixels(tile.x * 16, tile.y * 16, 16, 16, gl.RGBA, gl.FLOAT, pixels);

    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const localIdx = (py * 16 + px) * 4;
        const status = pixels[localIdx + 3];

        if (status === 1.0) {  // Escaped
          const globalX = tile.x * 16 + px;
          const globalY = tile.y * 16 + py;
          const globalIdx = globalY * this.width + globalX;

          if (!this.reported[globalIdx]) {
            changes.push({
              index: globalIdx,
              iterations: pixels[localIdx + 2],
              zr: pixels[localIdx + 0],
              zi: pixels[localIdx + 1]
            });
            this.reported[globalIdx] = true;
          }
        }
      }
    }
  }

  // Step 6: Swap tile buffers for next "newly escaped" tracking
  [this.level1FB, this.prevLevel1FB] = [this.prevLevel1FB, this.level1FB];
  [this.level1Tex, this.prevLevel1Tex] = [this.prevLevel1Tex, this.level1Tex];

  return changes;
}
```

#### Bandwidth Analysis

**Worst case per tile**: 1 escape in a 16×16 tile reads 256 pixels to find it.
- Overhead factor: **256×** per tile
- But we skip entirely empty tiles, so average overhead is much lower.

**Example scenarios for 2940×1600 viewport:**

| Scenario | Escapes | Super-tiles read | Tiles read | Pixels read | Total bandwidth |
|----------|---------|------------------|------------|-------------|-----------------|
| Very sparse (10 escapes) | 10 | 1.3 KB | ~3 KB | ~10 KB | **~15 KB** |
| Sparse (1,000 escapes) | 1,000 | 1.3 KB | ~30 KB | ~200 KB | **~230 KB** |
| Moderate (10,000 escapes) | 10,000 | 1.3 KB | ~100 KB | ~1 MB | **~1.1 MB** |
| Dense (100,000 escapes) | 100,000 | 1.3 KB | 295 KB | ~5 MB | **~5.3 MB** |
| Full read (naive) | any | - | - | 75 MB | **75 MB** |

The hierarchical approach provides **14×-5000× bandwidth reduction** depending on sparsity.

#### Adaptive Strategy

For very dense escapes (>10% of pixels), the hierarchy overhead may exceed its benefit. We adaptively switch:

```javascript
readResults() {
  // Quick check: read Level 2 first
  const superTiles = this.readLevel2();
  const totalNew = sumNewlyEscaped(superTiles);
  const totalPixels = this.width * this.height;

  if (totalNew > totalPixels * 0.1) {
    // Dense escapes: full read is more efficient
    return this.readFullTexture();
  } else {
    // Sparse escapes: hierarchical read
    return this.readHierarchical(superTiles);
  }
}
```

This gives optimal performance across the entire computation:
- **Early** (many escapes): Dense read, ~5 MB, but we need the data anyway
- **Late** (few escapes): Hierarchical read, ~15 KB, huge savings

#### Framebuffer Setup

```javascript
initHierarchy() {
  // Level 1: 184×100 tiles
  this.level1Tex = this.createTexture(184, 100, gl.RGBA32F);
  this.prevLevel1Tex = this.createTexture(184, 100, gl.RGBA32F);
  this.level1FB = this.createFramebuffer(this.level1Tex);
  this.prevLevel1FB = this.createFramebuffer(this.prevLevel1Tex);

  // Level 2: 12×7 super-tiles
  this.level2Tex = this.createTexture(12, 7, gl.RGBA32F);
  this.level2FB = this.createFramebuffer(this.level2Tex);

  // Reduction shader programs
  this.reductionProgram1 = this.compileProgram(vsQuad, fsReduction1);
  this.reductionProgram2 = this.compileProgram(vsQuad, fsReduction2);
}
```

#### Integration with Iteration Loop

The reduction passes are queued as regular draw calls, benefiting from the same driver pipelining as the iteration:

```javascript
iterate(n) {
  for (let i = 0; i < n; i++) {
    this.queueIterationPass();
    this.swapPingPong();
  }

  // Queue reduction passes (non-blocking, pipelined with iterations)
  this.queueReductionPass1();
  this.queueReductionPass2();
}
```

The reduction passes execute on the GPU after the iteration passes complete, maintaining the gap-free pipeline. Only the final `readResults()` call blocks to read the tiny Level 2 texture.

## Integration with Existing Architecture

### Board Selection

```javascript
// In createBoard() or similar
function selectBoard(config) {
  if (config.board === 'gl' || (config.board === 'auto' && hasWebGL2())) {
    return new GlBoard(k, rect, worker);
  } else if (config.board === 'gpu' && hasWebGPU()) {
    return new GpuBoard(k, rect, worker);
  }
  // ... other boards
}
```

GlBoard becomes the default when WebGL2 is available, preferred over WebGPU for the iteration performance.

### Worker Integration

GlBoard runs on the main thread (WebGL contexts can't be transferred to workers). This is fine because:
1. The actual computation is on GPU
2. Main thread just queues draw calls (fast)
3. Results processing can be chunked to avoid jank

Alternatively, we could use OffscreenCanvas in a worker (WebGL2 supports this in modern browsers).

### Scheduler Integration

The WorkScheduler treats GlBoard like any other board:
1. Assigns pixels to GlBoard
2. Calls `board.start(pixels, config)`
3. Receives results via callback
4. Updates canvas

The difference is internal: GlBoard pipelines iterations without CPU round-trips.

## Performance Expectations

### Theoretical Improvement

If the GPU gap is ~50% of total time (conservative estimate):
- Current: 100 iterations/second
- With gap eliminated: 150-200 iterations/second

Actual improvement depends on:
- GPU gap duration (CPU processing time)
- GPU compute throughput
- Results collection frequency

### Benchmark Plan

1. Measure current WebGPU iteration throughput
2. Implement GlBoard with same iteration logic
3. Compare iterations/second at various zoom levels
4. Profile results collection overhead

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| WebGL2 not available | Fall back to WebGPU/CPU boards |
| Float32 precision | Same as GpuBoard; use GlZhuoranBoard for deep zoom |
| gl.readPixels() blocking | Reduce read frequency, use PBOs for async |
| Main thread jank | Use OffscreenCanvas in worker, or chunk work |
| MRT limits | Check MAX_DRAW_BUFFERS, fall back if needed |

## Implementation Plan

### Phase 1: Basic GlBoard
1. Create GlBoard class skeleton
2. WebGL2 context initialization
3. Ping-pong framebuffer setup
4. Basic iteration shader
5. Results collection (full read)
6. Integration with Grid/Scheduler

### Phase 2: Optimization
1. Tune iteration batch sizes
2. Async results with PBOs (if needed)
3. Profile and optimize

### Phase 3: GlZhuoranBoard (Future)
1. MRT setup for expanded state
2. Perturbation iteration shader
3. Reference orbit integration

---

## Appendix A: Why Not WebGPU?

WebGPU was designed as a modern, explicit graphics API that gives developers fine-grained control. However, in pursuit of safety and portability, it omitted cross-command-buffer synchronization primitives.

### The Synchronization Gap

In Vulkan, you can submit dependent command buffers without CPU round-trips:

```cpp
// Vulkan: GPU-side synchronization
vkQueueSubmit(queue, 1, &submitInfo0, VK_NULL_HANDLE);  // CB0
vkQueueSubmit(queue, 1, &submitInfo1, VK_NULL_HANDLE);  // CB1 waits on semaphore
// GPU executes CB0 → CB1 with no CPU involvement
```

WebGPU has no equivalent:

```javascript
// WebGPU: Must wait on CPU
device.queue.submit([cb0]);
await device.queue.onSubmittedWorkDone();  // CPU wait!
device.queue.submit([cb1]);
```

### Why WebGPU Made This Choice

1. **Safety**: Semaphores are easy to deadlock; WebGPU prioritizes safe-by-default
2. **Portability**: Different GPUs have different sync capabilities
3. **Simplicity**: Fewer concepts for developers to manage

### The Irony

WebGPU is "lower level" than WebGL, but WebGL can achieve better pipelining because:
1. WebGL's driver has access to internal sync primitives
2. The driver automatically manages dependencies
3. You don't need to explicitly synchronize

For our use case (dependent sequential compute batches), WebGL's implicit model outperforms WebGPU's explicit model—not because WebGL is faster, but because WebGPU doesn't expose the primitives needed to eliminate GPU idle time.

### Could This Change?

Potentially. WebGPU could add:
- `GPUQueue.signal()` / `GPUQueue.wait()` for semaphore-like behavior
- Timeline semaphores for more flexible ordering
- `GPUCommandBuffer.addDependency()` for explicit ordering

Until then, WebGL (or native APIs via wasm) may be preferable for gap-sensitive workloads.

---

## Appendix B: WebGL 2 API Reference

### Key APIs Used

**Context Creation:**
```javascript
const gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  powerPreference: 'high-performance'
});
```

**Floating-Point Textures:**
```javascript
// Requires EXT_color_buffer_float extension
gl.getExtension('EXT_color_buffer_float');

gl.texImage2D(
  gl.TEXTURE_2D, 0, gl.RGBA32F,
  width, height, 0,
  gl.RGBA, gl.FLOAT, null
);
```

**Framebuffer Setup:**
```javascript
const fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(
  gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
  gl.TEXTURE_2D, texture, 0
);
```

**Multiple Render Targets:**
```javascript
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex0, 0);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex1, 0);
gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
```

**Full-Screen Quad:**
```javascript
// Vertex shader
const vsSource = `#version 300 es
  in vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// Two triangles covering clip space
const positions = new Float32Array([
  -1, -1,  1, -1,  -1, 1,
  -1,  1,  1, -1,   1, 1
]);
```

**Reading Results:**
```javascript
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
const pixels = new Float32Array(width * height * 4);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
```

---

## Appendix C: Convergence Detection

### Algorithm Overview

GlBoard detects Mandelbrot set interior points (converged pixels) using Fibonacci-based checkpoint orbit detection. This matches CpuBoard's behavior.

**Key Insight**: If a point is in the Mandelbrot set, its orbit will eventually become periodic. By comparing the current z to a saved checkpoint, we can detect when the orbit returns to (approximately) the same position.

### Checkpoint Update Schedule

Checkpoints are updated at Fibonacci iteration numbers: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, ...

**Why Fibonacci?** The period of a converged orbit divides evenly into some Fibonacci number (or is close to one), so the detection triggers reliably. Non-Fibonacci schedules might miss periods that don't align well.

### Two-Threshold Detection

Like CpuBoard, GlBoard uses two epsilon thresholds:

```javascript
this.epsilon = this.pix / 10;    // Final convergence threshold
this.epsilon2 = this.pix * 10;   // "Getting close" threshold
```

The detection logic:
1. If `|z - checkpoint| <= epsilon2`: Record the period (iteration when first detected)
2. If `|z - checkpoint| <= epsilon`: Converged! Mark pixel as done

This two-threshold approach avoids false positives from orbits that merely pass near the checkpoint.

### Shader Implementation

```glsl
// Check for Fibonacci checkpoint update
if (globalIter == fibCurr) {
  cp_zr = zr;
  cp_zi = zi;
  period = 0.0;  // Reset period tracking
  // Advance Fibonacci: fibPrev, fibCurr = fibCurr, fibPrev + fibCurr
  int nextFib = fibPrev + fibCurr;
  fibPrev = fibCurr;
  fibCurr = nextFib;
  // Skip convergence check this iteration
} else {
  // Check for convergence (compare to checkpoint)
  float dist = abs(zr - cp_zr) + abs(zi - cp_zi);
  if (dist <= u_epsilon2) {
    if (period == 0.0) period = iter;  // Record first detection
    if (dist <= u_epsilon) {
      status = 2.0;  // Converged
    }
  }
}
```

**Critical detail**: Convergence checking is skipped on the iteration when the checkpoint is updated. Otherwise, `z == checkpoint` trivially (we just set it), causing false convergence.

### Checkpoint Initialization

The checkpoint texture must be initialized to a sentinel value far outside valid z coordinates:

```javascript
checkpointData[0] = 1e30;  // checkpoint_zr = sentinel
checkpointData[1] = 1e30;  // checkpoint_zi = sentinel
```

This prevents false convergence detection before the first real checkpoint is set (at iteration 1).

### Reporting Converged Pixels

Converged pixels are reported with:
- `nn[i] = -iter` (negative iteration indicates convergence)
- `vv` array contains `{ index, z: [zr, zi], p: period }` for each converged pixel

The Grid uses these to:
1. Color converged pixels (typically black or using the period for coloring)
2. Track the chaotic region boundary (`ch` count)

### Performance Characteristics

- **Memory**: 2 additional textures (checkpoint ping/pong), each RGBA32F
- **Compute**: One extra comparison per iteration (negligible)
- **Bandwidth**: Checkpoint texture read only for converged pixels (hierarchical readback skips unchanged tiles)

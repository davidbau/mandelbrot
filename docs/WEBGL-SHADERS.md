# WebGL Shaders and GPGPU

The explorer uses WebGL2 as a fallback when WebGPU is unavailable. This document explains the fragment shader architecture, the three WebGL board types, and the techniques that enable GPU computation through a graphics API designed for rendering triangles.

## Historical Context: GPGPU Before Compute Shaders

Before CUDA (2007), OpenCL (2009), and compute shaders, researchers discovered they could use graphics hardware for general computation. The technique, called GPGPU (General-Purpose GPU), emerged in the early 2000s when scientists realized that fragment shaders—designed to calculate pixel colors—were essentially massively parallel processors.

Early GPGPU pioneers like Ian Buck (later creator of CUDA) showed that by encoding data as textures and computation as shader programs, you could achieve 10-100× speedups for parallel algorithms. This required "thinking in textures"—representing vectors as pixel rows, matrices as 2D images, and arithmetic as color blending.

The Mandelbrot set was a natural fit: each pixel is independent, the computation is simple (z² + c), and the workload is embarrassingly parallel. GPGPU Mandelbrot renderers appeared as early as 2003-2004, years before dedicated GPU compute APIs existed.

Today, WebGL2 preserves this approach. While WebGPU offers modern compute shaders and is about 2× faster, WebGL's fragment-shader GPGPU remains relevant as a fallback for browsers without WebGPU support.

## WebGL GPGPU: Hacking Pixels for Computation

WebGL was designed for drawing graphics—triangles, textures, lighting. It has no compute shaders. But the same hardware that shades pixels can also compute Mandelbrot iterations, if you're willing to abuse the graphics pipeline.

### The Core Hack

The insight: a fragment shader runs once per pixel, in parallel, across thousands of GPU cores. If we:
1. Store **data** in textures (pretending floats are "colors")
2. Render a **full-screen quad** (two triangles covering the viewport)
3. Write **computation results** as "pixel colors" to a render target

...then we've turned the graphics pipeline into a general-purpose compute engine.

```
Traditional Graphics:              GPGPU Mandelbrot:
┌─────────────┐                    ┌─────────────┐
│ Vertices    │                    │ Full-screen │
│ (triangles) │                    │ quad (2 tri)│
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       ▼                                  ▼
┌─────────────┐                    ┌─────────────┐
│ Rasterizer  │                    │ Rasterizer  │
│ (pixels)    │                    │ (all pixels)│
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       ▼                                  ▼
┌─────────────┐                    ┌─────────────┐
│ Fragment    │                    │ Fragment    │
│ shader:     │                    │ shader:     │
│ lighting    │                    │ z = z² + c  │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       ▼                                  ▼
┌─────────────┐                    ┌─────────────┐
│ Framebuffer │                    │ State tex   │
│ (screen)    │                    │ (data out)  │
└─────────────┘                    └─────────────┘
```

### Textures as Data Buffers

In normal graphics, textures hold images. In GPGPU, they hold arbitrary floats:

```glsl
// "Reading a pixel" = loading computational state
vec4 state = texture(u_state, texCoord);
float zr = state.r;        // z.real stored in red channel
float zi = state.g;        // z.imag stored in green channel
float iter = state.b;      // iteration count in blue
float status = state.a;    // status flag in alpha
```

WebGL2 supports `RGBA32F` textures (4 floats per pixel), giving us 16 bytes of state per pixel. When that's not enough, we use Multiple Render Targets (MRT) to write to several textures simultaneously.

### The Ping-Pong Pattern

Iterative computation (like z = z² + c) requires reading and writing the same data. But you can't read and write the same texture in one draw call. The solution: **ping-pong** between two buffers.

```
Iteration 1:                    Iteration 2:
  Read: pingTex                   Read: pongTex
  Write: pongTex                  Write: pingTex

  ┌──────────┐                    ┌──────────┐
  │ pingTex  │──read──┐           │ pongTex  │──read──┐
  └──────────┘        │           └──────────┘        │
        ▲             ▼                 ▲             ▼
        │       ┌──────────┐            │       ┌──────────┐
        │       │ Fragment │            │       │ Fragment │
        │       │ Shader   │            │       │ Shader   │
        │       └──────────┘            │       └──────────┘
        │             │                 │             │
        │             ▼                 │             ▼
  ┌──────────┐──write─┘           ┌──────────┐──write─┘
  │ pongTex  │                    │ pingTex  │
  └──────────┘                    └──────────┘
```

After each iteration, we swap roles. The shader always reads from one texture and writes to the other.

### WebGL vs WebGPU: Different Synchronization Models

WebGL and WebGPU take fundamentally different approaches to GPU synchronization, though both achieve gap-free pipelining in practice. **WebGPU is about 2× faster** in benchmarks—WebGL is the fallback for browsers without WebGPU support, not a performance optimization.

#### WebGPU's Explicit Model

WebGPU is an "explicit" API inspired by Vulkan and Metal. You build command buffers on the CPU, then submit them to the GPU. Within a single command buffer, the GPU handles dependencies automatically—if dispatch B reads from a buffer that dispatch A writes, the GPU waits.

But **across command buffers**, you must synchronize manually. WebGPU deliberately omits GPU-side synchronization primitives (no semaphores, no timeline fences) for safety and portability. A naive implementation would require CPU round-trips:

```javascript
// Naive WebGPU: CPU waits between batches
device.queue.submit([cmdBuffer0]);
await device.queue.onSubmittedWorkDone();  // CPU waits, GPU idles
device.queue.submit([cmdBuffer1]);
```

The explorer solves this by **submitting batches optimistically** without waiting, then using **atomic operations** in the shader to detect if batches overlap on the GPU. If a batch starts while the previous one is still running (reading stale data), the atomic check fails and that batch's results are skipped. In practice, overlaps are rare—the CPU processing time between submissions usually exceeds GPU batch duration, so batches complete before the next one starts.

```javascript
// Actual WebGPU: Submit without waiting, detect overlaps with atomics
device.queue.submit([cmdBuffer0]);
// Don't wait—immediately prepare and submit next batch
device.queue.submit([cmdBuffer1]);
// Shader uses atomicCompareExchange to detect if batch 0 finished
// If overlap detected, skip results (rare in practice)
```

#### WebGL's Implicit Model

WebGL takes the opposite approach: the driver manages everything. When you issue draw calls, you're not building command buffers—you're making requests to a black-box driver:

```javascript
// WebGL: The driver handles everything
for (let i = 0; i < 1000; i++) {
  gl.bindTexture(gl.TEXTURE_2D, readTex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, writeFB);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  swapBuffers();  // Swap ping/pong roles
}
// All 1000 draw calls queued, CPU returns immediately
```

Internally, the driver:
1. **Tracks resource dependencies** automatically (it knows `writeFB` depends on `readTex`)
2. **Batches commands** into GPU command buffers as it sees fit
3. **Inserts GPU-side synchronization** (the semaphores/fences that WebGPU doesn't expose)
4. **Keeps the GPU pipeline full**

The tradeoff: WebGL's implicit model is simpler to use but gives less control. WebGPU's explicit model requires more work but enables optimizations that make it about 2× faster:

- **Sparse dispatch**: WebGPU maintains a list of active pixel indices and only dispatches work for pixels still computing. WebGL must render a full-screen quad every iteration, running the fragment shader on *every* pixel—even when 99.9% have already escaped. This difference is most pronounced in late iterations when few pixels remain active.
- **Compute shaders** skip the graphics pipeline (no rasterization overhead)
- **Storage buffers** allow direct array access instead of texture sampling
- **Shared memory** enables workgroup-level optimizations

## The Three WebGL Boards

The explorer has three WebGL implementations, selected based on zoom depth:

| Board | Pixel Size | Precision | MRT Count | Use Case |
|-------|------------|-----------|-----------|----------|
| **GlBoard** | > 1e-7 | float32 | 2 textures | Shallow zoom (up to ~10^7×) |
| **GlZhuoranBoard** | 1e-30 to 1e-7 | float32 perturbation<br/>DD reference orbit | 3 textures | Deep zoom (10^7× to 10^30×) |
| **GlAdaptiveBoard** | < 1e-30 | float32 perturbation<br/>QD reference orbit<br/>Per-pixel scaling | 4 textures | Ultra-deep zoom (10^30×+) |

All three share the same ping-pong architecture and hierarchical reduction for sparse readback. The differences are in precision handling and state size.

## GlBoard: The Simple Shader

For shallow zooms, the fragment shader is straightforward: each pixel computes its orbit independently using native float32 arithmetic.

### Texture Layout

GlBoard uses 2 textures per ping-pong buffer (MRT with 2 color attachments):

**State Texture (RGBA32F, COLOR_ATTACHMENT0):**
```
R: z.real        - Current orbit position (real part)
G: z.imag        - Current orbit position (imaginary part)
B: iterations    - Iteration count (as float)
A: pixel_index   - Grid index for result mapping (static)
```

**Checkpoint Texture (RGBA32F, COLOR_ATTACHMENT1):**
```
R: checkpoint_zr - Z position at last Fibonacci checkpoint
G: checkpoint_zi - (for cycle detection)
B: period        - Detected period (iteration when convergence first seen)
A: status        - 0=active, 1=escaped, 2=converged
```

### The Fragment Shader

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_state;
uniform sampler2D u_checkpoint;
uniform vec2 u_resolution;
uniform vec2 u_cMin, u_cMax;
uniform int u_iterations;
uniform float u_escapeRadius;
uniform int u_exponent;
uniform float u_epsilon, u_epsilon2;
uniform int u_startIter;
uniform int u_fibPrev, u_fibCurr;

in vec2 v_texCoord;
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outCheckpoint;

void main() {
  vec4 state = texture(u_state, v_texCoord);
  vec4 checkpoint = texture(u_checkpoint, v_texCoord);

  float zr = state.r;
  float zi = state.g;
  float iter = state.b;
  float pixelIndex = state.a;

  float cp_zr = checkpoint.r;
  float cp_zi = checkpoint.g;
  float period = checkpoint.b;
  float status = checkpoint.a;

  // c from pixel position
  vec2 c = mix(u_cMin, u_cMax, v_texCoord);

  int fibPrev = u_fibPrev;
  int fibCurr = u_fibCurr;

  if (status == 0.0) {  // Active pixel
    for (int i = 0; i < 327680; i++) {
      if (i >= u_iterations) break;

      int globalIter = u_startIter + i + 1;

      // z = z^n + c (exponent 2 shown, generalized in real code)
      float zr2 = zr * zr - zi * zi + c.x;
      float zi2 = 2.0 * zr * zi + c.y;
      zr = zr2;
      zi = zi2;
      iter += 1.0;

      // Check for escape
      if (zr * zr + zi * zi > u_escapeRadius) {
        status = 1.0;
        break;
      }

      // Fibonacci checkpoint update and convergence detection
      if (globalIter == fibCurr) {
        cp_zr = zr; cp_zi = zi;
        period = 0.0;
        int nextFib = fibPrev + fibCurr;
        fibPrev = fibCurr; fibCurr = nextFib;
      } else {
        float dist = abs(zr - cp_zr) + abs(zi - cp_zi);
        if (dist <= u_epsilon2) {
          if (period == 0.0) period = iter;
          if (dist <= u_epsilon) {
            status = 2.0;  // Converged
            break;
          }
        }
      }
    }
  }

  outState = vec4(zr, zi, iter, pixelIndex);
  outCheckpoint = vec4(cp_zr, cp_zi, period, status);
}
```

### Framebuffer Setup

```javascript
initPingPongBuffers() {
  const gl = this.gl;

  // Create textures
  this.pingStateTex = this.createTexture(gl.RGBA32F);
  this.pingCheckpointTex = this.createTexture(gl.RGBA32F);
  this.pongStateTex = this.createTexture(gl.RGBA32F);
  this.pongCheckpointTex = this.createTexture(gl.RGBA32F);

  // Create MRT framebuffers
  this.pingFB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_2D, this.pingStateTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1,
                          gl.TEXTURE_2D, this.pingCheckpointTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

  // Same for pongFB...
}
```

### Key Design Choices

**Batch size up to 327,680**: The loop limit is large enough that we rarely hit it. The uniform `u_iterations` controls actual iterations per draw call.

**Generalized exponent**: The real code supports z^n for n=2,3,4,5 using explicit formulas, with a polar fallback for higher exponents.

**Fibonacci-based checkpoints**: Convergence detection uses the same algorithm as CpuBoard—save checkpoints at Fibonacci numbers, compare current z to checkpoint.

## GlZhuoranBoard: Deep Zoom with Perturbation

Beyond 10^7 magnification, float32 loses the ability to represent pixel coordinates precisely. The solution is *perturbation theory*: compute a single reference orbit at high precision on the CPU, then compute each pixel's orbit as a small perturbation from that reference.

### The Perturbation Approach

Instead of iterating `z = z² + c` for each pixel, we track:
- **Reference orbit** `Z_n`: computed once in DD (double-double) precision on the CPU
- **Perturbation** `δz_n` for each pixel: how far this pixel's orbit is from the reference

The iteration becomes:
```
z_n = Z_n + δz_n
z_{n+1} = (Z_n + δz_n)² + c
        = Z_n² + 2·Z_n·δz_n + δz_n² + c
        = Z_{n+1} + (2·Z_n·δz_n + δz_n²)

So: δz_{n+1} = 2·Z_n·δz_n + δz_n² + δc
```

The key insight: even though `c` requires 30+ digits of precision, the *difference* `δc = c - c_ref` is tiny and fits in float32.

### Texture Layout (3 MRT)

GlZhuoranBoard extends to 3 textures per ping-pong buffer:

**State Texture (RGBA32F, COLOR_ATTACHMENT0):**
```
R: dz.real      - Perturbation δz (real part)
G: dz.imag      - Perturbation δz (imaginary part)
B: iterations   - Total iteration count
A: status       - 0=active, 1=escaped, 2=converged
```

**Checkpoint Texture (RGBA32F, COLOR_ATTACHMENT1):**
```
R: bb.real      - Current checkpoint δz (for convergence)
G: bb.imag
B: ref_iter     - Current position in reference orbit
A: period       - Detected period
```

**Lazy Texture (RGBA32F, COLOR_ATTACHMENT2):**
```
R: ckpt_refidx      - Checkpoint reference index
G: pending_refidx   - Pending reference index for lazy threading
B: ckpt_bbr         - Original checkpoint δz.real (for reset after rebase)
A: ckpt_bbi         - Original checkpoint δz.imag
```

### Reference Orbit Texture

The CPU computes the reference orbit in DD precision and uploads it to a 2D texture:

```javascript
// Reference texture layout: 2048×512 texels
// Each reference point uses 2 texels:
// Texel 0: (ref.real, ref.imag, thread.next, thread.deltaRe)
// Texel 1: (thread.deltaIm, 0, 0, 0)
```

The shader samples this texture to get reference values and threading information for convergence detection.

### Rebasing

Perturbation theory has a flaw: when the reference orbit passes near zero, small errors in δz get amplified catastrophically, causing visual "glitches."

The solution is **rebasing**: when the total orbit `Z + δz` gets smaller than the perturbation itself, we reset:

```glsl
let dz_norm = max(abs(dzr), abs(dzi));
let total_r = refr + dzr;
let total_i = refi + dzi;
let total_norm = max(abs(total_r), abs(total_i));

// Rebase when orbit approaches zero
if (ref_iter > 0 && total_norm < dz_norm * 2.0) {
  dzr = total_r;   // Set δz = total orbit position
  dzi = total_i;
  ref_iter = 0;    // Restart from beginning of reference
}
```

After rebasing, the perturbation holds the absolute position and we follow the reference from iteration 0 again.

### Threading for Convergence Detection

Detecting cycles in the perturbation context is tricky because δz values aren't comparable across rebases. The solution is "threading": a data structure that tracks which reference orbit positions are close to each other.

When orbit position 5000 is near position 3000, we record a "thread" with the position difference. This allows O(1) cycle detection even when pixels have rebased multiple times.

## GlAdaptiveBoard: Ultra-Deep Zoom with Scaling

At extreme zoom depths (pixel sizes < 1e-30), float32's exponent range becomes the limiting factor. Even with perturbation, the δz values can underflow to zero.

GlAdaptiveBoard solves this with **per-pixel adaptive scaling**: each pixel maintains its own exponent offset that shifts values into float32's normal range.

### The Scaling Mechanism

Each pixel tracks:
- `scale`: an integer exponent offset (typically negative, e.g., -95 for pixel_size ≈ 1e-30)
- `dzr, dzi`: perturbation values stored as `δz_actual / 2^scale`

This effectively extends float32's range:
- Actual value: `1e-95` (would underflow float32)
- With `scale = -95`: stored as `1.0` (perfectly normal float32)
- To convert back: `stored × 2^scale = actual`

### Texture Layout (4 MRT)

GlAdaptiveBoard adds a fourth texture for scale:

**Scale Texture (RGBA32F, COLOR_ATTACHMENT3):**
```
R: scale        - Log2 scale factor (integer stored as float)
G: (unused)
B: (unused)
A: (unused)
```

### Dynamic Rescaling

After each iteration, the shader adjusts scale to keep δz in range [0.5, 2.0]:

```glsl
float dz_mag = max(abs(new_dzr), abs(new_dzi));
if (dz_mag > 0.0) {
  float log2_mag = floor(log2(dz_mag));

  if (log2_mag >= 1.0) {
    // δz too large, scale down
    int steps = int(log2_mag);
    new_dzr = ldexp(new_dzr, -steps);
    new_dzi = ldexp(new_dzi, -steps);
    new_scale = scale + steps;
  } else if (log2_mag < -1.0 && scale > u_initialScale) {
    // δz too small, scale up (toward initial scale)
    int steps = min(int(-log2_mag) - 1, scale - u_initialScale);
    if (steps > 0) {
      new_dzr = ldexp(new_dzr, steps);
      new_dzi = ldexp(new_dzi, steps);
      new_scale = scale - steps;
    }
  }
}
```

### QD Reference Orbit

For GlAdaptiveBoard to work correctly, the CPU computes the reference orbit in **QD (quad-double) precision** rather than DD. This provides ~62 decimal digits of precision, sufficient for pixel sizes down to ~1e-60.

## Hierarchical Reduction for Sparse Readback

### The Problem

WebGL can't do atomic operations like WebGPU. Without atomics, we can't efficiently pack sparse results (escaped pixels) into a dense buffer. A naive approach reads the entire state texture every batch—**75 MB** for a 2940×1600 viewport.

But most pixels haven't escaped yet. If only 10 pixels escaped this batch, reading the whole texture wastes 99.999% of the bandwidth.

### The Solution: Two-Level Tiles

We use GPU reduction shaders to build a hierarchy that identifies where escapes occurred:

```
Level 0 (State):    2940×1600 pixels      = 4,704,000 entries (75 MB)
Level 1 (Tiles):    184×100 tiles (16×16) = 18,400 entries    (295 KB)
Level 2 (Super):    12×7 super-tiles      = 84 entries        (1.3 KB)
```

### Reduction Shaders

**Pass 1 (Level 0 → Level 1):** Each tile shader samples all 256 pixels in its 16×16 region, counts escapes:

```glsl
void main() {
  ivec2 tileCoord = ivec2(gl_FragCoord.xy);
  ivec2 basePixel = tileCoord * 16;

  float escapeCount = 0.0;
  for (int dy = 0; dy < 16; dy++) {
    for (int dx = 0; dx < 16; dx++) {
      vec4 state = texelFetch(u_checkpoint, basePixel + ivec2(dx, dy), 0);
      if (state.a == 1.0) escapeCount += 1.0;  // status == escaped
    }
  }

  // Compare with previous to find newly escaped
  float prev = texelFetch(u_prevTiles, tileCoord, 0).r;
  float newlyEscaped = escapeCount - prev;

  tileInfo = vec4(escapeCount, newlyEscaped, 0.0, escapeCount > 0.0 ? 1.0 : 0.0);
}
```

**Pass 2 (Level 1 → Level 2):** Same pattern, reducing 16×16 tiles into super-tiles.

### Adaptive CPU Readback

1. Read tiny Level 2 (1.3 KB)—always cheap
2. Find super-tiles with `newlyEscaped > 0`
3. Read only those Level 1 regions (~1 KB each)
4. Find tiles with escapes
5. Read only those Level 0 regions (~1 KB each)
6. Extract escaped pixel data

**Bandwidth savings:**
- Very sparse (10 escapes): ~15 KB instead of 75 MB = **5000× reduction**
- Moderate (10,000 escapes): ~1.1 MB instead of 75 MB = **70× reduction**

### PBO-Based Async Readback

`gl.readPixels()` normally blocks. GlBoard uses Pixel Buffer Objects (PBOs) with fence sync to avoid stalling the GPU:

```javascript
// Start async read
gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, 0);
const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);

// Later: check if done
const status = gl.clientWaitSync(sync, 0, 0);
if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
  const data = new Float32Array(gl.getBufferSubData(...));
  // Process results...
}
```

This allows the GPU to continue iterating while we process previous results.

## CPU-GPU Coordination

### Reference Orbit Extension

The reference orbit is computed lazily on the CPU:
- **GlZhuoranBoard**: DD (double-double) precision (~31 decimal digits)
- **GlAdaptiveBoard**: QD (quad-double) precision (~62 decimal digits)

Each `compute()` call:
1. **Extends the reference** if any pixel needs more iterations than available
2. **Uploads new orbit data** to the reference texture (incrementally)
3. **Uploads new threading data** for convergence detection
4. **Dispatches iteration shader** for one batch
5. **Reads back results** for finished pixels via hierarchical reduction

### Orbit Looping

Beyond ~1 million iterations, the reference orbit buffer would exceed memory limits. Both boards detect when the orbit loops near a previous position and create a "jump" that wraps around:

```javascript
const THREADING_CAPACITY = 1048576;  // 2^20

// Find closest previous position in last 12,000 iterations
for (let i = THREADING_CAPACITY - 12000; i < THREADING_CAPACITY; i++) {
  const dist = computeDistance(endpoint, this.refOrbit[i]);
  if (dist < minDist) {
    closestIter = i;
    minDist = dist;
  }
}

this.refOrbitLoop = {
  threshold: THREADING_CAPACITY,
  jumpAmount: THREADING_CAPACITY - closestIter,
  delta: /* difference to add when jumping */
};
```

## Class Hierarchy

```
Board (abstract base)
│
├── GlBoard (WebGL2, shallow zoom)
│   └── Ping-pong framebuffers, 2 MRT, float32 arithmetic
│
└── GlPerturbationBaseBoard (WebGL2 perturbation infrastructure)
    │
    ├── GlZhuoranBoard (DD precision reference orbit)
    │   └── 3 MRT, rebasing, DDReferenceOrbitMixin
    │
    └── GlAdaptiveBoard (QD precision + adaptive scaling)
        └── 4 MRT, per-pixel scale, QDReferenceOrbitMixin
```

## Performance Characteristics

| Board | MRT | Ping-Pong Textures | Reference Texture | Precision Limit |
|-------|-----|-------------------|-------------------|-----------------|
| GlBoard | 2 | 4 textures | None | ~10^7 zoom |
| GlZhuoranBoard | 3 | 6 textures | 2048×512 (2D) | ~10^30 zoom |
| GlAdaptiveBoard | 4 | 8 textures | 2048×512 (2D) | ~10^60 zoom |

All boards benefit from WebGL's driver-managed pipelining, achieving gap-free GPU execution between iteration batches.

## WebGL2 Requirements

GlBoard requires:
- WebGL2 context (widely supported in modern browsers)
- `EXT_color_buffer_float` extension (for RGBA32F render targets)
- `MAX_DRAW_BUFFERS >= 4` (for GlAdaptiveBoard's 4-MRT setup)

```javascript
const gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true
});

const ext = gl.getExtension('EXT_color_buffer_float');
if (!ext) throw new Error('EXT_color_buffer_float not available');
```

## References

- [WebGL 2.0 Specification](https://www.khronos.org/registry/webgl/specs/latest/2.0/)
- [GLSL ES 3.0 Specification](https://www.khronos.org/registry/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
- [Perturbation Theory for Mandelbrot](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html)

## Next Steps

- [GPU-SHADERS.md](GPU-SHADERS.md): The WebGPU compute shader architecture (primary implementation)
- [MATH.md](MATH.md): The DD and QD precision math library used for reference orbits
- [ALGORITHMS.md](ALGORITHMS.md): Cycle detection and the Zhuoran method in detail

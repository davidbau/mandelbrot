# WebGL2 Perturbation Boards Architecture

This document describes the architecture and implementation of the WebGL2 perturbation board classes: `GlPerturbationBaseBoard`, `GlZhuoranBoard`, and `GlAdaptiveBoard`. These classes provide GPU-accelerated deep zoom rendering for the Mandelbrot explorer.

## Overview

At deep zoom levels (beyond 10^13), standard floating-point precision becomes insufficient. The perturbation theory approach computes a single high-precision reference orbit on the CPU, then uses the GPU to compute per-pixel deltas (perturbations) from that reference. This allows billions of pixels to iterate efficiently while maintaining precision.

The WebGL2 perturbation boards use fragment shaders for computation rather than compute shaders, enabling driver-managed pipelining for gap-free GPU execution (see [webgl-pingpong-design.md](webgl-pingpong-design.md) for background).

## Class Hierarchy

```
Board (abstract base)
│
├── GlPerturbationBaseBoard (WebGL2 perturbation infrastructure)
│   │
│   ├── GlZhuoranBoard (DD precision reference orbit)
│   │   └── Uses DDReferenceOrbitMixin for ~31 decimal digits
│   │
│   └── GlAdaptiveBoard (QD precision reference orbit + adaptive scaling)
│       └── Uses QDReferenceOrbitMixin for ~62 decimal digits
```

## GlPerturbationBaseBoard

The abstract base class providing shared WebGL2 infrastructure for perturbation-based rendering.

### Key Responsibilities

- WebGL2 context and shader management
- Ping-pong framebuffer architecture for iterative computation
- Hierarchical reduction for sparse result readback
- Reference orbit texture management

### Texture Layout

Each pixel's state is stored across three textures using Multiple Render Targets (MRT):

**State Texture (RGBA32F, COLOR_ATTACHMENT0):**
```
R: dz.real     - Perturbation delta (real part)
G: dz.imag     - Perturbation delta (imaginary part)
B: iterations  - Current iteration count
A: status      - 0=active, 1=escaped, 2=converged
```

**Checkpoint Texture (RGBA32F, COLOR_ATTACHMENT1):**
```
R: bb.real     - Bounding box checkpoint (for convergence detection)
G: bb.imag     - Bounding box checkpoint
B: ref_iter    - Current reference orbit index
A: period      - Detected period (for interior coloring)
```

**Lazy Texture (RGBA32F, COLOR_ATTACHMENT2):**
```
R: ckpt_refidx    - Checkpoint reference index
G: pending_refidx - Pending reference index for threading
B: ckpt_bbr       - Checkpoint bb.real
A: ckpt_bbi       - Checkpoint bb.imag
```

### Ping-Pong Architecture

The iteration shader reads from one set of textures and writes to another:

```
Frame N:
  Read:  ping{State,Checkpoint,Lazy}Tex
  Write: pong{State,Checkpoint,Lazy}Tex via pongFB

Frame N+1:
  Read:  pong{State,Checkpoint,Lazy}Tex
  Write: ping{State,Checkpoint,Lazy}Tex via pingFB
```

The `isPingRead` flag tracks which set is the current read source.

### Hierarchical Reduction

To avoid reading the entire state texture every batch, a two-level tile hierarchy identifies which regions contain newly escaped pixels:

```
Level 0 (State):    dimsWidth × dimsHeight pixels
Level 1 (Tiles):    ⌈dimsWidth/16⌉ × ⌈dimsHeight/16⌉ tiles
Level 2 (Super):    ⌈level1Width/16⌉ × ⌈level1Height/16⌉ super-tiles
```

1. GPU reduction shaders aggregate escape counts per tile
2. CPU reads tiny Level 2 (typically < 100 entries)
3. Only active super-tiles are expanded to Level 1
4. Only active tiles have their pixels read

This provides 10x-1000x bandwidth reduction for sparse escapes.

### Reference Orbit Texture

The reference orbit is stored in a large 2D texture (default 2048×512):

```
Each reference point uses 2 texels:
  Texel 0: (ref.real, ref.imag, thread.next, thread.deltaRe)
  Texel 1: (thread.deltaIm, 0, 0, 0)
```

The shader samples this texture to get reference values and threading offsets for lazy checkpoint evaluation.

## GlZhuoranBoard

Extends `GlPerturbationBaseBoard` with DD (double-double) precision reference orbit computation.

### Usage Range

Suitable for zoom depths from ~10^13 to ~10^28 where DD precision (~31 decimal digits) is sufficient.

### Reference Orbit

Uses `DDReferenceOrbitMixin` to compute the reference orbit with DD arithmetic:

```javascript
// DD representation: [high, low] where value ≈ high + low
this.refOrbit[i] = [re_hi, re_lo, im_hi, im_lo];
```

When uploading to GPU, DD values are collapsed to float32 for shader use:
```javascript
data[idx + 0] = orbit[0] + orbit[1];  // re_hi + re_lo → float32
data[idx + 1] = orbit[2] + orbit[3];  // im_hi + im_lo → float32
```

### Perturbation Formula

For the Mandelbrot iteration z → z² + c:

```glsl
// Z = reference point, dz = perturbation delta
// New z = (Z + dz)² + c = Z² + 2*Z*dz + dz² + c
// New dz = 2*Z*dz + dz² + dc
new_dzr = 2.0 * (refr * dzr - refi * dzi) + dzr * dzr - dzi * dzi + dcr;
new_dzi = 2.0 * (refr * dzi + refi * dzr) + 2.0 * dzr * dzi + dci;
```

### Rebasing

When the perturbation grows larger than the reference, the shader rebases:

```glsl
if (total_norm < dz_norm * 2.0) {
  // dz became larger than reference - rebase to origin
  dzr = total_r;
  dzi = total_i;
  ref_iter = 0;  // Restart from beginning of reference orbit
}
```

## GlAdaptiveBoard

Extends `GlPerturbationBaseBoard` with QD (quad-double) precision reference orbit and adaptive per-pixel scaling.

### Usage Range

Required for extreme zoom depths beyond ~10^28 where the dynamic range of perturbation deltas exceeds float32 exponent range.

### The Scaling Problem

At extreme depths, the pixel size might be 2^-100 while the reference orbit amplitude is ~2. Without scaling, float32's limited exponent range (2^-126 to 2^127) cannot represent both:

```
Pixel size: 10^-30 ≈ 2^-100
Float32 minimum normal: ≈ 2^-126
Float32 underflows below 2^-149 (denormals)
```

The perturbation delta `dz` starts near pixel size but can grow toward the reference amplitude during iteration. Unscaled float32 would underflow initially or overflow later.

### Adaptive Scaling Design

Each pixel maintains a per-pixel scale exponent stored in an additional texture:

**Scale Texture (RGBA32F, COLOR_ATTACHMENT3):**
```
R: scale       - Log2 scale factor (integer stored as float)
G: (unused)
B: (unused)
A: (unused)
```

The actual delta is: `dz_actual = dz_stored × 2^scale`

This extends effective precision to approximately 2^-252 to 2^127 by combining float32 mantissa precision with extended exponent range.

### 4-MRT Framebuffer

GlAdaptiveBoard uses 4 color attachments instead of 3:

```javascript
createMRTFramebuffer4(stateTex, checkpointTex, lazyTex, scaleTex) {
  gl.drawBuffers([
    gl.COLOR_ATTACHMENT0,  // State
    gl.COLOR_ATTACHMENT1,  // Checkpoint
    gl.COLOR_ATTACHMENT2,  // Lazy
    gl.COLOR_ATTACHMENT3   // Scale (NEW)
  ]);
}
```

### Initialization

The initial scale is computed from pixel size:

```javascript
initPixels(size, re, im) {
  const log2_pixelSize = Math.log2(pixelSize);
  this.initialScale = Math.floor(log2_pixelSize);

  // Mantissa is in range [1, 2)
  const mantissa = Math.pow(2, log2_pixelSize - this.initialScale);

  // Store dc as mantissa × offset, with separate scale
  this.dc[index2] = Math.fround(mantissa * xOffset);
  this.pixelScale[index] = this.initialScale;
}
```

### Scaled Perturbation Iteration

The shader performs iteration in scaled coordinates:

```glsl
// ldexp(x, n) = x × 2^n
float ldexp(float x, int n) {
  return x * exp2(float(n));
}

// Perturbation iteration with scaling:
// Linear term (2*Z*dz) stays in scaled coordinates
// Quadratic term (dz²) needs ldexp(dz*dz, scale) since (dz×2^s)² = dz²×2^(2s)
// dc needs ldexp(dc, initial_scale - scale) to match current scale

float linear_r = 2.0 * (refr * dzr - refi * dzi);
float dz2_r = ldexp(dzr * dzr - dzi * dzi, scale);
float dc_r = ldexp(dcr, u_initialScale - scale);
new_dzr = linear_r + dz2_r + dc_r;
```

### Adaptive Rescaling

After each iteration, the shader checks if rescaling is needed:

```glsl
float dz_mag = max(abs(new_dzr), abs(new_dzi));
if (dz_mag > 0.0 && dz_mag < 1e30) {
  float log2_mag = floor(log2(dz_mag));
  if (log2_mag >= 1.0) {
    // dz too large, scale down
    int steps = int(log2_mag);
    new_dzr = ldexp(new_dzr, -steps);
    new_dzi = ldexp(new_dzi, -steps);
    new_scale = scale + steps;
  } else if (log2_mag < -1.0 && scale > u_initialScale) {
    // dz too small, scale up (toward initial scale)
    int steps = min(int(-log2_mag) - 1, scale - u_initialScale);
    if (steps > 0) {
      new_dzr = ldexp(new_dzr, steps);
      new_dzi = ldexp(new_dzi, steps);
      new_scale = scale - steps;
    }
  }
}
```

This keeps the mantissa in range ~[0.5, 2] while adjusting the scale exponent.

### Reference Orbit (QD Precision)

Uses `QDReferenceOrbitMixin` with quad-double arithmetic (~62 decimal digits):

```javascript
// QD representation: [x0, x1, x2, x3] where value ≈ x0 + x1 + x2 + x3
this.qdRefOrbit[i] = [re0, re1, re2, re3, im0, im1, im2, im3];
```

For GPU upload, QD is collapsed to float32:
```javascript
data[idx + 0] = orbit[0] + orbit[1] + orbit[2] + orbit[3];  // Sum → float32
```

### Convergence Detection with Scaling

The epsilon threshold must be scaled to match the current pixel's scale:

```glsl
float eps = ldexp(u_epsilon, -old_scale);
float eps2 = ldexp(u_epsilon2, -old_scale);
if (db <= eps2) {
  if (period == 0.0) period = iter;
  if (db <= eps) {
    status = 2.0;  // Converged
  }
}
```

## Shared Infrastructure

### createShaders()

The base class compiles shaders and caches uniform locations:

```javascript
async createShaders() {
  this.iterProgram = this.compileProgram(vsSource, fsIterSource);
  this.iterUniforms = {
    u_state: gl.getUniformLocation(...),
    u_checkpoint: gl.getUniformLocation(...),
    // ... standard uniforms
  };
}
```

GlAdaptiveBoard extends this to add scale-specific uniforms:

```javascript
async createShaders() {
  await super.createShaders();
  this.iterUniforms.u_scale = gl.getUniformLocation(this.iterProgram, 'u_scale');
  this.iterUniforms.u_initialScale = gl.getUniformLocation(this.iterProgram, 'u_initialScale');
}
```

### doGpuIterations()

Binds textures, sets uniforms, and dispatches the iteration shader. GlAdaptiveBoard overrides to add scale texture binding.

### uploadRefOrbit()

Each subclass implements this to upload its precision-specific reference orbit format:
- GlZhuoranBoard: DD format (4 floats per point)
- GlAdaptiveBoard: QD format (8 floats per point, collapsed to float32)

### processLevel2Results()

Shared logic for hierarchical result collection. Reads Level 2 super-tiles, drills down into active tiles, and extracts escaped/converged pixel information.

## Performance Characteristics

| Board | Precision | Zoom Range | Texture Count | MRT Count |
|-------|-----------|------------|---------------|-----------|
| GlZhuoranBoard | DD (~31 digits) | 10^13 - 10^28 | 7 ping-pong + 1 refOrbit | 3 |
| GlAdaptiveBoard | QD (~62 digits) | 10^28+ | 9 ping-pong + 1 refOrbit | 4 |

Both boards benefit from WebGL's driver-managed pipelining, achieving gap-free GPU execution between iteration batches.

## Serialization

Both boards support serialization for state persistence:

```javascript
async serialize() {
  return {
    ...base,
    reported: Array.from(this.reported),
    refC: this.refC,           // GlZhuoranBoard
    refOrbit: this.refOrbit,   // GlZhuoranBoard
    refC_qd: this.refC_qd,     // GlAdaptiveBoard
    qdRefOrbit: this.qdRefOrbit,
    initialScale: this.initialScale,
    pixelScale: Array.from(this.pixelScale)
  };
}
```

## Board Selection

The scheduler selects boards based on zoom depth:

```
Zoom < 10^13:        GpuBoard (standard float64)
10^13 ≤ Zoom < 10^28: GlZhuoranBoard (DD perturbation)
Zoom ≥ 10^28:        GlAdaptiveBoard (QD + adaptive scaling)
```

When WebGL2 is unavailable, equivalent WebGPU boards (`GpuZhuoranBoard`, `GpuAdaptiveBoard`) are used instead.

# Architecture Overview

## Philosophy: A Structured Monolith

The entire application—interface, computation, and styling—lives in a single `index.html` file. This design choice is intentional. It means the fractal explorer is a self-contained digital object. You can save the page, email it, or host it on any simple web server without needing a build system, package manager, or CDN. It's as portable as the mathematics it visualizes.

This commitment to a single file means new features should be implemented without adding external file dependencies, preserving the project's portability.

Despite being a single file, the code is highly structured, using modern JavaScript classes to create a clean, maintainable system.

## The Big Picture

The application is composed of several collaborating classes, coordinated by the main `MandelbrotExplorer` object. State is managed centrally by `StateStore`, and computation is offloaded to Web Workers.

```
┌───────────────────────────────────────────────────────────────────┐
│                        MandelbrotExplorer                         │
│  (The application root - coordinates everything)                  │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │    Config    │  │  StateStore  │  │     Grid     │             │
│  │  (settings)  │◄─┤   (state)    ├─►│   (views)    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│         │                 ▲                  │                    │
│         ▼                 │                  ▼                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  URLHandler  │  │ EventHandler │  │  Scheduler   │             │
│  │  (URL sync)  │  │   (input)    │  │  (workers)   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                             │                     │
│  ┌──────────────┐  ┌──────────────┐         │                     │
│  │  MovieMode   │  │ ZoomManager  │         ▼                     │
│  │   (video)    │  │  (zoom UI)   │    Web Workers                │
│  └──────────────┘  └──────────────┘    ┌─────────┐                │
│                                        │ Board 1 │                │
│                                        ├─────────┤                │
│                                        │ Board 2 │                │
│                                        ├─────────┤                │
│                                        │   ...   │                │
│                                        └─────────┘                │
└───────────────────────────────────────────────────────────────────┘
```

## Core Classes

| Class | Primary Responsibility |
|---|---|
| `MandelbrotExplorer` | The application root; creates and wires together all other components. |
| `StateStore` | A Redux-inspired container that holds the entire application state. |
| `Config` | Provides an ergonomic, property-based API for accessing and modifying state. |
| `Grid` | Manages the layout and collection of `View` objects. |
| `View` | Represents a single zoom level, holding its coordinates and pixel data. |
| `Scheduler` | Manages the pool of Web Workers and distributes computational tasks. |
| `URLHandler` | Synchronizes the application state with the browser's URL for bookmarking. |
| `EventHandler` | Handles all user input, such as mouse clicks, drags, and keyboard shortcuts. |
| `ZoomManager` | Manages the UI for the zoom selection box. |
| `MovieMode` | Handles the rendering and encoding of smooth zoom animations. |
| `Board` (in worker) | The computational engine that performs the fractal calculations for a `View`. |

### MandelbrotExplorer
The application root. It creates and wires together all the other components.

### StateStore
A Redux-inspired state container. All state changes flow through `dispatch(action)`, which makes mutations predictable. Fractal exploration involves complex state interactions; without a central store, this would create spaghetti code. The store provides a single source of truth.

The state is organized into four domains:
```javascript
{
  config: {
    // Display settings: dimensions, pixel ratio, theme, etc.
  },
  views: [
    // Array of zoom levels, each with coordinates
  ],
  ui: {
    // Mouse state, focused view, movie mode, fullscreen
  },
  computation: {
    // Per-view computation progress from workers
  }
}
```

### Config
Configuration management with property getters/setters that delegate to `StateStore`. It provides an ergonomic layer over the raw state, with computed properties and validation. For example, instead of dispatching `{type: 'SET_THEME', payload: 'neon'}`, the `Config` class allows for a simpler assignment: `config.theme = 'neon'`, which handles the dispatch internally. Key configuration categories include Viewport, Computation, Display, and Initial View settings.

### Grid
Manages the collection of `View` objects and their corresponding DOM elements. It handles layout changes, view creation/deletion, and coordinates the visual representation of the zoom hierarchy.

### View
Each `View` represents one zoom level. It maintains:
- **Coordinates**: center position (DD or QD precision) and size.
- **Pixel data**: iteration counts (`nn`).
- **Histogram**: distribution of iteration values for color mapping.
- **Parent reference**: for composite rendering.

### Scheduler
The traffic controller for computation. It manages a pool of Web Workers, distributes work, and collects results. Mandelbrot computation is CPU-intensive; workers run this in separate threads to keep the UI responsive.

### Board Classes (in Workers)
The actual computation happens inside `Board` objects within the workers. Different boards are optimized for different zoom depths, from simple `CpuBoard` and `GpuBoard` to high-precision `PerturbationBoard` and `GpuZhuoranBoard` for deep zooms beyond 10^15.

#### Board Class Hierarchy

The application uses three GPU/rendering backends with automatic fallback:

```
Backend Selection (in order of preference):
  1. WebGPU (GpuBaseBoard subclasses) - Best performance, requires modern GPU
  2. WebGL2 (GlBoard, GlPerturbationBaseBoard subclasses) - Wide compatibility
  3. CPU (CpuBoard, CpuZhuoranBaseBoard subclasses) - Universal fallback
```

```
Board (abstract base)
│
├── CPU Boards (universal fallback)
│   ├── CpuBoard                       Float64 direct iteration, zoom < 10^15
│   ├── QDCpuBoard                     QD direct iteration (testing only)
│   └── CpuZhuoranBaseBoard            Shared perturbation logic
│       ├── DDZhuoranBoard             DD precision (via DDReferenceOrbitMixin)
│       └── QDZhuoranBoard             QD precision (via QDReferenceOrbitMixin)
│
├── WebGPU Boards (preferred when available)
│   └── GpuBaseBoard                   Shared WebGPU infrastructure
│       ├── GpuBoard                   Float32 direct iteration, zoom < 10^7
│       ├── GpuZhuoranBoard            Float32 + DD reference orbit
│       └── GpuAdaptiveBoard           Float32 + QD reference + adaptive scaling
│
└── WebGL2 Boards (fallback when WebGPU unavailable)
    ├── GlBoard                        Float32 direct iteration, zoom < 10^7
    └── GlPerturbationBaseBoard        Shared WebGL2 perturbation infrastructure
        ├── GlZhuoranBoard             Float32 + DD reference orbit
        └── GlAdaptiveBoard            Float32 + QD reference + adaptive scaling
```

#### GPU Backend Fallback Chain

The application automatically selects the best available backend:

1. **WebGPU** (`GpuBoard`, `GpuZhuoranBoard`, `GpuAdaptiveBoard`): Uses compute shaders for maximum throughput. Requires a modern browser with WebGPU support and a compatible GPU.

2. **WebGL2** (`GlBoard`, `GlZhuoranBoard`, `GlAdaptiveBoard`): Uses fragment shaders with a ping-pong framebuffer architecture. Available on most modern browsers. See [GL-PERTURBATION-BOARDS.md](GL-PERTURBATION-BOARDS.md) for details.

3. **CPU** (`CpuBoard`, `DDZhuoranBoard`, `QDZhuoranBoard`): Pure JavaScript computation. Always available but slower.

The perturbation boards (`GpuZhuoranBoard`, `GlZhuoranBoard`, `DDZhuoranBoard` for medium zoom; `GpuAdaptiveBoard`, `GlAdaptiveBoard`, `QDZhuoranBoard` for deep zoom) share reference orbit computation logic via mixins:
- **DDReferenceOrbitMixin**: Double-double precision (~31 digits) for 10^7 to 10^30 zoom
- **QDReferenceOrbitMixin**: Quad-double precision (~62 digits) for beyond 10^30 zoom

The fallback is transparent to users—the application automatically uses the best available option. Debug flags `debug=nogpu` and `debug=nogl` can force fallback for testing.

#### Reference Orbit Mixins

Two mixins factor out reference orbit computation shared between CPU and GPU boards:

**DDReferenceOrbitMixin** - Double-double precision (~31 digits):
- Used by: `DDZhuoranBoard`, `GpuZhuoranBoard`
- Provides: `initDDReferenceOrbit()`, `extendReferenceOrbit()`, `getRefOrbit()`, etc.
- Storage: `refOrbit` array of 4-element arrays `[r_hi, r_lo, i_hi, i_lo]`

**QDReferenceOrbitMixin** - Quad-double precision (~62 digits):
- Used by: `QDZhuoranBoard`, `GpuAdaptiveBoard`
- Provides: `initQDReferenceOrbit()`, `extendReferenceOrbit()`, `getRefOrbit()`, etc.
- Storage: `qdRefOrbit` array of 8-element arrays `[re0..re3, im0..im3]`

The mixin pattern enables code sharing between classes with different base classes (CPU vs GPU). For example:
```javascript
class DDZhuoranBoard extends DDReferenceOrbitMixin(CpuZhuoranBaseBoard) { ... }
class GpuZhuoranBoard extends DDReferenceOrbitMixin(GpuBaseBoard) { ... }
```

Both classes inherit identical reference orbit logic while maintaining their respective CPU/GPU computation pipelines.

#### Board Selection by Zoom Level

The board selection depends on both zoom depth and available GPU backend:

| Pixel Size | Zoom Level | WebGPU | WebGL2 | CPU |
|------------|------------|--------|--------|-----|
| > 1e-7 | < ~10^7 | `GpuBoard` | `GlBoard` | `CpuBoard` |
| 1e-7 to 1e-30 | ~10^7 to ~10^30 | `GpuZhuoranBoard` | `GlZhuoranBoard` | `DDZhuoranBoard`* |
| < 1e-30 | > ~10^30 | `GpuAdaptiveBoard` | `GlAdaptiveBoard` | `QDZhuoranBoard` |

*Note: CPU uses `CpuBoard` up to 1e-15 (float64 precision) then switches to `DDZhuoranBoard`.

The GPU thresholds are lower than CPU because `float32` has ~7 decimal digits vs `float64`'s ~15 digits. At deep zooms (> 10^30), `GpuAdaptiveBoard` and `GlAdaptiveBoard` use per-pixel adaptive scaling to correctly detect escape even when the scale exponent exceeds float32's range. See [ADAPTIVE-SCALING.md](ADAPTIVE-SCALING.md) for the design.

## State Management and URL Synchronization

The application uses a unidirectional data flow:

```
User Interaction
       │
       ▼
Event Handler ──► dispatch(action) ──► StateStore.reducer()
                                              │
                                              ▼
                                        New State
                                              │
                                              ▼
                                    Component Updates
```

The `URLHandler` maintains a bidirectional sync between the state and the URL, making any view bookmarkable.

A key challenge is handling browser history navigation without discarding computed fractal detail. The `handlePopState` handler implements a **view preservation** system: it compares the state from the new URL with the current state, matches views by coordinates and zoom level, and preserves any unchanged views, keeping their computed data intact.

### The `stableViews` System

A race condition can occur if a history navigation event arrives while the app is already processing a new view from a user click. The `stableViews` system solves this:

```
┌─────────────────────────────────────────────────────────────┐
│  Normal State: this.views = [view0, view1, view2]           │
│                this.stableViews = null                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ updateLayout() called
┌─────────────────────────────────────────────────────────────┐
│  During Update: this.views = []  (cleared)                   │
│                 this.stableViews = [view0, view1, view2]     │
│                 (boards continue computing in workers)       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ Views recreated/preserved
┌─────────────────────────────────────────────────────────────┐
│  After Update: this.views = [view0', view1', view2']        │
│                this.stableViews = null (cleaned up)          │
│                (unused boards removed from workers)          │
└─────────────────────────────────────────────────────────────┘
```

When a layout change begins, current views move to `stableViews`. Workers continue computing for these views. As the new layout is constructed, views from `stableViews` are matched and reused. Any views left over are safely discarded. This ensures no worker messages are lost and no computation is wasted during the transition.

## Rendering, Communication, and Memory

### Rendering Pipeline

Views are rendered in layers for smooth zoom experience:
1. **Clear** - Reset canvas to unknown color
2. **Parent Composite** - Draw scaled parent view as background (provides instant visual feedback during zoom)
3. **Local Pixels** - Draw computed pixels on top
4. **UI Overlay** - Zoom box, coordinates, etc.

### Fast Pixel Drawing

Drawing pixels efficiently is critical for smooth updates. The application uses several optimizations:

**ImageData Caching:** For large updates (>100k pixels), the View caches its `ImageData` object to avoid expensive `getImageData()` readbacks. The cached ImageData is updated incrementally and written back with `putImageData()`. The cache is cleared after computation completes to free memory.

**RGBA Color Tables:** Color themes pre-compute RGBA byte arrays (`colorThemesRGBA`) to avoid per-pixel color function calls. This enables direct memory writes:
```javascript
// Fast path: direct byte copy from pre-computed RGBA
data[idx] = rgba[0];     // R
data[idx + 1] = rgba[1]; // G
data[idx + 2] = rgba[2]; // B
data[idx + 3] = 255;     // A
```

**Offscreen Canvas Compositing:** When drawing partial updates that need alpha blending, an offscreen canvas is used because `putImageData()` ignores compositing modes.

**Sparse Updates:** Rather than redrawing the entire canvas, only changed pixels are updated via the `changeList` from workers.

### Worker Communication

The main thread sends `createBoard` messages to workers. Workers stream results back via `update` messages containing a `changeList` of newly computed pixels grouped by iteration count. This sparse update mechanism minimizes data transfer and enables incremental rendering.

### Memory Management

Heavy pixel data stays in workers to avoid main-thread GC pressure. The `changeList` system ensures only minimal data is transferred. Converged pixel data (`z` values and periods) is stored in a Map rather than arrays to handle sparse convergence efficiently.

## Code Organization in `index.html`

The application's JavaScript is contained within `<script>` tags inside `index.html`:

| Script ID | Approx Lines | Contents |
|-----------|-------------|----------|
| `mainCode` | 217-4501 | Core classes (MandelbrotExplorer, StateStore, Config, View, Grid, ZoomManager), UI classes (URLHandler, EventHandler, MovieMode), Scheduler, OrbitComputer |
| `workerCode` | 4502-9616 | Board classes, mixins (DDReferenceOrbitMixin, QDReferenceOrbitMixin), and computational algorithms |
| `workerStart` | 9617-9637 | Worker initialization code (injected into blob) |
| `debugCode` | 9638-9805 | Debug utilities for main-thread board inspection |
| `mathCode` | 9806-11568 | DD and QD precision math library (shared by main thread and workers) |
| `i18nCode` | 11569-11747 | Internationalization messages |
| `mp4Muxer` | 11748-12790 | Bundled mp4-muxer library |
| `startApp` | 12791-12795 | Application startup |

The line numbers are approximate and shift as the code evolves. The script IDs are used for code coverage reporting.

## Next Steps

- [COMPUTATION.md](COMPUTATION.md): How computation is managed across threads and GPUs.
- [ALGORITHMS.md](ALGORITHMS.md): The mathematical algorithms.
- [COLORS.md](COLORS.md): The histogram-based coloring system.
- [MOVIES.md](MOVIES.md): How smooth animations and videos are generated.
- [GL-PERTURBATION-BOARDS.md](GL-PERTURBATION-BOARDS.md): WebGL2 perturbation board architecture.
- [webgl-pingpong-design.md](webgl-pingpong-design.md): WebGL2 ping-pong rendering design.

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

```
Board (abstract base)
├── CpuBoard                           Float64 CPU, zoom < 10^13
├── QDCpuBoard                         QD CPU, simple iteration
├── PerturbationBoard                  DD perturbation, CPU
├── QDPerturbationBoard                QD perturbation, CPU
│
├── CpuZhuoranBaseBoard                Shared CPU Zhuoran logic
│   ├── DDZhuoranBoard                 DD precision (via DDReferenceOrbitMixin)
│   └── QDZhuoranBoard                 QD precision (via QDReferenceOrbitMixin)
│
└── GpuBaseBoard                       Shared GPU infrastructure
    ├── GpuBoard                       Float64 GPU, zoom < 10^13
    ├── GpuZhuoranBoard                DD GPU perturbation (via DDReferenceOrbitMixin)
    └── AdaptiveGpuBoard               QD GPU perturbation (via QDReferenceOrbitMixin)
```

#### Reference Orbit Mixins

Two mixins factor out reference orbit computation shared between CPU and GPU boards:

**DDReferenceOrbitMixin** - Double-double precision (~31 digits):
- Used by: `DDZhuoranBoard`, `GpuZhuoranBoard`
- Provides: `initDDReferenceOrbit()`, `extendReferenceOrbit()`, `getRefOrbit()`, etc.
- Storage: `refOrbit` array of 4-element arrays `[r_hi, r_lo, i_hi, i_lo]`

**QDReferenceOrbitMixin** - Quad-double precision (~62 digits):
- Used by: `QDZhuoranBoard`, `AdaptiveGpuBoard`
- Provides: `initQDReferenceOrbit()`, `extendReferenceOrbit()`, `getRefOrbit()`, etc.
- Storage: `qdRefOrbit` array of 8-element arrays `[re0..re3, im0..im3]`

The mixin pattern enables code sharing between classes with different base classes (CPU vs GPU). For example:
```javascript
class DDZhuoranBoard extends DDReferenceOrbitMixin(CpuZhuoranBaseBoard) { ... }
class GpuZhuoranBoard extends DDReferenceOrbitMixin(GpuBaseBoard) { ... }
```

Both classes inherit identical reference orbit logic while maintaining their respective CPU/GPU computation pipelines.

#### Board Selection by Zoom Level

| Zoom Range | Exponent=2 | Exponent>2 |
|------------|------------|------------|
| < 10^13    | GpuBoard   | GpuBoard   |
| 10^13 - 10^28 | GpuZhuoranBoard | GpuZhuoranBoard |
| > 10^28    | AdaptiveGpuBoard | AdaptiveGpuBoard |

The `AdaptiveGpuBoard` can fall back to CPU computation (`QDZhuoranBoard`) when GPU precision is insufficient for the current zoom level.

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

- **Rendering Pipeline:** Views are rendered in layers: 1. Clear, 2. Parent composite, 3. Local pixels, 4. UI Overlay. The composite rendering provides a smooth zoom experience.
- **Worker Communication:** The main thread sends `createBoard` messages to workers. Workers stream results back via `update` messages containing a `changeList` of newly computed pixels.
- **Memory:** Heavy pixel data stays in workers to avoid main-thread GC pressure. The `changeList` system ensures only minimal data is transferred.

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

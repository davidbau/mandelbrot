# Architecture Overview

## Philosophy: A Structured Monolith

The entire application—interface, computation, and styling—lives in a single `index.html` file. This design choice is intentional. It means the fractal explorer is a self-contained digital object. You can save the page, email it, or host it on any simple web server without needing a build system, package manager, or CDN. It's as portable as the mathematics it visualizes.

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
Configuration management with property getters/setters that delegate to `StateStore`. It provides an ergonomic layer over the raw state, with computed properties and validation. Key configuration categories include Viewport, Computation, Display, and Initial View settings.

### Grid
Manages the collection of `View` objects and their corresponding DOM elements. It handles layout changes, view creation/deletion, and coordinates the visual representation of the zoom hierarchy.

### View
Each `View` represents one zoom level. It maintains:
- **Coordinates**: center position (quad precision) and size.
- **Pixel data**: iteration counts (`nn`).
- **Histogram**: distribution of iteration values for color mapping.
- **Parent reference**: for composite rendering.

### Scheduler
The traffic controller for computation. It manages a pool of Web Workers, distributes work, and collects results. Mandelbrot computation is CPU-intensive; workers run this in separate threads to keep the UI responsive.

### Board Classes (in Workers)
The actual computation happens inside `Board` objects within the workers. Different boards are optimized for different zoom depths, from simple `CpuBoard` and `GpuBoard` to high-precision `PerturbationBoard` and `GpuZhuoranBoard` for deep zooms beyond 10^15.

## State Management and URL Synchronization

The application uses a unidirectional data flow (`Interaction -> Action -> Reducer -> New State -> Re-render`). The `URLHandler` maintains a bidirectional sync between the state and the URL, making any view bookmarkable.

A key challenge is handling browser history navigation without discarding computed fractal detail. The `handlePopState` handler implements a **view preservation** system: it compares the state from the new URL with the current state, matches views by coordinates and zoom level, and preserves any unchanged views, keeping their computed data intact.

### The `stableViews` System
A race condition can occur if a history navigation event arrives while the app is already processing a new view from a user click. The `stableViews` system solves this. When a layout change begins, the current views are moved to a temporary `stableViews` holding area. Workers continue computing for these views. As the new layout is constructed, views from `stableViews` are matched and reused. Any views left over are safely discarded. This ensures that no worker messages are lost and no computation is wasted during the transition.

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

## Rendering, Communication, and Memory

- **Rendering Pipeline:** Views are rendered in layers: 1. Clear, 2. Parent composite, 3. Local pixels, 4. UI Overlay. The composite rendering provides a smooth zoom experience.
- **Worker Communication:** The main thread sends `createBoard` messages to workers. Workers stream results back via `update` messages containing a `changeList` of newly computed pixels.
- **Memory:** Heavy pixel data stays in workers to avoid main-thread GC pressure. The `changeList` system ensures only minimal data is transferred.

## Code Organization in `index.html`
The application's JavaScript is contained within `<script>` tags inside `index.html`, organized conceptually as follows:
1.  **Main Application Code:** Core classes like `MandelbrotExplorer`, `StateStore`, `Config`, `View`, and `Grid`.
2.  **UI and Interaction Code:** `URLHandler`, `EventHandler`, `MovieMode`, etc.
3.  **Worker Code:** The `Board` classes and computational algorithms.
4.  **Quad-Precision Math:** The library for quad-double arithmetic.
5.  **Bundled Libraries & Utilities:** The MP4 muxer, i18n strings, and startup script.

## Next Steps

- [COMPUTATION.md](COMPUTATION.md): How computation is managed across threads and GPUs.
- [ALGORITHMS.md](ALGORITHMS.md): The mathematical algorithms.
- [COLORS.md](COLORS.md): The histogram-based coloring system.
- [MOVIES.md](MOVIES.md): How smooth animations and videos are generated.
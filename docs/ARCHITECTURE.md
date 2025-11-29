# Architecture Overview

## Philosophy: One HTML File

The entire application lives in `index.html`. A single file means you can save
the page, email it to a friend, or host it anywhere without worrying about build
systems or CDNs. The fractal explorer should be as self-contained as the
mathematics it visualizes.

The code inside is organized into clear sections with well-defined responsibilities.
A structured monolith.

## The Big Picture

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

The application root. Creates and wires together all the other components.
When you load the page, `MandelbrotExplorer` gets instantiated, triggering
the cascade that initializes everything else.

```javascript
class MandelbrotExplorer {
  constructor() {
    this.store = new StateStore();
    this.config = new Config(this.store);
    this.grid = new Grid(this.config, this.store);
    this.scheduler = new Scheduler(this.grid, this.config);
    // ... and so on
  }
}
```

### StateStore

A Redux-inspired state container. All state changes flow through here via
`dispatch(action)`, which makes mutations predictable and debuggable.

Fractal exploration involves complex state interactions: clicking creates views,
views trigger computation, computation updates pixels, pixels affect colors.
Without centralized state, these interactions create spaghetti. The store
provides a single source of truth: easy to serialize to URLs, easy to debug,
and components stay synchronized without effort.

The state is organized into four domains:

```javascript
{
  config: {
    // Display settings: dimensions, pixel ratio, theme, etc.
    dimsWidth: 960,
    dimsHeight: 540,
    pixelRatio: 2,
    theme: 'warm',
    exponent: 2,
    enableGPU: true,
    // ...
  },
  views: [
    // Array of zoom levels, each with coordinates
    { k: 0, sizes: [3.0, [-0.5, 0], [0, 0]], hidden: false },
    // ...
  ],
  ui: {
    // Mouse state, focused view, movie mode, fullscreen
    mouseDown: false,
    focusedView: 0,
    movieMode: { active: false, progress: 0 },
    fullscreen: false
  },
  computation: {
    // Per-view computation progress
    views: { 0: { un: 1000, di: 45000, ch: 100, it: 500 } }
  }
}
```

### Config

Configuration management with property getters/setters that delegate to StateStore.
This maintains backward compatibility while ensuring all config changes go through
the state system.

The StateStore holds raw state, but components need convenient access. Config
provides computed properties (like `dimsArea` from width × height), validation
(clamping exponent to valid ranges), and a familiar getter/setter interface.
It's the ergonomic layer over the raw store.

Key configuration categories:
- **Viewport**: canvas dimensions, pixel ratio, grid columns
- **Computation**: exponent (z^n), GPU enable/disable, algorithm forcing
- **Display**: color theme, unknown pixel color, zoom factor
- **Initial view**: starting coordinates and size

### Grid

Manages the collection of View objects and their corresponding DOM elements.
Handles layout changes, view creation/deletion, and coordinates the visual
representation of the zoom hierarchy.

A View knows how to render itself but doesn't know about other Views or the DOM.
Grid handles the "many views" concerns: arranging them in columns, deciding when
to show or hide views, managing the parent-child relationships for composite
rendering. Views focus on pixels; Grid focuses on layout.

### View

Each View represents one zoom level in the explorer. Views maintain:
- **Coordinates**: center position (quad precision) and size
- **Pixel data**: iteration counts (`nn`), periods (`pp`)
- **Histogram**: distribution of iteration values for color mapping
- **Parent reference**: for composite rendering (zoomed region from parent)

Views handle their own rendering, including the clever composite drawing that
shows the parent's zoomed region as a background while local pixels compute.

Pixel arrays are large (megabytes) and updated frequently. Keeping them in the
View avoids copying data through the state system on every update. The StateStore
tracks view metadata (coordinates, visibility), while Views own the heavy pixel
data directly.

### Scheduler

The traffic controller for computation. Manages a pool of Web Workers,
distributes work across them, and handles:
- Creating and destroying workers
- Transferring boards between workers for load balancing
- Collecting results and updating views

Mandelbrot computation is CPU-intensive, requiring millions of iterations per
second. Running this on the main thread would freeze the UI. Workers run in
separate threads, keeping the interface responsive while computation happens
in the background. The Scheduler abstracts this complexity, presenting a simple
"create board, receive updates" interface to the rest of the application.

### Board Classes (in Workers)

The actual computation happens in Web Workers, which run Board objects:
- **CpuBoard**: Simple double-precision iteration
- **GpuBoard**: WebGPU-accelerated for shallow zooms
- **PerturbationBoard**: High-precision reference orbit with double perturbations
- **ZhuoranBoard**: Quad-double reference with rebasing (CPU)
- **GpuZhuoranBoard**: Quad-double reference with float32 perturbations (GPU)

Different zoom depths have different computational requirements. At shallow zoom,
double precision suffices and GPU parallelism dominates, making GpuBoard fastest.
At deep zoom (10^15 and beyond), double precision fails, requiring perturbation
theory with high-precision reference orbits. The Scheduler automatically selects
the appropriate Board type based on zoom depth, giving optimal performance at
every scale.

See [ALGORITHMS.md](ALGORITHMS.md) for details on the mathematical algorithms.

## State Management Flow

The application follows a unidirectional data flow pattern:

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

For example, when you press 'T' to change the color theme:

1. `EventHandler.onkeydown()` detects the 'T' key
2. Calls `explorer.cycleColorTheme()`
3. Which calls `config.setTheme(nextTheme)`
4. Which dispatches `CONFIG_SET_THEME` action
5. StateStore reducer creates new state with updated theme
6. RedrawProcess redraws all views with new colors

## URL Synchronization

The URL is the bookmark. `URLHandler` maintains bidirectional sync:

- **Parse on load**: URL parameters → initial state
- **Update on change**: state changes → URL update

Supported URL parameters:
- `c`: coordinates (can chain multiple: `c=re+im,re+im,...`)
- `z`: zoom level (alternative to `s` for size)
- `s`: view size in complex plane
- `grid`: number of columns
- `exponent`: z^n exponent (default 2)
- `theme`: color theme name
- `gpu`: enable/disable GPU
- `board`: force specific algorithm
- `lang`: interface language
- `a`: aspect ratio (e.g., `16:9`)

### Browser History and View Preservation

The application uses `pushState`/`replaceState` for browser history integration:

- **pushState**: When zoom centers are replaced (clicking B, C, or typing new centers),
  a new history entry is created, allowing browser back/forward navigation.
- **replaceState**: When zoom centers are extended (clicking A to zoom in), the URL
  is updated without creating a new history entry.

The `handlePopState` handler implements smart view preservation when navigating
browser history. Instead of reloading the entire page, it:

1. Compares target state (from URL) with current state
2. Matches views by **coordinates AND zoom level** (within tolerance)
3. Preserves matching views (keeping their computation progress)
4. Creates only the views that actually changed

This is crucial for a good user experience because:
- Computed fractal detail is preserved (no visual flash/reset)
- Only changed views restart computation
- Theme changes just redraw existing views (no recomputation)
- Grid/aspect ratio changes trigger full reload (unavoidable)

The matching algorithm uses tolerances because URL encoding loses precision:
- Coordinates match within 1% of the view's visible extent
- Zoom levels match within 1% of each other

### The stableViews System

During layout transitions (popstate, grid resize, H/G keys), views need to be
preserved without losing worker messages or computation progress. The `stableViews`
system handles this:

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

Key invariants:
1. **stableViews is null except during updates** - If non-null, an update is in progress
2. **Worker messages route to stableViews during updates** - Messages find views by ID
3. **Boards are tracked by ID, not just index** - Prevents removing the wrong board
4. **processingPopState flag prevents forward history loss** - No pushState during popstate

The scheduler's `boardIds` map tracks which view ID owns each board index. When
cleaning up unused boards, it only removes boards whose ID matches, preventing
accidental removal of newer boards created at the same index.

## Worker Communication

Workers communicate with the main thread via structured messages:

```javascript
// Main → Worker
{ type: 'createBoard', k: 0, size: 3.0, re: [-0.5, 0], im: [0, 0] }

// Worker → Main
{ type: 'update', k: 0, changeList: [...], un: 500, di: 46000, it: 1000 }
```

The Scheduler maintains a pool of workers and handles board transfers:
- Workers request boards when idle
- Scheduler can transfer boards between workers for load balancing
- Results stream back as computation progresses

## Rendering Pipeline

Views are rendered in layers:

1. **Clear**: Start with transparent/black background
2. **Parent composite**: Scale and draw parent's relevant region
3. **Local pixels**: Draw computed pixels on top
4. **Overlay**: Yellow zoom rectangles, orbit dots (optional)

The composite rendering creates the smooth zoom experience - you see the
zoomed parent while waiting for child pixels to compute.

## Memory Considerations

Pixel data stays in workers to avoid main-thread GC pressure. Only change
lists (newly computed pixels) transfer to the main thread. Views maintain
their own `nn` (iteration) and `pp` (period) arrays for rendering.

The histogram (`hi`) summarizes iteration distribution without storing
individual values, enabling efficient color palette computation.

## File Organization

Within `index.html`:
- Lines 1-120: HTML structure and CSS
- Lines 120-200: Application overview comment
- Lines 200-2000: Main thread classes (Config, View, Grid, etc.)
- Lines 2000-2800: UI classes (URLHandler, EventHandler, MovieMode)
- Lines 2800-4000: Utility functions and color themes
- Lines 4000-7500: Worker code (Board classes, algorithms)
- Lines 7500-8000: Quad-double math library
- Lines 8000+: Internationalization messages

## Next Steps

- [COMPUTATION.md](COMPUTATION.md): How computation is managed across threads
- [ALGORITHMS.md](ALGORITHMS.md): The mathematical algorithms
- [COLORS.md](COLORS.md): Histogram-based coloring
- [MOVIES.md](MOVIES.md): Smooth animation and video export

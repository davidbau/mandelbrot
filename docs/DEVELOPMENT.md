# Development Guide

## Prerequisites

The explorer itself needs no build step to run: just open `index.html` in a modern browser. The build tools are only needed for updating the bundled `mp4-muxer` library or for running the automated test suite.

**Node.js**: Version 18+ is recommended. If you use `nvm`:
```bash
nvm use
```

**npm dependencies**:
```bash
npm install
```

This installs development dependencies, including:
- `jest`: The test framework.
- `puppeteer`: For headless browser-based integration tests.
- `esbuild`: Bundles the `mp4-muxer` library.
- `mp4-muxer`: The video encoding library.
- `nyc` & `v8-to-istanbul`: For code coverage reporting.

## The Build Process

The `mp4-muxer` library is bundled directly into `index.html` so the page remains a single self-contained file. If you update the library version in `package.json`, you must run the build to inject the new version into the main HTML file.

```bash
npm run build
```

This runs `build/build.sh`, which uses `esbuild` to tree-shake and minify the `mp4-muxer` code, then injects the minified bundle between two sentinel comments in `index.html`:

```html
<!-- BEGIN_MP4MUXER_LIBRARY -->
...bundled code...
<!-- END_MP4MUXER_LIBRARY -->
```

## Running Tests

The project has a comprehensive test suite covering mathematical correctness, UI behavior, and race conditions.

```bash
npm test              # Run all unit and integration tests
npm run test:unit     # Run only unit tests (fast, no browser)
npm run test:integration  # Run only integration tests (headless Chrome)
npm run test:stress   # Run longer stress tests to find race conditions
npm run test:watch    # Re-run tests on file changes
npm run test:coverage # Generate a code coverage report
```

- **Unit tests** verify the mathematical components, such as DD and QD precision arithmetic and algorithm logic.
- **Integration tests** use Puppeteer to simulate user interactions in a headless browser, testing everything from keyboard commands and URL parsing to movie mode and fullscreen behavior.
- **Stress tests** run extended, randomized sequences of operations (like history navigation and view toggling) to uncover subtle race conditions in the asynchronous view lifecycle.

See `tests/README.md` for more details on the test structure.

## Performance Benchmarking

Run `node tests/debug-benchmark.js` to measure board performance across all 9 board types. This script:
- Tests at multiple zoom levels (shallow, medium, deep)
- Varies grid size and iteration count to separate per-pixel vs per-batch costs
- Uses linear regression to fit the model: `time = perBatch + perPixelIter × pixels × iters`
- Outputs per-pixel-iteration cost (μs) and per-batch overhead for each board

The benchmark results inform the `effort` values used by the scheduler for load balancing across workers. See `docs/BENCHMARKS.md` for detailed methodology and results.

## Code Coverage

Run `npm run test:coverage` to generate a coverage report. This command runs the integration test suite while using Puppeteer's V8 coverage tools to track which code paths are exercised.

The report is written to the `coverage/` directory. Open `coverage/index.html` in a browser to see an interactive report showing covered and uncovered lines for each script section within `index.html`.

**Note on Worker Coverage:** Worker code is executed in a context (a `blob:` URL) that is separate from the main page. Because of this, standard coverage tools cannot fully track its execution. The coverage report for worker code may only reflect the main thread's initial parsing of the script, not the actual computation performed within the worker.

## Call Graph Visualization

Run `npm run callgraph` to generate an interactive visualization of the codebase's evolution over time. This extracts the call graph from each commit in the git history and creates an animated timeline.

Open `coverage/callgraph.html` in a browser to explore:
- **Timeline scrubbing**: Drag the slider or press Play to animate through commits
- **Node colors**: Viridis color scale shows when each function/class was added
- **Click nodes**: Opens the source file at that line on GitHub
- **Shareable URLs**: `#i=123` or `#c=abc1234` link to specific commits

The visualization includes:
- Original 2009 branch history (table-cell and canvas versions)
- Claude co-author badges (orange icon) for AI-assisted commits
- Test count per commit (parsed from `*.test.js` files)
- Statistics: lines, classes, mixins, methods, functions

## Project Structure

The main application file, `index.html`, is located in the project's root directory, one level above this `docs` folder.

```
mandelbrot/
├── index.html          # The entire application
├── package.json        # Node dependencies and scripts
├── build/
│   ├── build.sh        # The build script
│   └── build-mp4-muxer.js # esbuild configuration
├── tests/
│   ├── unit/           # Math and algorithm tests
│   ├── integration/    # Browser interaction tests
│   └── utils/          # Test helpers
└── docs/               # Documentation
```

## Code Organization in index.html

The application's JavaScript is contained within `<script>` tags inside `index.html`, organized conceptually as follows:

1.  **Main Application Code (`mainCode`):** Contains the core application logic and classes that run on the main thread, including `MandelbrotExplorer`, `StateStore`, `Config`, `View`, `Grid`, and `ZoomManager`.
2.  **UI and Interaction Code:** Includes classes for handling user input and browser integration, such as `URLHandler`, `EventHandler`, and `MovieMode`.
3.  **Worker Code (`workerCode`):** Contains the `Board` classes and all the computational algorithms. This code is loaded into Web Workers to run off the main thread.
4.  **DD and QD Precision Math (`mathCode`):** The library for double-double and quad-double arithmetic.
5.  **Bundled MP4 Muxer:** The minified `mp4-muxer` library, injected by the build script.
6.  **Internationalization (i18n):** Contains the translated strings for the UI.
7.  **Startup Script:** A final small script that instantiates `MandelbrotExplorer` to start the application.

## Debugging

You can use the browser's developer console to observe computation progress, worker messages, and GPU status. The `?board=` URL parameter is invaluable for forcing a specific algorithm for testing:

| Parameter | Board Class | Description |
|-----------|-------------|-------------|
| `?board=cpu` | CpuBoard | Simple float64 CPU board |
| `?board=gpu` | GpuBoard | WebGPU float32 board |
| `?board=ddz` | DDZhuoranBoard | DD-precision CPU with Zhuoran rebasing |
| `?board=gpuz` | GpuZhuoranBoard | DD-precision GPU with Zhuoran rebasing |
| `?board=qdz` | QDZhuoranBoard | QD-precision CPU with Zhuoran rebasing |
| `?board=qdcpu` | QDCpuBoard | Simple QD-precision CPU board |
| `?board=adaptive` | AdaptiveGpuBoard | QD-precision GPU with adaptive per-pixel scaling |

### Main Thread Debugging with MockWorker

Normally, computation runs in Web Workers which makes debugging difficult—you can't set breakpoints or inspect state easily. The `?debug=w` parameter runs computation on the main thread instead, enabling full debugger access.

**`?debug=w`** — MockWorker mode

Replaces Web Workers with `MockWorker` instances that run on the main thread. This allows you to:
- Set breakpoints in board iteration code
- Use `console.log` statements that appear in the main console
- Inspect board state directly via `window.worker0.boards`

```javascript
// Access the worker and its boards from the console
worker0.boards                    // Map of all boards
worker0.boards.get(0)            // Get board for view 0
worker0.boards.get(0).nn         // Iteration counts array
worker0.boards.get(0).it         // Current iteration
```

**`?debug=w,s`** — Step mode

Adds step-by-step iteration control on top of MockWorker mode. Computation pauses after each iteration batch, letting you inspect state changes incrementally.

Available console functions:

| Function | Description |
|----------|-------------|
| `step(n)` | Run `n` iteration batches (default: 1). Returns the boards Map. |
| `step(n, callback)` | Run `n` batches, calling `callback(board)` after each. |
| `stepAll()` | Resume continuous iteration (exit step mode). |
| `pause()` | Pause iteration and re-enter step mode. |
| `inspectBoard(k)` | Print summary of board `k` (iteration, pixels remaining, etc). |
| `tracePixel(k, idx)` | Get detailed state for pixel `idx` in board `k`. |

**Example debugging session:**

```javascript
// Load page with ?debug=w,s
// Computation is paused

step()                           // Run one iteration batch
inspectBoard(0)                  // Check board state
// Board 0 (GpuBoard):
//   Iteration: 100
//   Unfinished pixels: 12847
//   Diverged: 1553
//   Converged: 0

step(10)                         // Run 10 more batches

// Trace a specific pixel
tracePixel(0, 500)              // Get pixel 500's state

stepAll()                        // Resume normal iteration
pause()                          // Pause again when needed
```

**Use cases:**
- Debugging iteration logic by stepping through batches
- Comparing board states at specific iterations
- Investigating why specific pixels converge/diverge
- Profiling individual iteration batches

### Additional Debug Flags

Debug flags are comma-separated in `?debug=...`:

- `w` — Run workers on the main thread (MockWorker mode).
- `s` — Step mode (requires `w`).
- `n` — No initial view creation (blank canvas).
- `t` — Log timing per batch.
- `b` — Collect batch timing stats (use `analyzeBatchTimings(k)` in console).
- `r` — Random batch sizes for benchmarking.
- `inherit` — Log inheritance stats and flash inherited pixels.

## Contributing

The project's philosophy is to maintain simplicity and portability by keeping the application within a single, self-contained HTML file. Before adding a new dependency or build step, consider if the added complexity is justified.

When making changes:
1. Test in multiple modern browsers (e.g., Chrome, Firefox, Safari).
2. Verify that both GPU and CPU computation paths function correctly.
3. Check that deep zooms (e.g., to 10^20 magnification) still render correctly.
4. Run the full test suite (`npm test`) to ensure no regressions were introduced.

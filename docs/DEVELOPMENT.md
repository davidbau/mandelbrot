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

- **Unit tests** verify the mathematical components, such as quad-precision arithmetic and algorithm logic.
- **Integration tests** use Puppeteer to simulate user interactions in a headless browser, testing everything from keyboard commands and URL parsing to movie mode and fullscreen behavior.
- **Stress tests** run extended, randomized sequences of operations (like history navigation and view toggling) to uncover subtle race conditions in the asynchronous view lifecycle.

See `tests/README.md` for more details on the test structure.

## Code Coverage

Run `npm run test:coverage` to generate a coverage report. This command runs the integration test suite while using Puppeteer's V8 coverage tools to track which code paths are exercised.

The report is written to the `coverage/` directory. Open `coverage/index.html` in a browser to see an interactive report showing covered and uncovered lines for each script section within `index.html`.

**Note on Worker Coverage:** Worker code is executed in a context (a `blob:` URL) that is separate from the main page. Because of this, standard coverage tools cannot fully track its execution. The coverage report for worker code may only reflect the main thread's initial parsing of the script, not the actual computation performed within the worker.

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
4.  **Quad-Precision Math (`mathCode`):** The library for quad-double arithmetic.
5.  **Bundled MP4 Muxer:** The minified `mp4-muxer` library, injected by the build script.
6.  **Internationalization (i18n):** Contains the translated strings for the UI.
7.  **Startup Script:** A final small script that instantiates `MandelbrotExplorer` to start the application.

## Debugging

You can use the browser's developer console to observe computation progress, worker messages, and GPU status. The `?board=` URL parameter is invaluable for forcing a specific algorithm for testing:

- `?board=cpu`: Force the simple double-precision CPU board.
- `?board=gpu`: Force the WebGPU float32 board.
- `?board=zhuoran`: Force the quad-precision CPU board with rebasing.
- `?board=gpuzhuoran`: Force the quad-precision GPU board with rebasing.
- `?board=perturbation`: Force the quad-precision CPU board (alternative to Zhuoran).

## Contributing

The project's philosophy is to maintain simplicity and portability by keeping the application within a single, self-contained HTML file. Before adding a new dependency or build step, consider if the added complexity is justified.

When making changes:
1. Test in multiple modern browsers (e.g., Chrome, Firefox, Safari).
2. Verify that both GPU and CPU computation paths function correctly.
3. Check that deep zooms (e.g., to 10^20 magnification) still render correctly.
4. Run the full test suite (`npm test`) to ensure no regressions were introduced.

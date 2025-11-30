# Development Guide

## Prerequisites

The explorer itself needs no build step: just open `index.html` in a browser.
The build tools are only needed for updating the bundled mp4-muxer library
or running tests.

**Node.js**: Version 18+ recommended. If you use nvm:
```bash
nvm use node
```

**npm dependencies**:
```bash
npm install
```

This installs:
- `esbuild` - Bundles mp4-muxer into index.html
- `mp4-muxer` - Video encoding library
- `jest` - Test framework
- `puppeteer` - Headless browser for integration tests
- `nyc` - Code coverage reporting
- `v8-to-istanbul` - Converts V8 coverage to Istanbul format

## The Build Process

The mp4-muxer library is bundled directly into index.html so the page remains
a single self-contained file. When the library updates:

```bash
npm run build
```

This runs `build/build.sh`, which:
1. Bundles mp4-muxer with esbuild (tree-shaking unused code)
2. Minifies the result (~40KB)
3. Injects it between sentinel comments in index.html

The sentinels look like:
```html
<!-- BEGIN_MP4MUXER_LIBRARY -->
...bundled code...
<!-- END_MP4MUXER_LIBRARY -->
```

## Running Tests

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:integration  # Browser tests only
npm run test:stress   # Stress tests for race conditions
npm run test:watch    # Re-run on changes
npm run test:coverage # Generate coverage report
```

Unit tests verify the math (quad-precision arithmetic, board computations).
Integration tests use Puppeteer to click around in the actual explorer.
Stress tests run extended fuzzing of browser history navigation, hide/unhide
cycling, and mixed random operations to catch race conditions in view
lifecycle management. They take about 90 seconds to run.

Test suites include:
- `ui-commands.test.js` - Keyboard commands (zoom, grid, colors)
- `ui-url.test.js` - URL parameter parsing (zoom, center, theme, grid)
- `ui-history.test.js` - Browser history navigation and view preservation
- `ui-keyboard-nav.test.js` - Arrow key navigation between views
- `ui-mouse.test.js` - Click and drag interactions
- `ui-movie.test.js` - Movie mode and video export
- `ui-fullscreen.test.js` - Fullscreen mode
- `ui-language.test.js` - Internationalization

The `ui-history.test.js` tests cover browser back/forward integration,
including the view preservation optimization that keeps computed views intact
when navigating between similar states.

See [tests/README.md](../tests/README.md) for details on writing tests.

## Code Coverage

Run `npm run test:coverage` to generate a coverage report. This uses
Puppeteer's V8 coverage API to track which code paths are exercised by
the integration tests.

Coverage reports are written to the `coverage/` directory. Open
`coverage/index.html` in a browser to see an interactive report showing
covered and uncovered lines.

Since `index.html` contains multiple `<script>` blocks, coverage is reported
separately for each:

| Script | Description |
|--------|-------------|
| mainCode.js | Main application (~82% coverage) |
| workerCode.js | Web worker algorithms |
| quadCode.js | Quad-double precision math |
| mp4Muxer.js | Video encoding library |
| i18nCode.js | Internationalization |
| startApp.js | Application startup |
| analytics.js | Google Analytics |

Note: Worker code runs in a separate blob URL context, so its coverage
reflects parse-time execution in the main thread rather than actual
worker execution.

## Project Structure

```
mandelbrot/
├── index.html          # The entire application
├── package.json        # Node dependencies and scripts
├── build/
│   ├── build.sh        # Build script
│   └── build-mp4-muxer.js  # esbuild entry point
├── tests/
│   ├── unit/           # Arithmetic and algorithm tests
│   ├── integration/    # Browser interaction tests
│   └── utils/          # Test helpers
└── docs/               # Documentation
```

## Code Organization in index.html

The code is organized into sections (line numbers approximate):

| Lines | Section |
|-------|---------|
| 1-120 | HTML structure and CSS |
| 120-200 | Application overview comment |
| 200-2000 | Main thread classes (Config, View, Grid, Scheduler) |
| 2000-2800 | UI classes (URLHandler, EventHandler, MovieMode) |
| 2800-4000 | Utility functions and color themes |
| 4000-7500 | Worker code (Board classes, algorithms) |
| 7500-8000 | Quad precision math library |
| 8000+ | Internationalization messages |

## Debugging

Open the browser console to see:
- Computation progress (iterations, diverged/converged counts)
- Worker messages
- GPU initialization status

The `?board=` URL parameter forces a specific algorithm:
- `?board=cpu` - CpuBoard (double precision)
- `?board=gpu` - GpuBoard (WebGPU)
- `?board=zhuoran` - ZhuoranBoard (quad-precision CPU)
- `?board=gpuzhuoran` - GpuZhuoranBoard (quad-precision GPU)

## Contributing

The philosophy: keep it in one file. Before adding dependencies, consider
whether the feature justifies the complexity. The fractal explorer should
remain something you can save and share without a build pipeline.

When making changes:
1. Test in multiple browsers (Chrome, Firefox, Safari)
2. Verify GPU and CPU paths both work
3. Check deep zoom (10^20+) still renders correctly
4. Run the test suite

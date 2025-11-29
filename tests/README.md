# Mandelbrot Explorer Test Suite

Comprehensive test suite for the Mandelbrot Explorer application, including unit tests, integration tests, and end-to-end tests.

## Test Structure

```
tests/
├── unit/                      # Unit tests
│   ├── quad-double.test.js    # Quad-double arithmetic tests
│   └── mandelbrot-boards.test.js  # Board computation tests
├── integration/               # Integration tests
│   └── ui-commands.test.js    # UI keyboard and mouse command tests
└── utils/                     # Test utilities
    └── extract-code.js        # Code extraction from index.html
```

## Setup

Install dependencies:

```bash
npm install
```

This will install:
- `jest` - Test framework
- `puppeteer` - Headless browser for integration tests

## Running Tests

Run all tests:
```bash
npm test
```

Run only unit tests:
```bash
npm run test:unit
```

Run only integration tests:
```bash
npm run test:integration
```

Run tests in watch mode (re-runs on file changes):
```bash
npm run test:watch
```

Generate coverage report:
```bash
npm run test:coverage
```

## Test Categories

### Unit Tests

#### Quad-Double Arithmetic (`quad-double.test.js`)
Tests the high-precision arithmetic functions used for deep zoom calculations:
- Two-sum operations (Afast2Sum, Aslow2Sum)
- Two-product operations (AtwoProduct, AtwoSquare)
- Quad-double addition (AqdAdd)
- Quad-double multiplication (AqdMul)
- Quad-double square (AqdSquare)
- Catastrophic cancellation handling
- Parsing scientific notation

#### Mandelbrot Boards (`mandelbrot-boards.test.js`)
Tests various Mandelbrot computation implementations on small grids:
- CpuBoard - Basic CPU implementation
- ZhuoranBoard - High-precision CPU implementation
- PerturbationBoard - Perturbation theory implementation
- GpuBoard - WebGPU implementation
- GpuZhuoranBoard - WebGPU with perturbation theory

Test locations include:
- Origin (all pixels diverge)
- Main cardioid (all pixels converge)
- Feigenbaum point (chaotic pixels on spike)
- Julia set boundary (mixed diverged/converged)
- Deep zoom locations (1e-15 scale)

Board consistency tests verify that different implementations produce equivalent results.

### Integration Tests

#### UI Commands (`ui-commands.test.js`)
End-to-end tests of user interactions using Puppeteer:

**Keyboard Commands:**
- `T` / `Shift+T` - Cycle color themes
- `U` / `Shift+U` - Cycle unknown color
- `H` / `G` - Increase/decrease grid columns
- `X` / `Z` - Increase/decrease exponent
- `ESC` - Clear all views except first
- `D` - Delete current view

**Mouse Interactions:**
- Click - Zoom in and create child view
- Shift+Click - Zoom out and delete view

**URL Parameters:**
- `z` - Zoom level (including scientific notation)
- `c` - Center coordinates
- `theme` - Color theme
- `grid` - Number of grid columns
- `a` - Aspect ratio

**System Tests:**
- Computation completion tracking
- URL state updates
- WebGPU fallback handling

## Test Data Extraction

The test suite uses `extract-code.js` to dynamically extract JavaScript functions and classes from `index.html`. This approach ensures tests stay synchronized with the main codebase as it evolves.

Example usage:
```javascript
const { createTestEnvironment } = require('./utils/extract-code');

const math = createTestEnvironment(['AqdAdd', 'AqdMul']);
// Now math.AqdAdd and math.AqdMul are available for testing
```

## Known Mandelbrot Properties Tested

The tests verify fundamental properties of the Mandelbrot set:
- Points with |c| > 2 diverge
- c = 0 is in the set (converges)
- c = -1 is in the period-2 bulb (converges)
- Points on the Feigenbaum spike are chaotic

## Writing New Tests

### Adding Unit Tests

1. Create a new test file in `tests/unit/`
2. Extract required functions using `createTestEnvironment()`
3. Write Jest test cases

Example:
```javascript
const { createTestEnvironment } = require('../utils/extract-code');

const myFunctions = createTestEnvironment(['myFunc']);

describe('My Function', () => {
  test('should do something', () => {
    expect(myFunctions.myFunc(42)).toBe(84);
  });
});
```

### Adding Integration Tests

1. Create a new test file in `tests/integration/`
2. Use Puppeteer to control the browser
3. Interact with the page using `page.keyboard`, `page.mouse`, etc.
4. Verify state using `page.evaluate()`

Example:
```javascript
const puppeteer = require('puppeteer');

describe('My Feature', () => {
  let browser, page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    await page.goto('file://path/to/index.html');
  });

  afterAll(async () => {
    await browser.close();
  });

  test('should do something', async () => {
    await page.keyboard.press('t');
    const result = await page.evaluate(() => window.someGlobal);
    expect(result).toBe('expected');
  });
});
```

## Continuous Integration

These tests are designed to run in CI environments. Puppeteer will automatically download Chromium for headless testing.

Environment variables:
- `CI=true` - Enables CI-specific settings
- `HEADLESS=true` - Forces headless mode (default in CI)

## Debugging Tests

Run tests with console output visible:
```bash
npm test -- --verbose
```

Run a single test file:
```bash
npm test -- tests/unit/quad-double.test.js
```

Run tests matching a pattern:
```bash
npm test -- --testNamePattern="should add correctly"
```

Debug integration tests in headed mode (see browser):
```javascript
// In test file, change:
browser = await puppeteer.launch({ headless: false });
```

## Performance Considerations

- Unit tests should complete in < 1 second each
- Board computation tests may take 5-10 seconds (small grids)
- Integration tests may take 10-30 seconds (browser startup + interactions)
- Total test suite should complete in < 2 minutes

## Coverage Goals

Target coverage levels:
- Arithmetic functions: 100%
- Board implementations: 90%+
- UI commands: 80%+
- Overall: 85%+

## Architecture: View Lifecycle and stableViews

For detailed documentation on view lifecycle management and the stableViews system, see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#the-stableviews-system).

### Stress Testing

Run stress tests to verify race condition handling:

```bash
npm run test:stress
```

These tests perform rapid hide/unhide cycles, back/forward navigation, and mixed operations for 30 seconds each to expose timing-dependent bugs.

## Troubleshooting

**Puppeteer installation fails:**
```bash
# Set custom Chromium download path
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install puppeteer
# Then set executable path in tests
```

**Tests timeout:**
- Increase `TEST_TIMEOUT` constant in test files
- Check if boards are completing (may need to adjust grid size)

**Extraction fails:**
- Verify function name matches exactly in index.html
- Check for syntax errors in extracted code
- Use `extractAllJavaScript()` to debug

**Integration tests fail on CI:**
- Ensure headless mode is enabled
- Add `--no-sandbox` flag for Docker/containers
- Check Chromium version compatibility

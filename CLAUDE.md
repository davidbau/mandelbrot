# CLAUDE.md

## Project Overview

Mandelbrot set explorer - a single HTML file that renders fractals with deep zoom capability using WebGPU, perturbation theory, and quad-precision arithmetic.

## Commands

- `npm test` - Run all tests (unit + integration)
- `npm run test:unit` - Unit tests only
- `npm run test:integration` - Integration tests only
- `npm run test:coverage` - Run with coverage reporting
- `./build/build.sh` - Build the project

## Key Principles

### Verify, Don't Assume

When writing documentation, changelogs, or making claims about the codebase:
- Check actual git logs for dates and attribution (`git log --format="%h %ad %s" --date=short`)
- Verify claims against the actual code, not memory or assumptions
- Run tests and check coverage results to confirm behavior

### Testing

When running tests repeatedly:
- Always capture output and grep for FAIL - don't just trust summary lines
- Test flakiness is usually caused by missing preconditions, not insufficient timeouts
- Fix root causes, not symptoms

### Architecture

- Single HTML file design - avoid adding external dependencies
- All JavaScript is embedded in index.html
- Tests use Puppeteer for integration testing

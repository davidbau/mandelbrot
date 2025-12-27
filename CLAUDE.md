# CLAUDE.md

## Project Overview

Mandelbrot set explorer - a single HTML file that renders fractals with deep zoom capability using WebGPU, perturbation theory, and quad-precision arithmetic.

## Commands

- `npm test` - Run all tests (unit + integration)
- `npm run test:unit` - Unit tests only
- `npm run test:integration` - Integration tests only (sequential by default)
- `npm run test:integration:fast` - Integration tests with 3 parallel workers
- `TEST_WORKERS=3 npm run test:integration` - Custom parallelism via env var
- `npm run test:coverage` - Run with coverage reporting
- `./build/build.sh` - Build the project

### Test Parallelism

Integration tests run with `--maxWorkers=1` by default for reliability on Linux
(where swiftshader WebGPU emulation is slow). On Mac/Windows, you can speed up
tests with parallel execution:
- `npm run test:integration:fast` - Uses 3 workers
- `TEST_WORKERS=4 npm run test:integration` - Uses 4 workers

To set a default for your machine, create `.env.local` (gitignored):
```bash
TEST_WORKERS=3
```
The test scripts use `dotenv-cli` to automatically load this file.

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
- For debug scripts that need long timeouts, create a `tests/debug-*.js` script and run with `node tests/debug-*.js` rather than using long inline commands or `timeout` wrappers - this avoids permission prompts

When filtering tests by name:
- Do NOT use `npm run test:integration -- --testPathPattern="foo"` - the positional directory arg takes precedence and ignores the pattern
- Instead use: `npx jest --testPathPattern="integration/foo"` - include the directory in the pattern
- Multiple `--testPathPattern` args are ORed (match either), not ANDed

### Architecture

- Single HTML file design - avoid adding external dependencies
- All JavaScript is embedded in index.html
- Tests use Puppeteer for integration testing

### Code Design Philosophy

**Simplicity over complexity** - Write the simplest code that works. Avoid over-engineering solutions. If cleanup reduces code by 200+ lines, the original implementation was too complex.

**Fail loudly for debugging features** - Debugging tools like `board=` should throw errors on invalid input rather than silently falling back. This prevents masking bugs:
- `board=invalid` should throw an error, not fall back to automatic selection
- Hard failures during development catch issues early
- Silent fallbacks hide configuration mistakes and make debugging harder

**Reduce special cases** - Fewer code paths means:
- Each path gets exercised more frequently in tests
- Code generalizes better to edge cases
- Maintenance burden is lower
- Bugs are easier to find (fewer places to look)

**Design for generalization** - Write code that works for the general case rather than adding special-case logic:
- Use Fibonacci-based checkpoints everywhere, not one-time initialization
- Use incremental O(1) threading, not quadratic loops
- Handle edge cases through the same logic as normal cases when possible

**Trust your data structures** - Don't add defensive checks that paper over bugs:
- If thread.next should always equal refIter when advancing, check that exactly
- Don't use fuzzy matching (`|current - refIter| <= 10`) when exact matching is correct
- Defensive programming can hide bugs rather than expose them

### Debugging Strategies That Work

These guidelines emerged from successful debugging sessions on this codebase:

1. **Use slow-but-correct implementations as ground truth** - Compare fast GPU code against slow CPU implementations (e.g., QDZhuoranBoard vs GpuAdaptiveBoard). When results differ, the simpler implementation is usually right.

2. **Understand mathematical invariants** - Know the constraints your data structures must satisfy (e.g., QD limbs must satisfy `|limb[i]| < ulp(limb[i-1])/2`). Violations cause subtle bugs that only appear at extreme zoom.

3. **Compare against authoritative sources** - For algorithms like quad-double arithmetic, find the original papers or reference implementations (e.g., Bailey/Hida/Li QD library) and verify your code matches.

4. **Test at specific zoom regimes** - Bugs manifest differently at different scales. Test at z=5, z=1e20, z=1e45, z=3.81e47 to catch regime-specific issues.

5. **Trace code paths in shaders** - When GPU code misbehaves, trace through the WGSL shader logic step by step. Look for conditions that skip important checks (e.g., `scale < -126` skipping escape detection).

6. **Understand float32/float64 boundaries** - Know where numeric limits matter: float32 underflows at scale < -126, float64 loses precision around 1e-15, QD extends to ~1e-60.

7. **Create targeted debug scripts** - Write standalone `tests/debug-*.js` scripts for deep investigation rather than fighting test framework timeouts.

8. **Follow the data, not the symptoms** - When iterations mismatch, check if coordinates actually match first. Trace from visible symptom back to root cause.

9. **Check for duplicate function definitions** - In a single-file codebase, search for duplicate function names. Later definitions override earlier ones, causing subtle bugs.

10. **Write commit messages that explain WHY** - Document the root cause analysis, not just the fix. Future debugging depends on understanding constraints.

11. **Unit test arithmetic operations in isolation** - Verify basic operations (add, mul, normalize) work correctly before debugging complex pipelines that use them.

12. **Look for normalization issues** - When `f(x)` and `f(y)` differ but `x` and `y` should be equal, check if they have different internal representations (denormalized values, different limb distributions).

13. **Reproduce first, debug later** - Don't dive into detailed debugging until you can reliably reproduce the exact problem. Early investigation may be looking at the wrong case entirely (wrong viewport size, wrong zoom level, wrong grid dimensions).

14. **Match exact test conditions** - Viewport size determines grid dimensions (1470x827 → 52x29 grid). Testing at different sizes may show completely different behavior. Use explicit viewport/dimension settings in tests.

15. **Build step-by-step tracing infrastructure** - For iteration-based algorithms, create `step(n, callback)` functionality that calls a callback after each iteration. This allows logging comprehensive state without timeouts.

16. **Log comprehensive JSON data for offline analysis** - When debugging complex state evolution, log all relevant variables (dz, scale, refiter, z, |z|) as JSON per iteration. Capture to a file and analyze separately rather than trying to return large datasets through Puppeteer.

17. **Compare working vs broken implementations side-by-side** - When two implementations should match but don't, log the same data from both and find exactly when they diverge. The first divergence point reveals the bug location.

18. **Trace backwards from symptoms to root cause** - If pixels falsely diverge at iteration 9997, trace back to find when the two implementations started behaving differently (e.g., iter 1237). The divergence point is where the bug manifests.

19. **Compare equivalent code across implementations** - When one board works and another doesn't, find the corresponding code sections (e.g., rebase conditions) and diff them. Extra conditions like `&& z_norm > 1e-13` that exist in one but not the other are prime bug candidates.

20. **Guards can prevent necessary operations** - Conditions added to "avoid edge cases" (like `z_norm > 1e-13` to avoid numerical issues with very small z) may actually prevent critical operations (rebasing when z is near zero). Sometimes the edge case IS the important case.

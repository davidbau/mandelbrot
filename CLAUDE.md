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
- For debug scripts that need long timeouts, create a `tests/debug-*.js` script and run with `node tests/debug-*.js` rather than using long inline commands or `timeout` wrappers - this avoids permission prompts

When filtering tests by name:
- Do NOT use `npm run test:integration -- --testPathPattern="foo"` - the positional directory arg takes precedence and ignores the pattern
- Instead use: `npx jest --testPathPattern="integration/foo"` - include the directory in the pattern
- Multiple `--testPathPattern` args are ORed (match either), not ANDed

### Architecture

- Single HTML file design - avoid adding external dependencies
- All JavaScript is embedded in index.html
- Tests use Puppeteer for integration testing

### Debugging Strategies That Work

These guidelines emerged from successful debugging sessions on this codebase:

1. **Use slow-but-correct implementations as ground truth** - Compare fast GPU code against slow CPU implementations (e.g., QDZhuoranBoard vs AdaptiveGpuBoard). When results differ, the simpler implementation is usually right.

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

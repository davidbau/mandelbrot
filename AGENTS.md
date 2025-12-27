# Repository Guidelines

## Project Structure & Module Organization
- Core app lives in `index.html`; all JavaScript, CSS, and HTML are embedded there (main thread logic, worker code, quad math, i18n, and bundled MP4 muxer).
- Build tools sit in `build/` (`build.sh`, `build-mp4-muxer.js`) and only touch the muxer bundle inside the sentinel comments.
- Tests are in `tests/` (`unit/`, `integration/`, optional `*.stress.js` and `*.bench.js` plus shared helpers in `tests/utils/`); coverage output lands in `coverage/`.
- Reference docs live in `docs/`; media assets in `media/`; automation helpers in `scripts/`.

## Build, Test, and Development Commands
- `npm install` — install dev dependencies (Node 18+ recommended).
- `npm run build` — rebuild and inject the minified `mp4-muxer` between `BEGIN/END_MP4MUXER_LIBRARY` in `index.html`.
- `npm test` — run all Jest suites (unit + integration).
- `npm run test:unit` / `npm run test:integration` — targeted suites; integration uses Puppeteer/Chromium headless.
- `npm run test:stress` — long-running race-condition checks; `npm run bench` — benchmark-oriented runs.
- `npm run test:coverage` — generate coverage report (open `coverage/index.html`).
- For manual QA, opening `index.html` in a modern browser is enough; no dev server required.

## Coding Style & Naming Conventions
- Keep the single-file architecture: prefer adding logic inside existing `<script>` blocks rather than new bundles; avoid new runtime dependencies unless essential.
- Use 2-space indentation, `const`/`let` over `var`, and camelCase for functions; classes like `MandelbrotExplorer`, `ZhuoranBoard`, `URLHandler` use PascalCase.
- Preserve sentinel comments and inline section ordering (main code → worker code → quad math → muxer bundle → i18n → startup).
- Write focused inline comments only where the control flow or math is non-obvious; keep CSS minimal and in-line with existing style.

## Testing Guidelines
- Test files end with `.test.js`; stress and bench files use `.stress.js` / `.bench.js`.
- Prefer adding unit coverage in `tests/unit/` for math/algorithm changes; use `tests/utils/extract-code.js` to pull functions from `index.html`.
- For UI or interaction changes, add Puppeteer cases under `tests/integration/`; keep assertions deterministic (avoid timing flakiness).
- Run `npm test` before submitting; include `npm run test:coverage` when touching critical computation paths.

## Commit & Pull Request Guidelines
- Follow existing history: use lowercase scope prefixes where helpful (e.g., `docs:`, `tests:`, `build:`) and concise subjects.
- **Agent Attribution:** AI agents should sign their work by adding a `Co-Authored-By` line to the commit message. Use your specific agent name and a placeholder email (e.g., `Co-Authored-By: Gemini 3 <noreply@google.com>` or `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`).
- PRs should include a brief summary of changes, user-visible impacts, and links to relevant issues/threads.
- List the commands you ran (e.g., `npm test`, `npm run test:integration`) and attach screenshots or short clips when altering UI or rendering behavior.
- Keep the HTML self-contained: note any new assets or external calls in the PR description and justify added dependencies.

## Static Analysis & Tooling Standards
- **Shadowing Awareness:** When building analysis tools, always pre-scan function bodies for local declarations (`var`, `let`, `const`, `function`) and parameters. Common names like `size`, `last`, `url`, and `forceBoard` are frequently shadowed; avoid linking them to global symbols.
- **Library Unwrapping:** The bundled `mp4-muxer` library is wrapped in multiple IIFEs. Tools should "unwrap" these closures (e.g., by resetting depth counters) to treat its internal classes and functions as high-level architectural components.
- **Assignment Recognition:** Support `name = function(...)` and `name_fn = function(...)` patterns for method attribution, especially within bundled modules where this pattern is used for internal helpers.
- **Mixin Roots:** Treat methods defined within Mixin patterns (`const Mixin = (Base) => class extends Base...`) as top-level architectural methods, not nested functions.
- **Visualization:** Represent recursive self-calls using circular loops (e.g., drawn to the left of the node) to clearly distinguish them from inter-function edges.

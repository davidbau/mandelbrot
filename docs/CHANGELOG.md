# Changelog

## Origins: September 27, 2009

I [posted the original version](http://davidbau.com/archives/2009/09/27/mandelbrot.html)
in September 2009. It came with some nostalgia: in the pre-XGA graphics days,
you could not render a very good-looking Mandelbrot set on a computer screen, so
I used to write programs that rendered on laser printers. Clusters of word
processing computers in a school's English building basement would chug away
through the night, iterating polynomials to generate fractal images.

The first 2009 JavaScript version used colored **table cells** as pixels - each `<td>`
element with class "c" was a tiny colored square, assembled into a 180×180 grid
(32,400 table cells!). You can still see this version at
[mandelbrot.page/version-2009.html](https://mandelbrot.page/version-2009.html).

A canvas-based version followed shortly after, taking advantage of HTML5 canvas
support in Chrome and Safari. This version is preserved at
[davidbau.com/mandelbrot/new.html](https://davidbau.com/mandelbrot/new.html).
The canvas approach was more efficient and allowed dynamic sizing based on
window dimensions.

The core algorithm was already interesting: rather than stopping at a fixed
iteration count, the code identified both divergent points (escaping to infinity)
and convergent points (settling into periodic cycles). This allowed the fractal
to refine indefinitely as you watched.

Key features from 2009:
- Table-cell rendering (oldversion.html) and canvas rendering (new.html)
- Click to zoom
- Cycle detection for convergent points
- Sparse computation (skip finished pixels)
- Adaptive iteration refinement

## October 2020: GitHub and Major Refresh

The project moved to GitHub in October 2020, starting fresh with a modernized codebase.
You can see the state of the code at that time at
[mandelbrot.page/version-2020.html](https://mandelbrot.page/version-2020.html).

New features in the 2020 version:

- **High DPI support**: Proper handling of Retina and high-resolution displays
- **Orbit visualization**: Yellow dots showing the iteration path for each point
- **Periodicity display**: Red dots marking limit cycles
- **Hover details**: Popup showing coordinates and iteration info
- **Mobile support**: Touch-friendly interaction

## 2022: Keyboard Controls

Added keyboard shortcuts for power users:
- `T` to cycle color themes
- `I` to zoom in
- `U` to highlight unfinished pixels
- `H`/`G` to shrink/grow windows
- `R` to restore hidden views
- And many more...

## 2024: Deep Zoom and Movies

The biggest technical leap, enabling exploration beyond 10^30 magnification.
In 2024 I began coding with Claude as a chatbot, copying code back and forth.
Features that would have taken weeks to research and implement came together
in days.

### DD Precision (Double-Double)

Implemented DD precision arithmetic for coordinates, enabling
zoom depths far beyond standard 64-bit float limits. Each number is stored as
the unevaluated sum of two doubles, providing about 31 decimal digits of precision.

### Perturbation Theory

Added perturbation-based computation: compute one reference orbit at high
precision, then calculate each pixel as a small perturbation from that reference.
This technique was pioneered by K.I. Martin in [SuperFractalThing](https://fractalwiki.org/wiki/SuperFractalThing)
(2013) and dramatically speeds up deep zoom rendering.

### Movie Mode

Added video export capability:
- Press `M` to create a smooth zoom animation
- Catmull-Rom spline interpolation for smooth camera paths
- Logarithmic zoom interpolation for natural zoom speed
- WebCodecs-based H.264 encoding
- MP4 export with mp4-muxer

### Web Workers

Moved computation to background Web Workers for responsive UI during long
calculations. Multiple workers enable parallel computation across CPU cores.

### Additional 2024 Features

- Higher exponents (z^3, z^4, etc.) for Multibrot sets
- Multiple color themes (warm, neon, ice blue, tie-dye, grayscale)
- User-adjustable subpixel resolution
- URL parameters for sharing specific locations and settings
- Basic fullscreen mode

## 2025: Claude Code and WebGPU

In November 2025 the project adopted a novel workflow using Claude Code, where
Claude (an AI from Anthropic) works as an autonomous agent that directly edits
files, runs tests, and commits code to the repository. This changed the workflow
entirely - instead of copying snippets back and forth, Claude works in the
codebase alongside me. Claude also drafted this documentation.

The result: WebGPU support with massive parallelism, plus significant UI enhancements.

### GPU Computation

- **GpuBoard**: WebGPU compute shaders for shallow zooms (pixel size > 10^-7)
- **GpuZhuoranBoard**: GPU perturbation with DD-precision reference orbits for
  deep zooms up to 10^30
- **AdaptiveGpuBoard**: GPU perturbation with QD-precision reference for ultra-deep
  zooms beyond 10^30, using per-pixel adaptive scaling

### Zhuoran's Rebasing

To support GPU at higher zoom depths, implemented the rebasing technique
[proposed by Zhuoran](https://fractalforums.org/fractal-mathematics-and-new-theories/28/another-solution-to-perturbation-glitches/4360)
on fractalforums.org in December 2021. When pixel orbits approach critical points,
they "rebase" to restart from the reference, avoiding the numerical glitches that
plague traditional perturbation methods. This eliminated visual artifacts at
extreme zoom depths.

### QD Precision (Quad-Double, 60+ Digits)

Extended precision from ~31 decimal digits (DD, double-double) to ~62 decimal digits
(QD, quad-double, using four doubles). This enables zoom depths beyond 10^60:
- **QDZhuoranBoard**: CPU perturbation with QD-precision reference orbits
- Seamless transition from DD to QD precision at z > 10^30

### Performance Optimizations

- Persistent staging buffers (avoid allocation overhead)
- Conditional buffer readbacks (only read expensive data when needed)
- Incremental reference orbit uploads
- Optimized shader memory access patterns

### UI Enhancements

- Aspect ratio support (16:9 and other ratios)
- Enhanced fullscreen mode with viewport-adaptive layout
- Internationalization (11 languages)
- Browser history support (back/forward navigation)

### Bug Fixes and Refinements

- Float32 precision handling for deep zoom cycle detection
- Fibonacci checkpoint intervals (faster period detection)
- Unified state management with Redux-style patterns
- Comprehensive test suite with Jest and Puppeteer

## Technical Milestones

| Year | Milestone |
|------|-----------|
| 2009 | Table-cell and canvas rendering, cycle detection |
| 2020 | High DPI, orbit visualization |
| 2022 | Keyboard controls |
| 2024 | Double-double (DD) precision (~31 digits), perturbation, movies, web workers |
| 2025 | WebGPU acceleration, quad-double (QD) precision (~62 digits), i18n, fullscreen |

## The Philosophy

Through all these changes, the core philosophy remains: a single HTML file that
you can save, share, and explore without dependencies. The mathematics of the
Mandelbrot set are timeless; the viewer should be too.

## References

- [Original blog post](http://davidbau.com/archives/2009/09/27/mandelbrot.html)
- [Live explorer](https://mandelbrot.page/)
- [GitHub repository](https://github.com/davidbau/mandelbrot)
- [Deep zoom theory](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) - Claude Heiland-Allen
- [Zhuoran's rebasing](https://fractalforums.org/fractal-mathematics-and-new-theories/28/another-solution-to-perturbation-glitches/4360) - The original forum post
- [Canvas element history](https://en.wikipedia.org/wiki/Canvas_element)

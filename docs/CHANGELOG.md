# Changelog

A history of the Mandelbrot Set Fractal Explorer, from its origins as a table-cell
experiment in 2009 to the GPU-accelerated, infinitely-refining explorer of today.

## Origins: September 27, 2009

The original version was [posted as a JavaScript example](http://davidbau.com/archives/2009/09/27/mandelbrot.html)
in September 2009. It came with some nostalgia: in the pre-XGA graphics days,
you couldn't render a very good-looking Mandelbrot set on a computer screen, so
the author used to write programs that rendered on laser printers. Clusters of
word processing computers in a school's English building basement would chug
away through the night, iterating polynomials to generate fractal images.

The 2009 JavaScript version used colored **table cells** as pixels - each `<td>`
element with class "c" was a tiny colored square, assembled into a 180×180 grid
(32,400 table cells!). You can still see this version at
[davidbau.com/mandelbrot/oldversion.html](https://davidbau.com/mandelbrot/oldversion.html).
This approach predated widespread browser support for the HTML canvas element
(which Apple had introduced in 2004 but wasn't universally available until later).

The core algorithm was already interesting: rather than stopping at a fixed
iteration count, the code identified both divergent points (escaping to infinity)
and convergent points (settling into periodic cycles). This allowed the fractal
to refine indefinitely as you watched.

Key features from 2009:
- Table-cell rendering (pre-canvas era)
- Click to zoom
- Cycle detection for convergent points
- Sparse computation (skip finished pixels)
- Adaptive iteration refinement

## 2020: Major Refresh

A major update modernized the codebase for contemporary browsers:

- **Canvas rendering**: Replaced table cells with HTML5 canvas
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

The biggest technical leap, enabling exploration beyond 10^30 magnification:

### Quad-Double Precision

Implemented double-double arithmetic (quad precision) for coordinates, enabling
zoom depths far beyond standard 64-bit float limits. Each number is stored as
the unevaluated sum of two doubles, providing about 31 decimal digits of precision.

### Perturbation Theory

Added perturbation-based computation: compute one reference orbit at high
precision, then calculate each pixel as a small perturbation from that reference.
This technique, pioneered by K.I. Martin and others in the fractal community,
dramatically speeds up deep zoom rendering.

### Zhuoran's Rebasing

Implemented the rebasing technique proposed by Zhuoran on fractalforums.org.
When pixel orbits approach critical points, they "rebase" to restart from the
reference, avoiding the numerical glitches that plague traditional perturbation
methods. This eliminated visual artifacts at extreme zoom depths.

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
- Aspect ratio support (16:9 and other ratios)
- Fullscreen mode with viewport-adaptive layout
- Internationalization (11 languages)
- URL parameters for sharing specific locations and settings

## 2025: GPU Acceleration

WebGPU support added with help from Claude, enabling massive parallelism:

### GPU Computation

- **GpuBoard**: WebGPU compute shaders for shallow zooms (pixel size > 10^-6)
- **GpuZhuoranBoard**: GPU perturbation with quad-double reference orbits for
  deep zooms, falling back to CPU-only at extreme depths where float32 precision
  fails

### Performance Optimizations

- Persistent staging buffers (avoid allocation overhead)
- Conditional buffer readbacks (only read expensive data when needed)
- Incremental reference orbit uploads
- Optimized shader memory access patterns

### Bug Fixes and Refinements

- Float32 precision handling for deep zoom cycle detection
- Magnitude-based convergence comparison (more stable than position subtraction)
- Fibonacci checkpoint intervals (better fundamental period detection)
- Unified state management with Redux-style patterns
- Comprehensive test suite with Jest and Puppeteer

## Technical Milestones

| Year | Milestone |
|------|-----------|
| 2009 | Table-cell rendering, cycle detection |
| 2020 | Canvas rendering, orbit visualization |
| 2022 | Keyboard controls |
| 2024 | Quad precision, perturbation, movies |
| 2025 | WebGPU acceleration |

## The Philosophy

Through all these changes, the core philosophy remains: a single HTML file that
you can save, share, and explore without dependencies. The mathematics of the
Mandelbrot set are timeless; the viewer should be too.

## References

- [Original blog post](http://davidbau.com/archives/2009/09/27/mandelbrot.html)
- [Live explorer](https://mandelbrot.page/)
- [GitHub repository](https://github.com/davidbau/mandelbrot)
- [Deep zoom theory](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) - Claude Heiland-Allen
- [Zhuoran's rebasing](https://mathr.co.uk/blog/2022-02-21_deep_zoom_theory_and_practice_again.html)
- [Canvas element history](https://en.wikipedia.org/wiki/Canvas_element)

# Color and Histogram System

How do colors stay consistent as you zoom deeper? The iteration counts change
by orders of magnitude, yet the palette remains coherent. This is the histogram
system at work.

## The Problem with Direct Iteration Mapping

Map iterations directly to colors - iteration 1 = red, iteration 100 = blue,
iteration 1000 = green - and you get chaos:

- At shallow zoom, most pixels diverge between iterations 1-50
- At deep zoom, most pixels diverge between iterations 1,000,000-1,000,100
- Same color mapping produces wildly different palettes at different depths

The solution is to use the *distribution* of iteration values rather than
the values themselves.

## The Histogram

Each View maintains a histogram of iteration counts:

```javascript
this.hi = [
  [iteration, fracUnfinished, fracDiverged, fracEstimatedLimit],
  [1000, 0.10, 0.85, 0.88],   // At iter 1000: 10% unknown, 85% diverged
  [500, 0.20, 0.75, 0.80],    // At iter 500: 20% unknown, 75% diverged
  [100, 0.50, 0.40, 0.55],    // At iter 100: 50% unknown, 40% diverged
  ...
];
```

The histogram tracks, for various iteration thresholds:
- `fracUnfinished`: What fraction of pixels have not finished by this iteration?
- `fracDiverged`: What fraction have diverged by this iteration?
- `fracEstimatedLimit`: Predicted asymptotic fraction that will ultimately diverge

### Lineweaver-Burk Estimation

The estimated limit uses Lineweaver-Burk regression to predict how many pixels
will eventually diverge. This technique comes from an unexpected source: enzyme
kinetics.

In biochemistry, Lineweaver and Burk (1934) transformed the Michaelis-Menten
equation by plotting 1/v against 1/[S]. The y-intercept of this linear plot
gives the maximum reaction velocity as substrate concentration approaches
infinity.

The same idea works for fractal computation. We want to know: as iterations
approach infinity, what fraction of pixels will have diverged? Plotting
diverged fraction against iteration gives a curve that approaches an asymptote.
By plotting against 1/iteration^0.75 (the exponent was found empirically),
we get something approximately linear, and the y-intercept estimates the limit:

```javascript
function estimateLimit(data) {
  // Transform: x → 1/x^0.75
  const transformed = data.map(point => ({
    x: 1 / (point.x ** 0.75),
    y: point.y,
    weight: point.weight
  }));

  // Weighted linear regression in transformed space
  // ...calculate slope and intercept...

  // Intercept (at x→0, i.e., iteration→∞) gives asymptotic limit
  return intercept;
}
```

The 0.75 exponent is empirical - it produces better predictions than 1.0 for
typical Mandelbrot computation patterns. Why does enzyme kinetics apply to fractals?
Both systems have a characteristic shape: rapid initial progress that slows as you
approach a limit. In enzymes, the limit is maximum reaction velocity. In fractals,
the limit is the fraction of pixels that will ever diverge. The mathematical form
of the approach-to-limit is similar enough that the same linearization trick works.

Why 0.75 instead of 1.0? With exponent 1.0 (standard Lineweaver-Burk), the plot
curves slightly. The 0.75 was found by trial and error - it straightens the curve
for typical Mandelbrot divergence patterns, giving better extrapolation. The
estimate updates as computation proceeds, giving increasingly accurate predictions
of the final black-pixel fraction.

## From Histogram to Color

When rendering a pixel with iteration count `i`:

```javascript
makecolor(i, histogram, scale, unknownColor) {
  if (i === 0) return unknownColor;  // Unfinished
  if (i < 0) return 'black';         // Converged (in the set)

  // Look up this iteration in the histogram
  const fracs = View.lookupHistogram(i, histogram);

  // Pass to color theme function
  return this.config.colorThemes[this.config.theme](
    i,           // raw iteration count
    fracs.fracK, // fraction known (= 1 - fracUnfinished)
    fracs.fracD, // fraction diverged
    fracs.fracL, // estimated limit
    scale        // current zoom size
  );
}
```

The key insight: `fracs.fracK` tells us where this pixel sits in the distribution.
A pixel at the 90th percentile looks similar across zoom levels, even if its
raw iteration count differs by factors of 1000.

## Color Themes

Each theme is a function that takes statistical position and returns a CSS color.

### Design Philosophy

The palettes are designed with two goals in tension:

1. **Hue from iteration count**: The color (hue) comes from the logarithm of the
   iteration count. This creates the characteristic color bands of Mandelbrot
   images - each band represents a range of escape times.

2. **Brightness from distribution**: The brightness (luminance) comes from where
   the pixel sits in the histogram. Early divergers are darker; late divergers
   are brighter.

Why logarithm for hue? Iteration counts span orders of magnitude. Linear mapping
would compress most colors into a tiny range. Log scaling spreads them evenly
across the spectrum.

Why separate hue from brightness? This is the key to smooth movie animations.
As you zoom, the iteration counts change, but if a pixel stays at the 90th
percentile of the distribution, its brightness stays roughly constant. The hue
shifts gradually as iteration counts increase, but the overall luminance
structure remains stable. This prevents jarring brightness flickers during
zoom transitions.

What happens without this separation? If brightness came from iteration count
directly, a pixel that goes from iteration 1000 to iteration 10000 (same relative
position, deeper zoom) would jump in brightness. The image would flash and flicker
as you zoom. By tying brightness to histogram position instead, we decouple the
visual structure from the absolute iteration numbers. The boundary between light
and dark stays at the boundary of the set, where it belongs.

### Warm Theme (Default)

```javascript
warm: (i, frac, fracD, fracL, s) => {
  // Adjust frac using the ratio of diverged to estimated limit
  frac = Math.max(frac, Math.min(0.99, fracD / Math.max(1e-3, fracL)));

  // Hue cycles with log of iteration (creates bands)
  let hue = (Math.log(i + 20) * 200) % 360;

  // Full saturation
  let chroma = 100;

  // Luminance increases with frac (early divergers are darker)
  let light = 15 * frac + 85 * frac ** 5;

  return hclColor(hue, chroma, light);
}
```

The warm theme produces dark reds and oranges for early divergers, bright yellows
and cyans for late divergers. The `Math.log(i + 20) * 200` creates smooth color
bands - each doubling of iteration count shifts the hue by a consistent amount.
The `frac ** 5` term in the luminance formula keeps early divergers quite dark,
with brightness increasing rapidly only for the latest divergers.

### Neon Theme

```javascript
neon: (i, frac, fracD, fracL, s) => {
  // Use sine waves for RGB, offset by 120°
  let angle = (Math.log(i + 10) * 0.8) * Math.PI;
  let r = Math.abs(Math.sin(angle));
  let g = Math.abs(Math.sin(angle + Math.PI * 2/3));
  let b = Math.abs(Math.sin(angle + Math.PI * 4/3));

  // Boost saturation by suppressing the minimum channel
  let minChannel = Math.min(r, g, b);
  r = Math.max(0, r - minChannel * 2/3);
  g = Math.max(0, g - minChannel * 2/3);
  b = Math.max(0, b - minChannel * 2/3);

  // Normalize to full brightness
  let maxChannel = Math.max(r, g, b);
  if (maxChannel > 0) {
    r /= maxChannel;
    g /= maxChannel;
    b /= maxChannel;
  }

  let brightness = 0.5 + 0.4 * frac;
  return `rgb(${intcolor(r * brightness)},${intcolor(g * brightness)},${intcolor(b * brightness)})`;
}
```

The neon theme uses sine waves cycling through RGB, with the log of iteration
count controlling the angle. Suppressing the minimum channel boosts saturation -
at any moment, at least one channel is near zero, creating pure, vibrant colors.
The brightness still depends on `frac`, so the luminance structure remains
stable during zoom animations even as the specific hues shift.

### Ice Blue Theme

```javascript
iceblue: (i, frac, fracD, fracL, s) => {
  let ff = Math.pow(frac, 2);
  let fr = Math.pow(frac, 0.333);
  let fg = Math.pow(frac, 3);

  // Blue-dominated with scale-dependent hints of red/green
  let g = intcolor(Math.max(fg, Math.min(fr, i * Math.pow(s, 0.33) / 64)));
  let r = intcolor(Math.min(fr, i * Math.pow(s, 0.22) / 64));
  let b = intcolor(ff / 3 + 0.667);

  return `rgb(${r},${g},${b})`;
}
```

The ice blue theme takes a different approach: the blue channel dominates
(`ff / 3 + 0.667` is always high), while red and green add subtle warmth
based on both iteration count and zoom scale. This creates a cool, crystalline
appearance that varies subtly with depth.

### Tie-Dye Theme

```javascript
tiedye: (i, frac, fracD, fracL, s) => {
  // Same as warm but with 5x faster hue cycling
  let hue = (Math.log(i + 20) * 1000) % 360;
  let chroma = 100;
  let light = 25 * frac + 75 * frac ** 5;
  return hclColor(hue, chroma, light);
}
```

The tie-dye theme uses the same formula as warm but with 5x faster hue cycling
(`* 1000` instead of `* 200`). This creates rapid color transitions that
emphasize the fine structure of iteration bands. The psychedelic effect comes
from adjacent iteration counts mapping to very different hues.

### Grayscale Theme

```javascript
gray: (i, frac, fracD, fracL, s) => {
  frac = Math.max(frac, Math.min(0.99, fracD / Math.max(1e-3, fracL)));
  let value = intcolor(0.15 + 0.85 * frac ** 5);
  return `rgb(${value},${value},${value})`;
}
```

The grayscale theme shows structure without color, useful for print or accessibility.

## HCL Color Space

Most themes use HCL (Hue, Chroma, Luminance) rather than RGB or HSL. Why?

RGB and HSL distort perception: a step from 50% to 60% saturation in yellow
looks very different from the same step in blue. HCL, based on the CIE 1976
color standards, attempts to make equal numerical steps produce equal
perceived changes.

```javascript
function hclColor(h, c, l) {
  // Normalize inputs
  h = h % 360;
  if (h < 0) h += 360;
  c = Math.min(Math.max(c, 0), 100);
  l = Math.min(Math.max(l, 0), 100);

  // Convert to CIELAB, then to XYZ, then to RGB
  // (Full conversion omitted for brevity)

  return `rgb(${r},${g},${b})`;
}
```

The conversion path is HCL → CIELAB → XYZ → linear RGB → sRGB (with gamma).
This is more expensive than HSL, but the perceptual uniformity makes color
gradients feel natural. For fractal visualization, where subtle iteration
differences should map to subtle color differences, this matters.

## Gamma Correction

RGB values are gamma-corrected before output:

```javascript
function gammaCorrect(n) {
  // sRGB gamma correction
  if (n <= 0.0031308) {
    return n * 12.92;
  }
  return 1.055 * Math.pow(n, 1/2.4) - 0.055;
}
```

This matches the sRGB standard that monitors expect.

## The Unknown Pixel Color

Pixels that have not finished computing need a placeholder color. The default
is transparent (showing the parent view beneath), but users can override:

- `?unk=000`: Black unfinished pixels
- `?unk=888`: Gray unfinished pixels
- `?unk=rgb(32,16,64)`: Custom CSS color

For movie mode, unknown pixels default to black (no parent to show through).

## Rendering Order

Pixels are rendered in iteration order to minimize color state changes:

```javascript
drawLocal(ctx, colorview, unknownColor) {
  const n = this.nn;
  const sorted = n.map((v, i) => i).sort((a, b) => n[a] - n[b]);

  let prev = null;
  for (let m of sorted) {
    const cur = n[m];
    if (prev !== cur) {
      ctx.fillStyle = colorview.makecolor(cur, null, null, unknownColor);
      prev = cur;
    }
    const x = m % this.config.dimsWidth;
    const y = Math.floor(m / this.config.dimsWidth);
    ctx.fillRect(x, y, 1, 1);
  }
}
```

Sorting by iteration count means we set `fillStyle` once per unique value,
rather than per pixel. With 50-100 unique iteration values and 500,000 pixels,
this is a significant optimization.

## Cross-View Palette Consistency

When rendering a movie frame, we want colors to match between zoom levels.
The `colorview` parameter lets us use one view's histogram to color another
view's pixels:

```javascript
// Use parent's histogram for child's colors (matching palette)
child.draw(ctx, parentView);
```

This creates smooth color transitions during zoom animations.

## Debug Visualization

The `debugStatus()` method renders a mini histogram graph:

```javascript
renderHiGraph(width, height) {
  // Draw bar chart showing:
  // - Blue: iteration thresholds
  // - Red: unfinished fraction
  // - Green: diverged fraction
  // - Purple: estimated limit
}
```

This appears in the tooltip when hovering over the zoom number, helping
debug color mapping issues.

## References

- [HCL color space](https://en.wikipedia.org/wiki/HCL_color_space) - The cylindrical representation of CIELUV
- [LCH is the best color space for UI](https://atmos.style/blog/lch-color-space) - Why perceptual uniformity matters
- [Lineweaver-Burk plot](https://en.wikipedia.org/wiki/Lineweaver–Burk_plot) - The 1934 technique borrowed from enzyme kinetics
- [CIELAB color space](https://en.wikipedia.org/wiki/CIELAB_color_space) - The 1976 CIE standard
- [sRGB gamma](https://en.wikipedia.org/wiki/SRGB) - The transfer function monitors expect

## Next Steps

- [MOVIES.md](MOVIES.md): How smooth animations interpolate between frames
- [ALGORITHMS.md](ALGORITHMS.md): How iteration counts are computed

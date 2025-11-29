# Color and Histogram System

The Mandelbrot explorer uses a histogram-based coloring system that produces
consistent, beautiful colors across different zoom levels. This document
explains how iteration counts become colors.

## The Problem with Direct Iteration Mapping

A simple approach would map iterations directly to colors: iteration 1 = red,
iteration 100 = blue, iteration 1000 = green, etc. But this breaks down:

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
- `fracUnfinished`: What fraction of pixels haven't finished by this iteration?
- `fracDiverged`: What fraction have diverged by this iteration?
- `fracEstimatedLimit`: Predicted asymptotic fraction that will ultimately diverge

### Lineweaver-Burk Estimation

The estimated limit uses a Lineweaver-Burk regression to predict how many
pixels will eventually diverge (vs. stay black). This is the same technique
used in enzyme kinetics to find limiting rates:

```javascript
function estimateLimit(data) {
  // Transform: x → 1/x^0.75
  const transformed = data.map(point => ({
    x: 1 / (point.x ** 0.75),
    y: point.y,
    weight: point.weight
  }));

  // Linear regression in transformed space
  // Intercept (at x→0, i.e., iteration→∞) gives asymptotic limit
  return intercept;
}
```

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

Each theme is a function that takes statistical position and returns a CSS color:

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

The warm theme produces:
- Dark reds/oranges for early divergers
- Bright yellows/cyans for late divergers
- Smooth color bands due to log scaling

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

The neon theme maintains high saturation throughout, creating vibrant electric colors.

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

The ice blue theme creates cool, crystalline appearances with blue dominance.

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

The tie-dye theme cycles through hues rapidly, creating psychedelic patterns.

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

Most themes use HCL (Hue, Chroma, Luminance) rather than RGB or HSL:

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

HCL is perceptually uniform: equal steps in L produce equal perceived brightness
changes. This makes the color gradients feel natural to human vision.

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

Pixels that haven't finished computing need a placeholder color. The default
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

## Next Steps

- [MOVIES.md](MOVIES.md): How smooth animations interpolate between frames
- [ALGORITHMS.md](ALGORITHMS.md): How iteration counts are computed

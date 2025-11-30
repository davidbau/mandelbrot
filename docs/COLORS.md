# Color and Histogram System

A key challenge in fractal visualization is coloring. As you zoom, iteration counts can change by orders of magnitude. A naive mapping of iteration numbers to colors would cause the palette to flash and flicker during zooms. This explorer uses a histogram-based system to ensure colors remain stable and perceptually uniform at any depth.

## The Problem with Direct Mapping

If you map iteration counts directly to colors (e.g., 1-100 is red, 101-200 is green), the visual appearance of the fractal will change dramatically with zoom. In a shallow view, most points might escape between 1 and 50 iterations. In a deep view, they might escape between 1,000,000 and 1,000,050. A fixed color mapping would render these two views completely differently, destroying visual continuity.

The solution is to color based on a pixel's rank within the *distribution* of iteration values, not its absolute iteration count.

## The Histogram

Each `View` maintains a histogram that summarizes the distribution of iteration counts for all its pixels.

```javascript
this.hi = [
  // [iteration, fracUnfinished, fracDiverged, fracEstimatedLimit]
  [1000, 0.10, 0.85, 0.88],   // At iter 1000: 10% unknown, 85% diverged
  [500,  0.20, 0.75, 0.80],   // At iter 500:  20% unknown, 75% diverged
  [100,  0.50, 0.40, 0.55],   // At iter 100:  50% unknown, 40% diverged
  ...
];
```

When a pixel's color is calculated, its iteration count is looked up in this histogram. This tells us where the pixel sits in the overall distribution (e.g., "this pixel escaped later than 95% of other pixels in this view"). This relative rank, not the raw iteration count, is the primary input to the color theme functions.

### Estimating the Limit with Enzyme Kinetics

The histogram also stores an estimate of the final fraction of pixels that will diverge. This is calculated using a **Lineweaver-Burk plot**, a technique borrowed from 1930s enzyme kinetics.

Why does a concept from biochemistry apply to fractals? Both systems describe a process that approaches a limit. In enzymes, it's reaction velocity approaching a maximum. In fractals, it's the fraction of diverging pixels approaching a final value. By plotting the data in a transformed space, the relationship becomes linear:

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

The 0.75 exponent is empirical—with exponent 1.0 (standard Lineweaver-Burk), the plot curves slightly. The 0.75 was found by trial and error to straighten the curve for typical Mandelbrot divergence patterns, giving better extrapolation. The estimate updates as computation proceeds, providing increasingly accurate predictions of the final black-pixel fraction.

## From Histogram to Color

The `makecolor` function combines these ideas:

```javascript
makecolor(i, histogram, scale) {
  if (i < 0) return 'black'; // Converged (in the set)

  // Look up this iteration in the histogram to get its rank
  const fracs = View.lookupHistogram(i, histogram);

  // Pass rank and other data to the current color theme
  return this.config.colorThemes[this.config.theme](
    i,           // raw iteration count (for hue)
    fracs.fracK, // fraction known (for brightness/luminance)
    ...
  );
}
```

## Color Theme Design Philosophy

The color themes are designed around a separation of concerns:
1.  **Hue from Iteration:** The color's hue is derived from the *logarithm* of the raw iteration count. This creates the characteristic colored bands, with each band representing a range of escape times. Log scaling ensures the bands are visually balanced across many orders of magnitude.
2.  **Brightness from Distribution:** The color's brightness (luminance) is derived from the pixel's *rank* in the histogram. Early divergers are darker; late divergers are brighter.

This separation is the key to creating smooth zoom animations. As you zoom, a pixel's raw iteration count will increase, causing its hue to shift, but its rank in the distribution will remain relatively stable, so its brightness won't jump. This prevents the distracting flickering seen in simpler fractal renderers.

### HCL Color Space
Most themes use the **HCL (Hue, Chroma, Luminance)** color space instead of the more common RGB or HSL. HCL is designed to be "perceptually uniform," meaning that a numerical step (e.g., from 50% to 60% luminance) corresponds to a consistent perceived change in brightness, regardless of the hue. This produces more natural-feeling color gradients. The conversion path is `HCL -> CIELAB -> XYZ -> linear RGB -> sRGB`, moving through standard colorimetric models to ensure perceptual accuracy.

### Example Themes

**`warm` (Default):** Uses a logarithmic spiral through the HCL color space to produce bands of dark reds, oranges, and bright yellows. The luminance is calculated with `15 * frac + 85 * frac ** 5`, a curve that keeps early divergers very dark and allows brightness to increase rapidly only for the last few percent of pixels near the set boundary.

```javascript
warm: (i, frac, fracD, fracL, s) => {
  frac = Math.max(frac, Math.min(0.99, fracD / Math.max(1e-3, fracL)));
  let hue = (Math.log(i + 20) * 200) % 360;
  let chroma = 100;
  let light = 15 * frac + 85 * frac ** 5;
  return hclColor(hue, chroma, light);
}
```

**`neon`:** Generates vibrant, saturated colors by cycling three sine waves for the R, G, and B channels, offset by 120 degrees. It actively suppresses the minimum channel to boost saturation, ensuring that at least one channel is always near zero, creating pure, intense hues.

```javascript
neon: (i, frac, fracD, fracL, s) => {
  let angle = (Math.log(i + 10) * 0.8) * Math.PI;
  let r = Math.abs(Math.sin(angle));
  let g = Math.abs(Math.sin(angle + Math.PI * 2/3));
  let b = Math.abs(Math.sin(angle + Math.PI * 4/3));
  // Suppress minimum channel to boost saturation
  let minChannel = Math.min(r, g, b);
  r = Math.max(0, r - minChannel * 2/3);
  g = Math.max(0, g - minChannel * 2/3);
  b = Math.max(0, b - minChannel * 2/3);
  // Normalize and apply brightness from histogram rank
  let maxChannel = Math.max(r, g, b);
  if (maxChannel > 0) { r /= maxChannel; g /= maxChannel; b /= maxChannel; }
  let brightness = 0.5 + 0.4 * frac;
  return `rgb(${r*brightness*255|0},${g*brightness*255|0},${b*brightness*255|0})`;
}
```

**`iceblue`:** Creates a cool, crystalline appearance where the blue channel is dominant, and the red and green channels add subtle warmth based on both iteration count and the zoom scale (`s`), making the palette evolve slightly as you zoom deeper.

## Rendering Optimization

To minimize expensive `fillStyle` changes, pixels are rendered in sorted order based on their iteration count. This allows the renderer to set the color once and then draw all pixels that share that color, rather than setting the color for every single pixel. For a one-megapixel image with only a few hundred unique iteration values, this is a major performance win.

## References

- [HCL color space](https://en.wikipedia.org/wiki/HCL_color_space) - The cylindrical representation of CIELUV
- [Lineweaver-Burk plot](https://en.wikipedia.org/wiki/Lineweaver–Burk_plot) - The 1934 technique from enzyme kinetics
- [CIELAB color space](https://en.wikipedia.org/wiki/CIELAB_color_space) - The 1976 CIE standard
- [sRGB gamma](https://en.wikipedia.org/wiki/SRGB) - The transfer function monitors expect

## Next Steps

- [MOVIES.md](MOVIES.md): How smooth animations interpolate between keyframe views.
- [ALGORITHMS.md](ALGORITHMS.md): How the iteration counts are computed.
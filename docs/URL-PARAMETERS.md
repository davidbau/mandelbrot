# URL Parameters

The explorer supports URL parameters for sharing specific views, customizing
appearance, and debugging. Parameters can be combined with `&`.

## View Parameters

### `c` - Center Position

Sets the center of the view in the complex plane.

```
?c=-0.14-0.65i      # Single center point
?c=-0.5+0i          # Real axis (use + for positive imaginary)
?c=-0.7+0.3i,-0.5   # Chain of centers (zoom path)
```

The format is `real+imag*i` or `real-imag*i`. When chaining multiple centers
with commas, each becomes a separate zoom level.

### `z` - Zoom Level

Sets the zoom magnification. Default is 1.0 (showing the full set from -2 to 1).

```
?z=5        # 5x zoom
?z=100      # 100x zoom
?z=1e15     # Quadrillion-fold zoom (scientific notation)
```

Higher values mean more magnification. The zoom is applied to the center
specified by `c`, or to the default center if `c` is not provided.

### `grid` - Grid Layout

Sets the number of columns in the view grid.

```
?grid=1     # Single view
?grid=3     # 3-column grid (default)
?grid=5     # 5-column grid
```

### `h` - Hide Views

Hides specific views by index (0-based, comma-separated).

```
?h=0        # Hide the first (outermost) view
?h=1,2      # Hide views 1 and 2
```

## Appearance Parameters

### `a` - Aspect Ratio

Sets the aspect ratio of each view.

```
?a=16:9     # Widescreen
?a=4:3      # Traditional
?a=1:1      # Square (default)
?a=2:1      # Ultra-wide
```

### `theme` - Color Theme

Sets the color palette for rendering.

```
?theme=fire       # Warm oranges and reds
?theme=ocean      # Blues and cyans
?theme=forest     # Greens
?theme=purple     # Purples and magentas
?theme=grayscale  # Black and white
?theme=neon       # High saturation
?theme=tiedye     # Psychedelic
?theme=ice        # Cool blues
```

### `unk` - Unknown Pixel Color

Sets the color for pixels still being computed (unknown status).

```
?unk=000          # Black (hex)
?unk=fff          # White (hex)
?unk=red          # CSS color name
?unk=transparent  # Transparent
```

### `pixelratio` - Subpixel Resolution

Sets the rendering resolution multiplier.

```
?pixelratio=1     # 1:1 pixels (fastest)
?pixelratio=2     # 2x resolution (default on high-DPI displays)
?pixelratio=4     # 4x resolution (highest quality, slower)
```

## Computation Parameters

### `exponent` - Iteration Exponent

Sets the exponent in the iteration formula z → z^n + c.

```
?exponent=2       # Classic Mandelbrot (default)
?exponent=3       # Cubic Multibrot
?exponent=4       # Quartic Multibrot
```

### `gpu` - GPU Acceleration

Controls WebGPU acceleration.

```
?gpu=1            # Enable GPU (default if available)
?gpu=0            # Disable GPU (force CPU computation)
```

### `board` - Algorithm Selection

Forces a specific computation algorithm. Useful for testing and debugging.

```
?board=cpu          # CpuBoard (double precision, no perturbation)
?board=gpu          # GpuBoard (WebGPU float32)
?board=zhuoran      # ZhuoranBoard (CPU with rebasing)
?board=gpuzhuoran   # GpuZhuoranBoard (GPU with rebasing)
?board=perturbation # PerturbationBoard (CPU quad precision)
```

## Localization

### `lang` - Language

Sets the UI language for help text.

```
?lang=en      # English (default)
?lang=es      # Spanish
?lang=zh      # Chinese (Simplified)
?lang=zh-tw   # Chinese (Traditional)
?lang=ar      # Arabic
?lang=id      # Indonesian
?lang=pt      # Portuguese
?lang=fr      # French
?lang=ja      # Japanese
?lang=ru      # Russian
?lang=de      # German
```

## Examples

**Deep zoom into Seahorse Valley:**
```
?c=-0.743643887037158704752191506114774+0.131825904205311970493132056385139i&z=1e15
```

**Widescreen view with neon colors:**
```
?a=16:9&theme=neon
```

**Cubic Multibrot in grayscale:**
```
?exponent=3&theme=grayscale
```

**Force CPU computation for debugging:**
```
?gpu=0&board=perturbation
```

**Spanish interface with custom grid:**
```
?lang=es&grid=4
```

## Bookmarking and Sharing

The URL updates automatically as you explore. You can bookmark or share your
current URL to save your exact view, including:
- All zoom levels in your path
- Color theme and aspect ratio
- Hidden view state

## Next Steps

- [ARCHITECTURE.md](ARCHITECTURE.md): How URL parameters are parsed and applied
- [COMPUTATION.md](COMPUTATION.md): How computational work is distributed

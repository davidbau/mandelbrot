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

The format is `real+imag*i` or `real-imag*i`. When providing a number without
an imaginary part (like `-0.5`), it is interpreted as `-0.5+0i`. When chaining
multiple centers with commas, each becomes a separate zoom level, creating a path.

### `z` - Zoom Level

Sets the zoom magnification factor. Default is 1.0.

```
?z=25        # 25x zoom
?z=1e15     # Quadrillion-fold zoom (scientific notation)
```

Higher values mean more magnification. This is an intuitive way to specify zoom,
but for precision, `s` is sometimes more direct.

### `s` - View Size

Sets the width of the view in complex-plane coordinates. This is an alternative
to `z` for specifying zoom level. A smaller size means higher magnification.

```
?s=0.01      # A view that is 0.01 units wide
```

### `grid` - Grid Layout

Sets the number of columns for the view grid.

```
?grid=1     # Single column of views
?grid=3     # 3-column grid
```

### `h` - Hide Views

Hides specific views by their 0-based index, separated by commas.

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
?a=9:16     # Portrait
```

### `theme` - Color Theme

Sets the color palette for rendering.

```
?theme=warm      # Warm oranges and reds (default)
?theme=neon      # High-saturation, vibrant colors
?theme=iceblue   # Crystalline blues and whites
?theme=tiedye    # Psychedelic, rapid-cycling hues
?theme=gray      # Grayscale for print or structural analysis
```

### `unk` - Unknown Pixel Color

Sets the color for pixels that are still being computed.

```
?unk=000          # Black (hex)
?unk=fff          # White (hex)
?unk=red          # CSS color name
?unk=transparent  # Transparent (default)
```

### `pixelratio` - Subpixel Resolution

Sets the rendering resolution multiplier. A higher ratio produces sharper images
at the cost of performance, as it increases the number of pixels to compute.

```
?pixelratio=1     # 1:1 pixels (fastest, but may look blurry on high-DPI screens)
?pixelratio=2     # 2x resolution (default on most high-DPI displays)
?pixelratio=4     # 4x resolution (best quality, 16x the pixels of ratio 1)
```

## Computation Parameters

### `exponent` - Iteration Exponent

Sets the exponent `n` in the iteration formula z → z^n + c.

```
?exponent=2       # Classic Mandelbrot set (default)
?exponent=3       # Cubic Multibrot
?exponent=4       # Quartic Multibrot
```

### `gpu` - GPU Acceleration

Controls WebGPU acceleration.

```
?gpu=1            # Enable GPU (default if available)
?gpu=0            # Disable GPU (force all computation onto the CPU)
```

### `board` - Algorithm Selection

Forces a specific computation algorithm. This is primarily useful for testing
and debugging the different computation engines.

```
?board=cpu          # CpuBoard (double precision, no perturbation)
?board=gpu          # GpuBoard (WebGPU float32)
?board=zhuoran      # ZhuoranBoard (CPU with rebasing)
?board=gpuzhuoran   # GpuZhuoranBoard (GPU with rebasing)
?board=perturbation # PerturbationBoard (CPU DD precision)
?board=qdzhuoran    # QDZhuoranBoard (CPU QD precision, z > 10^30)
?board=adaptive     # AdaptiveGpuBoard (GPU QD precision, z > 10^30)
?board=qdcpu        # QDCpuBoard (CPU QD precision)
```

## Localization

### `lang` - Language

Sets the UI language for help text and other interface elements.

```
?lang=en      # English (default)
?lang=es      # Spanish
?lang=zh      # Chinese (Simplified)
?lang=zh-tw   # Chinese (Traditional, e.g., as used in Taiwan)
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
?exponent=3&theme=gray
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
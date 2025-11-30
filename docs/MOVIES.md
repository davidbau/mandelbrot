# Movie Mode and Smooth Animation

Press 'M' and the explorer creates a smooth zoom animation following your exploration path—rendered, encoded, and downloadable as an MP4, all within the browser.

## The Animation Challenge

A compelling Mandelbrot zoom video needs to solve several problems:

1.  **Smooth Camera Path**: The user's zoom path is a series of discrete points. The animation must create a fluid, continuous path between them.
2.  **Consistent Colors**: The color palette must not flicker or jump jarringly between zoom levels.
3.  **UI Responsiveness**: Rendering and encoding a video is a heavy task; it must not freeze the browser.
4.  **Video Encoding**: The final output must be a standard, downloadable MP4 file.

## Camera Path: Catmull-Rom Splines

The camera path is generated using Catmull-Rom splines. Developed by Edwin Catmull (later president of Pixar) and Raphael Rom, this technique creates a smooth curve that passes through a sequence of control points. Given four points (P0, P1, P2, P3), the spline travels from P1 to P2, with its tangents at those points determined by the neighboring points (P0 and P3). This guarantees C1 continuity (a smooth, continuous velocity), which makes the camera motion feel natural and cinematic.

The implementation uses quad-precision arithmetic to ensure the path is accurate even at extreme zoom depths where the control points are numerically very close together:

```javascript
function catmullRom1D(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const c0 = (-t3 + 2*t2 - t) / 2;
  // c1 = (3*t3 - 5*t2 + 2) / 2; // unneeded since p1 = 0 in offset form
  const c2 = (-3*t3 + 4*t2 + t) / 2;
  const c3 = (t3 - t2) / 2;
  // Compute offsets from p1 for numerical stability
  const s0 = qdSub(p0, p1);
  const s2 = qdSub(p2, p1);
  const s3 = qdSub(p3, p1);
  return qdAdd(qdAdd(qdAdd(qdScale(s0, c0),
           qdScale(s3, c3)), qdScale(s2, c2)), p1);
}
```

For 2D complex coordinates:

```javascript
function catmullRomSpline(p0, p1, p2, p3, t) {
  return [
    catmullRom1D(p0[0], p1[0], p2[0], p3[0], t),  // Real part
    catmullRom1D(p0[1], p1[1], p2[1], p3[1], t)   // Imaginary part
  ];
}
```

## Zoom Speed: Logarithmic Interpolation

While the camera's position follows a spline, its zoom level is interpolated logarithmically.

```javascript
// Linear interpolation in log space = exponential in real space
const interpolatedSize = sourceSize * Math.pow(targetSize / sourceSize, t);
```

This creates a constant *relative* zoom rate. Why does this matter? Human perception of scale is logarithmic; we perceive the jump from 1x to 2x zoom as being similar in "distance" to the jump from 50x to 100x zoom. A linear interpolation of size would feel like it starts fast and slows down dramatically, whereas logarithmic interpolation provides a steady, constant perceived zoom speed.

**Example:** Zooming from 1× to 1000× with 30 frames.
- **Linear** adds ~33× per frame: 1, 34, 67, 100, ..., 1000. Most frames show the final approach.
- **Logarithmic** multiplies by ~1.26× per frame: 1, 1.26, 1.58, 2, ..., 1000. Equal frames per "doubling."

## Frame Rendering and Compositing

Each frame of the animation is rendered by taking the fully-computed canvas of a keyframe (one of the user's views) and applying a transformation.

```javascript
renderFrame(k, t) {
  // 1. Interpolate center position using the spline
  const interpolatedCenter = catmullRomSpline(p0, p1, p2, p3, t);

  // 2. Interpolate view size logarithmically
  const interpolatedSize = sourceSize * Math.pow(targetSize / sourceSize, t);

  // 3. Calculate the scale and offset transform
  const scale = sourceSize / interpolatedSize;
  const offsetX = (interpolatedCenter.re - sourceCenter.re) * dimsWidth / sourceSize;
  const offsetY = (sourceCenter.im - interpolatedCenter.im) * dimsHeight / sourceHeight;

  // 4. Draw the source canvas with the transform applied
  ctx.save();
  ctx.translate(dimsWidth/2, dimsHeight/2);
  ctx.scale(scale, scale);
  ctx.translate(-dimsWidth/2 - offsetX, -dimsHeight/2 - offsetY);
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
}
```

To maintain color consistency during a transition (e.g., between view `k` and `k+1`), all intermediate frames are rendered using the color histogram from the source view (`k`). This prevents the palette from shifting abruptly mid-animation.

## In-Browser Video Encoding

The explorer uses the modern **WebCodecs API** to encode the rendered frames into a video stream. This API provides direct access to the browser's underlying hardware video encoders (like H.264), offering far more control than the older `MediaRecorder` API. This allows for precise configuration of bitrate, quality, and keyframes, resulting in a higher-quality MP4 file.

The encoded video chunks are then assembled into a valid MP4 container using [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), a lightweight, pure-TypeScript library that is bundled directly into `index.html`.

```javascript
async encodeVideo(frames) {
  const encoder = new VideoEncoder(...);

  encoder.configure({
    codec: 'avc1.640028',  // H.264 High Profile, Level 4.0
    width: this.width,
    height: this.height,
    bitrate: 8_000_000,    // 8 Mbps
    framerate: 60
  });

  for (const frame of frames) {
    const videoFrame = new VideoFrame(frame.canvas, { timestamp: ... });
    // Encode the frame, marking keyframes for segment starts
    encoder.encode(videoFrame, { keyFrame: frame.isKeyframe });
    videoFrame.close(); // Release the frame's memory immediately
  }

  await encoder.flush();
}
```
The codec string `avc1.640028` specifies the H.264 (AVC) standard, `6400` indicates "High Profile" (good quality and compression), and `28` is the level (4.0 in hex), which defines constraints like maximum resolution and bitrate, easily met here.

## Maintaining UI Responsiveness

Rendering and encoding hundreds of frames is a blocking operation that could freeze the UI. To prevent this, the render loop voluntarily yields control back to the browser's event loop after each frame is processed.

```javascript
async renderMovie() {
  for (let frame = 0; frame < totalFrames; frame++) {
    this.renderFrame(frame);
    this.updateProgress(frame / totalFrames);

    // Yield to the event loop to allow UI updates and prevent freezing
    await new Promise(r => setTimeout(r, 0));
  }
}
```
This small `await` on a zero-delay timeout gives the browser a chance to repaint the screen (showing the latest rendered frame) and handle any user input, keeping the application responsive.

## Final Touches

- **Frame Rate:** Movies render at 60 FPS, with each zoom transition taking 3 seconds by default, resulting in 180 interpolated frames between each of the user's chosen views.
- **Unknown Pixels:** Since there is no parent view to show through during movie rendering, unfinished pixels are rendered as black.
- **Memory Management:** `VideoFrame` objects are explicitly closed after being sent to the encoder to free up the significant memory they occupy, preventing the browser from running out of memory during long renders.
- **Browser Compatibility:** Movie mode is only enabled in browsers that support the WebCodecs API (e.g., Chrome, Edge, and Safari 16.4+).

## References

- [Catmull-Rom splines](https://en.wikipedia.org/wiki/Centripetal_Catmull–Rom_spline) - The interpolation algorithm.
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) - MDN documentation for hardware-accelerated video encoding.
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) - The MP4 multiplexer library.

## Next Steps

- [COLORS.md](COLORS.md): How colors are computed for each frame.
- [COMPUTATION.md](COMPUTATION.md): How the keyframe views are computed before animation begins.
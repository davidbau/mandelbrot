# Movie Mode and Smooth Animation

The explorer can create smooth zoom animations following your exploration path.
Press 'M' to enter movie mode, and the explorer renders and encodes a video
you can download and share.

## The Animation Challenge

A Mandelbrot zoom video needs to solve several problems:

1. **Smooth camera path**: Zoom checkpoints may be scattered; the path should flow
2. **Consistent colors**: Colors should transition smoothly between zoom levels
3. **Progressive rendering**: Show frames as they compute, refine over time
4. **Video encoding**: Produce a downloadable MP4 file

## Catmull-Rom Splines

The camera path uses Catmull-Rom splines for smooth interpolation between
zoom checkpoints. Given four control points (P0, P1, P2, P3), the spline
passes through P1 and P2 with tangents influenced by P0 and P3.

```javascript
function catmullRom1D(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  // Catmull-Rom basis functions
  const c0 = (-t3 + 2*t2 - t) / 2;
  const c2 = (-3*t3 + 4*t2 + t) / 2;
  const c3 = (t3 - t2) / 2;

  // Compute offsets from p1 for numerical stability
  const s0 = qdSub(p0, p1);
  const s2 = qdSub(p2, p1);
  const s3 = qdSub(p3, p1);

  return qdAdd(p1, qdAdd(qdMul(s0, c0), qdAdd(qdMul(s2, c2), qdMul(s3, c3))));
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

The spline produces C1 continuity (smooth first derivatives) at control points,
making the zoom feel natural rather than jerky.

## Zoom Size Interpolation

While position uses splines, zoom size uses logarithmic interpolation:

```javascript
// Linear interpolation in log space = exponential in real space
const interpolatedSize = sourceSize * Math.pow(targetSize / sourceSize, t);
```

This creates constant *relative* zoom rate: the image shrinks by the same
percentage each frame, which feels natural to human perception.

## Frame Rendering

Each frame is rendered by scaling and compositing the source view:

```javascript
renderFrame(k, t) {
  // Get source and target views
  const sourceSize = this.explorer.grid.views[k].sizes[0];
  const targetSize = this.explorer.grid.views[k+1].sizes[0];

  // Interpolate position with spline (using 4 control points)
  const p0 = k > 0 ? getCenter(k-1) : getCenter(k);
  const p1 = getCenter(k);
  const p2 = getCenter(k+1);
  const p3 = k+2 < views.length ? getCenter(k+2) : getCenter(k+1);
  const interpolatedCenter = catmullRomSpline(p0, p1, p2, p3, t);

  // Interpolate size (logarithmic)
  const interpolatedSize = sourceSize * Math.pow(targetSize / sourceSize, t);

  // Calculate transform
  const scale = sourceSize / interpolatedSize;
  const offsetX = (interpolatedCenter.re - sourceCenter.re) * dimsWidth / sourceSize;
  const offsetY = (sourceCenter.im - interpolatedCenter.im) * dimsHeight / sourceHeight;

  // Draw scaled and translated source view
  ctx.save();
  ctx.translate(dimsWidth/2, dimsHeight/2);
  ctx.scale(scale, scale);
  ctx.translate(-dimsWidth/2 - offsetX, -dimsHeight/2 - offsetY);
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
}
```

## Color Palette Transitions

To maintain color consistency, movie frames use the source view's histogram
for coloring. As we zoom from view k to view k+1:

```javascript
// Use view k's color palette throughout the transition
const colorview = this.explorer.grid.views[k];
this.movieView.draw(this.movieCtx, colorview, 'black');
```

This prevents jarring color shifts mid-transition. When we reach the next
keyframe, colors transition naturally because similar iteration values
map to similar colors.

## Video Encoding

The explorer uses the WebCodecs API for hardware-accelerated video encoding:

```javascript
async encodeVideo(frames) {
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      this.muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => console.error('Encoding error:', e)
  });

  encoder.configure({
    codec: 'avc1.640028',  // H.264 High Profile Level 4.0
    width: this.width,
    height: this.height,
    bitrate: 8_000_000,    // 8 Mbps
    framerate: 60
  });

  for (const frame of frames) {
    const videoFrame = new VideoFrame(frame.canvas, {
      timestamp: frame.time * 1_000_000
    });
    encoder.encode(videoFrame, { keyFrame: frame.isKeyframe });
    videoFrame.close();
  }

  await encoder.flush();
}
```

The output is muxed into an MP4 container using mp4-muxer, which is bundled
into the HTML file during the build process.

## Frame Rate and Timing

Movies render at 60 FPS with zoom speed tuned for visual appeal:

```javascript
const FPS = 60;
const ZOOM_DURATION = 3.0;  // Seconds per zoom level
const FRAMES_PER_ZOOM = FPS * ZOOM_DURATION;  // 180 frames per level
```

For a path with 5 zoom levels, the video is 12 seconds (4 transitions × 3 seconds).

## Progressive Display

While encoding, the explorer shows frames as they're rendered:

```javascript
async renderMovie() {
  for (let frame = 0; frame < totalFrames; frame++) {
    // Render frame
    this.renderFrame(frame);

    // Update progress display
    this.updateProgress(frame / totalFrames);

    // Let browser update UI
    await new Promise(r => setTimeout(r, 0));
  }
}
```

The `setTimeout(r, 0)` yields to the browser's event loop, keeping the UI
responsive during the long encoding process.

## Looping Playback

After encoding completes, the video loops indefinitely in preview:

```javascript
this.videoElement.loop = true;
this.videoElement.autoplay = true;
this.videoElement.muted = true;  // Required for autoplay
```

Click the download button to save the MP4 file.

## Unknown Pixel Handling

Movie frames can't show parent views as background (there's only one canvas),
so unfinished pixels default to black:

```javascript
// Fill with black before drawing
this.movieCtx.fillStyle = 'black';
this.movieCtx.fillRect(0, 0, width, height);

// Draw computed pixels
this.movieView.drawLocal(this.movieCtx, colorview, 'black');
```

This means movies look best when the source views are well-computed. The
explorer waits for views to stabilize before including them as keyframes.

## Aspect Ratio Considerations

Movies respect the current aspect ratio setting. In fullscreen mode with
16:9 aspect ratio, the movie matches. The H.264 encoder handles non-square
pixels correctly.

## Memory Management

Video frames are large (1920×1080 = 8MB per RGBA frame). The encoder processes
frames one at a time and releases them immediately:

```javascript
const videoFrame = new VideoFrame(canvas, { timestamp });
encoder.encode(videoFrame);
videoFrame.close();  // Release immediately
```

The mp4-muxer buffers encoded chunks (much smaller than raw frames) until
the final mux produces the downloadable file.

## Browser Compatibility

WebCodecs is required for video encoding. On browsers without WebCodecs
support (Safari before 16.4, Firefox without flags), movie mode is disabled.

The feature check:

```javascript
if (!('VideoEncoder' in window)) {
  console.warn('WebCodecs not available, movie mode disabled');
  return;
}
```

## Interruption Handling

If the user presses 'M' again or navigates away, encoding stops gracefully:

```javascript
toggle() {
  if (this.active) {
    // Abort current encoding
    this.abortController.abort();
    this.cleanup();
    this.active = false;
  } else {
    this.active = true;
    this.startRendering();
  }
}
```

Partial encodes produce valid (but truncated) video files.

## Next Steps

- [COLORS.md](COLORS.md): How colors are computed for each frame
- [COMPUTATION.md](COMPUTATION.md): How keyframe views are computed

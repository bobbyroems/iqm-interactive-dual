# Majorana, Nanoscale and magnetic waves

## Changes

- Majorana prepares the finale images after entering Build. The enclosure reveal and chip dissolve now overlap, followed immediately by the camera pullout. The 420 ms intermediate hold and animated blur of the large live board/canvases are removed. Asset registration, the final composition and reduced-motion behavior remain intact.
- Nanoscale retains its bounded compositor cameras. During zoom it permits a sharp raster after a 1.5× scale change, at most once per 180 ms after the first refresh. The first refresh can occur immediately for a quick gesture. Only the moving wrapper temporarily releases its hint; its 3D transform retains promotion. This trades a few raster updates for less magnification of a stale bitmap. Chromium documents the underlying behavior in [Re-rastering composited layers on scale change](https://developer.chrome.com/blog/re-rastering-composite).
- Magnetic waves copy and filter only the part of the overscanned canvas inside the kiosk stage, with a nine-pixel guard band for the unchanged eight-pixel, 17-tap blur kernel. The complete base scene is still rendered. Copy coordinates use framebuffer pixels with a bottom-left origin; resizing updates the crop. Renderer scissor state is restored after the pass. Wave count, geometry, noise, resolution, colors and blur weights are unchanged.

## Validation

- Build, 38 unit tests, registered-camera checks and the 70-asset check pass. The UI detector reports no findings.
- Actual Majorana renderers with state advanced to a completed build: 672 recorded frames, including 88 intermediate dissolve frames; no stationary intermediate phase. The sequence completes and resets. This fixture bypasses the drag gesture; captures are not a benchmark of frame pacing.
- Nanoscale at exactly progress 1.5: identical camera transforms, two raster refreshes instead of zero. RMS channel error against a rerastered reference decreased from 1.014 to 0.763 in the measured artwork crop. This is one controlled zoom sample, not a guarantee for every device or gesture.
- Magnetic shader comparison: 12/12 visible-region fixtures match pixel for pixel, with a control confirming blur contributes to the output. At the measured 1080 × 1920 viewport the copied area decreases by about 35%; full-canvas resolution stays 1060 × 2452. The full module was already display-limited on this Mac before and after; target Windows FPS still needs a hardware check.

Compact evidence: [motion-refinement.json](./audits/2026-09-07/motion-refinement.json).

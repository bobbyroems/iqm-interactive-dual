# Loupe and Majorana first-use preparation

Nanowire now allocates its loupe render target and renders both the scene and lens optics before exposing the experience. Its separate WebGL renderer prepares hidden scene variants as well. Preparing the main canvas alone did not prepare resources belonging to this second context.

Majorana's shared-preview entry now waits for component preparation before enabling Start. Each detail renderer resizes before preparation and again after asynchronous compilation, then renders once. The two component views prepare sequentially to avoid overlapping environment bakes and uploads.

Protecting Information starts loupe video playback during entry and waits for a presented video frame when supported. Abort, playback failure and a four-second deadline release the wait; the existing fallback remains available.

No geometry, shader quality, resolution settings or authored effects were reduced. Preparation may lengthen entry. These changes target first-use work; they do not establish that every intermittent hitch has the same cause.

## Verification

- Electron Nanowire test: showing the previously hidden loupe created no additional GL programs (71 → 71), textures (107 → 107), or framebuffers (24 → 24). No orphan animation frames after disposal. Evidence: `audits/2026-09-07/loupe-first-use.json`. The development CSP warning is retained in the raw output.
- Real kiosk navigation through Protecting Information, Nanowire and Majorana: two warmup cycles and one measured cycle per module. Tracked GPU resources, DOM nodes, listeners, videos and contexts returned to baseline. Evidence: `audits/2026-09-07/loupe-majorana-soak.json`. This is a short lifecycle check, not proof of long-term RSS stability.
- Video readiness tests cover waiting for an actual frame, timeout and cancellation.

Manual follow-up: on the target kiosk, test the first Nanowire loupe reveal, the module 04 loupe, and both Majorana component reveals after a cold launch. Resource-count checks do not measure compositor, driver or video-decoder frame latency.

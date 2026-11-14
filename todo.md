# Browser readiness TODO

Updated 2026-11-13. Remaining work from the offline Electron-to-web review.
Keep Electron presentation and prewarming intact unless explicitly changing that policy.

## Completed baseline

- Finding 1: browser startup loading reduced from approximately 116 MiB to
  6.85 MiB in `3c7c391`. Live 3D menu previews load when their card is selected;
  experience assets wait until entry.
- Finding 2, first pass: responsive Nanoscale artwork, browser-owned image
  lifetimes, source cleanup on exit, and reduced startup texture warmup in
  `7944ca8`. Electron retains original images and full prewarming.
- Validation at that baseline: 58 tests, production build/media checks, camera
  registration, responsive layouts, and browser navigation/cleanup checks passed.

## Remaining findings

### Finding 2 follow-up: bound and validate Nanoscale memory

- [x] Add stop-aware browser loading/decoding and safe eviction. All earlier
  camera scenes remain available as registered underlays; distant independent
  comparisons and unreached future cameras can release their sources.
- [ ] Measure peak and settled memory on physical mobile devices, including GPU
  textures and repeated entry/exit. Clearing image sources makes them eligible
  for release; it does not guarantee immediate browser cache eviction.
- [ ] Validate image quality after rotation, substantial resizing, and deep zoom.
  The tier is selected once per mount with pixel-density headroom capped at 1.5x.
  Browser viewports whose longest side exceeds 2048 CSS pixels still use originals.

The eager full-set calculated image-pixel footprints, including module UI, were
approximately 60 MiB on a phone, 176 MiB on a desktop, and 472 MiB with originals.
The 1024px-tier browser layout check now samples **18.23 MiB at entry** and
**41.95 MiB at the finale**, deduplicating assigned image URLs and including UI.
These are RGBA pixel estimates, **not measured RAM, GPU memory, or peak usage**.
Entry prepares only the splash and first handoff; transitions await required
images, next-stop prefetch remains, and restarting releases distant sources.
Electron retains the full-resolution preheat cache and all-scene warmup.

Sources: [image selection](src/js/modules/nanoscale/nanoscale-image-source.js),
[module lifecycle](src/js/modules/nanoscale/index.js),
[production notes](docs/ASSET-PRODUCTION-NOTES.md#browser-image-derivatives).

### Finding 3: recover the menu CTA on short landscape screens

- [x] Add a browser-only short-height menu layout and reachable overflow instead of clipping
  the active card's copy and CTA.
- [x] Recheck all nine cards at 844 x 390, 667 x 375, and 568 x 320 with pointer
  and keyboard activation, plus emulated touch at 568 x 320. CTA bounds fit
  their viewport; keyboard activation now opens the selected card without
  requiring its decorative footer to be the click target. Physical touch
  acceptance remains part of the device checks below.

Sources: [menu styles](src/styles/app.css),
[carousel layout](src/js/core/module-carousel.js).

### Finding 4: make media readiness resilient to online transfers

- [x] Replace or revise fixed readiness deadlines so progressing downloads are
  not treated as stalled transfers. Provide useful loading, cancellation, retry,
  and explicit failure states without allowing indefinite hangs.
- [x] Coordinate browser media/host limits: 45 seconds without observable
  readiness progress, bounded by 180 seconds overall. Increasing buffered
  ranges/readiness renew the video stall timer; completed image decodes notify
  the host. A browser loading/cancel view remains reachable behind slow-entry
  wipes. Electron retains its 8-second media and 30-second host limits, and its
  full-resolution Nanoscale preloader retains a 15-second per-image deadline.
- [x] Test delayed responses, failed requests, retries, and cancellation locally:
  a real 9.5-second delayed MP4 now loads, a 2 Mbps/500 ms latency emulation
  loads, and failure/retry/cancel paths pass. Deterministic tests cover genuine
  versus spurious progress, overall limits, stalled images, and late cleanup.
  Real mobile-network/browser acceptance remains outstanding.

Validation note: the production build, unit tests, camera checks, and Nanoscale
layout/gesture suite pass. The separate `check:recovery` command is blocked
before application startup by the pre-existing LF-only instrumentation extractor
in `scripts/check-runtime-recovery.cjs` on this CRLF Windows checkout; that
unrelated harness was not changed. Focused Electron host-deadline tests pass.

Sources: [States of Matter media](src/js/modules/states-of-matter/media.js),
[Measurement media](src/js/modules/measurement-based/index.js),
[Nanoscale preloader](src/js/modules/nanoscale/nanoscale-assets.js),
[module host](src/js/core/module-host.js).

## Large assets and deployment size

Full-resolution lossless Majorana hero/schematic WebP derivatives now save
approximately **7.43 MiB**, including **1.99 MiB** on the startup path, without
reducing decoded pixels. PNG masters live outside production assets in
`ref/majorana-image-masters/`. See the
[media review](docs/ASSET-PRODUCTION-NOTES.md#large-media-web-optimization-2026-11-13).

Current measured local production output is approximately **431.61 MiB**, including
**427.47 MiB of public assets**, down from 439.05 MiB and 434.91 MiB before this
pass. The original review measured 393.5 MiB and 389.4 MiB respectively; the
responsive Nanoscale derivatives add 45.55 MiB while retaining originals for
Electron and large browser displays.
Deployment size is not the amount every visitor downloads.

Sizes below are approximate compressed/on-disk MiB, not decoded memory:

| Asset or group | MiB | Follow-up |
| --- | ---: | --- |
| [Laptop TGA](public/assets/modules/differences/laptop/laptop_02_BaseColor.TGA) | 48.00 | Appeared unused in the original renderer review; verify references before excluding from web output. |
| [Nanoscale responsive derivatives](public/assets/modules/nanoscale/responsive/) | 45.55 total | Each mount selects one tier: 7.40 / 14.66 / 23.49 MiB of artwork, not all three. |
| [Nanoscale original runtime images](src/js/modules/nanoscale/nanoscale-assets.js) | 41.60 | Retained for Electron and large browser viewports; consider separating web and Electron packaging. |
| [States of Matter video](public/assets/modules/states-of-matter/SoM_IceCube_4k_vertical.mp4) | 40.06 | Create a browser-sized rendition while preserving seek-friendly scrubbing. |
| [Hundred-cent color and bump BMPs](public/assets/modules/differences/coins/) | 18.90 combined | Replace legacy BMP textures with browser-efficient derivatives; preserve material appearance. |
| [Protection models](public/assets/modules/protecting-information/) | 18.28 combined | Optimize the 10.65 MiB topplate and 7.63 MiB plate models and their textures. |
| [Majorana schematic backdrop](public/assets/modules/build-majorana-2/majorana-schematic-backdrop.webp) | 11.17 | Lossless full-resolution conversion complete; responsive sizing remains a follow-up. |
| [Quarter color and bump BMPs](public/assets/modules/differences/coins/) | 16.32 combined | Optimize textures; loading on selection still makes the first live preview expensive. |
| [Majorana model](public/assets/modules/build-majorana-2/majorana-2.glb) | 14.45 | Optimize geometry/textures for the live preview and module. |
| [Chandelier model](public/assets/m2_glb_full_chandelier.web.glb) | 13.75 | Optimize geometry/textures; no longer fetched on browser startup. |
| [Five-cent color and bump BMPs](public/assets/modules/differences/coins/) | 13.06 combined | Replace BMPs with efficient runtime textures after confirming usage. |
| [Majorana reference video](public/assets/modules/build-majorana-2/intro-reference.mp4) | 9.65 | Confirm whether runtime needs it before shipping it in the web build. |
| [Protection alpha effect](public/assets/video-fx/tpt-add-on-fx.webm) | 7.44 | Reduce transfer cost and provide a compatible alpha-media path. |
| [Ice model](public/assets/modules/states-of-matter/Ice+Cube.glb) | 6.82 | Optimize the selected live preview's geometry and textures. |
| [Attract hero](public/assets/modules/build-majorana-2/majorana-intro-hero.webp) | 4.48 | Lossless full-resolution conversion complete; responsive sizing could further reduce startup loading. |

- [ ] Establish an explicit web asset inventory and exclude unused source/reference
  files from production output only after checking runtime references.
- [ ] Optimize first-selected preview assets as well as experience-entry assets.
  Keep the chosen live 3D previews; do not silently replace them with posters.
- [ ] Set transfer-size and decoded-pixel budgets for representative phone and
  desktop entry paths, and check them against the built output.

## Other browser concerns

- [ ] **Codec capability detection and fallback.** Measurement currently depends
  on WebM media, and alpha-video selection follows the manifest rather than
  proven browser capabilities. The integrated Chromium runtime rejected VP9
  alpha video and Opus audio; this does not establish failure in standard Chrome.
  Test real Chrome, Edge, Firefox, desktop Safari, and iOS Safari, then add
  compatible media or an explicit supported fallback.
  Sources: [Measurement story media](src/js/modules/measurement-based/story-state.js),
  [alpha-video selection](src/js/core/alpha-video.js).
- [ ] **Browser zoom and accessibility.** Remove or browser-gate
  `maximum-scale=1, user-scalable=no` in the
  [viewport declaration](src/index.html). Validate browser zoom, text enlargement,
  and module gesture handling without inadvertently changing Electron controls.
- [ ] **URL and browser-history navigation.** Add bookmarkable module URLs and
  Back/Forward behavior, including reload/direct-entry handling and disposal of
  the outgoing experience. The [screen router](src/js/core/screen-router.js)
  currently switches screens without history integration.
- [ ] **Production hosting.** Validate the deployed host, not just the local
  server: byte-range requests must return correct 206 responses for scrubbing;
  configure suitable compression/MIME types and version-aware caching for
  stable-named public assets. Confirm deployments cannot mix stale media with
  new code. Local range requests passed; deployment behavior remains unverified.
- [ ] **Cross-browser and real-device acceptance.** Exercise all experiences,
  menu previews, touch/pinch/wheel/keyboard interactions, short landscape layouts,
  high-DPR screens, slow networks, and repeated entry/exit on physical mobile
  devices. Safari/Firefox and physical-device coverage remain outstanding.

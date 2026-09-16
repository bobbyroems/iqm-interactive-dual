# Production asset notes

## Majorana 2 GLB

The supplied source GLB was approximately 160 MiB and embedded 30 PNG textures,
including 18 at 4096 × 4096. Those images required roughly 1.36 GiB after RGBA
decoding, before GPU mipmaps, and failed to decode reliably in the browser QA
runtime.

The checked-in `majorana-2.glb` is therefore a kiosk-safe prototype derivative:

- approximately 24 MiB;
- the original roughly 276k triangles and named node hierarchy are preserved;
- embedded textures are capped at 1024 × 1024;
- estimated decoded texture memory is roughly 110 MiB before mipmaps;
- the file still has no animation, snap points or interaction metadata, so the
  application supplies those behaviors in code.

The derivative can be reproduced from the client source asset with ImageMagick:

```bash
node scripts/optimize-majorana-glb.mjs source.glb majorana-2.glb 1024
```

Before final production delivery, test 1K versus 2K visual quality on the actual
55-inch display. If closer inspection needs sharper maps, prefer KTX2/Basis GPU
compression over restoring the uncompressed 4K PNGs. Also validate cold-load
time, peak memory and recovery on the exact Windows kiosk PC.

Binary assets use Git LFS patterns in `.gitattributes`. Run `git lfs install`
before adding or cloning them on a new workstation.

## Module 02 scale journey

The three currently authored stopping points use the exact comparison assets
from Figma: dilution fridge versus arcade machine, Majorana 2 package versus a
hockey puck, and QPU chip versus a pencil eraser.

The pull-out film embedded in the brief was evaluated as a possible scrubbed
transition. It was intentionally removed from the live experience because it
reveals unrelated stack components between the authored stopping points and
made the comparison screens look visually layered and noisy. The clean live
transition now uses compositor-only scaling and opacity, with a short white
keyframe separating each comparison.

The final QPU label is implemented as approximately 0.5 cm. The corresponding
mockup still says 10 cm, but the Figma stopping-point notes specify 0.5 cm and
the preceding transition is already marked 3 cm. Two additional listed stops,
Qubit Array and Nanowire, do not yet have authored screens or production-ready
comparison assets; the progress model is intentionally data-driven so those
can be appended when supplied.

## Module 03 states of matter

### Video, model and Figma VFX

The checked-in MP4 and GLB are Git LFS objects, not generated stand-ins. They
were hydrated from `origin` and verified against their pointer OIDs:

- `SoM_IceCube_4k_vertical.mp4`: the delivered master is SHA-256
  `f47cb5ca0f1b8293a0365527ada84a058b661d9449571c4fd0c8f7e633502420`;
  H.264 Main, 2160 × 3840, 24 fps, 12.5 seconds and exactly 300 frames. The
  checked-in file is an all-intra re-encode of it — see "Scrub encoding" below —
  SHA-256 `130e1a97b1c6ca402ad0e1eb666c4047b64dcda26a074ac80ccb1b13b7af233a`,
  42,007,855 bytes, same resolution, frame rate and frame count;
- `Ice+Cube.glb`: SHA-256
  `d9f0b7061ce8b023950d29e8291489a3a7688c26298952690d851c2f05e9fcca`;
  glTF binary v2, 7,146,744 bytes.

The runtime VFX assets are local derivatives of exact image sources exported
from the `IQM Makeshift Internal` Figma file on 2026-08-08:

- node `1:6151`: `som-frost-overlay.png`, the Adobe Stock frost image supplied
  in the design (4096 × 2458), losslessly re-containerized from its Figma JPEG
  source as PNG;
- node `1:6171`: `som-condensation-overlay.png` (2731 × 4096), losslessly
  re-containerized from its Figma JPEG source, plus the exact
  `som-condensation-mask.svg` (3414 × 4738);
- node `1:6193`: `som-fog-mask.png`, the exact uploaded 1080 × 1920 luminance
  artwork with luminance copied into alpha for reliable Chromium CSS masking.
  The design contains no independent fog texture: its fog is a 25% white veil,
  video blur and a masked duplicate of the scene. Do not replace this with a
  baked full-screen Figma export because that export also contains the text,
  card and scrubber UI;
- `som-poster.jpg`: frame zero extracted from the hydrated MP4 at its native
  2160 × 3840 resolution (`ffmpeg`, JPEG quality 5).

Temporary Figma MCP URLs are intentionally not stored in application code;
they expire. The committed files above are the offline runtime sources.

### Scrub encoding

Module 03 never plays this clip; it seeks to an arbitrary frame on every pointer
move. That makes the GOP structure, not the bitrate, the thing that decides how
the scrub feels.

The delivered master carries a keyframe every 30 frames, so landing on frame 117
means decoding frames 90–117 first. Measured in Chromium on the 4K footage that
is **~97 ms per seek** in every direction, which caps the scrub near 10 fps no
matter how fast the visitor's finger moves. Re-encoding with every frame as a
keyframe removes the dependency chain: **~14 ms per seek**, inside a 60 Hz frame
budget. In the module itself, a 400 ms full-rail drag renders 14 video frames
instead of 5, and the footage settles on the released frame in 14 ms instead of
42 ms.

Regenerate it with:

```
npm run generate:som-scrub-video -- <path-to-delivered-master.mp4>
```

The script is idempotent — it probes the keyframe count and leaves footage that
is already all-intra alone — so re-running it cannot stack generation loss. Run
it whenever new footage is delivered, otherwise the module silently regresses to
the 10 fps scrub.

Two encoding choices worth not re-litigating:

- **Resolution stays 2160 × 3840.** A 1440 × 2560 downscale measured *no faster*
  (17–19 ms). Once the GOP is gone the pixel count is not the bottleneck, so
  there is nothing to buy by giving up sharpness on a 4K portrait panel. This
  is a statement about *seeking* H.264, and it does not carry to module 07,
  which plays VP9 with alpha continuously and is pixel-bound — see that
  section.
- **CRF 20, not 18.** CRF 20 measures SSIM 0.9986 / PSNR 57.5 dB against the
  master, which is visually lossless. CRF 18 gains nothing visible and costs
  another 23 MB of Git LFS (62 MB versus 42 MB).

### Module 03 loop audio

The three kiosk loops were made from Freesound's public HQ MP3 previews because
the original WAV download endpoints require an authenticated Freesound account.
The previews are complete-length public renditions; the output files are not
synthetic replacements. License metadata below was rechecked against the live
Freesound pages on 2026-08-08.

| Runtime file | Source and license | Processing |
| --- | --- | --- |
| `som-ice-crackle.ogg` | [Freezer crackling.wav by sethlind](https://freesound.org/people/sethlind/sounds/264991/), CC0 1.0 | Source range 0.10–29.00 s; 500 ms circular linear crossfade; loudness target -24 LUFS / -3 dBTP; 48 kHz mono; 27.900 s. |
| `som-water-drip.ogg` | [Water_Drip_Loop.wav by michael_grinnell](https://freesound.org/people/michael_grinnell/sounds/464419/), CC0 1.0 | Source range 0.025–6.140 s; 150 ms circular linear crossfade; loudness target -24 LUFS / -3 dBTP; resampled to 48 kHz stereo; 5.815 s. |
| `som-steam-hiss.ogg` | [Gas Stove Leak Air Hiss by Geoff-Bremner-Audio](https://freesound.org/people/Geoff-Bremner-Audio/sounds/671566/), CC BY 4.0 | Stable hiss range 2.00–15.50 s (the source also contains stove on/off sounds); 500 ms circular linear crossfade; loudness target -24 LUFS / -3 dBTP; resampled to 48 kHz stereo; 12.500 s. |

Attribution for the third file: **“Gas Stove Leak Air Hiss” by Geoff Bremner,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).**
The original implementation plan described all three sources as CC0, but the
live page for sound 671566 now reports CC BY 4.0. Keep this attribution with any
distribution of the derived loop.

### Runtime audio encoding

Everything under `assets/audio/` ships as Ogg Opus. The masters were 44.1–192 kHz
24-bit WAV totalling 113 MB, which is what `public/` used to copy verbatim into
`dist/`; re-encoded they come to 5.5 MB with no audible loss at kiosk listening
level. Opus rather than MP3 because `kiosk-audio.js` loops five of these as
`AudioBufferSourceNode`s with `loop = true`: Opus carries its encoder delay in the
`OpusHead` pre-skip field, so a decoded buffer is sample-accurate against the
master and the loop seam stays silent. MP3 has no such field and would prepend
padding to every decoded buffer, putting a click at each loop point.

Recipe — `-vn` matters because three of the sound-library WAVs carried embedded
MJPEG cover art:

```
ffmpeg -i in.wav -vn -map_metadata -1 -c:a libopus -b:a <rate> -vbr on -application audio out.ogg
```

Rates: 160k for the melodic music loop, 112k for the long ambience and foley
loops, 128k for one-shots. `scripts/check-media-assets.mjs` asserts `OpusHead`
rather than just the `OggS` container, so a re-encode that loses the pre-skip
fails the build instead of shipping a clicking loop.

All circular edits were applied after loudness processing so the last sample
continues naturally into the first. Output WAVs are uncompressed PCM for
predictable offline decoding. Existing non-module audio files in the same
directory were also hydrated from their unchanged Git LFS OIDs so the global
asset validator does not encounter pointer text.

## Module 05 protecting quantum information

The runtime model is `protect-quantum-information.glb`, reproducibly prepared
from the supplied `ProtectQuantumInfo_001a (1).glb` source. It is a glTF binary
v2 file with no authored animation clips:

- 1,851,520 bytes;
- SHA-256
  `a7786e84c3a8a3bcb2a4e6bd01def8b7a24ea1ba1085086a11926756d71fb141`;
- the complete source geometry is retained without simplification;
- `UPPER-GATE` and `LOWER-GATE` each become semantic `_H`, `_FRONT` and
  `_REAR` nodes. Triangle centroids inside the verified source-local footprint
  `abs(x) <= 0.0485` and `abs(z) <= 0.0265` are assigned to `_H` first; all
  remaining triangles are split at local `x=0.025` into `_FRONT` and `_REAR`;
- buffers use `EXT_meshopt_compression`; the module-local JavaScript reference
  decoder keeps loading compatible with the kiosk CSP;
- the unused 4096 px source metallic/roughness texture and authored materials
  are removed because runtime materials are rebuilt from exact node names;
- the application generates the moving electrons, voltage tracks, magnetic
  field, Cooper-pair alignment and protected-state success effect at runtime.

Regenerate the production model with Node 22.12 or newer:

```sh
node scripts/prepare-protecting-information-glb.mjs \
  "/path/to/ProtectQuantumInfo_001a (1).glb" \
  public/assets/modules/protecting-information/protect-quantum-information.glb \
  0.025 0.0485 0.0265
```

The final three positional arguments are, in order, `split-x`, `h-half-x` and
`h-half-z`. They are optional only because the script defaults to the verified
values shown above; changing them changes the semantic geometry contract and
requires updating the focused GLB bounds test.

The temperature, voltage and magnetic-field SVG icons and the exact 392 × 392
dial-target PNGs were exported from the module frame in the `IQM Makeshift
Internal` Figma file and are stored locally for offline use. Temporary Figma
asset URLs are not used by the renderer.

`EngineeringTheTopoconductor_Social_Loop-wOutro_v4.mp4` was inspected frame by
frame as the motion reference but is not bundled: its social outro is not part
of the kiosk flow. `TopoGap_modelExport_001a.glb` was also evaluated and
intentionally excluded because its long strip geometry does not match the
device shown in the reference film.

## Module 07 measurement-based footage

The six delivered beats arrived twice. The first delivery was opaque H.264 with
the background flattened into the frame at about `#dfdcdf`, which meant the
footage painted its own surface over the whole 2160 x 3840 stage — and a tone
that did not even match the module's own `#f2f4f5`. The second delivery is
ProRes 4444 MXF, `yuva444p12le`, 2160 x 3840, 30 fps, with a real alpha channel
so the module's gradient carries the surface instead.

Baked to VP9-alpha WebM with the same recipe `scripts/pack-alpha-video.mjs`
uses for its `vp9-alpha` path — straight alpha, explicit range and matrix, CRF
32 — but at full frame rather than cropped to the alpha bounding box. These are
full-stage compositions: `.mbqc__video` is `inset: 0` at stage size and the
Figma-authored measurement annotations are positioned against coordinates in
the footage, so shrinking the frame to its content would move every one of
them. Cropping is the right trade for the effect layers in
`public/assets/video-fx`, which the runtime re-places from a manifest; it is
the wrong one here.

```sh
ffmpeg -i IQM_MultiQubit_VIDEO_split-004.mxf -an -sn -dn   -filter_complex "[0:v]scale=in_range=tv:out_range=pc,setrange=pc,format=gbrap,scale=2160:3840:flags=lanczos:in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuva420p[out]" -map "[out]"   -c:v libvpx-vp9 -pix_fmt yuva420p   -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709   -crf 32 -b:v 0 -row-mt 1 -deadline good -cpu-used 2   -g 30 -keyint_min 30 -r 30   public/assets/modules/measurement-based/IQM_MultiQubit_VIDEO_split-004.webm
```

Dropping the flattened background cost nothing and saved most of the bytes:
51 MB of opaque MP4 became a fraction of that, because the grey field that used
to fill everything outside the device is now absent rather than compressed.

Two consequences in the module itself. `.mbqc__media` is `background:
transparent` — anything painted there would sit between the artwork and the
gradient and flatten it straight back out. And `.mbqc` now carries the same
soft aurora wash as the carousel screen and Module 03 over its
`--mbqc-surface` tone, because with the footage transparent that background is
what the visitor actually sees around the device.

The same PSNR check `scripts/check-alpha-video.mjs` runs applies here, with a
full-frame crop; note its warning that ffmpeg's native VP9 decoder silently
ignores the WebM alpha channel, so `-c:v libvpx-vp9` is required on the
encoded side or the comparison passes against an opaque frame no matter how
wrong the matte is. Measured against the masters, in delivery order: 37.7,
42.4, 42.1, 41.6, 41.4 and 41.6 dB average, all clear of the 35 dB floor.

### Resolution: 1440 x 2560, not the delivered 2160 x 3840

The copy entrance on the sequence beat stuttered. Two rendering fixes helped and
did not finish the job -- see `measurement-based.css` for those -- because the
remaining cost was simply decoding the footage.

Measured with `ffmpeg -benchmark -threads 1 -c:v libvpx-vp9`, single threaded so
the figure is per-core work rather than a number that moves with the machine.
`-c:v libvpx-vp9` matters: the native decoder silently drops the alpha channel
and reports roughly half the real cost.

| Encoding | decode s per s | x realtime |
| --- | --- | --- |
| VP9 + alpha, 2160 x 3840 | 0.515 | 1.94 |
| VP9 + alpha, 1440 x 2560 | 0.234 | 4.27 |
| VP9 + alpha, 1080 x 1920 | 0.119 | 8.38 |
| VP9 no alpha, 2160 x 3840 | 0.338 | 2.96 |

Two things fall out. The alpha channel is a second VP9 stream and costs more
than the colour does -- 0.515 against 0.338 -- and decode scales with pixel
count almost exactly. At the delivered size one core spent 52 percent of
realtime on decode alone, before compositing, the copy animation, or the next
clip being prefetched. At 1440 x 2560 that is 23 percent.

Note that this is the opposite conclusion to module 03's scrub, where a
1440 x 2560 downscale measured no faster at all. Both are true. That clip is
H.264 without alpha and is *seeked*, so its cost was the GOP dependency chain
and pixel count was not the bottleneck. These clips are played, carry alpha,
and are decode-bound, so pixel count is the only lever. Do not read one note as
covering the other.

Re-baked from the same masters with the recipe above, changing only the scale
target. The filter chain earns its keep here in a way it did not at full size:
resampling in `gbrap` rather than YUV is what keeps chroma from being scaled
around its 128 midpoint, and at 1:1 nothing was being resampled at all.

Frame counts are identical to the clips they replace, which matters because the
module waits on `ended` and loops on exact duration. Total footage went from
13 MB to 7.7 MB.

What it costs: SSIM against the master falls from 0.9982 to 0.9929 on clip 003.
PSNR *rises* -- 44.3 against the delivered 42.1 -- but that is the downscale
low-passing away VP9's high-frequency artefacts, which mean-squared error
rewards, not detail being gained. The honest summary is that the footage is
softer, by a 1.5x upscale on a 4K panel, and the fine dashed detail in the chip
grid is where a viewer would see it first. 1080 x 1920 is twice as cheap again
and was rejected: a 2x upscale on that artwork is a visible loss.

Clip 001 sits lowest and is not an encode deficiency. Re-baking it at CRF 24
scored 37.85 dB against CRF 32's 37.73 — 0.12 dB for 55 percent more bytes —
so the residual is not the quantizer. It is the 4:4:4 12-bit masters landing in
`yuva420p`, which is why the red channel is consistently the weakest of the
three (36.4 dB against green's 38.4 on that clip) on artwork whose fine detail
is gold and teal. Chroma subsampling is inherent to the format and identical to
what the shipped `video-fx` clips do, so CRF 32 stands; spending bitrate there
buys nothing.

## Electron packaging

Large media is unpacked from ASAR so Chromium can stream and seek video and load
the GLB/HDR assets from normal files in the packaged application.

## Nanoscale (design v3)

The hero plates are display-resolution derivatives. Their masters live in
`art-source/nanoscale/`, which is gitignored and never served: everything under
`public/` is copied into the Electron build and decoded on the panel when the
module mounts, so a plate is cut and scaled to the size the 2160 x 3840 stage
actually draws it at, plus headroom for the zoom that reaches it.

`npm run assets:nanoscale` bakes them all from the masters and prints every crop
rectangle and output size it used. Those numbers and the constants in
`nanoscale-camera.js` have to agree; `npm run check:nanoscale` is what proves
the camera still lands its handoffs afterwards.

### The current masters

Three renders, delivered 2026-08-31, 116 MB together:

| Master | Serves | Recipe |
|---|---|---|
| `M2_ServerRoom_Schem_Module_Vertical.png` (2304 x 4096) | `splash-room.webp`, stop 00 | no crop, no resize, alpha dropped |
| `M2_Chandelier_Schem_Module_8k.png` (4608 x 8192) | `cryostat.webp`, stop 01 | crop (512, 1382, 3582, 6197), resize to 1800 x 3114 |
| | `majorana-arm.webp`, the stop-02 underlay | crop (1905, 6357, 796, 1222), native |
| `M2_ChipCloseup_8k.png` (8192 x 8192) | `majorana-2.webp`, stop 02 and the stop-03 background | trim to content (249, 0, 7697, 8135), long edge to 4096 |
| | `qpu-chip-focal.webp`, the stop-03 focal | crop (1758, 2856, 2283, 2490), native, edges feathered |

The splash is an exact 9:16 recomposition for this panel, so `contain` fills the
stage with nothing left over and the plate needs no work at all. It replaced a
4521 x 6654 plate that only reached partway down the frame, so stop 00 is a
different composition: the cryostat is larger and the floor is now in frame.
That is the delivered art, not a placement change.

### Two masters, five plates

The chandelier is cut twice. Stop 01 gets the plate, and the stop-02 underlay --
the arm the package hangs from -- is cut from the same master at master
resolution rather than being re-cropped out of the already-downscaled stop-01
plate, which is what it used to be.

The close-up is cut twice and painted three times. Stop 02 paints the package;
stop 03 retains that same plate underneath and paints it again as its own
background, so one decoded bitmap serves three layers and they are pixel
coincident by construction. The separate `qpu-chip-background.webp` export this
replaced was the same object rendered about 1% off the plate retained beneath
it, and it is gone.

### Registering a replacement

Nothing here is authored twice. Every crop above is a measured registration
against the plate it replaced, and every stage-space landmark the camera builds
its handoffs from is held still across the swap:

- The stop-01 crop was found by matching gold masks across scale and offset,
  1.99 master px per retired plate px. Keeping the retired plate's framing is
  what leaves `CRYOSTAT_ART` and the 01 -> 02 registration untouched.
- The stop-02 plate is the close-up whole, resized until it fits the arm it
  hangs from. The underlay is not trimmed, so the chandelier renders its own
  package at the arm's tip and the plate has to bury it: anywhere it falls
  short, that render shows as a second chip. Width and centre come from the
  chandelier's package (910 stage px wide); both renders keep the neck 14 px
  inside the frame, so the stub the close-up carries runs straight into the
  chandelier's neck. The vertical offset is a search rather than an edge match,
  because the close-up's frame is slightly shallower and the two corner radii
  differ; at the chosen offset nothing underneath is more than 1.3 px outside
  the plate. Fitted to the retired plate's package instead it came out 4.4% too
  wide and sat 42 px high, which left the chandelier's package showing below it.
  The 10 cm bracket follows the refitted frame.
- The QPU window is measured on the plate in its own pixels and pushed through
  that placement, so the 02 -> 03 landmark follows the plate wherever it is
  fitted; `QPU_DARK_BOARD_TARGET` at stop 03 is a Figma constant and does not
  move.

The one exception is deliberate. The retired stop-03 background sat on a Figma
canvas far larger than anything it painted, and that empty canvas decided when
the scene was allowed to start fading in. The plate that replaced it has a
smaller box, so the group states `coverageArtBox` explicitly to keep the fade
starting where it did rather than about a tenth of the way later.

The result, measured against the previous build: stops 04 and 05 render
pixel-identically, the 00 -> 01 and 02 -> 03 registrations moved only by the
refits above, every other handoff and fade window is unchanged, and the runtime
set costs 486 MB of decoded bitmap where it used to cost 531 MB.

### Module 08's finale shares these plates

`src/js/modules/build-majorana-2/majorana-finale.js` paints stop 02's package
and stop 01's cryostat directly, and runs the 02 -> 01 handoff in reverse. Its
Figma-authored start placement used to be resolved against the stop-02 bitmap,
which meant a new plate at a different size would have moved the package away
from the live board it dissolves out of. What those numbers pinned was where
the package's circuit board fell on screen, so the start is now the similarity
that lays the current plate's board on that rectangle, whatever stop 02 does
with its plate. The pull-out end follows stop 02's placement and so lands on
the chandelier's arm the way stop 02 does. Both plates are also sized from the
camera's own `assetSize` rather than from hardcoded CSS, which is what had let
the two drift apart.

## Alpha effect video

The topoconductor device and electricity clips arrived as ProRes 4444 MXF at
4096 x 4096, 30 fps, `yuva444p12le` — real 12-bit alpha, about 34 GB across six
files. None of that plays in a browser. `scripts/pack-alpha-video.mjs` bakes
them, `scripts/check-alpha-video.mjs` verifies them against the masters, and
`src/js/core/alpha-video.js` plays them.

Two encodings exist. `--codec vp9-alpha` is the default and what ships: VP9 in
WebM with a real alpha channel, composited by the browser with no canvas and no
shader. `--codec h264-packed` stacks colour over matte in one H.264 frame and
recombines it with a two-tap fragment shader.

### Why VP9 alpha won

The received wisdom is that Chromium cannot hardware-decode VP9 alpha and falls
back to software. That was the original reason for packing, and measurement did
not support it. On an RTX 3090, using
`src/playground/alpha-video-bench.html` with the same master, crop, resolution
and keyframe interval on both sides:

| | packed H.264 | VP9 WebM alpha |
| --- | --- | --- |
| decode, median | 99.9 ms | 1.2 ms |
| sustained rate | 29.9 fps | 30 fps |
| dropped frames | 0 / 150 | 0 / 149 |
| three clips at once | 23.8 fps | 26.3 fps |
| seek | 43.5 ms | 28.7 ms |

Neither drops frames on its own, but VP9 alpha wins everywhere and packing
costs twice the pixels, since the matte doubles the frame height.

`mediaCapabilities` also reports `powerEfficient: true` for plain VP9 on that
GPU, so "VP9 is slow" was never the right claim. Note the API has no field for
an alpha channel, so it cannot confirm the alpha path specifically — only the
playback measurement does.

The packed path is kept because VP9 hardware decode varies far more by GPU than
H.264 does, and the kiosk PC's GPU is not specified in
`docs/WINDOWS-KIOSK-SETUP.md`. If that machine decodes VP9 alpha poorly, re-bake
with `--codec h264-packed`; the manifest records the layout per clip and the
runtime picks the path, so nothing else changes.

### Straight alpha, not premultiplied

`src/js/video-layer-draft.js` took an earlier route — flattened-over-black MP4s
with the black keyed out. Its own notes record the symptom: "Jasne tło aplikacji
ujawnia jednak ciemne obwódki wynikające z kompresji H.264", dark fringes on the
light background. Keying black out of a flattened frame returns colour that is
already premultiplied, and compositing that as straight alpha darkens every soft
edge.

So the shipped clips keep the masters' own straight alpha. Measured against the
verified packed clip through the same decode path, straight scores 46.1 dB and
premultiplied 41.7 dB with a consistent dark bias. The packed encoding is the
opposite — it premultiplies deliberately, because there the shader composites
and expects it.

The colour outside the matte is left as the master rendered it. It looks like
garbage in isolation — `TPT_Add-on-FX` is a solid blue field with vertical
streaks where unmultiplying amplified near-zero alpha — but it is a smooth
extension of the element's own hue, so chroma subsampling bleeding it across a
soft edge is benign. Filling it with black would reintroduce exactly the
fringing above. It does cost bitrate: `electricity-pulsing-p3-add` is 15.9 MB as
WebM against 6.0 MB packed, because premultiplying collapses that region to
black and black compresses to nearly nothing. Across all six the totals are
26 MB and 19 MB, so only that one clip is an outlier. If it ever matters,
edge-extending the colour before encoding compresses far better than the raw
field and, unlike a black fill, does not fringe.

### Range and matrix have to be stated explicitly

The masters are limited-range YUV — black sits at 16 — while their alpha plane
is full-range 0-255. Neither ffmpeg's `format` filter nor the browser reconciles
that, and getting it wrong is not obvious: the clip still plays, just thin.

Every conversion needs `setrange` first to state what the frame already holds.
Without it swscale silently ignores the range options: in the packed encoding
the matte landed at 28-140 instead of 16-146 and every alpha value came back
about 12 % low, costing a round trip 22 dB of PSNR while looking perfectly
plausible on screen. Colour matrix must be tagged for the same reason — an
unsignalled matrix leaves the decoder guessing, and a guess that differs from
the encoder shifts hue as well as luma.

### Verifying

```
npm run pack:alpha-video  -- --source "G:/Github/videofiles"
npm run check:alpha-video -- --source "G:/Github/videofiles"
```

The packer skips clips whose manifest entry still matches the master and the
encode settings; `--force` overrides.

The checker composites both the master and the encoded clip over mid-grey and
compares them, rebuilding the reference from the master rather than reusing the
packer's own filter graph so a mistake there cannot pass by being present on
both sides. The floor is 35 dB. A correct bake measures 38-52 dB depending on
how much soft edge a clip carries; the range regression described above scored
29.7 dB on a clip that otherwise measures 52.

Two traps worth knowing before debugging one of these by eye.

**ffmpeg's native VP9 decoder ignores the WebM alpha channel** and returns an
opaque frame, so anything run through it compares against a fully opaque clip
and passes no matter how wrong the matte is. `-c:v libvpx-vp9` reads it. Most
offline tooling has the same blind spot, which makes alpha WebM meaningfully
harder to inspect than a packed frame — that is the real cost of this choice.

**Chrome colour-manages `<img>` and `<video>` differently.** Comparing a decoded
frame against a PNG reference in a page shows a consistent offset that is
entirely the browser's: one reference PNG held 70 at a pixel the canvas read as
80. Compare video against video.

`src/playground/alpha-video.html` plays each clip over a checkerboard, mid-grey,
white and brand-blue backdrop. `src/playground/alpha-video-bench.html` runs the
codec comparison, and refuses to run unless its window is actually being
composited — Chrome stops presenting frames in a background window and reports
catastrophic drops for both codecs, which reads exactly like a real result.

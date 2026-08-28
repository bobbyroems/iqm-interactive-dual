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
  there is nothing to buy by giving up sharpness on a 4K portrait panel.
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

## Electron packaging

Large media is unpacked from ASAR so Chromium can stream and seek video and load
the GLB/HDR assets from normal files in the packaged application.

## Nanoscale (design v3)

The five hero plates are display-resolution derivatives. Their masters — Figma
exports and supplied photography, about 120 MB — live in `art-source/nanoscale/`,
which is gitignored and never served: everything under `public/` is copied into
the Electron build and decoded on the panel, and five plates at master
resolution cost roughly 260 MB of decoded bitmap when the module mounts.

Each derivative's width is set by how large the art is ever drawn on the
2160 × 3840 stage plus a little headroom for the zoom between stops, not by what
the master happens to be:

| Master | Served asset | Recipe |
|---|---|---|
| `cryostat2x.png` | `cryostat.webp` (1800 × 3114) | `-trim +repage -resize 1800x -quality 86`, alpha kept |
| `large.png` | `majorana-2.webp` (1300 × 2466) | `-trim +repage -resize 1300x -quality 86`, alpha kept |
| `IQM_Still_M2_Puck_FaceOn-upscale-upscale-2x 1.png` | `qpu-chip.webp` (2160 × 3840) | re-registered (below), then `-resize 2160x3840 -quality 84` |
| `Group 18.png` | `qubit-array.webp` (2160 × 3840) | `-resize 2160x3840! -quality 84` |
| `Group 19.png` | `nanowire.webp` (2160 × 3840) | `-resize 2160x3840! -quality 84` |

The two cut-out plates are trimmed of their transparent margin before scaling,
so their aspect is the object's, not the export canvas's — the layout boxes in
`nanoscale-layout.js` assume that.

### Stop 03 registration

The supplied puck master is framed 170 × 264 stage px right and down of Figma
frame 31:1510 (confirmed by phase correlation; frames 04 and 05 register
exactly). The frame's own dimension geometry — nodes 31:1762 to 31:1766, which
the layout table uses verbatim — therefore missed the die it measures. The plate
was moved into register and the edge that opened up was borrowed from the frame
render, tone-matched to the plate and feathered across 50 px. If a correctly
framed master arrives, re-derive it with a plain `-resize 2160x3840!` and
nothing in the layout has to change.

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

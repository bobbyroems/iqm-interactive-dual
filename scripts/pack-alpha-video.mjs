/**
 * Converts alpha-carrying masters (ProRes 4444 MXF/MOV, or anything ffmpeg can
 * decode with an alpha plane) into clips the kiosk can play.
 *
 * Three encodings, chosen with --codec, because the layers these clips form are
 * not all composited the same way:
 *
 *   vp9-alpha     (default) a real alpha channel in WebM. The browser
 *                 composites it source-over with no shader and no canvas, so
 *                 the colour must stay straight — premultiplying darkens every
 *                 soft edge.
 *   h264-additive no alpha at all, colour premultiplied so the frame is exactly
 *                 what the clip looks like over black. For layers the design
 *                 marks "Add/Screen Mode", where the blend adds light and an
 *                 alpha channel would be information the blend discards.
 *   h264-packed   colour stacked over matte in one frame, premultiplied,
 *                 recombined by a fragment shader. A fallback for hardware that
 *                 handles VP9 alpha poorly.
 *
 * Every clip is cropped to its alpha bounding box — the masters are 4096x4096
 * but the electricity artwork occupies about 15% of that — and the crop is
 * recorded in the manifest so the runtime restores the original placement
 * without anyone measuring offsets by hand.
 *
 * Usage:
 *   node scripts/pack-alpha-video.mjs --source "G:/Github/videofiles"
 *   node scripts/pack-alpha-video.mjs --only Electricity --codec h264-additive
 *   node scripts/pack-alpha-video.mjs --stage-width 2160 --oversample 1.5
 *
 * Flags:
 *   --source <dir>       directory of masters (required unless --only is a path)
 *   --codec <name>       vp9-alpha | h264-additive | h264-packed | vp9-luma-alpha
 *   --out <dir>          output directory, default public/assets/video-fx
 *   --only <name>        process a single master by filename stem
 *   --stage-width <px>   kiosk design width the source frame maps onto (2160)
 *   --oversample <n>     resolution multiplier over a 1:1 stage-width fit (1)
 *   --crf <n>            x264 quality, lower is better (18)
 *   --preset <name>      x264 preset (slow)
 *   --pad <px>           margin added around the alpha bounding box (8)
 *   --no-crop            keep the full source frame
 *   --force              re-encode even when the manifest entry is current
 *   --dry-run            analyse and report, write nothing
 */

import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const SOURCE_EXTENSIONS = new Set(['.mxf', '.mov', '.mkv', '.avi', '.webm'])

/* NVDEC and Quick Sync both cap H.264 at 4096 on either axis. Cross it and the
   clip falls back to software decode, which is the failure this script exists
   to avoid, so the packed frame is clamped rather than allowed to exceed it. */
const MAX_DECODE_DIMENSION = 4096

/* vp9-alpha carries a real alpha channel, so the browser composites a plain
   <video> with no shader and no unpacking. It measured faster than the packed
   H.264 on an RTX 3090 — 1.2ms median decode against 99.9ms, and 26.3fps
   against 23.8 with three clips at once — largely because it decodes half the
   pixels: packing stacks the matte under the colour and doubles frame height.

   h264-packed remains available because VP9 hardware decode varies far more by
   GPU than H.264 does, and the kiosk PC's GPU is not specified anywhere. If
   that machine turns out to decode VP9 alpha poorly, re-bake with
   --codec h264-packed and the runtime picks the shader path from the manifest. */
/* h264-additive carries no alpha channel at all. Layers the design marks
   "Add/Screen Mode" — the electricity pulses and the particle passes — are
   composited by adding light, and an additive layer's contribution is exactly
   its colour multiplied by its own coverage. Premultiplying produces that
   directly and leaves pure black everywhere the effect is absent, which adds
   nothing and compresses to almost nothing. Carrying an alpha channel for those
   would be paying twice for information the blend mode discards. */
const CODECS = Object.freeze(['vp9-alpha', 'h264-packed', 'h264-additive', 'vp9-luma-alpha'])

const DEFAULTS = Object.freeze({
  codec: 'vp9-alpha',
  out: 'public/assets/video-fx',
  stageWidth: 2160,
  oversample: 1,
  crf: 18,
  preset: 'slow',
  pad: 8
})

function parseArguments(argv) {
  const options = { ...DEFAULTS, crop: true, force: false, dryRun: false, source: null, only: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`)
      index += 1
      return next
    }
    switch (flag) {
      case '--source': options.source = value(); break
      case '--codec': {
        const codec = value()
        if (!CODECS.includes(codec)) throw new Error(`--codec must be one of: ${CODECS.join(', ')}`)
        options.codec = codec
        break
      }
      case '--out': options.out = value(); break
      case '--only': options.only = value(); break
      case '--stage-width': options.stageWidth = Number(value()); break
      case '--oversample': options.oversample = Number(value()); break
      case '--crf': options.crf = Number(value()); break
      case '--preset': options.preset = value(); break
      case '--pad': options.pad = Number(value()); break
      case '--no-crop': options.crop = false; break
      case '--force': options.force = true; break
      case '--dry-run': options.dryRun = true; break
      default: throw new Error(`Unknown flag: ${flag}`)
    }
  }
  return options
}

function run(command, args, { capture = 'stderr' } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', code => {
      if (code !== 0) {
        rejectPromise(new Error(`${command} exited ${code}\n${stderr.split('\n').slice(-25).join('\n')}`))
        return
      }
      resolvePromise(capture === 'stdout' ? stdout : stderr)
    })
  })
}

/* ffprobe is not always installed alongside ffmpeg (the ImageMagick bundle on
   the kiosk build box ships only ffmpeg), so stream facts are read back out of
   `ffmpeg -i`, which prints them to stderr and then exits non-zero. */
async function probe(filename) {
  let output = ''
  try {
    output = await run('ffmpeg', ['-hide_banner', '-i', filename])
  } catch (error) {
    output = error.message
  }
  const video = output.split('\n').find(line => /Stream #\d+:\d+.*: Video:/.test(line))
  if (!video) throw new Error(`No video stream found in ${basename(filename)}`)

  const size = video.match(/, (\d{2,5})x(\d{2,5})[ ,]/)
  if (!size) throw new Error(`Could not read frame size for ${basename(filename)}`)

  const pixelFormat = (video.match(/Video: [^,]+, ([a-z0-9]+)/) || [])[1] || ''
  const rate = video.match(/([\d.]+) (?:fps|tbr)/)
  const duration = output.match(/Duration: (\d+):(\d+):([\d.]+)/)

  return {
    width: Number(size[1]),
    height: Number(size[2]),
    pixelFormat,
    fps: rate ? Number(rate[1]) : 30,
    duration: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : null,
    hasAlpha: /^(?:yuva|rgba|bgra|argb|abgr|gbrap|ya)/.test(pixelFormat)
  }
}

/* Union of the per-frame alpha bounding boxes. min_val is deliberately near the
   floor so faint glow tails are kept — clipping them would put a hard edge on
   exactly the soft falloff these clips are made of. */
async function measureAlphaBounds(filename) {
  const output = await run('ffmpeg', [
    '-hide_banner', '-i', filename, '-an',
    '-vf', 'alphaextract,bbox=min_val=6',
    '-f', 'null', '-'
  ])

  const bounds = { x1: Infinity, y1: Infinity, x2: -1, y2: -1, frames: 0 }
  for (const line of output.split('\n')) {
    const match = line.match(/x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/)
    if (!match) continue
    bounds.x1 = Math.min(bounds.x1, Number(match[1]))
    bounds.x2 = Math.max(bounds.x2, Number(match[2]))
    bounds.y1 = Math.min(bounds.y1, Number(match[3]))
    bounds.y2 = Math.max(bounds.y2, Number(match[4]))
    bounds.frames += 1
  }
  if (!bounds.frames) throw new Error(`${basename(filename)} has a fully transparent alpha channel`)
  return bounds
}

const toEven = value => Math.max(2, Math.round(value / 2) * 2)

function planCrop(bounds, source, { pad, crop }) {
  if (!crop) return { x: 0, y: 0, width: source.width, height: source.height }
  const x = Math.max(0, Math.floor((bounds.x1 - pad) / 2) * 2)
  const y = Math.max(0, Math.floor((bounds.y1 - pad) / 2) * 2)
  return {
    x,
    y,
    width: toEven(Math.min(source.width - x, bounds.x2 + pad - x + 1)),
    height: toEven(Math.min(source.height - y, bounds.y2 + pad - y + 1))
  }
}

/* A 1:1 fit means the cropped region lands on the kiosk stage at one video
   pixel per stage pixel when the source frame is mapped to the full stage
   width. Anything beyond that is resampling work the GPU does for free. */
function planOutputSize(cropRect, source, { stageWidth, oversample }) {
  const scale = (stageWidth / source.width) * oversample
  let width = toEven(cropRect.width * scale)
  let height = toEven(cropRect.height * scale)

  const limit = Math.min(
    MAX_DECODE_DIMENSION / width,
    MAX_DECODE_DIMENSION / (height * 2)
  )
  if (limit < 1) {
    width = toEven(width * limit)
    height = toEven(height * limit)
  }
  return { width, height }
}

/* Both graphs need this: the masters are limited-range YUV, and setrange states
   what a frame already holds so swscale performs exactly one conversion.
   Without it the range options are silently ignored and every value drifts —
   the fault is invisible on screen and only shows up when measured. */
const TO_FULL_RANGE = 'scale=in_range=tv:out_range=pc,setrange=pc'

function buildAlphaWebmGraph(cropRect, output, source) {
  const cropped = cropRect.width === source.width && cropRect.height === source.height
    ? 'null'
    : `crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y}`

  /* Straight alpha, deliberately not premultiplied. A plain <video> is
     composited source-over by the browser, which expects unmultiplied colour;
     handing it premultiplied colour darkens every soft edge. Measured against
     the verified packed clip through the same decode path, straight scores
     46.1dB and premultiplied 41.7dB with a consistent dark bias — which is the
     dark-fringe artefact the earlier keyed-WebM draft ran into.

     The colour outside the matte is left as the master rendered it. It looks
     like garbage in isolation, but it is a smooth extension of the element's
     own hue, so 4:2:0 chroma subsampling bleeding it across a soft edge is
     benign. Replacing it with black would reintroduce exactly the fringing
     this avoids. */
  const steps = [
    cropped,
    TO_FULL_RANGE,
    'format=gbrap',
    `scale=${output.width}:${output.height}:flags=lanczos`
      + ':in_range=pc:out_range=tv:out_color_matrix=bt709',
    'format=yuva420p'
  ]
  return `[0:v]${steps.join(',')}[out]`
}

function buildLumaAlphaGraph(cropRect, output, source) {
  const cropped = cropRect.width === source.width && cropRect.height === source.height
    ? 'null'
    : `crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y}`

  /* For a master whose transparency is drawn rather than matted.

     An "ADD" pass is authored to be added to what is under it: the effect is
     painted over black, and the black is meant to disappear by contributing no
     light. Its alpha channel, if it has one, is opaque everywhere — the black
     is colour, not absence. That composites correctly only under a blend that
     cancels black, and only over something opaque; anywhere else the black is
     just black, and the clip reads as a rectangle.

     So the matte is recovered from the picture: premultiply first, so the alpha
     is measured from the clip as it will actually be seen, then take luminance
     as the alpha. Black becomes transparent, the effect keeps its own falloff,
     and the result composites correctly over anything at all. */
  const steps = [
    cropped,
    TO_FULL_RANGE,
    'format=gbrap',
    'premultiply=inplace=1:planes=7',
    'setrange=pc',
    `scale=${output.width}:${output.height}:flags=lanczos`
      + ':in_range=pc:out_range=tv:out_color_matrix=bt709'
  ]
  /* Split, take the matte from luma on one branch, merge it back — then undo
     the premultiply. The colour has to leave here straight: a browser stores
     straight alpha and premultiplies as it composites, so handing it colour
     that is already multiplied applies the falloff twice and the glow comes
     out visibly darker and tighter than it was authored. */
  return `[0:v]${steps.join(',')},format=gbrp,split[colour][matte];`
    + '[matte]format=gray[alpha];'
    + '[colour][alpha]alphamerge,'
    + 'unpremultiply=inplace=1:planes=7,'
    + 'format=yuva420p[out]'
}

function buildAdditiveGraph(cropRect, output, source) {
  const cropped = cropRect.width === source.width && cropRect.height === source.height
    ? 'null'
    : `crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y}`

  /* Premultiply, then drop alpha entirely. What remains is the clip as it looks
     over black, which is precisely what an additive blend contributes. The
     matte is not lost so much as already applied. */
  const steps = [
    cropped,
    TO_FULL_RANGE,
    'format=gbrap',
    'premultiply=inplace=1:planes=7',
    'setrange=pc',
    `scale=${output.width}:${output.height}:flags=lanczos`
      + ':in_range=pc:out_range=tv:out_color_matrix=bt709',
    'format=yuv420p'
  ]
  return `[0:v]${steps.join(',')}[out]`
}

function buildPackedGraph(cropRect, output, source) {
  const cropped = cropRect.width === source.width && cropRect.height === source.height
    ? 'null'
    : `crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y}`

  /* The masters are limited-range YUV (black sits at 16) while their alpha
     plane is full-range 0-255. Neither ffmpeg's format filter nor the eventual
     browser decode reconciles that on its own, so both halves are moved
     explicitly:
       - color is expanded to full range before the multiply, because
         premultiplying a pedestalled black leaves a grey wash wherever the
         matte is empty, then compressed back on the way into the encoder;
       - the matte is squeezed 0-255 into 16-235 so the decoder's own
         limited-range expansion hands the shader back the values it started
         with. Skipping this crushes everything below alpha 6% to zero, which
         is precisely the soft falloff these clips are built from. */
  const toFullRange = 'scale=in_range=tv:out_range=pc'

  /* setrange states what the frame already holds so swscale performs exactly
     one range conversion. Without it the filter chain applies a second,
     invisible squeeze on the way into yuv420p — the matte lands at 28-140
     instead of 16-146 and every alpha value comes back about 12% low. */
  const toLimitedRange = [
    'setrange=pc',
    `scale=${output.width}:${output.height}:flags=lanczos:in_range=pc:out_range=tv`,
    'format=yuv420p'
  ].join(',')

  /* premultiply runs on planar RGB: the packed rgba layout silently produces
     garbage, and doing it in YUV would scale chroma around its 128 midpoint
     rather than towards black. planes=7 leaves the alpha plane itself alone. */
  return [
    `[0:v]${cropped},${toFullRange},format=gbrap,split=2[color][matte]`,
    `[color]premultiply=inplace=1:planes=7,${toLimitedRange}[top]`,
    `[matte]alphaextract,format=gray,${toLimitedRange}[bottom]`,
    '[top][bottom]vstack=inputs=2[out]'
  ].join(';')
}

function encodeArguments(filename, destination, filterGraph, source, options) {
  const common = [
    '-hide_banner', '-y',
    '-i', filename,
    '-an', '-sn', '-dn',
    '-filter_complex', filterGraph,
    '-map', '[out]'
  ]

  /* Tagged explicitly in both cases. An unsignalled matrix leaves the decoder
     guessing, and a guess that differs from the encoder's shifts hue as well as
     luma — it reads as a slightly wrong grade rather than an obvious fault. */
  const colorTags = [
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709'
  ]

  if (options.codec === 'vp9-alpha' || options.codec === 'vp9-luma-alpha') {
    return [
      ...common,
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      ...colorTags,
      /* VP9 quality is a different scale to x264's; 32 sits close to the
         packed clip's CRF 18 in measured fidelity. -b:v 0 is what makes crf
         behave as constant quality rather than a cap. */
      '-crf', '32',
      '-b:v', '0',
      '-row-mt', '1',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-g', String(Math.round(source.fps)),
      '-keyint_min', String(Math.round(source.fps)),
      '-r', String(source.fps),
      destination
    ]
  }

  return [
    ...common,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    ...colorTags,
    '-crf', String(options.crf),
    '-preset', options.preset,
    /* Keyframe every second keeps scrubbing responsive without inflating the
       file; these clips are short enough that nothing longer helps. */
    '-g', String(Math.round(source.fps)),
    '-r', String(source.fps),
    '-vsync', 'cfr',
    '-movflags', '+faststart',
    destination
  ]
}

function slugify(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_\s]+/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return { version: 1, clips: {} }
  }
}

function isCurrent(entry, sourceStat, options) {
  if (!entry || options.force) return false
  return entry.source?.bytes === sourceStat.size
    && entry.source?.modifiedAt === sourceStat.mtimeMs
    && entry.codec === options.codec
    && entry.encode?.crf === options.crf
    && entry.encode?.stageWidth === options.stageWidth
    && entry.encode?.oversample === options.oversample
}

async function packClip(filename, options, manifest) {
  const name = basename(filename)
  const id = slugify(name)
  const sourceStat = await stat(filename)
  const existing = manifest.clips[id]

  if (isCurrent(existing, sourceStat, options)) {
    console.log(`  ${name}: unchanged, skipping`)
    return existing
  }

  const source = await probe(filename)
  if (!source.hasAlpha) {
    throw new Error(`${name} is ${source.pixelFormat}, which carries no alpha channel`)
  }

  const bounds = options.crop ? await measureAlphaBounds(filename) : null
  const cropRect = planCrop(bounds ?? {}, source, options)
  const output = planOutputSize(cropRect, source, options)

  const lumaAlpha = options.codec === 'vp9-luma-alpha'
  const alphaWebm = options.codec === 'vp9-alpha' || lumaAlpha
  const additive = options.codec === 'h264-additive'
  const extension = alphaWebm ? 'webm' : 'mp4'
  /* The decoded frame the runtime receives: identical to the artwork when the
     alpha is a real channel or already applied, twice as tall only when the
     matte is stacked underneath. */
  const decoded = alphaWebm || additive
    ? output
    : { width: output.width, height: output.height * 2 }

  const coverage = ((cropRect.width * cropRect.height) / (source.width * source.height) * 100).toFixed(1)
  console.log(`  ${name}`)
  console.log(`    source  ${source.width}x${source.height} ${source.pixelFormat} @ ${source.fps}fps`)
  console.log(`    crop    ${cropRect.width}x${cropRect.height} at ${cropRect.x},${cropRect.y} (${coverage}% of frame)`)
  console.log(`    encode  ${options.codec}, decoded frame ${decoded.width}x${decoded.height}`)

  const destination = join(resolve(PROJECT_ROOT, options.out), `${id}.${extension}`)
  if (options.dryRun) {
    console.log('    dry run, not encoding')
    return existing ?? null
  }

  const buildGraph = lumaAlpha ? buildLumaAlphaGraph
    : alphaWebm ? buildAlphaWebmGraph
    : additive ? buildAdditiveGraph
    : buildPackedGraph
  const filterGraph = buildGraph(cropRect, output, source)
  await run('ffmpeg', encodeArguments(filename, destination, filterGraph, source, options))
  const encoded = await stat(destination)
  console.log(`    wrote   ${basename(destination)} (${(encoded.size / 1_000_000).toFixed(1)} MB)`)

  return {
    id,
    file: `${id}.${extension}`,
    bytes: encoded.size,
    /* How the runtime must read the frame. 'alpha-webm' needs nothing but a
       positioned <video>; 'additive' the same but blended as light rather than
       composited over; 'over-under' needs the unpacking shader. */
    layout: alphaWebm ? 'alpha-webm' : additive ? 'additive' : 'over-under',
    /* The CSS blend the layer expects. plus-lighter is true addition, which is
       what the design's "Add/Screen Mode" asks for; screen would compress the
       highlights and lose the sense of light stacking up. */
    blend: additive || lumaAlpha ? 'plus-lighter' : 'normal',
    codec: options.codec,
    /* The source frame is the composition everything was authored against;
       crop is expressed inside it so the runtime can restore the original
       placement from fractions alone. */
    frame: { width: source.width, height: source.height },
    crop: cropRect,
    color: output,
    decoded,
    /* Packed colour is premultiplied because the shader wants it that way; a
       real alpha channel must stay straight because the browser composites
       source-over and would otherwise darken every soft edge. */
    premultiplied: !alphaWebm,
    fps: source.fps,
    duration: source.duration,
    source: {
      name,
      bytes: sourceStat.size,
      modifiedAt: sourceStat.mtimeMs,
      pixelFormat: source.pixelFormat
    },
    encode: {
      crf: options.crf,
      preset: options.preset,
      stageWidth: options.stageWidth,
      oversample: options.oversample
    }
  }
}

async function collectSources(options) {
  if (options.only && SOURCE_EXTENSIONS.has(extname(options.only).toLowerCase())) {
    return [resolve(options.only)]
  }
  if (!options.source) throw new Error('--source <dir> is required')
  const entries = await readdir(options.source, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .filter(entry => !options.only || entry.name.startsWith(options.only))
    .map(entry => join(options.source, entry.name))
    .sort()
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const outDirectory = resolve(PROJECT_ROOT, options.out)
  const manifestPath = join(outDirectory, 'manifest.json')

  const sources = await collectSources(options)
  if (!sources.length) throw new Error('No alpha masters matched')

  if (!options.dryRun) await mkdir(outDirectory, { recursive: true })
  const manifest = await readManifest(manifestPath)
  manifest.version = 1
  /* Layout is per clip now: a manifest can legitimately hold both encodings
     while the kiosk GPU is still an unknown. */
  delete manifest.layout

  console.log(`Packing ${sources.length} master${sources.length === 1 ? '' : 's'} as ${options.codec} into ${options.out}`)
  for (const filename of sources) {
    const entry = await packClip(filename, options, manifest)
    if (entry) manifest.clips[entry.id] = entry
  }

  if (options.dryRun) return
  const ordered = Object.fromEntries(Object.entries(manifest.clips).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, clips: ordered }, null, 2)}\n`, 'utf8')
  console.log(`Manifest written: ${manifestPath}`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

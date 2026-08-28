/**
 * Prepares the delivered clips that play inside explainer panels — the material
 * insets in Building a topoconductor, and the animated graphs in Interference.
 *
 * Two things the masters need before they can loop in a panel.
 *
 * Some are one-shot animations rather than loops. The material insets end 9-11
 * dB away from where they started, so playing them on `loop` jumps once a
 * cycle. Those get a circular crossfade — the same trick the module 03 audio
 * loops use, described in docs/ASSET-PRODUCTION-NOTES.md — dissolving the tail
 * into the head and dropping the frames it consumes:
 *
 *     output = frames[F .. N-F)  ++  crossfade(frames[N-F .. N), frames[0 .. F))
 *
 * The graphs do not need it: each animation begins and ends on an empty axis,
 * so it already returns to its own first frame. Forcing a crossfade onto those
 * would dissolve one drawn wave into another for no reason, which is why
 * `crossfade: 0` is a per-clip setting rather than a global default.
 *
 * Some masters also hold more than one panel's worth of animation. The
 * interference graph draws the constructive wave, clears, then draws the
 * destructive one, but the lesson shows those as two separate panels — so a
 * clip can name a frame range and be cut into its parts. The cut lands on the
 * blank frame between them, which is what leaves both halves looping cleanly.
 *
 * Every master arrives with a silent AAC track, which is dropped.
 *
 * Usage:
 *   node scripts/prepare-panel-video.mjs --source "G:/Github/videofiles"
 *   node scripts/prepare-panel-video.mjs --source ... --only interference
 */

import { spawn } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')

const INTERFERENCE_GRAPH = 'IQM_Mod01c_Graph_Interference-Waves.mp4'
const TOOLTIPS = 'public/assets/modules/differences/interference-tooltips'
const MATERIALS = 'public/assets/modules/qubit-explorer'

/* `crossfade` is seconds, 0 for clips that already return to their first frame.
   `range` is [startFrame, endFrame) against the master, for masters holding
   more than one panel's animation. */
const CLIPS = Object.freeze([
  {
    source: 'Superconductor_Inset_v1.mp4',
    out: `${MATERIALS}/superconductor-inset.mp4`,
    crossfade: 0.6
  },
  {
    source: 'Semiconductor_Inset_v1.mp4',
    out: `${MATERIALS}/semiconductor-inset.mp4`,
    crossfade: 0.6
  },
  {
    source: 'IQM_Mod01c_Graph_Waves-of-Probability_V2.mp4',
    out: `${TOOLTIPS}/wave-probability.webm`,
    crossfade: 0,
    whiteToAlpha: true
  },
  /* The master draws the constructive wave, clears on frame 90, then draws the
     destructive one. Cutting on that blank frame gives two panels that each
     start and end empty. */
  {
    source: INTERFERENCE_GRAPH,
    out: `${TOOLTIPS}/constructive-interference.webm`,
    crossfade: 0,
    range: [0, 91],
    whiteToAlpha: true
  },
  {
    source: INTERFERENCE_GRAPH,
    out: `${TOOLTIPS}/destructive-interference.webm`,
    crossfade: 0,
    range: [91, 183],
    whiteToAlpha: true
  }
])

const DEFAULTS = Object.freeze({
  /* Panel media slots are 760-808 design px wide and the masters are 1440,
     nearly twice what any slot shows. 1024 keeps a margin for a denser panel
     without paying for pixels nobody sees. */
  width: 1024,
  crf: 20
})

function parseArguments(argv) {
  const options = { ...DEFAULTS, source: null, only: null }
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
      case '--only': options.only = value(); break
      case '--width': options.width = Number(value()); break
      case '--crf': options.crf = Number(value()); break
      default: throw new Error(`Unknown flag: ${flag}`)
    }
  }
  if (!options.source) throw new Error('--source <dir> is required')
  return options
}

function run(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('ffmpeg', args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', code => code === 0
      ? resolvePromise(stderr)
      : rejectPromise(new Error(stderr.split('\n').slice(-20).join('\n'))))
  })
}

async function probe(filename) {
  /* Decoding to null is the dependable way to get an exact frame count: the
     container's metadata can disagree with what actually decodes, and the
     crossfade and range arithmetic below are wrong by a frame if it does. */
  const output = await run(['-hide_banner', '-i', filename, '-map', '0:v', '-c', 'copy', '-f', 'null', '-'])
  const frames = Number(output.match(/frame=\s*(\d+)/g)?.pop()?.match(/(\d+)/)?.[1])
  if (!Number.isFinite(frames) || frames <= 0) throw new Error(`Could not count frames in ${basename(filename)}`)

  const info = await run(['-hide_banner', '-i', filename]).catch(error => error.message)
  const stream = info.split('\n').find(line => /Stream #\d+:\d+.*: Video:/.test(line)) ?? ''
  const size = stream.match(/, (\d{2,5})x(\d{2,5})[ ,]/)
  const rate = stream.match(/([\d.]+) fps/)
  return {
    frames,
    width: Number(size?.[1]),
    height: Number(size?.[2]),
    fps: rate ? Number(rate[1]) : 25
  }
}

function outputHeight(source, width) {
  return Math.round((width * source.height) / source.width / 2) * 2
}

function trimGraph(clip, source, width) {
  const [start, end] = clip.range ?? [0, source.frames]
  const scale = `scale=${width}:${outputHeight(source, width)}:flags=lanczos`
  const trim = clip.range
    ? `trim=start_frame=${start}:end_frame=${end},setpts=PTS-STARTPTS,`
    : ''
  if (!clip.whiteToAlpha) return `[0:v]${trim}${scale}[out]`

  /* The graphs are drawn on solid white, and the panel they sit in is a 24%
     white glass with a backdrop-filter. That filter makes the panel a backdrop
     root, so a mix-blend-mode on the clip can only blend against the panel's own
     background — which is almost entirely transparent. Multiplying into nothing
     returns the source, so the white stayed put and the clip read as a white
     card pasted on the glass.

     So the white is turned into real transparency here instead. The least of
     the three channels is how close a pixel is to white; inverting it gives the
     coverage. A white pixel drops out completely, a dark stroke stays solid,
     and the tinted fills keep their hue at partial coverage. */
  return [
    `[0:v]${trim}${scale},format=gbrp,split=2[colour][key]`,
    '[key]extractplanes=g+b+r[kg][kb][kr]',
    '[kg][kb]blend=all_mode=darken[kgb]',
    '[kgb][kr]blend=all_mode=darken,negate,format=gray[alpha]',
    '[colour][alpha]alphamerge,format=yuva420p[out]'
  ].join(';')
}

function crossfadeGraph(clip, source, fadeFrames, width) {
  const [start, end] = clip.range ?? [0, source.frames]
  const frames = end - start
  const bodyEnd = frames - fadeFrames
  const scale = `scale=${width}:${outputHeight(source, width)}:flags=lanczos`
  const window = clip.range
    ? `trim=start_frame=${start}:end_frame=${end},setpts=PTS-STARTPTS,`
    : ''

  /* blend's own `N` is the output frame index, which drives the ramp. Dividing
     by fadeFrames - 1 makes the last blended frame land exactly on the head, so
     the restart is a continuation rather than a step. */
  const ramp = `A*(1-N/${fadeFrames - 1})+B*(N/${fadeFrames - 1})`

  return [
    `[0:v]${window}${scale},split=3[s1][s2][s3]`,
    `[s1]trim=start_frame=${fadeFrames}:end_frame=${bodyEnd},setpts=PTS-STARTPTS[body]`,
    `[s2]trim=start_frame=${bodyEnd}:end_frame=${frames},setpts=PTS-STARTPTS[tail]`,
    `[s3]trim=start_frame=0:end_frame=${fadeFrames},setpts=PTS-STARTPTS[head]`,
    `[tail][head]blend=all_expr='${ramp}'[mixed]`,
    '[body][mixed]concat=n=2:v=1:a=0[out]'
  ].join(';')
}

async function prepare(clip, options) {
  const master = join(options.source, clip.source)
  const destination = join(PROJECT_ROOT, clip.out)
  await mkdir(dirname(destination), { recursive: true })
  const source = await probe(master)

  const [start, end] = clip.range ?? [0, source.frames]
  const available = end - start
  const fadeFrames = clip.crossfade > 0
    ? Math.max(2, Math.round(clip.crossfade * source.fps))
    : 0
  if (fadeFrames * 2 >= available) {
    throw new Error(`${clip.source}: a ${clip.crossfade}s crossfade needs more than ${available} frames`)
  }

  console.log(`  ${basename(clip.out)}`)
  console.log(`    from    ${clip.source} ${source.width}x${source.height} @ ${source.fps}fps, ${source.frames} frames`)
  if (clip.range) console.log(`    range   frames ${start}-${end - 1}`)
  console.log(fadeFrames
    ? `    loop    ${fadeFrames}-frame crossfade, ${available - fadeFrames} frames out`
    : `    loop    already returns to its first frame, ${available} frames out`)

  const colorTags = [
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709'
  ]

  /* A real alpha channel means VP9 in WebM: it is the only encoding a plain
     <video> composites with transparency, and it needs no shader to unpack. */
  const codec = clip.whiteToAlpha
    ? [
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
        '-crf', '30', '-b:v', '0', '-row-mt', '1',
        '-deadline', 'good', '-cpu-used', '2'
      ]
    : [
        '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
        '-crf', String(options.crf), '-preset', 'slow',
        '-movflags', '+faststart'
      ]

  await run([
    '-hide_banner', '-y',
    '-i', master,
    '-an', '-sn', '-dn',
    '-filter_complex', fadeFrames
      ? crossfadeGraph(clip, source, fadeFrames, options.width)
      : trimGraph(clip, source, options.width),
    '-map', '[out]',
    ...codec,
    ...colorTags,
    '-g', String(Math.round(source.fps)),
    '-r', String(source.fps),
    destination
  ])

  const encoded = await stat(destination)
  console.log(`    wrote   ${(encoded.size / 1_000_000).toFixed(1)} MB`)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const wanted = CLIPS.filter(clip => !options.only
    || clip.out.includes(options.only)
    || clip.source.toLowerCase().includes(options.only.toLowerCase()))
  if (!wanted.length) throw new Error('No clips matched')

  console.log(`Preparing ${wanted.length} panel clip${wanted.length === 1 ? '' : 's'}`)
  for (const clip of wanted) await prepare(clip, options)
  console.log('Done.')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

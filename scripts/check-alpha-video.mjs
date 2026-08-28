/**
 * Verifies the packed and alpha-WebM clips against the masters they came from.
 *
 * A packed clip can look plausible and still be wrong: the color half and the
 * matte half travel through separate range conversions, and a stray one leaves
 * every alpha value low by a fixed percentage. That reads as a slightly thin
 * effect rather than an obvious fault, so it needs measuring rather than
 * eyeballing.
 *
 * Both sides are composited over mid-grey before comparison. Comparing the
 * halves separately would let a matte error hide behind a black background,
 * whereas grey makes an alpha shift show up as a brightness shift everywhere
 * the effect is semi-transparent — which is where these clips live.
 *
 * Usage:
 *   node scripts/check-alpha-video.mjs --source "G:/Github/videofiles"
 *   node scripts/check-alpha-video.mjs --source ... --min-psnr 45
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')

/* This deliberately rebuilds the reference from the master rather than reusing
   the packer's own graph, so a mistake in that graph cannot pass by being
   present on both sides. The price is that benign rounding differences between
   the two chains put a correct bake well below the codec's own fidelity:
   measured against the packed frame the encoder actually produced, loss is
   50-58 dB, but this end-to-end comparison lands at 38.5-52 dB depending on how
   much soft edge the clip carries.

   A genuine pipeline fault is nowhere near that band. The range regression this
   check exists to catch — every alpha value about 12% low — scored 29.7 dB on a
   clip that otherwise measures 52. 35 dB sits in the gap. */
const DEFAULT_MIN_PSNR = 35

function parseArguments(argv) {
  const options = { source: null, packed: 'public/assets/video-fx', minPsnr: DEFAULT_MIN_PSNR, only: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
      index += 1
      return value
    }
    switch (flag) {
      case '--source': options.source = next(); break
      case '--packed': options.packed = next(); break
      case '--min-psnr': options.minPsnr = Number(next()); break
      case '--only': options.only = next(); break
      default: throw new Error(`Unknown flag: ${flag}`)
    }
  }
  if (!options.source) throw new Error('--source <dir> is required')
  return options
}

function runFfmpeg(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('ffmpeg', args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', code => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.split('\n').slice(-20).join('\n')))
        return
      }
      resolvePromise(stderr)
    })
  })
}

const OVER_GREY = "blend=all_expr='A+128*(1-B/255)'"

function comparisonGraph(clip) {
  const { crop, color } = clip
  const resize = `scale=${color.width}:${color.height}:flags=lanczos`

  /* A real alpha channel needs no unpacking: ffmpeg composites the decoded
     clip the same way the browser will, and the reference is built from the
     master with straight alpha to match how it was encoded. */
  if ((clip.layout ?? 'over-under') === 'alpha-webm') {
    return [
      `[0:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},`
        + 'scale=in_range=tv:out_range=pc,setrange=pc,format=gbrap,split=2[refColor][refMatte]',
      `[refMatte]alphaextract,format=gray,${resize},format=gbrp[refAlpha]`,
      `[refColor]premultiply=inplace=1:planes=7,${resize},format=gbrp[refPremultiplied]`,
      `[refPremultiplied][refAlpha]${OVER_GREY}[reference]`,
      /* The decoded clip is limited-range YUV, so it needs the same expansion
         the reference gets. Without it the colour sits on a pedestal and the
         comparison reads as a 12dB loss that is entirely the checker's own. */
      '[1:v]setrange=tv,scale=in_range=tv:out_range=pc,setrange=pc,format=gbrap,split=2[resColorSrc][resMatte]',
      '[resMatte]alphaextract,format=gray,format=gbrp[resAlpha]',
      '[resColorSrc]premultiply=inplace=1:planes=7,format=gbrp[resPremultiplied]',
      `[resPremultiplied][resAlpha]${OVER_GREY}[result]`,
      '[reference][result]psnr'
    ].join(';')
  }

  /* Mirrors the encoder's own graph up to the point of encoding, so a change
     there that this does not track shows up as a failure rather than passing
     silently against a stale expectation. */
  const reference = [
    `[0:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},`
      + 'scale=in_range=tv:out_range=pc,format=gbrap,split=2[refColor][refMatte]',
    `[refMatte]alphaextract,format=gray,${resize},format=gbrp[refAlpha]`,
    `[refColor]premultiply=inplace=1:planes=7,${resize},format=gbrp[refPremultiplied]`,
    `[refPremultiplied][refAlpha]${OVER_GREY}[reference]`
  ]

  /* setrange states what the decoder hands over, so the expansion back to full
     range happens exactly once — the same single conversion a browser performs
     on its way to RGB. */
  const result = [
    '[1:v]setrange=tv,scale=in_range=tv:out_range=pc,format=gbrp,split=2[packedTop][packedBottom]',
    `[packedTop]crop=${color.width}:${color.height}:0:0[resColor]`,
    `[packedBottom]crop=${color.width}:${color.height}:0:${color.height}[resAlpha]`,
    `[resColor][resAlpha]${OVER_GREY}[result]`
  ]

  if (clip.decoded.height !== color.height * 2) {
    throw new Error(`${clip.id}: decoded height ${clip.decoded.height} is not twice the color height, so the halves cannot be where the shader expects`)
  }

  return [...reference, ...result, '[reference][result]psnr'].join(';')
}

async function checkClip(clip, options) {
  const master = join(options.source, clip.source.name)
  const encodedFile = join(resolve(PROJECT_ROOT, options.packed), clip.file)

  /* ffmpeg's native VP9 decoder ignores the WebM alpha channel and hands back
     an opaque frame, so a check run through it would compare against a fully
     opaque clip and pass no matter how wrong the matte was. libvpx-vp9 reads
     it. Worth knowing beyond this script: most offline tooling has the same
     blind spot, which makes alpha WebM harder to inspect than a packed frame. */
  const decoder = clip.file.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : []

  const output = await runFfmpeg([
    '-hide_banner',
    '-i', master,
    ...decoder, '-i', encodedFile,
    '-filter_complex', comparisonGraph(clip),
    '-an', '-f', 'null', '-'
  ])

  const match = output.match(/PSNR .*?average:([\d.inf]+) min:([\d.inf]+)/)
  if (!match) throw new Error(`${clip.id}: ffmpeg reported no PSNR`)

  const average = Number(match[1])
  const minimum = Number(match[2])
  const passed = Number.isFinite(average) ? average >= options.minPsnr : true

  return { id: clip.id, average, minimum, passed }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const manifestPath = join(resolve(PROJECT_ROOT, options.packed), 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  const clips = Object.values(manifest.clips)
    .filter(clip => !options.only || clip.id.includes(options.only))
  if (!clips.length) throw new Error('No clips in the manifest matched')

  const failures = []
  console.log(`Checking ${clips.length} clip${clips.length === 1 ? '' : 's'} against their masters`)

  for (const clip of clips) {
    const result = await checkClip(clip, options)
    const verdict = result.passed ? 'ok' : 'FAILED'
    console.log(`  ${result.id}: PSNR avg ${result.average.toFixed(1)} dB, min ${result.minimum.toFixed(1)} dB — ${verdict}`)
    if (!result.passed) {
      failures.push(`${result.id}: ${result.average.toFixed(1)} dB is below the ${options.minPsnr} dB floor`)
    }
  }

  if (failures.length) {
    throw new Error(`Packed alpha video validation failed:\n${failures.map(line => `- ${line}`).join('\n')}`)
  }
  console.log('All clips match their masters.')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

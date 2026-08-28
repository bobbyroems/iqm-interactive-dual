/**
 * Bakes a still RGBA plate into the video-fx set.
 *
 * Some passes in the Protecting quantum information stack do not move — the
 * base device, the plate over Particles A, the "H" bar that appears during the
 * electricity reveal. They arrive as 4096² PNGs from the same composition the
 * clips were authored in, so they belong in the same manifest and want the same
 * treatment: crop to the alpha bounding box, record where that box sat, and let
 * the layer place itself from the crop rather than from a hand-measured offset.
 *
 * Cropping is most of the win. These plates are mostly empty: the base device
 * occupies about a fifth of its square.
 *
 *   node scripts/pack-still-plate.mjs <file.png> [more.png ...]
 */

import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const OUTPUT_DIRECTORY = path.resolve('public/assets/video-fx')
const MANIFEST_PATH = path.join(OUTPUT_DIRECTORY, 'manifest.json')

/* Alpha below this is treated as empty when finding the bounding box. Matching
   the clip packer so a still and a clip from the same composition crop to
   comparable edges. */
const ALPHA_FLOOR = 8

/* Lossless. These are foundation plates — the base device sits under every
   other pass — and lossy WebP costs about 2 MB apiece to avoid banding in the
   soft glow gradients and a halo where the matte softens. On a kiosk that
   already ships its clips locally that is not a trade worth making. */
const WEBP_COMPRESSION_LEVEL = 6

function slugOf(filename) {
  return path
    .basename(filename, path.extname(filename))
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

/* `probing` because ffmpeg reports stream facts on stderr and then exits
   non-zero, so for those calls stderr is the result rather than the failure.
   An encode that fails must still throw — swallowing it leaves a missing file
   to be discovered later, somewhere less obvious. */
async function ffmpeg(args, { probing = false } = {}) {
  try {
    const { stderr } = await execFileAsync('ffmpeg', ['-hide_banner', ...args], {
      maxBuffer: 1024 * 1024 * 64
    })
    return stderr
  } catch (error) {
    if (probing && error.stderr) return error.stderr
    throw new Error(`ffmpeg failed: ${error.stderr?.trim().slice(-200) ?? error.message}`)
  }
}

async function probe(filename) {
  const output = await ffmpeg(['-i', filename], { probing: true })
  const match = output.match(/Stream #\d+:\d+.*?:\s*Video:.*?,\s*(\w+).*?,\s*(\d+)x(\d+)/)
  if (!match) throw new Error(`Could not read stream facts from ${filename}`)
  return { pixelFormat: match[1], width: Number(match[2]), height: Number(match[3]) }
}

async function alphaBoundingBox(filename) {
  const output = await ffmpeg([
    '-i', filename,
    '-vf', `alphaextract,bbox=min_val=${ALPHA_FLOOR}`,
    '-f', 'null', '-'
  ], { probing: true })
  const match = output.match(/x1:(\d+)\s+x2:(\d+)\s+y1:(\d+)\s+y2:(\d+)/)
  if (!match) throw new Error(`${filename} has no visible alpha`)
  const [, x1, x2, y1, y2] = match.map(Number)
  return { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 }
}

async function packPlate(filename) {
  const id = slugOf(filename)
  const source = await stat(filename)
  const frame = await probe(filename)

  if (!frame.pixelFormat.includes('a')) {
    throw new Error(`${filename} carries no alpha channel (${frame.pixelFormat})`)
  }

  const crop = await alphaBoundingBox(filename)
  const outputName = `${id}.webp`
  const destination = path.join(OUTPUT_DIRECTORY, outputName)

  await ffmpeg([
    '-y',
    '-i', filename,
    '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
    '-c:v', 'libwebp',
    '-lossless', '1',
    '-compression_level', String(WEBP_COMPRESSION_LEVEL),
    destination
  ])

  const baked = await stat(destination)
  const saved = 1 - baked.size / source.size

  return {
    entry: {
      id,
      file: outputName,
      bytes: baked.size,
      layout: 'still',
      frame: { width: frame.width, height: frame.height },
      crop,
      source: {
        name: path.basename(filename),
        bytes: source.size,
        modifiedAt: source.mtimeMs,
        pixelFormat: frame.pixelFormat
      },
      encode: { codec: 'libwebp', lossless: true, compressionLevel: WEBP_COMPRESSION_LEVEL }
    },
    saved
  }
}

async function main() {
  const inputs = process.argv.slice(2)
  if (!inputs.length) {
    console.error('usage: node scripts/pack-still-plate.mjs <file.png> [more.png ...]')
    process.exitCode = 1
    return
  }

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))

  for (const input of inputs) {
    const { entry, saved } = await packPlate(input)
    manifest.clips[entry.id] = entry
    const megabytes = (entry.bytes / 1024 / 1024).toFixed(2)
    console.log(
      `${entry.id.padEnd(28)} ${String(entry.crop.width).padStart(4)}x${String(entry.crop.height).padEnd(4)}`
      + ` @ ${entry.crop.x},${entry.crop.y}   ${megabytes} MB   ${(saved * 100).toFixed(1)}% smaller`
    )
  }

  /* Sorted so the file stays reviewable as clips come and go. */
  manifest.clips = Object.fromEntries(
    Object.entries(manifest.clips).sort(([a], [b]) => a.localeCompare(b))
  )
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`\nmanifest updated: ${Object.keys(manifest.clips).length} clips`)
}

await main()

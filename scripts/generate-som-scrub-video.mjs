/**
 * Re-encodes the States of Matter footage as an all-intra (every-frame-keyframe)
 * H.264 file.
 *
 * The module is a scrubber, not a player: it never plays the clip forward, it
 * seeks to an arbitrary frame on every pointer move. A normal delivery encode
 * puts a keyframe every 30 frames, so landing on frame 117 means decoding
 * frames 90-117 first — measured at ~97ms per seek on the 4K source, which caps
 * the scrub near 10fps no matter how fast the finger moves. Giving every frame
 * its own keyframe removes the dependency chain: ~14ms per seek, inside a 60Hz
 * frame budget.
 *
 * Resolution is deliberately unchanged. A 1440x2560 downscale measured no faster
 * than full 4K — once the GOP is gone the pixel count is not the bottleneck — so
 * there is nothing to buy by giving up sharpness on a 4K portrait panel.
 *
 * Requires ffmpeg and ffprobe on PATH. The script is idempotent: footage that is
 * already all-intra is left alone, so re-running it cannot stack generation loss.
 * Run it whenever new footage is delivered:
 *   npm run generate:som-scrub-video -- <path-to-delivered-master.mp4>
 */
import { spawn } from 'node:child_process'
import { rename, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUTPUT = resolve(
  import.meta.dirname,
  '../public/assets/modules/states-of-matter/SoM_IceCube_4k_vertical.mp4'
)

/* CRF 20 measured SSIM 0.9986 / PSNR 57.5dB against the delivered master —
   visually lossless, and it keeps the all-intra file near the source's size.
   CRF 18 gains nothing visible and costs another 23MB of Git LFS. */
const CRF = '20'

function run(command, args, { capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit']
    })
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise(output)
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function countFrames(path) {
  const [total, keyframes] = await Promise.all([
    run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-count_frames', '-show_entries', 'stream=nb_read_frames',
      '-of', 'csv=p=0', path
    ], { capture: true }),
    run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time',
      '-of', 'csv=p=0', path
    ], { capture: true })
  ])

  return {
    total: Number(total.trim()),
    keyframes: keyframes.trim().split('\n').filter(Boolean).length
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const megabytes = bytes => `${(bytes / 1_000_000).toFixed(1)}MB`

async function main() {
  const [sourceArgument] = process.argv.slice(2)
  const source = sourceArgument ? resolve(sourceArgument) : OUTPUT
  if (!(await exists(source))) throw new Error(`Source footage not found: ${source}`)

  const before = await countFrames(source)
  console.log(`Source: ${before.total} frames, ${before.keyframes} keyframes`)

  if (source === OUTPUT && before.keyframes === before.total) {
    console.log('Already all-intra; nothing to do.')
    return
  }

  const temporary = `${OUTPUT}.tmp.mp4`
  await run('ffmpeg', [
    '-y', '-v', 'error',
    '-i', source,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', CRF,
    /* Every frame a keyframe. -sc_threshold 0 stops x264 from also inserting
       scene-cut keyframes, which would leave the GOP structure uneven. */
    '-g', '1',
    '-keyint_min', '1',
    '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    temporary
  ])

  const after = await countFrames(temporary)
  if (after.keyframes !== after.total) {
    await unlink(temporary).catch(() => {})
    throw new Error(`Encode is not all-intra: ${after.keyframes}/${after.total} keyframes`)
  }

  const sourceSize = (await stat(source)).size
  const outputSize = (await stat(temporary)).size
  await unlink(OUTPUT).catch(() => {})
  await rename(temporary, OUTPUT)
  console.log(
    `Encoded all-intra scrub master: ${after.total} frames, ` +
    `${megabytes(sourceSize)} -> ${megabytes(outputSize)}`
  )
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

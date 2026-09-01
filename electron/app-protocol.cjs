const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')

const APP_PROTOCOL_SCHEME = 'iqm-app'
const APP_PROTOCOL_HOST = 'bundle'
const APP_PROTOCOL_PRIVILEGES = Object.freeze({
  codeCache: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true
})

/* Serving the bundle through `net.fetch` on a file:// URL looked like it
   worked, because everything that only ever reads a response from start to end
   does work. It answered with two headers and nothing else: no
   `content-length`, no `accept-ranges`, and a `Range` request came back 200
   rather than 206 with a `content-range`.

   Those three are how Chromium's media pipeline decides a video is seekable.
   Missing them, it marked SoM_IceCube_4k_vertical.mp4 unseekable —
   `video.seekable` ended at 0 — and clamped every seek to the first frame.
   States of Matter scrubs by assigning `currentTime` and waiting for `seeked`
   (see states-of-matter/media.js), and `seeked` still fires on a clamped seek,
   so the scrub queue kept committing frames while the element sat on frame 0.
   The module read as frozen rather than broken, which is why it looked
   intermittent for so long.

   So the bundle is served from here instead, with the headers a seekable
   resource owes the caller. */

/* `net.fetch` was also picking the content type. Doing it by hand means every
   extension that ships in dist/ has to be listed — a missing entry serves the
   renderer's own module graph as octet-stream and the app does not boot.
   Extensions are matched lowercased: some delivered meshes and textures arrive
   with upper-case ones. */
const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.exr': 'image/x-exr',
  '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'image/vnd.radiance',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mtl': 'text/plain; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
})

/* Windows hands back these when something else holds the file open, which on
   the event PC means the on-access virus scanner reading a freshly installed
   asset. The old handler let that reject straight through `protocol.handle`,
   where it reached the renderer as `TypeError: Failed to fetch` and killed the
   module for the rest of the session — the biggest files in the bundle are the
   ones a scanner holds longest, which is why Protecting Quantum Information and
   Build a Majorana were the two that failed to load. A scan lock clears in
   milliseconds, so it is worth waiting out rather than surfacing. */
const TRANSIENT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN', 'EMFILE', 'ENFILE'])
const RETRY_DELAYS_MS = Object.freeze([25, 75, 200])

function createAppUrl(relativePath = 'index.html') {
  const normalizedPath = String(relativePath)
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
  const encodedPath = normalizedPath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `${APP_PROTOCOL_SCHEME}://${APP_PROTOCOL_HOST}/${encodedPath}`
}

function resolveAppRequestPath(requestUrl, rendererRoot) {
  let request
  try {
    request = new URL(requestUrl)
  } catch {
    return null
  }

  if (
    request.protocol !== `${APP_PROTOCOL_SCHEME}:` ||
    request.hostname !== APP_PROTOCOL_HOST
  ) {
    return null
  }

  let decodedPath
  try {
    decodedPath = decodeURIComponent(request.pathname)
  } catch {
    return null
  }

  const relativePath = decodedPath.replace(/^[/\\]+/, '') || 'index.html'
  const absoluteRoot = path.resolve(rendererRoot)
  const absolutePath = path.resolve(absoluteRoot, relativePath)
  const pathFromRoot = path.relative(absoluteRoot, absolutePath)
  const escapesRoot = (
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(pathFromRoot)
  )

  return escapesRoot ? null : absolutePath
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Stats the file, waiting out a scanner's lock before giving up on it. */
async function statWithRetry(filePath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fsp.stat(filePath)
    } catch (error) {
      const retryable = TRANSIENT_ERROR_CODES.has(error.code) && attempt < RETRY_DELAYS_MS.length
      if (!retryable) throw error
      await wait(RETRY_DELAYS_MS[attempt])
    }
  }
}

/**
 * Parses a `Range` header against a known size, as a half-open `[start, end]`
 * pair of byte offsets.
 *
 * Returns `null` when there is nothing to honour and the whole file should be
 * sent, and `'unsatisfiable'` when the caller asked for bytes past the end.
 * Multi-range requests fall into the `null` case on purpose: no media element
 * or loader in the app sends one, and answering a multipart body would be more
 * surface than it is worth.
 */
function parseRangeHeader(headerValue, size) {
  if (!headerValue) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(headerValue.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  /* `bytes=-500` is the last 500 bytes, not a range starting at -500. MP4
     playback leans on it to find an moov atom parked at the end of the file. */
  if (rawStart === '') {
    const suffixLength = Number(rawEnd)
    if (suffixLength <= 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}

function bodyFor(filePath, method, range) {
  if (method === 'HEAD') return null

  /* Streaming rather than reading into a buffer keeps the 42 MB ice-cube master
     out of the main process's heap, and matters more now that seeking works:
     the renderer opens a fresh short-lived range request per scrub. Cancelling
     the web stream destroys the fs stream under it, so an abandoned seek closes
     its descriptor instead of leaking one. */
  return Readable.toWeb(fs.createReadStream(filePath, range ? { start: range.start, end: range.end } : {}))
}

function createAppProtocolHandler({ rendererRoot }) {
  if (!rendererRoot) throw new TypeError('A rendererRoot is required for the app protocol')

  return async request => {
    const filePath = resolveAppRequestPath(request.url, rendererRoot)
    if (!filePath) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }

    let stats
    try {
      stats = await statWithRetry(filePath)
      if (!stats.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' })
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        console.error(`[protocol] ${path.basename(filePath)} could not be read: ${error.code || error.message}`)
      }
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }

    const size = stats.size
    const headers = {
      'accept-ranges': 'bytes',
      'content-type': contentTypeFor(filePath),
      'last-modified': stats.mtime.toUTCString()
    }

    const range = parseRangeHeader(request.headers.get('range'), size)
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${size}` }
      })
    }

    const method = request.method === 'HEAD' ? 'HEAD' : 'GET'

    try {
      if (range) {
        return new Response(bodyFor(filePath, method, range), {
          status: 206,
          headers: {
            ...headers,
            'content-length': String(range.end - range.start + 1),
            'content-range': `bytes ${range.start}-${range.end}/${size}`
          }
        })
      }

      return new Response(bodyFor(filePath, method, null), {
        status: 200,
        headers: { ...headers, 'content-length': String(size) }
      })
    } catch (error) {
      console.error(`[protocol] ${path.basename(filePath)} could not be opened: ${error.code || error.message}`)
      return new Response('Unavailable', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
  }
}

module.exports = {
  APP_PROTOCOL_HOST,
  APP_PROTOCOL_PRIVILEGES,
  APP_PROTOCOL_SCHEME,
  createAppProtocolHandler,
  createAppUrl,
  parseRangeHeader,
  resolveAppRequestPath
}

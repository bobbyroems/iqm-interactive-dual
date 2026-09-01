/**
 * Serves the built renderer for a browser, with byte ranges.
 *
 * Ranges are the point of this rather than reaching for any static server that
 * happens to be installed: without them a <video> cannot seek, which is the
 * exact failure the app protocol was fixed for. A server that answers a range
 * with the whole file and a 200 makes States of Matter look broken in the
 * browser while it is fine in the app.
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(process.argv[2] ?? 'dist')
const PORT = Number(process.argv[3] ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary',
  '.obj': 'text/plain; charset=utf-8', '.mtl': 'text/plain; charset=utf-8',
  '.fbx': 'application/octet-stream', '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr'
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const decoded = normalize(decodeURIComponent(url.pathname))
  /* Strip leading separators without a literal backslash in a regex; normalize()
     turns the URL's slashes into this platform's separator. */
  let relative = decoded
  while (relative.startsWith('/') || relative.startsWith(String.fromCharCode(92))) {
    relative = relative.slice(1)
  }
  const filePath = join(ROOT, relative === '' ? 'index.html' : relative)
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden')
    return
  }

  let stats
  try {
    stats = statSync(filePath)
    if (!stats.isFile()) throw new Error('not a file')
  } catch {
    response.writeHead(404).end('Not found')
    return
  }

  const type = TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), stats.size - 1) : stats.size - 1
    if (start >= stats.size || start > end) {
      response.writeHead(416, { 'content-range': `bytes */${stats.size}` }).end()
      return
    }
    response.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${stats.size}`,
      'accept-ranges': 'bytes'
    })
    createReadStream(filePath, { start, end }).pipe(response)
    return
  }

  response.writeHead(200, {
    'content-type': type,
    'content-length': stats.size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache'
  })
  createReadStream(filePath).pipe(response)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Serving ${ROOT} at http://127.0.0.1:${PORT}/`)
})

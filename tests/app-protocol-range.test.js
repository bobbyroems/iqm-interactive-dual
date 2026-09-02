import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { parseRangeHeader, resolveAppRequestPath } = require('../electron/app-protocol.cjs')

/* These offsets are what makes a video seekable. Serving the bundle without
   them pinned States of Matter to its first frame: `video.seekable` ended at 0,
   so every scrub seek was clamped back to zero while `seeked` still fired. */

test('a bounded range keeps both offsets', () => {
  assert.deepEqual(parseRangeHeader('bytes=0-1023', 4096), { start: 0, end: 1023 })
  assert.deepEqual(parseRangeHeader('bytes=100-199', 4096), { start: 100, end: 199 })
})

test('an open-ended range runs to the last byte', () => {
  assert.deepEqual(parseRangeHeader('bytes=4000-', 4096), { start: 4000, end: 4095 })
})

test('a range past the end is clamped to the last byte', () => {
  assert.deepEqual(parseRangeHeader('bytes=4000-99999', 4096), { start: 4000, end: 4095 })
})

test('a suffix range counts back from the end', () => {
  /* MP4 playback leans on this one to find an moov atom parked at the tail. */
  assert.deepEqual(parseRangeHeader('bytes=-1024', 4096), { start: 3072, end: 4095 })
})

test('a suffix longer than the file starts at zero', () => {
  assert.deepEqual(parseRangeHeader('bytes=-99999', 4096), { start: 0, end: 4095 })
})

test('a range starting past the end is unsatisfiable', () => {
  assert.equal(parseRangeHeader('bytes=4096-5000', 4096), 'unsatisfiable')
  assert.equal(parseRangeHeader('bytes=-0', 4096), 'unsatisfiable')
  assert.equal(parseRangeHeader('bytes=0-', 0), 'unsatisfiable')
})

test('anything not a single byte range sends the whole file', () => {
  assert.equal(parseRangeHeader(null, 4096), null)
  assert.equal(parseRangeHeader('', 4096), null)
  assert.equal(parseRangeHeader('bytes=-', 4096), null)
  assert.equal(parseRangeHeader('items=0-10', 4096), null)
  /* Multi-range would need a multipart body, and nothing in the app asks. */
  assert.equal(parseRangeHeader('bytes=0-99,200-299', 4096), null)
})

test('requests stay inside the renderer root', () => {
  const root = process.platform === 'win32' ? 'C:\\app\\dist' : '/app/dist'
  const inside = candidate => {
    const resolved = resolveAppRequestPath(candidate, root)
    return resolved !== null && resolved.startsWith(root)
  }

  assert.ok(inside('iqm-app://bundle/index.html'))
  assert.ok(inside('iqm-app://bundle/assets/modules/states-of-matter/som-poster.jpg'))

  /* The URL parser folds a plain `../` away before the handler sees it, so
     these arrive already flattened to /secret.txt and land inside the root. */
  assert.ok(inside('iqm-app://bundle/../../secret.txt'))
  assert.ok(inside('iqm-app://bundle/%2e%2e/%2e%2e/secret.txt'))

  /* Encoded separators survive normalisation and only become `..` once the
     handler decodes them, which is what the escape check is there to catch. */
  assert.equal(resolveAppRequestPath('iqm-app://bundle/%2E%2E%2F%2E%2E%2Fsecret.txt', root), null)
  assert.equal(resolveAppRequestPath('iqm-app://bundle/..%5C..%5Csecret.txt', root), null)

  assert.equal(resolveAppRequestPath('https://bundle/index.html', root), null)
})

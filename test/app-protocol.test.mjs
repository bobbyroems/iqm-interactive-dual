import assert from 'node:assert/strict'
import test from 'node:test'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { createAppProtocolHandler } = createRequire(import.meta.url)('../electron/app-protocol.cjs')

test('protocol retries file opening, preserves ranges, and closes cancelled streams', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'iqm-protocol-test-'))
  const open = fsp.open
  try {
    await fsp.writeFile(path.join(dir, 'media.mp4'), Buffer.alloc(2 * 1024 * 1024, 65))
    let attempts = 0, handle
    fsp.open = async (...args) => {
      attempts++
      if (attempts === 1) throw Object.assign(new Error('scanner lock'), { code: 'EBUSY' })
      handle = await open(...args)
      return handle
    }
    const handler = createAppProtocolHandler({ rendererRoot: dir })
    const response = await handler(new Request('iqm-app://bundle/media.mp4', { headers: { Range: 'bytes=10-19' } }))
    assert.equal(response.status, 206)
    assert.equal(attempts, 2)
    assert.equal(response.headers.get('content-range'), 'bytes 10-19/2097152')
    assert.equal(await response.text(), 'AAAAAAAAAA')
    const stream = await handler(new Request('iqm-app://bundle/media.mp4'))
    await stream.body.cancel()
    for (let i = 0; i < 50 && handle.fd !== -1; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(handle.fd, -1, 'cancelling a media response closes the descriptor')
    const before = attempts
    assert.equal((await handler(new Request('iqm-app://bundle/media.mp4', { method: 'HEAD' }))).status, 200)
    assert.equal(attempts, before, 'HEAD must not open a streaming descriptor')
  } finally {
    fsp.open = open
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('permanent open failure is 503 before a successful response is committed', async () => {
  const open = fsp.open
  const handler = createAppProtocolHandler({ rendererRoot: path.resolve('public') })
  try {
    fsp.open = async () => { throw Object.assign(new Error('read failure'), { code: 'EIO' }) }
    const response = await handler(new Request('iqm-app://bundle/assets/ui/microsoft-logo.png'))
    assert.equal(response.status, 503)
    assert.equal(await response.text(), 'Unavailable')
  } finally { fsp.open = open }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForMediaReady } from '../src/js/core/media-readiness.js'

function fixture() {
  let now = 0
  let nextId = 0
  const timers = new Map()
  const video = new EventTarget()
  video.readyState = 0
  video.error = null
  let end = 0
  video.buffered = { length: 1, start: () => 0, end: () => end }
  const clock = {
    setTimeoutFn(fn, ms) { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id },
    clearTimeoutFn(id) { timers.delete(id) },
    tick(ms) {
      const target = now + ms
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > target) break
        now = next[1].at
        timers.delete(next[0])
        next[1].fn()
      }
      now = target
    }
  }
  return {
    video, clock, timers,
    progress(value) { end = value; video.dispatchEvent(new Event('progress')) },
    ready() { video.readyState = 2; video.dispatchEvent(new Event('loadeddata')) }
  }
}

test('a delayed response beyond the old eight-second limit can become ready', async () => {
  const f = fixture()
  const ready = waitForMediaReady(f.video, f.clock)
  f.clock.tick(9_500)
  f.ready()
  await ready
  assert.equal(f.timers.size, 0)
})

test('real buffering progress renews the stall deadline but never the overall deadline', async () => {
  const f = fixture()
  let reported = 0
  const ready = waitForMediaReady(f.video, {
    ...f.clock, idleMs: 100, timeoutMs: 350, onProgress: () => reported++
  })
  const rejected = assert.rejects(ready, { name: 'TimeoutError', message: /time limit/ })
  for (let i = 1; i <= 3; i++) {
    f.clock.tick(90)
    f.progress(i)
  }
  f.clock.tick(80)
  await rejected
  assert.equal(reported, 3)
  assert.equal(f.timers.size, 0)
})

test('spurious progress events cannot keep a stalled transfer alive', async () => {
  const f = fixture()
  const ready = waitForMediaReady(f.video, { ...f.clock, idleMs: 100 })
  const rejected = assert.rejects(ready, { name: 'TimeoutError', message: /stopped making progress/ })
  f.clock.tick(90)
  f.progress(0)
  f.clock.tick(10)
  await rejected
  assert.equal(f.timers.size, 0)
})

test('navigation abort and failed media settle promptly and remove timers', async () => {
  for (const fail of ['abort', 'error']) {
    const f = fixture()
    const controller = new AbortController()
    const ready = waitForMediaReady(f.video, { ...f.clock, signal: controller.signal })
    const rejected = assert.rejects(ready, fail === 'abort' ? { name: 'AbortError' } : /media error 2/)
    if (fail === 'abort') controller.abort()
    else {
      f.video.error = { code: 2 }
      f.video.dispatchEvent(new Event('error'))
    }
    await rejected
    f.ready()
    assert.equal(f.timers.size, 0)
  }
})

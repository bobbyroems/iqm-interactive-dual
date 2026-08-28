import assert from 'node:assert/strict'
import test from 'node:test'

import { createAlphaVideo } from '../src/js/core/alpha-video.js'
import { disposeKioskExplainer } from '../src/js/core/kiosk-explainer.js'
import { releaseVideoElement } from '../src/js/core/media-lifecycle.js'
import { ModuleCarousel } from '../src/js/core/module-carousel.js'
import {
  shouldUseProtectionVideoVisual
} from '../src/js/modules/protecting-information/index.js'

class FakeMediaElement extends EventTarget {
  constructor({ readyState = 0, playError = null } = {}) {
    super()
    this.ended = false
    this.error = null
    this.currentTime = 0
    this.loadCalls = 0
    this.loop = false
    this.pauseCalls = 0
    this.paused = true
    this.playCalls = 0
    this.playError = playError
    this.readyState = readyState
    this.removed = false
    this.src = ''
    this.style = {}
    this.seeking = false
  }

  setAttribute() {}

  removeAttribute(name) {
    if (name === 'src') this.src = ''
  }

  pause() {
    this.pauseCalls += 1
    this.paused = true
  }

  async play() {
    this.playCalls += 1
    if (this.playError) throw this.playError
    this.paused = false
  }

  load() {
    this.loadCalls += 1
  }

  remove() {
    this.removed = true
  }
}

class FakeCanvas extends EventTarget {
  constructor(gl) {
    super()
    this.gl = gl
    this.height = 0
    this.removed = false
    this.style = {}
    this.width = 0
  }

  setAttribute() {}
  getContext() { return this.gl }
  remove() { this.removed = true }
}

function createFakeGl() {
  const deleted = { buffer: 0, program: 0, texture: 0, lost: 0 }
  const gl = {
    ARRAY_BUFFER: 1,
    CLAMP_TO_EDGE: 2,
    COMPILE_STATUS: 3,
    FLOAT: 4,
    FRAGMENT_SHADER: 5,
    LINEAR: 6,
    LINK_STATUS: 7,
    RGB: 8,
    STATIC_DRAW: 9,
    TEXTURE_2D: 10,
    TEXTURE_MAG_FILTER: 11,
    TEXTURE_MIN_FILTER: 12,
    TEXTURE_WRAP_S: 13,
    TEXTURE_WRAP_T: 14,
    TRIANGLES: 15,
    UNSIGNED_BYTE: 16,
    VERTEX_SHADER: 17,
    attachShader() {},
    bindBuffer() {},
    bindTexture() {},
    bufferData() {},
    compileShader() {},
    createBuffer: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    createTexture: () => ({}),
    deleteBuffer: () => { deleted.buffer += 1 },
    deleteProgram: () => { deleted.program += 1 },
    deleteShader() {},
    deleteTexture: () => { deleted.texture += 1 },
    drawArrays() {},
    enableVertexAttribArray() {},
    getAttribLocation: () => 0,
    getExtension: name => name === 'WEBGL_lose_context'
      ? { loseContext: () => { deleted.lost += 1 } }
      : null,
    getProgramInfoLog: () => '',
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getShaderParameter: () => true,
    getUniformLocation: () => ({}),
    isContextLost: () => false,
    linkProgram() {},
    shaderSource() {},
    texImage2D() {},
    texParameteri() {},
    uniform1f() {},
    uniform1i() {},
    useProgram() {},
    vertexAttribPointer() {},
    viewport() {}
  }
  return { deleted, gl }
}

async function withFakeDocument({ videoOptions, withGl = false } = {}, run) {
  const previousDocument = globalThis.document
  const created = []
  const graphics = withGl ? createFakeGl() : null
  globalThis.document = {
    baseURI: 'http://kiosk.test/',
    body: { append: (...elements) => created.push(...elements) },
    createElement(tag) {
      const element = tag === 'canvas'
        ? new FakeCanvas(graphics?.gl ?? null)
        : new FakeMediaElement(tag === 'video' ? videoOptions : undefined)
      created.push(element)
      return element
    }
  }
  try {
    return await run({ created, graphics })
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
}

function clip(layout = 'alpha-webm') {
  return {
    layout,
    file: 'effect.webm',
    frame: { width: 100, height: 100 },
    crop: { x: 0, y: 0, width: 100, height: 100 },
    color: { width: 64, height: 64 },
    packed: { height: 128 }
  }
}

test('releaseVideoElement and explainer disposal release the decoder', () => {
  const direct = new FakeMediaElement()
  direct.src = 'direct.mp4'
  releaseVideoElement(direct)
  assert.equal(direct.pauseCalls, 1)
  assert.equal(direct.src, '')
  assert.equal(direct.loadCalls, 1)

  const explainerVideo = new FakeMediaElement()
  explainerVideo.src = 'explainer.mp4'
  disposeKioskExplainer({ element: {}, mediaVideo: explainerVideo })
  assert.equal(explainerVideo.pauseCalls, 1)
  assert.equal(explainerVideo.src, '')
  assert.equal(explainerVideo.loadCalls, 1)
})

test('alpha video rejects an already-aborted mount before allocating media', async () => {
  const controller = new AbortController()
  controller.abort()
  await withFakeDocument({}, async ({ created }) => {
    await assert.rejects(
      createAlphaVideo({
        manifest: { clips: { effect: clip() } },
        id: 'effect',
        signal: controller.signal
      }),
      error => error?.name === 'AbortError'
    )
    assert.equal(created.length, 0)
  })
})

test('failed WebM load releases its partially mounted decoder', async () => {
  await withFakeDocument({}, async ({ created }) => {
    const container = { append() {} }
    const pending = createAlphaVideo({
      manifest: { clips: { effect: clip() } },
      id: 'effect',
      container
    })
    const video = created.find(element => element instanceof FakeMediaElement)
    video.error = new Error('decode failed')
    video.dispatchEvent(new Event('error'))

    await assert.rejects(pending, /decode failed/)
    assert.equal(video.pauseCalls, 1)
    assert.equal(video.loadCalls, 1)
    assert.equal(video.removed, true)
    assert.equal(video.src, '')
  })
})

test('aborting an in-flight WebM load releases its decoder immediately', async () => {
  await withFakeDocument({}, async ({ created }) => {
    const controller = new AbortController()
    const pending = createAlphaVideo({
      manifest: { clips: { effect: clip() } },
      id: 'effect',
      container: { append() {} },
      signal: controller.signal
    })
    const video = created.find(element => element instanceof FakeMediaElement)
    controller.abort()

    await assert.rejects(pending, error => error?.name === 'AbortError')
    assert.equal(video.pauseCalls, 1)
    assert.equal(video.loadCalls, 1)
    assert.equal(video.removed, true)
  })
})

test('autoplay rejection releases an otherwise ready WebM decoder', async () => {
  await withFakeDocument({
    videoOptions: { readyState: 2, playError: new Error('play blocked') }
  }, async ({ created }) => {
    await assert.rejects(
      createAlphaVideo({
        manifest: { clips: { effect: clip() } },
        id: 'effect',
        container: { append() {} },
        autoplay: true
      }),
      /play blocked/
    )
    const video = created.find(element => element instanceof FakeMediaElement)
    assert.equal(video.loadCalls, 1)
    assert.equal(video.removed, true)
  })
})

test('seeking to the current alpha-video frame resolves without a seeked event', async () => {
  await withFakeDocument({ videoOptions: { readyState: 2 } }, async () => {
    const instance = await createAlphaVideo({
      manifest: { clips: { effect: clip() } },
      id: 'effect',
      container: { append() {} }
    })
    await instance.seek(0)
    instance.dispose()
  })
})

test('failed packed-video load frees GL objects, context and decoder', async () => {
  await withFakeDocument({ withGl: true }, async ({ created, graphics }) => {
    const pending = createAlphaVideo({
      manifest: { clips: { effect: clip('over-under') } },
      id: 'effect',
      container: { append() {} }
    })
    const video = created.find(element => element instanceof FakeMediaElement)
    const canvas = created.find(element => element instanceof FakeCanvas)
    video.error = new Error('packed decode failed')
    video.dispatchEvent(new Event('error'))

    await assert.rejects(pending, /packed decode failed/)
    assert.deepEqual(graphics.deleted, { buffer: 1, program: 1, texture: 1, lost: 1 })
    assert.equal(canvas.removed, true)
    assert.equal(video.loadCalls, 1)
    assert.equal(video.removed, true)
  })
})

test('production kiosk defaults Module 05 to scene with explicit query overrides', () => {
  assert.equal(shouldUseProtectionVideoVisual({ isKiosk: true }), false)
  assert.equal(shouldUseProtectionVideoVisual({ isKiosk: false }), true)
  assert.equal(shouldUseProtectionVideoVisual({ isKiosk: true, search: '?visual=video' }), true)
  assert.equal(shouldUseProtectionVideoVisual({ isKiosk: false, search: '?visual=scene' }), false)
})

test('carousel suspends preview decoding and motion outside the menu', async () => {
  const previousWindow = globalThis.window
  const cancelled = []
  let nextFrame = 10
  globalThis.window = {
    requestAnimationFrame: () => nextFrame++,
    cancelAnimationFrame: frame => cancelled.push(frame)
  }
  const videos = [new FakeMediaElement(), new FakeMediaElement()]
  const carousel = Object.create(ModuleCarousel.prototype)
  carousel.active = false
  carousel.cards = videos.map(video => ({ querySelector: () => video }))
  carousel.currentIndex = 1
  carousel.previewMotion = {
    previousCenterX: 10,
    previousFrameAt: 20
  }
  carousel.previewMotionFrame = 0

  try {
    carousel.setActive(true)
    assert.equal(videos[0].playCalls, 0)
    assert.equal(videos[1].playCalls, 1)
    assert.equal(carousel.previewMotionFrame, 10)

    carousel.setActive(false)
    assert.equal(carousel.previewMotionFrame, 0)
    assert.deepEqual(cancelled, [10])
    assert.equal(videos[0].pauseCalls, 2)
    assert.equal(videos[1].pauseCalls, 1)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

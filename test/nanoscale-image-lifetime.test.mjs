import assert from 'node:assert/strict'
import test from 'node:test'
import { getEventListeners } from 'node:events'
import { decodeNanoscaleElementImages } from '../src/js/modules/nanoscale/nanoscale-assets.js'
import { NANOSCALE_CAMERA_SCENES } from '../src/js/modules/nanoscale/nanoscale-camera.js'
import {
  createNanoscaleImageLifetime,
  nanoscaleImageRetained
} from '../src/js/modules/nanoscale/nanoscale-image-lifetime.js'

function imageFixture(stop, { pending = false, comparison = false } = {}) {
  const image = new EventTarget()
  Object.assign(image, {
    tagName: 'IMG', complete: !pending,
    naturalWidth: pending ? 0 : 100,
    naturalHeight: pending ? 0 : 100,
    dataset: { nzSrc: `${stop}.webp` },
    decode: async () => {},
    removeAttribute: name => { delete image[name] },
    closest: selector => {
      if (comparison) {
        return selector === '[data-nz-comparison-media]'
          ? { dataset: { nzComparisonMedia: 'majorana-2' } } : null
      }
      return selector === '[data-nz-scene]'
        ? { dataset: { nzScene: NANOSCALE_CAMERA_SCENES[stop].layerId } } : null
    }
  })
  return image
}

test('browser loads only reached artwork, retains all ancestor cameras, and releases future/independent media', async () => {
  const images = [0, 1, 2, 3, 4, 5].map(stop => imageFixture(stop))
  const comparison = imageFixture(2, { comparison: true })
  const root = { querySelectorAll: () => [...images, comparison] }
  const lifetime = createNanoscaleImageLifetime(root)
  await lifetime.ensure(0)
  assert.equal(images.filter(image => image.src).length, 1)
  await lifetime.ensure(0, 5)
  assert(images.every(image => image.src))
  assert(comparison.src)
  lifetime.evict(5)
  assert(images.every(image => image.src), 'deep views need every ancestor camera')
  assert.equal(comparison.src, undefined, 'distant independent comparisons can be released')
  lifetime.evict(0)
  assert.equal(images.filter(image => image.src).length, 2, 'retain splash and next camera only on restart')
  await lifetime.ensure(2)
  assert(comparison.src, 'released artwork must be reloadable on return')
  lifetime.dispose()
  assert(images.every(image => !image.src))
  assert.equal(comparison.src, undefined)
})

test('cancelling an image load removes its DOM listeners and source promptly', async () => {
  const image = imageFixture(0, { pending: true })
  const controller = new AbortController()
  const lifetime = createNanoscaleImageLifetime({ querySelectorAll: () => [image] }, {
    signal: controller.signal
  })
  const loading = lifetime.ensure(0)
  const rejected = assert.rejects(loading, { name: 'AbortError' })
  controller.abort()
  await rejected
  assert.equal(getEventListeners(image, 'load').length, 0)
  assert.equal(getEventListeners(image, 'error').length, 0)
  assert.equal(image.src, undefined)
})

test('image decode cancellation does not wait for a hung decode promise', async () => {
  const image = imageFixture(0)
  image.decode = () => new Promise(() => {})
  const controller = new AbortController()
  const loading = decodeNanoscaleElementImages([image], { signal: controller.signal })
  const rejected = assert.rejects(loading, { name: 'AbortError' })
  await Promise.resolve()
  controller.abort()
  await rejected
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

test('retention never evicts camera underlays just because they are distant', () => {
  for (let stop = 0; stop < 5; stop++) {
    assert(nanoscaleImageRetained({ kind: 'camera', stop }, 5))
  }
  assert.equal(nanoscaleImageRetained({ kind: 'camera', stop: 5 }, 1), false)
  assert.equal(nanoscaleImageRetained({ kind: 'finale', stop: 6 }, 1), false)
})

test('a stalled image has a finite deadline and leaves no load listeners', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const image = imageFixture(0, { pending: true })
  const loading = decodeNanoscaleElementImages([image])
  const rejected = assert.rejects(loading, { name: 'TimeoutError' })
  t.mock.timers.tick(45_000)
  await rejected
  assert.equal(getEventListeners(image, 'load').length, 0)
  assert.equal(getEventListeners(image, 'error').length, 0)
})

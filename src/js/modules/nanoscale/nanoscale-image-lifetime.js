import { decodeNanoscaleElementImages } from './nanoscale-assets.js'
import { NANOSCALE_CAMERA_SCENES } from './nanoscale-camera.js'
import { NANOSCALE_COMPARISON_RECIPES } from './nanoscale-comparison.js'

export function nanoscaleImageRequired({ kind, stop }, progress) {
  if (kind === 'camera') return stop <= Math.ceil(progress)
  if (kind === 'finale') return progress > 5
  return stop >= Math.floor(progress) && stop <= Math.ceil(progress)
}

export function nanoscaleImageRetained({ kind, stop }, progress) {
  // Every earlier camera scene can remain visible as a registered underlay.
  if (kind === 'camera') return stop <= Math.ceil(progress) + 1
  if (kind === 'finale') return progress >= 5
  return Math.abs(stop - progress) <= 1
}

export function createNanoscaleImageLifetime(root, { signal, onProgress } = {}) {
  const records = [...root.querySelectorAll('img[data-nz-src]')].map(image => {
    const camera = image.closest('[data-nz-scene]')
    const comparison = image.closest('[data-nz-comparison-media]')
    const kind = camera ? 'camera' : comparison ? 'comparison' : 'finale'
    const stop = camera
      ? NANOSCALE_CAMERA_SCENES.find(scene => scene.layerId === camera.dataset.nzScene).stop
      : comparison
        ? NANOSCALE_COMPARISON_RECIPES.find(recipe => recipe.id === comparison.dataset.nzComparisonMedia).timelineIndex
        : 6
    return { image, kind, stop }
  })
  const loads = new Map()
  let disposed = false
  let epoch = 0

  function release(record) {
    loads.get(record.image)?.controller.abort()
    loads.delete(record.image)
    record.image.removeAttribute('src')
  }

  function dispose() {
    if (disposed) return
    disposed = true
    epoch++
    records.forEach(release)
    signal?.removeEventListener('abort', dispose)
  }
  signal?.addEventListener('abort', dispose, { once: true })
  if (signal?.aborted) dispose()

  function load(record) {
    if (disposed) return Promise.reject(new DOMException('Nanoscale image loading aborted', 'AbortError'))
    const { image } = record
    if (loads.has(image)) return loads.get(image).promise
    const controller = new AbortController()
    const entry = { controller, ready: false, promise: null }
    image.src = image.dataset.nzSrc
    entry.promise = decodeNanoscaleElementImages([image], { signal: controller.signal, onProgress })
      .then(() => { entry.ready = true })
      .catch(error => {
        if (loads.get(image) === entry) {
          loads.delete(image)
          image.removeAttribute('src')
        }
        throw error
      })
    loads.set(image, entry)
    return entry.promise
  }

  function required(from, to) {
    return records.filter(record => {
      if (nanoscaleImageRequired(record, from) || nanoscaleImageRequired(record, to)) return true
      return record.kind === 'comparison' && record.stop >= Math.min(from, to) &&
        record.stop <= Math.max(from, to)
    })
  }

  return {
    dispose,
    isReady: (from, to = from) => required(from, to).every(record => loads.get(record.image)?.ready),
    async ensure(from, to = from) {
      const token = epoch
      for (const record of required(from, to)) {
        if (disposed || token !== epoch) throw new DOMException('Nanoscale image loading superseded', 'AbortError')
        await load(record)
      }
    },
    evict(progress) {
      epoch++
      records.filter(record => !nanoscaleImageRetained(record, progress)).forEach(release)
    }
  }
}

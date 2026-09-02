import { assetUrl } from '../../core/asset-url.js'
import { NANOSCALE_CAMERA_SCENES } from './nanoscale-camera.js'
import { NANOSCALE_COMPARISON_IMAGE_PATHS } from './nanoscale-comparison.js'
import { NANOSCALE_V3_FINALE, NANOSCALE_V3_TIMELINE } from './nanoscale-stops.js'

const NANOSCALE_ASSET_ROOT = 'assets/modules/nanoscale'

export const NANOSCALE_UI_IMAGE_PATHS = Object.freeze({
  microsoftLogo: 'assets/ui/microsoft-logo.png',
  restartIcon: 'assets/ui/restart.svg',
  exitIcon: 'assets/ui/exit-x.svg'
})

const cameraImagePaths = NANOSCALE_CAMERA_SCENES.flatMap(scene => {
  const underlays = (scene.underlays ?? []).map(plate => `${NANOSCALE_ASSET_ROOT}/${plate.asset}`)

  if (scene.cameraGroup?.layers?.length) {
    return [...underlays, ...scene.cameraGroup.layers.map(layer => `${NANOSCALE_ASSET_ROOT}/${layer.asset}`)]
  }

  const image = NANOSCALE_V3_TIMELINE[scene.stop]?.hero?.image
  if (!image) throw new Error(`Missing runtime image for Nanoscale stop ${scene.stop}`)
  return [...underlays, image]
})

/* Finale media is not part of the registered camera stack. */
const finaleImagePaths = NANOSCALE_V3_FINALE
  .flatMap(stop => [stop.figure?.image, stop.figure?.pixels, stop.figure?.marker])
  .filter(Boolean)

/** Every image URL that can be painted by the Nanoscale experience. */
export const NANOSCALE_RUNTIME_IMAGE_PATHS = Object.freeze([
  ...new Set([
    ...cameraImagePaths,
    ...finaleImagePaths,
    ...NANOSCALE_COMPARISON_IMAGE_PATHS,
    ...Object.values(NANOSCALE_UI_IMAGE_PATHS)
  ])
])

let preloadPromise = null

function createAbortError(message = 'Nanoscale image preload aborted') {
  return new DOMException(message, 'AbortError')
}

function loadAndDecodeImage(path, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    let settled = false

    const cleanup = () => {
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    const fail = error => {
      if (settled) return
      settled = true
      cleanup()
      image.removeAttribute('src')
      reject(error)
    }
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(image)
    }
    const onAbort = () => fail(createAbortError())
    const onError = () => fail(new Error(`Unable to load Nanoscale image: ${path}`))
    const onLoad = async () => {
      try {
        if (typeof image.decode === 'function') {
          try {
            await image.decode()
          } catch (error) {
            throw new Error(
              `Unable to decode Nanoscale image: ${path}${error?.message ? ` (${error.message})` : ''}`,
              { cause: error }
            )
          }
        }
        if (signal.aborted) throw createAbortError()
        if (!image.naturalWidth || !image.naturalHeight) {
          throw new Error(`Nanoscale image decoded without dimensions: ${path}`)
        }
        succeed()
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }

    signal.addEventListener('abort', onAbort, { once: true })
    image.addEventListener('load', onLoad, { once: true })
    image.addEventListener('error', onError, { once: true })
    image.src = assetUrl(path)
  })
}

async function loadNanoscaleImageBatch() {
  const batch = new AbortController()
  try {
    const images = []
    for (const path of NANOSCALE_RUNTIME_IMAGE_PATHS) {
      images.push(await loadAndDecodeImage(path, batch.signal))
    }
    return Object.freeze({
      paths: NANOSCALE_RUNTIME_IMAGE_PATHS,
      /* Keeping these decoded Image objects alive is the preheat cache. */
      images: Object.freeze(images)
    })
  } catch (error) {
    batch.abort()
    throw error
  }
}

/** Shared app-lifetime preheat. A real failure clears the cache so retry can recover. */
export function preloadNanoscaleAssets() {
  preloadPromise ??= loadNanoscaleImageBatch().catch(error => {
    preloadPromise = null
    throw error
  })
  return preloadPromise
}

function waitWithoutCancellingSharedPreload(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError('Nanoscale mount aborted'))

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(createAbortError('Nanoscale mount aborted'))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        cleanup()
        resolve(value)
      },
      error => {
        cleanup()
        reject(error)
      }
    )
  })
}

/** Await the shared cache without letting one abandoned mount cancel it for later visitors. */
export function waitForNanoscaleAssets({ signal } = {}) {
  return waitWithoutCancellingSharedPreload(preloadNanoscaleAssets(), signal)
}

function waitForElementLoad(image) {
  if (image.complete) {
    return image.naturalWidth && image.naturalHeight
      ? Promise.resolve()
      : Promise.reject(new Error(`Unable to load Nanoscale DOM image: ${image.src}`))
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
    }
    const onLoad = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`Unable to load Nanoscale DOM image: ${image.src}`))
    }
    image.addEventListener('load', onLoad, { once: true })
    image.addEventListener('error', onError, { once: true })
  })
}

async function decodeElementImage(image) {
  await waitForElementLoad(image)
  if (typeof image.decode === 'function') {
    try {
      await image.decode()
    } catch (error) {
      /* These URLs were decoded by the shared preheat immediately before the
         detached stage was built. Chromium can reject a second decode under
         memory pressure even though the DOM image has loaded valid dimensions. */
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
        throw new Error(
          `Unable to decode Nanoscale DOM image: ${image.src}${error?.message ? ` (${error.message})` : ''}`,
          { cause: error }
        )
      }
    }
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error(`Nanoscale DOM image decoded without dimensions: ${image.src}`)
  }
}

/** Decode the actual detached stage images before ModuleHost reveals or enables it. */
export async function decodeNanoscaleStageImages(root, { signal } = {}) {
  const images = [...root.querySelectorAll('img[src]')]
  try {
    for (const image of images) {
      await waitWithoutCancellingSharedPreload(decodeElementImage(image), signal)
    }
  } catch (error) {
    /* The detached stage will not be used after a failed/aborted mount. Cancel
       any requests it still owns instead of leaving them alive off-DOM. */
    images.forEach(image => image.removeAttribute('src'))
    throw error
  }
}

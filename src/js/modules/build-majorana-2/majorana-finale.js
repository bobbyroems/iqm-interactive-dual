import { assetUrl } from '../../core/asset-url.js'
import {
  composeNanoscaleSimilarities,
  interpolateNanoscaleSimilarityAroundAnchor,
  NANOSCALE_CAMERA_GEOMETRY,
  NANOSCALE_CAMERA_HANDOFFS,
  NANOSCALE_CAMERA_SCENES,
  nanoscaleCameraCssTransform,
  sampleNanoscaleCamera,
  sampleNanoscalePresentationSegment
} from '../nanoscale/nanoscale-camera.js'

const UI_CLEAR_MS = 420
const ENCLOSURE_REVEAL_MS = 780
const CHIP_SWAP_MS = 720
const CHIP_HOLD_MS = 420
const PULLOUT_MS = 4_800

const CRYOSTAT_STOP = 1
const MAJORANA_STOP = 2
const FINALE_STAGE = Object.freeze({ width: 2160, height: 3720 })
const FIGMA_HEADER_HEIGHT = 120
const majoranaArt = NANOSCALE_CAMERA_SCENES[MAJORANA_STOP].art
const cryostatArt = NANOSCALE_CAMERA_SCENES[CRYOSTAT_STOP].art
const majoranaHandoff = NANOSCALE_CAMERA_HANDOFFS[CRYOSTAT_STOP]

/* Node 895:8670 keeps the pullout above the bottom of the 2160 x 3840 frame:
   its 2927.9px-tall enclosure starts at frame y=0, while this build view starts
   directly below the persistent 120px header. */
const FIGMA_FINAL_CRYOSTAT_HEIGHT = 2927.9

export const MAJORANA_FINALE_END_FRAME = Object.freeze({
  height: FIGMA_FINAL_CRYOSTAT_HEIGHT,
  width: cryostatArt.assetSize.width * (
    FIGMA_FINAL_CRYOSTAT_HEIGHT / cryostatArt.assetSize.height
  ),
  x: (FINALE_STAGE.width - (
    cryostatArt.assetSize.width * (
      FIGMA_FINAL_CRYOSTAT_HEIGHT / cryostatArt.assetSize.height
    )
  )) / 2,
  y: -FIGMA_HEADER_HEIGHT
})

/* The replacement still begins in the same registered position as the former
   straight-on package: 1300 intrinsic pixels were rendered at 2270px wide,
   with its full bitmap beginning at (-57, -1360). Resolve that placement
   against module 08's own art transform, then remove the correction while its
   exact 02 -> 01 camera handoff runs in reverse. */
const registeredMajoranaAssetScale = 2270 / majoranaArt.assetSize.width
const finalCryostatAssetScale = (
  MAJORANA_FINALE_END_FRAME.height / cryostatArt.assetSize.height
)

export const MAJORANA_FINALE_START_REGISTRATION = Object.freeze({
  scale: registeredMajoranaAssetScale / majoranaArt.assetToScene.scale,
  translateX: -57 - (
    (registeredMajoranaAssetScale / majoranaArt.assetToScene.scale) *
    majoranaArt.assetToScene.translateX
  ),
  translateY: -1360 - (
    (registeredMajoranaAssetScale / majoranaArt.assetToScene.scale) *
    majoranaArt.assetToScene.translateY
  )
})

/* Settle the complete module-08 bitmap in the higher Figma-authored frame. */
export const MAJORANA_FINALE_END_REGISTRATION = Object.freeze({
  scale: finalCryostatAssetScale / cryostatArt.assetToScene.scale,
  translateX: MAJORANA_FINALE_END_FRAME.x - (
    (finalCryostatAssetScale / cryostatArt.assetToScene.scale) *
    cryostatArt.assetToScene.translateX
  ),
  translateY: MAJORANA_FINALE_END_FRAME.y - (
    (finalCryostatAssetScale / cryostatArt.assetToScene.scale) *
    cryostatArt.assetToScene.translateY
  )
})

const majoranaFocus = Object.freeze({
  x: NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.x +
    (NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.width / 2),
  y: NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.y +
    (NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.height / 2)
})

const clamp01 = value => Math.min(1, Math.max(0, value))
const lerp = (from, to, progress) => from + ((to - from) * progress)

function easeInOutCubic(value) {
  const progress = clamp01(value)
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - ((-2 * progress + 2) ** 3) / 2
}

export function sampleMajoranaFinaleCamera(progress) {
  const safeProgress = clamp01(Number.isFinite(progress) ? progress : 0)
  return interpolateNanoscaleSimilarityAroundAnchor(
    MAJORANA_FINALE_START_REGISTRATION,
    MAJORANA_FINALE_END_REGISTRATION,
    majoranaFocus,
    safeProgress
  )
}

export function sampleMajoranaFinaleComposition(progress) {
  const safeProgress = clamp01(Number.isFinite(progress) ? progress : 0)
  const cameraSample = sampleNanoscaleCamera(
    lerp(MAJORANA_STOP, CRYOSTAT_STOP, safeProgress)
  )
  const majoranaCameraTransform = composeNanoscaleSimilarities(
    sampleNanoscalePresentationSegment(CRYOSTAT_STOP, 1 - safeProgress),
    majoranaHandoff.registration
  )
  return Object.freeze({
    camera: sampleMajoranaFinaleCamera(safeProgress),
    layers: cameraSample.layers,
    majoranaCameraTransform,
    progress: safeProgress
  })
}

/**
 * Crossfades the assembled live board into module 08's registered Majorana
 * plate, then keeps that same DOM image throughout the reversed Majorana ->
 * Cryostat handoff. The package therefore remains continuous and registered
 * while the complete cryostat.webp plate settles into the higher Figma frame.
 */
export function createMajoranaFinale({ reducedMotion = false, stage } = {}) {
  if (!(stage instanceof HTMLElement)) {
    throw new TypeError('Majorana finale requires the build stage element.')
  }

  const element = document.createElement('div')
  element.className = 'majorana-finale'
  element.hidden = true
  element.setAttribute('aria-hidden', 'true')

  const camera = document.createElement('div')
  camera.className = 'majorana-finale__camera'

  const chipElement = document.createElement('div')
  chipElement.className = 'majorana-finale-chip-overlay'
  chipElement.hidden = true
  chipElement.setAttribute('aria-hidden', 'true')

  const chipCamera = document.createElement('div')
  chipCamera.className = 'majorana-finale__chip-camera'

  const pullout = document.createElement('img')
  pullout.className = 'majorana-finale__pullout'
  pullout.src = assetUrl('assets/modules/nanoscale/cryostat.webp')
  pullout.alt = ''
  pullout.draggable = false
  pullout.decoding = 'async'
  pullout.dataset.finaleArt = 'module-08-cryostat'

  const chip = document.createElement('img')
  chip.className = 'majorana-finale__chip'
  chip.src = assetUrl('assets/modules/nanoscale/majorana-2.webp')
  chip.alt = ''
  chip.draggable = false
  chip.decoding = 'async'
  chip.dataset.finaleArt = 'module-08-majorana-2'

  camera.append(pullout)
  chipCamera.append(chip)
  chipElement.append(chipCamera)
  element.append(camera)

  let animationFrame = 0
  let playToken = 0
  let pendingResolve = null
  let pulloutReveal = 0
  let chipReveal = 0
  let cryostatLayerOpacity = 0

  function applyLayerOpacities() {
    pullout.style.opacity = String(clamp01(pulloutReveal * cryostatLayerOpacity))
    chip.style.opacity = String(clamp01(chipReveal))
  }

  function renderComposition(progress) {
    const composition = sampleMajoranaFinaleComposition(progress)
    const cameraTransform = nanoscaleCameraCssTransform(composition.camera)
    camera.style.transform = cameraTransform
    chipCamera.style.transform = cameraTransform

    const cryostatLayer = composition.layers.find(layer => layer.sceneId === 'cryostat')

    cryostatLayerOpacity = cryostatLayer?.opacity ?? 0
    if (cryostatLayer) {
      pullout.style.transform = nanoscaleCameraCssTransform(
        composeNanoscaleSimilarities(
          cryostatLayer.cameraTransform,
          cryostatArt.assetToScene
        )
      )
    }
    chip.style.transform = nanoscaleCameraCssTransform(
      composeNanoscaleSimilarities(
        composition.majoranaCameraTransform,
        majoranaArt.assetToScene
      )
    )
    applyLayerOpacities()
  }

  function renderPulloutOpacity(opacity) {
    pulloutReveal = clamp01(opacity)
    applyLayerOpacities()
  }

  function renderChipSwap(progress) {
    const eased = easeInOutCubic(progress)
    chipReveal = eased
    chip.style.filter = `blur(${lerp(10, 0, eased)}px)`
    stage.style.setProperty('--majorana-finale-live-opacity', String(1 - eased))
    stage.style.setProperty('--majorana-finale-live-blur', `${lerp(0, 10, eased)}px`)
    applyLayerOpacities()
  }

  async function decode() {
    await Promise.all([pullout, chip].map(image => (
      typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : undefined
    )))
  }

  function cancel(result = false) {
    playToken += 1
    if (animationFrame) window.cancelAnimationFrame(animationFrame)
    animationFrame = 0
    pendingResolve?.(result)
    pendingResolve = null
  }

  async function play() {
    cancel(false)
    const token = playToken
    await decode()
    if (token !== playToken) return false

    renderComposition(0)
    renderPulloutOpacity(0)
    renderChipSwap(0)
    element.dataset.finalePhase = 'clearing'
    element.hidden = false
    element.setAttribute('aria-hidden', 'false')
    chipElement.hidden = false
    window.requestAnimationFrame(() => {
      element.classList.add('is-showing')
      chipElement.classList.add('is-showing')
    })

    if (reducedMotion) {
      renderPulloutOpacity(1)
      renderChipSwap(1)
      renderComposition(1)
      element.dataset.finalePhase = 'complete'
      return true
    }

    return new Promise(resolve => {
      pendingResolve = resolve
      const chipSwapStartMs = UI_CLEAR_MS + ENCLOSURE_REVEAL_MS
      const chipSwapEndMs = chipSwapStartMs + CHIP_SWAP_MS
      const pulloutStartMs = chipSwapEndMs + CHIP_HOLD_MS
      const totalMs = pulloutStartMs + PULLOUT_MS
      const startedAt = performance.now()

      const tick = timestamp => {
        if (token !== playToken) return
        const elapsedMs = timestamp - startedAt
        const enclosureProgress = clamp01(
          (elapsedMs - (UI_CLEAR_MS * 0.35)) / ENCLOSURE_REVEAL_MS
        )
        renderPulloutOpacity(easeInOutCubic(enclosureProgress))
        renderChipSwap(clamp01((elapsedMs - chipSwapStartMs) / CHIP_SWAP_MS))

        if (elapsedMs < UI_CLEAR_MS) {
          element.dataset.finalePhase = 'clearing'
        } else if (elapsedMs < chipSwapStartMs) {
          element.dataset.finalePhase = 'enclosing'
        } else if (elapsedMs < chipSwapEndMs) {
          element.dataset.finalePhase = 'chip-swap'
        } else if (elapsedMs < pulloutStartMs) {
          element.dataset.finalePhase = 'registered-still'
        } else {
          element.dataset.finalePhase = 'pulling-out'
          renderComposition(clamp01((elapsedMs - pulloutStartMs) / PULLOUT_MS))
        }

        if (elapsedMs >= totalMs) {
          renderPulloutOpacity(1)
          renderChipSwap(1)
          renderComposition(1)
          element.dataset.finalePhase = 'complete'
          animationFrame = 0
          pendingResolve = null
          resolve(true)
          return
        }
        animationFrame = window.requestAnimationFrame(tick)
      }
      animationFrame = window.requestAnimationFrame(tick)
    })
  }

  function reset() {
    cancel(false)
    element.classList.remove('is-showing')
    chipElement.classList.remove('is-showing')
    element.hidden = true
    element.setAttribute('aria-hidden', 'true')
    chipElement.hidden = true
    element.dataset.finalePhase = 'idle'
    stage.style.setProperty('--majorana-finale-camera-scale', '1')
    stage.style.setProperty('--majorana-finale-camera-x', '0px')
    stage.style.setProperty('--majorana-finale-camera-y', '0px')
    renderComposition(0)
    renderPulloutOpacity(0)
    renderChipSwap(0)
  }

  function dispose() {
    cancel(false)
    element.remove()
    chipElement.remove()
  }

  reset()
  return { chipElement, element, play, reset, dispose }
}

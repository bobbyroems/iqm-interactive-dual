/*
 * Nanoscale — registered camera journey with a two-screen scrollytelling finale.
 *
 * Timeline 0 is the supplied room-scale splash. Stops 1-5 are the numbered
 * Cryostat, Majorana 2, QPU, qubit-array and nanowire views from Figma Design
 * v3. Every handoff is registered around the same physical feature before the
 * incoming source is revealed. From 01 onward, registered prior scenes remain
 * opacity-1 underlays beneath each incoming overlay; only 00 crossfades away.
 */

import { assetUrl } from '../../core/asset-url.js'
import {
  createKioskExplainer,
  disposeKioskExplainer,
  updateKioskExplainer
} from '../../core/kiosk-explainer.js'
import { createKioskTooltip } from '../../core/kiosk-tooltip.js'
import {
  formatNanoscaleCount,
  nanoscaleCountState,
  NANOSCALE_HOLD_SNAP_MS,
  NANOSCALE_SCROLL_CUE,
  NANOSCALE_LAST_CONTENT_STOP,
  NANOSCALE_V3_FINALE,
  NANOSCALE_V3_SEQUENCE,
  NANOSCALE_V3_SPLASH,
  NANOSCALE_V3_STOPS,
  nanoscaleRevealState,
  nanoscaleTimelineStopAt
} from './nanoscale-stops.js'
import {
  NANOSCALE_FINALE_LAYOUT,
  NANOSCALE_LAYOUT,
  NANOSCALE_SCRUBBER,
  NANOSCALE_SPLASH_LAYOUT,
  nanoscaleLayoutAt,
  nanoscaleTimelineScrubberAt
} from './nanoscale-layout.js'
import {
  holdNanoscaleFinaleProgress,
  isFreeNanoscaleFinaleGesture,
  sampleNanoscaleFinale
} from './nanoscale-finale.js'
import {
  NANOSCALE_CAMERA_SCENES,
  assertValidNanoscaleCamera,
  nanoscaleCameraCssTransform,
  sampleNanoscaleCamera
} from './nanoscale-camera.js'
import {
  NANOSCALE_PRESENTATION_SEGMENTS,
  nanoscalePresentationFrame,
  nanoscalePullbackCameraTransform,
  nanoscaleSceneCssTransform
} from './nanoscale-presentation.js'
import {
  clamp,
  constrainGestureProgress,
  dragDeltaToProgress,
  getVelocityAwareSnapTarget,
  nearestNanoscaleStop,
  pinchDeltaToProgress,
  sampleSettlingMotion
} from './zoom-model.js'
import {
  NANOSCALE_UI_IMAGE_PATHS,
  decodeNanoscaleStageImages,
  preloadNanoscaleAssets,
  waitForNanoscaleAssets
} from './nanoscale-assets.js'
import {
  createNanoscaleComparisonMediaStack,
  hideNanoscaleComparisonMediaStack,
  setNanoscaleComparisonMediaStackStop
} from './nanoscale-comparison.js'

const DESIGN_PIXELS_PER_STOP = 760
const STAGE_HEIGHT = 3840
const LAST_STOP = NANOSCALE_V3_STOPS.at(-1)
const NANOSCALE_ASSET_ROOT = 'assets/modules/nanoscale'

/* One canonical DOM layer per visual source. Splash and Cryostat are separate
   assets registered through the warm-metal cryostat landmark. */
const VISUAL_SOURCES = Object.freeze({
  'splash-room': Object.freeze({
    image: NANOSCALE_V3_SPLASH.hero.image,
    box: NANOSCALE_SPLASH_LAYOUT.subject,
    fit: NANOSCALE_SPLASH_LAYOUT.fit,
    anchor: NANOSCALE_SPLASH_LAYOUT.anchor
  }),
  cryostat: Object.freeze({
    image: NANOSCALE_V3_SEQUENCE[0].hero.image,
    box: NANOSCALE_LAYOUT[0].subject,
    fit: NANOSCALE_LAYOUT[0].fit,
    anchor: NANOSCALE_LAYOUT[0].anchor
  }),
  'majorana-2': Object.freeze({
    image: NANOSCALE_V3_SEQUENCE[1].hero.image,
    box: NANOSCALE_LAYOUT[1].subject,
    fit: NANOSCALE_LAYOUT[1].fit,
    anchor: NANOSCALE_LAYOUT[1].anchor
  }),
  'qpu-chip': Object.freeze({
    image: NANOSCALE_V3_SEQUENCE[2].hero.image,
    box: NANOSCALE_LAYOUT[2].subject,
    fit: NANOSCALE_LAYOUT[2].fit,
    anchor: NANOSCALE_LAYOUT[2].anchor
  }),
  'qubit-array': Object.freeze({
    image: NANOSCALE_V3_SEQUENCE[3].hero.image,
    box: NANOSCALE_LAYOUT[3].subject,
    fit: NANOSCALE_LAYOUT[3].fit,
    anchor: NANOSCALE_LAYOUT[3].anchor
  }),
  nanowire: Object.freeze({
    image: NANOSCALE_V3_SEQUENCE[4].hero.image,
    box: NANOSCALE_LAYOUT[4].subject,
    fit: NANOSCALE_LAYOUT[4].fit,
    anchor: NANOSCALE_LAYOUT[4].anchor
  })
})

const UNIQUE_CAMERA_LAYERS = Object.freeze([
  ...new Set(NANOSCALE_CAMERA_SCENES.map(scene => scene.layerId))
])

function createAbortError() {
  return new DOMException('Nanoscale mount aborted', 'AbortError')
}

function stageScaleOf(element) {
  const rect = element.getBoundingClientRect()
  return rect.height > 0 ? rect.height / STAGE_HEIGHT : 1
}

function pinchDistance(points) {
  const [first, second] = points
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function fillToCss(value, fallback = 'transparent') {
  if (!value?.color) return fallback
  if (!Number.isFinite(value.opacity) || value.opacity >= 1) return value.color
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value.color)
  if (!match) return value.color
  const [, red, green, blue] = match
  return `rgb(${parseInt(red, 16)} ${parseInt(green, 16)} ${parseInt(blue, 16)} / ${value.opacity})`
}

/* Layer alpha ramps become one linear-gradient per axis; CSS intersects them. */
function maskImageToCss(mask) {
  const axes = [
    ['down', 'to bottom'],
    ['across', 'to right']
  ]
  return axes
    .filter(([axis]) => mask[axis])
    .map(([axis, direction]) => {
      const stops = mask[axis]
        .map(([at, alpha]) => `rgb(0 0 0 / ${alpha}) ${(at * 100).toFixed(3)}%`)
        .join(', ')
      return `linear-gradient(${direction}, ${stops})`
    })
    .join(', ')
}

const HEX_COLOR = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i

function mixColors(from, to, blend) {
  if (from === to) return from
  const start = HEX_COLOR.exec(from)
  const end = HEX_COLOR.exec(to)
  if (!start || !end) return blend > 0.5 ? to : from
  const channel = index => {
    const a = parseInt(start[index], 16)
    const b = parseInt(end[index], 16)
    return Math.round(a + ((b - a) * blend))
  }
  return `rgb(${channel(1)} ${channel(2)} ${channel(3)})`
}

/*
 * Every ink in the scrubber is tied to the stop it belongs to, so like the plate
 * behind it they cross-fade with the zoom rather than switching on arrival. Each
 * tick blends its own role between the two stops, which slides the active
 * highlight along the track instead of snapping it to the next tick.
 */
function nanoscaleScrubberColorsAt(timelineProgress, lastStop, tickCount) {
  const clamped = Math.min(Math.max(timelineProgress, 1), lastStop)
  const lower = Math.floor(clamped)
  const upper = Math.min(lastStop, lower + 1)
  const blend = clamped - lower
  const from = nanoscaleTimelineScrubberAt(lower)
  const to = nanoscaleTimelineScrubberAt(upper)
  const markColor = (treatment, index) => index === treatment.activeIndex
    ? treatment.activeTickColor
    : treatment.inactiveTickColor
  return {
    track: mixColors(from.trackColor, to.trackColor, blend),
    marker: mixColors(from.markerColor, to.markerColor, blend),
    number: mixColors(from.numberColor, to.numberColor, blend),
    ticks: Array.from({ length: tickCount }, (_, index) =>
      mixColors(markColor(from, index), markColor(to, index), blend))
  }
}

/*
 * The plate under the track belongs to the artwork behind it, so its strength
 * follows the zoom continuously instead of snapping when a stop is arrived at.
 * Stops without a scrim contribute zero, which is what makes it fade up out of
 * nothing on the way into 05 and back down on the way out.
 */
function nanoscaleScrubberScrimAt(timelineProgress, lastStop) {
  const clamped = Math.min(Math.max(timelineProgress, 1), lastStop)
  const lower = Math.floor(clamped)
  const upper = Math.min(lastStop, lower + 1)
  const blend = clamped - lower
  const from = nanoscaleTimelineScrubberAt(lower).scrim
  const to = nanoscaleTimelineScrubberAt(upper).scrim
  const mix = (a, b) => a + ((b - a) * blend)
  return {
    color: (blend > 0.5 ? to : from)?.fill.color ?? to?.fill.color ?? from?.fill.color ?? '#000000',
    strength: mix(from?.fill.opacity ?? 0, to?.fill.opacity ?? 0),
    blur: mix(from?.blur ?? 0, to?.blur ?? 0)
  }
}

function shadowToCss(value) {
  if (!value || !Number.isFinite(value.blur) || value.blur <= 0) return 'none'
  return `${value.x ?? 0}px ${value.y ?? 0}px ${value.blur}px ${value.color ?? '#00000040'}`
}

function sceneMarkup() {
  return UNIQUE_CAMERA_LAYERS.map(layerId => {
    const source = VISUAL_SOURCES[layerId]
    if (!source) throw new Error(`Missing nanoscale visual source for ${layerId}`)
    const cameraScene = NANOSCALE_CAMERA_SCENES.find(scene => scene.layerId === layerId)
    const artLayers = [
      ...(cameraScene?.underlays ?? []),
      ...(cameraScene?.cameraGroup?.layers ?? [{
        id: 'primary',
        asset: source.image,
        assetPath: true
      }])
    ]
    const artMarkup = artLayers.map(layer => `
      <img
        class="nz__scene-art"
        data-nz-art-layer="${layer.id}"
        src="${assetUrl(layer.assetPath ? layer.asset : `${NANOSCALE_ASSET_ROOT}/${layer.asset}`)}"
        alt=""
        draggable="false"
      >
    `).join('')
    return `
      <figure class="nz__scene" data-nz-scene="${layerId}" aria-hidden="true">
        <div class="nz__scene-camera" data-nz-camera>${artMarkup}</div>
      </figure>
    `
  }).join('')
}

export function nestNanoscaleCameraMarkup(contentMarkup) {
  if (typeof contentMarkup !== 'string') {
    throw new TypeError('Nanoscale camera stack content must be markup')
  }
  let markup = contentMarkup
  for (const segment of NANOSCALE_PRESENTATION_SEGMENTS) {
    markup = `
      <div class="nz__stack-camera" data-nz-stack-camera="${segment}">
        ${markup}
      </div>
    `
  }
  return markup
}

function cameraStackMarkup() {
  return nestNanoscaleCameraMarkup(sceneMarkup())
}

function moduleMarkup() {
  const microsoftLogo = assetUrl(NANOSCALE_UI_IMAGE_PATHS.microsoftLogo)
  const restartIcon = assetUrl(NANOSCALE_UI_IMAGE_PATHS.restartIcon)
  const exitIcon = assetUrl(NANOSCALE_UI_IMAGE_PATHS.exitIcon)
  const dimensionGradientStops = NANOSCALE_LAYOUT[0].annotation.spanGradient
    .map(stop => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}"></stop>`)
    .join('')
  const ticks = NANOSCALE_V3_SEQUENCE.map(stop => `
    <span class="nz__tick" data-nz-tick="${stop.index}" aria-hidden="true"></span>
  `).join('')

  return `
    <section class="nz" data-nz-root data-stop="0" aria-labelledby="nz-title" aria-describedby="nz-controls" tabindex="0">
      <div class="nz__stack" data-nz-stack aria-hidden="true">
        ${cameraStackMarkup()}
      </div>

      <svg class="nz__dimension" data-nz-dimension viewBox="0 0 2160 3840" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="nz-hardware-scale-gradient" data-nz-span-gradient gradientUnits="userSpaceOnUse">
            ${dimensionGradientStops}
          </linearGradient>
        </defs>
        <g data-nz-dimension-group>
          <line class="nz__dimension-extension" data-nz-extension="from"></line>
          <line class="nz__dimension-extension" data-nz-extension="to"></line>
          <line class="nz__dimension-span" data-nz-span="from"></line>
          <line class="nz__dimension-span" data-nz-span="to"></line>
          <polygon class="nz__dimension-arrow" data-nz-arrow="from"></polygon>
          <polygon class="nz__dimension-arrow" data-nz-arrow="to"></polygon>
        </g>
      </svg>
      <p class="nz__dimension-label" data-nz-dimension-label aria-hidden="true"></p>

      <header class="nz__header microsoft-header">
        <div class="microsoft-brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo">
            <img src="${microsoftLogo}" alt="Microsoft" draggable="false">
          </span>
          <span class="microsoft-brand__divider" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum">Quantum</span>
        </div>

        <div class="microsoft-header__actions">
          <button class="microsoft-header__action" type="button" data-nz-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${restartIcon}" alt="" draggable="false">
            </span>
          </button>
          <button class="microsoft-header__action" type="button" data-nz-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${exitIcon}" alt="" draggable="false">
            </span>
          </button>
        </div>
      </header>

      <h1 class="nz__sr" id="nz-title">Nanoscale of topological qubits</h1>
      <p class="nz__sr" id="nz-controls">Use pinch, vertical drag, mouse wheel, arrow keys, plus, or minus to move through the zoom journey.</p>

      <div data-nz-intro-slot></div>
      <div data-nz-instruction-slot></div>
      <div data-nz-identity-slot></div>

      <!-- Comparison is authored media, not an explainer; keep its two Figma boxes independent. -->
      <figure class="nz__comparison" data-nz-comparison aria-hidden="true">
        <div class="nz__comparison-media-frame" data-nz-comparison-media-host></div>
        <figcaption class="nz__comparison-footer">
          <span>About the size of</span>
          <strong data-nz-comparison-caption></strong>
        </figcaption>
      </figure>

      <div data-nz-scroll-cue-slot></div>

      <div class="nz__scrubber" data-nz-scrubber aria-hidden="true">
        <span class="nz__scrubber-number" data-nz-number></span>
        <span class="nz__scrubber-axis"></span>
        ${ticks}
        <span class="nz__scrubber-marker" data-nz-marker></span>
      </div>

      ${finaleMarkup()}

      <p class="nz__sr" data-nz-status aria-live="polite"></p>
    </section>
  `
}

function finaleMarkup() {
  const [impact, scale] = NANOSCALE_V3_FINALE
  return `
    <!-- Figma-authored full-stage scrollytelling: intentionally not a floating kiosk-explainer. -->
    <div class="nz__finale" data-nz-finale aria-hidden="true" inert>
      <div class="nz__finale-atmosphere" data-nz-finale-atmosphere aria-hidden="true"></div>
      <div class="nz__finale-track" data-nz-finale-track>
        <section class="nz__finale-section nz__finale-section--impact" data-nz-finale-section="impact" aria-labelledby="nz-finale-impact-title" aria-hidden="true" inert>
          <svg class="nz__finale-guide" data-nz-finale-guide viewBox="0 0 20 970" aria-hidden="true" focusable="false">
            <line x1="10" y1="0" x2="10" y2="944"></line>
            <circle cx="10" cy="960" r="10"></circle>
          </svg>
          <div class="nz__finale-copy nz__finale-copy--impact">
            <h2 id="nz-finale-impact-title" data-nz-finale-heading="impact">${impact.title}</h2>
            <div class="nz__finale-paragraphs">
              ${impact.paragraphs.map((copy, index) => `<p data-nz-finale-paragraph="impact-${index}">${copy}</p>`).join('')}
            </div>
          </div>
          <div data-nz-finale-prompt-slot></div>
        </section>

        <section class="nz__finale-section nz__finale-section--scale" data-nz-finale-section="scale" aria-labelledby="nz-finale-scale-title" aria-hidden="true" inert>
          <div class="nz__finale-copy nz__finale-copy--scale">
            <h2 id="nz-finale-scale-title" data-nz-finale-heading="scale">${scale.title}</h2>
            <div class="nz__finale-paragraphs">
              ${scale.paragraphs.map((copy, index) => `<p data-nz-finale-paragraph="scale-${index}">${copy}</p>`).join('')}
            </div>
          </div>
          <figure class="nz__finale-figure" data-nz-finale-figure>
            <p class="nz__finale-count" data-nz-finale-count>
              <span class="nz__finale-count-value" data-nz-finale-count-value>0</span>
              <span class="nz__finale-count-unit">${scale.counter.unit}</span>
            </p>
            <span class="nz__finale-scale-label nz__finale-scale-label--machine">${scale.figure.machineLabel}</span>
            <span class="nz__finale-scale-label nz__finale-scale-label--other">${scale.figure.otherLabel}</span>
            <span class="nz__finale-divider" aria-hidden="true"></span>
            <!-- The ground the count has not reached yet, under the crisp field
                 that the count wipes across it. -->
            <img class="nz__finale-field-ghost" src="${assetUrl(scale.figure.pixels)}" alt="" draggable="false" aria-hidden="true">
            <img class="nz__finale-field" src="${assetUrl(scale.figure.image)}" alt="${scale.figure.alt}" draggable="false">
            <img class="nz__finale-marker" src="${assetUrl(scale.figure.marker)}" alt="" draggable="false" aria-hidden="true">
          </figure>
        </section>
      </div>
    </div>
  `
}

function comparisonAlt(stop) {
  return `${stop.name}, about the same size as ${stop.comparison.caption}`
}

function createNanoscaleExplainers(root) {
  const intro = createKioskExplainer({
    ariaHidden: true,
    body: NANOSCALE_V3_SPLASH.body,
    className: 'nz__intro',
    tagName: 'aside',
    title: NANOSCALE_V3_SPLASH.title,
    variant: 'glass',
    visible: false
  })
  intro.element.dataset.nzIntro = ''

  const instruction = createKioskTooltip({
    ariaHidden: true,
    className: 'nz__instruction',
    text: NANOSCALE_V3_SPLASH.instruction
  })
  instruction.element.dataset.nzInstruction = ''

  const identity = createKioskExplainer({
    ariaHidden: true,
    className: 'nz__identity',
    tagName: 'aside',
    variant: 'glass',
    visible: false
  })
  identity.element.dataset.nzIdentity = ''
  identity.title.dataset.nzName = ''
  identity.body.dataset.nzCopy = ''

  const finalePrompt = createKioskTooltip({
    ariaHidden: true,
    className: 'nz__finale-prompt',
    text: NANOSCALE_V3_FINALE[0].instruction
  })
  finalePrompt.element.dataset.nzFinalePrompt = ''

  root.querySelector('[data-nz-intro-slot]').replaceWith(intro.element)
  const scrollCue = createKioskTooltip({
    className: 'nz__scroll-cue',
    text: NANOSCALE_SCROLL_CUE
  })
  root.querySelector('[data-nz-scroll-cue-slot]').replaceWith(scrollCue.element)
  root.querySelector('[data-nz-instruction-slot]').replaceWith(instruction.element)
  root.querySelector('[data-nz-identity-slot]').replaceWith(identity.element)
  root.querySelector('[data-nz-finale-prompt-slot]').replaceWith(finalePrompt.element)

  return Object.freeze({ finalePrompt, identity, instruction, intro, scrollCue })
}

/* App startup calls this while the visitor is still outside the experience;
   mount awaits the same promise, so the two paths never duplicate image work. */
export function preload() {
  return preloadNanoscaleAssets()
}

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) throw new TypeError('Nanoscale requires a DOM container')

  const { signal, onActivity, navigate = {} } = options
  if (signal?.aborted) throw createAbortError()

  if (import.meta.env?.DEV) assertValidNanoscaleCamera()

  await waitForNanoscaleAssets({ signal })
  if (signal?.aborted) throw createAbortError()

  const host = document.createElement('div')
  host.innerHTML = moduleMarkup().trim()
  const root = host.firstElementChild
  const explainers = createNanoscaleExplainers(root)
  const comparisonMediaHost = root.querySelector('[data-nz-comparison-media-host]')
  const firstStop = NANOSCALE_V3_SEQUENCE[0]
  const comparisonMediaStack = createNanoscaleComparisonMediaStack({
    activeReference: firstStop,
    alt: comparisonAlt(firstStop),
    ownerDocument: root.ownerDocument
  })
  comparisonMediaHost.append(comparisonMediaStack)
  await decodeNanoscaleStageImages(root, { signal })
  if (signal?.aborted) throw createAbortError()
  container.replaceChildren(root)

  const sceneElements = new Map(
    [...root.querySelectorAll('[data-nz-scene]')]
      .map(element => [element.dataset.nzScene, element])
  )
  const sceneStyles = new Map(
    [...sceneElements.values()].map(element => [element, {
      camera: element.querySelector('[data-nz-camera]'),
      transform: null,
      opacity: null,
      visible: null,
      zIndex: null,
      opacityPromoted: null
    }])
  )

  /* Layers that hold back until their own stop is the one on screen. */
  const revealedArtLayers = []

  for (const [layerId, element] of sceneElements) {
    const source = VISUAL_SOURCES[layerId]
    const cameraScene = NANOSCALE_CAMERA_SCENES.find(scene => scene.layerId === layerId)
    for (const plate of cameraScene?.underlays ?? []) {
      const art = element.querySelector(`[data-nz-art-layer="${plate.id}"]`)
      art.style.left = `${plate.artBox.x}px`
      art.style.top = `${plate.artBox.y}px`
      art.style.width = `${plate.artBox.width}px`
      art.style.height = `${plate.artBox.height}px`
      art.style.opacity = String(plate.opacity ?? 1)
      art.style.setProperty('--nz-scene-fit', plate.fit ?? 'fill')
      art.style.setProperty('--nz-scene-position', 'center center')
    }

    const groupLayers = cameraScene?.cameraGroup?.layers
    if (groupLayers?.length) {
      for (const layer of groupLayers) {
        const art = element.querySelector(`[data-nz-art-layer="${layer.id}"]`)
        const opacity = String(layer.opacity ?? 1)
        art.style.left = `${layer.artBox.x}px`
        art.style.top = `${layer.artBox.y}px`
        art.style.width = `${layer.artBox.width}px`
        art.style.height = `${layer.artBox.height}px`
        art.style.opacity = opacity
        art.style.setProperty('--nz-scene-fit', layer.fit ?? 'fill')
        art.style.setProperty('--nz-scene-position', 'center center')
        if (layer.mask) {
          art.dataset.nzArtMask = ''
          art.style.setProperty('--nz-art-mask', maskImageToCss(layer.mask))
        }
        if (layer.revealWithStop) {
          art.dataset.nzArtReveal = ''
          art.style.setProperty('--nz-art-reveal-delay', `${layer.revealDelayMs ?? 0}ms`)
          art.style.opacity = '0'
          revealedArtLayers.push({ element: art, opacity, stop: cameraScene.stop })
        }
      }
      continue
    }

    const artBox = cameraScene?.art?.artBox ?? source.box
    const art = element.querySelector('[data-nz-art-layer="primary"]')
    art.style.left = `${artBox.x}px`
    art.style.top = `${artBox.y}px`
    art.style.width = `${artBox.width}px`
    art.style.height = `${artBox.height}px`
    art.style.setProperty('--nz-scene-fit', cameraScene?.art?.fit ?? source.fit ?? 'cover')
    art.style.setProperty('--nz-scene-position', cameraScene?.art?.objectPosition ?? source.anchor ?? 'center center')
  }


  const dimensionLabel = root.querySelector('[data-nz-dimension-label]')
  const spans = {
    from: root.querySelector('[data-nz-span="from"]'),
    to: root.querySelector('[data-nz-span="to"]')
  }
  const spanGradient = root.querySelector('[data-nz-span-gradient]')
  const extensions = {
    from: root.querySelector('[data-nz-extension="from"]'),
    to: root.querySelector('[data-nz-extension="to"]')
  }
  const arrows = {
    from: root.querySelector('[data-nz-arrow="from"]'),
    to: root.querySelector('[data-nz-arrow="to"]')
  }
  const intro = explainers.intro.element
  const instruction = explainers.instruction.element
  const scrollCue = explainers.scrollCue.element
  const identity = explainers.identity.element
  const finalePrompt = explainers.finalePrompt.element
  const comparison = root.querySelector('[data-nz-comparison]')
  const comparisonCaption = root.querySelector('[data-nz-comparison-caption]')
  const scrubberNumber = root.querySelector('[data-nz-number]')
  const marker = root.querySelector('[data-nz-marker]')
  const ticks = [...root.querySelectorAll('[data-nz-tick]')]
  const status = root.querySelector('[data-nz-status]')
  const finale = root.querySelector('[data-nz-finale]')
  const finaleAtmosphere = root.querySelector('[data-nz-finale-atmosphere]')
  const finaleTrack = root.querySelector('[data-nz-finale-track]')
  const finaleGuide = root.querySelector('[data-nz-finale-guide]')
  const finaleSections = new Map(
    [...root.querySelectorAll('[data-nz-finale-section]')]
      .map(element => [element.dataset.nzFinaleSection, element])
  )
  const finaleHeadings = new Map(
    [...root.querySelectorAll('[data-nz-finale-heading]')]
      .map(element => [element.dataset.nzFinaleHeading, element])
  )
  const finaleParagraphs = new Map(
    [...root.querySelectorAll('[data-nz-finale-paragraph]')]
      .map(element => [element.dataset.nzFinaleParagraph, element])
  )
  const finaleFigure = root.querySelector('[data-nz-finale-figure]')
  const finaleCount = root.querySelector('[data-nz-finale-count]')
  const finaleCountValue = root.querySelector('[data-nz-finale-count-value]')

  /* The count runs once the last screen has landed, rather than being scrubbed:
     there is no track left past this screen to scrub it against — it is the end
     of the module — so tying it to progress would leave it frozen at whatever
     the entry animation happened to stop on. It restarts if the visitor scrolls
     away and comes back. */
  const countTarget = NANOSCALE_V3_FINALE.at(-1).counter.target
  let countFrame = null
  let countStartedAt = null

  function writeCount(state) {
    finaleCountValue.textContent = formatNanoscaleCount(state.value)
    finaleFigure.style.setProperty('--nz-field-fill', state.progress.toFixed(4))
  }

  function stepCount(now) {
    countFrame = null
    if (disposed || countStartedAt === null) return
    const state = nanoscaleCountState(now - countStartedAt, { target: countTarget })
    writeCount(state)
    if (state.progress < 1) countFrame = requestAnimationFrame(stepCount)
  }

  function startCount() {
    if (countStartedAt !== null) return
    countStartedAt = performance.now()
    if (reducedMotion?.matches) {
      writeCount(nanoscaleCountState(0, { target: countTarget, reducedMotion: true }))
      return
    }
    writeCount(nanoscaleCountState(0, { target: countTarget }))
    countFrame = requestAnimationFrame(stepCount)
  }

  function resetCount() {
    if (countStartedAt === null && countFrame === null) return
    if (countFrame !== null) cancelAnimationFrame(countFrame)
    countFrame = null
    countStartedAt = null
    writeCount(nanoscaleCountState(0, { target: countTarget }))
  }

  writeCount(nanoscaleCountState(0, { target: countTarget }))
  const stack = root.querySelector('[data-nz-stack]')
  const stackCameras = NANOSCALE_PRESENTATION_SEGMENTS.map(segment => (
    root.querySelector(`[data-nz-stack-camera="${segment}"]`)
  ))
  const explainerVisibility = new WeakMap()

  const listeners = new AbortController()
  const pointers = new Map()
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  let disposed = false
  let progress = 0
  let arrivedStop = 0
  let renderedTimelineStop = -1
  let announcedTimelineStop = -1
  let announcedFinaleSection = null
  let settledAt = performance.now()
  let frame = null
  let settle = null
  let gesture = null
  let wheelTarget = null
  let wheelUnlockTimer = null
  let holdSnapTimer = null
  let writtenMarkerX = null
  let writtenScrim = null
  let writtenScrubberColors = null
  let writtenFinale = null
  let writtenNumberOpacity = null
  const writtenPresentationTransforms = Array(stackCameras.length).fill(null)
  const writtenPresentationPromoted = Array(stackCameras.length).fill(null)
  const writtenPresentationOpacities = Array(stackCameras.length).fill(null)
  let writtenFinalePromoted = null

  root.style.setProperty('--nz-scrubber-x', `${NANOSCALE_SCRUBBER.x}px`)
  root.style.setProperty('--nz-scrubber-y', `${NANOSCALE_SCRUBBER.y}px`)
  root.style.setProperty('--nz-scrubber-width', `${NANOSCALE_SCRUBBER.width}px`)
  ticks.forEach((tick, index) => {
    tick.style.left = `${NANOSCALE_SCRUBBER.tickOffsets[index]}px`
  })

  function placeBox(element, value) {
    element.style.left = `${value.x}px`
    element.style.top = `${value.y}px`
    element.style.width = `${value.width}px`
    element.style.height = `${value.height}px`
  }

  placeBox(intro, NANOSCALE_SPLASH_LAYOUT.ui.intro.explainerBox)
  const introLayout = NANOSCALE_SPLASH_LAYOUT.ui.intro
  const introTitle = introLayout.title
  const introBody = introLayout.body
  intro.style.setProperty('--nz-intro-title-width', `${introTitle.box.width}px`)
  intro.style.setProperty('--nz-intro-title-height', `${introTitle.box.height}px`)
  intro.style.setProperty('--nz-intro-title-size', `${introTitle.type.fontSize}px`)
  intro.style.setProperty('--nz-intro-title-weight', String(introTitle.type.fontWeight))
  intro.style.setProperty('--nz-intro-title-tracking', introTitle.type.letterSpacing)
  intro.style.setProperty('--nz-intro-title-leading', `${introTitle.type.lineHeight}px`)
  intro.style.setProperty('--nz-intro-body-width', `${introBody.box.width}px`)
  intro.style.setProperty('--nz-intro-body-height', `${introBody.box.height}px`)
  intro.style.setProperty('--nz-intro-body-size', `${introBody.type.fontSize}px`)
  intro.style.setProperty('--nz-intro-body-weight', String(introBody.type.fontWeight))
  intro.style.setProperty('--nz-intro-body-tracking', introBody.type.letterSpacing)
  intro.style.setProperty('--nz-intro-body-leading', `${introBody.type.lineHeight}px`)

  const instructionLayout = introLayout.instruction
  const instructionBox = instructionLayout.box
  instruction.style.left = `${instructionBox.x + (instructionBox.width / 2)}px`
  instruction.style.top = `${instructionBox.y}px`
  instruction.style.width = `${instructionBox.width}px`
  instruction.style.height = `${instructionBox.height}px`
  instruction.style.setProperty('--nz-instruction-padding-x', `${instructionLayout.padding.x}px`)
  instruction.style.setProperty('--nz-instruction-padding-y', `${instructionLayout.padding.y}px`)
  instruction.style.setProperty('--nz-instruction-size', `${instructionLayout.type.fontSize}px`)
  instruction.style.setProperty('--nz-instruction-weight', String(instructionLayout.type.fontWeight))
  instruction.style.setProperty('--nz-instruction-tracking', instructionLayout.type.letterSpacing)
  instruction.style.setProperty('--nz-instruction-leading', `${instructionLayout.type.lineHeight}px`)

  function setSvgLine(element, geometry) {
    element.style.display = geometry ? '' : 'none'
    if (!geometry) return
    element.setAttribute('x1', String(geometry.from.x))
    element.setAttribute('y1', String(geometry.from.y))
    element.setAttribute('x2', String(geometry.to.x))
    element.setAttribute('y2', String(geometry.to.y))
  }

  function arrowPoints(x, y, axis, direction, size) {
    const halfWidth = size / Math.sqrt(3)
    if (axis === 'vertical') {
      const baseY = y - (size * direction)
      return `${x - halfWidth},${baseY} ${x + halfWidth},${baseY} ${x},${y}`
    }
    const baseX = x - (size * direction)
    return `${baseX},${y - halfWidth} ${baseX},${y + halfWidth} ${x},${y}`
  }

  /* Spans are axis aligned, so a position along the measured axis is a whole point. */
  function pointAlong(annotation, position) {
    return annotation.axis === 'vertical'
      ? { x: annotation.from.x, y: position }
      : { x: position, y: annotation.from.y }
  }

  /*
   * The label sits in a break in the line rather than on a plate over it, so the
   * span is drawn as two arrows that point away from the number. Each half is
   * drawn from the break outwards, which is also the direction its arrowhead
   * points; a half with no room left simply does not paint.
   */
  function drawSpanHalves(annotation, centre) {
    const axisKey = annotation.axis === 'vertical' ? 'y' : 'x'
    const start = annotation.from[axisKey]
    const end = annotation.to[axisKey]
    const direction = Math.sign(end - start) || 1
    const half = (annotation.labelGap ?? 0) / 2
    const low = Math.min(start, end)
    const high = Math.max(start, end)
    const clamp = position => Math.min(Math.max(position, low), high)

    const edges = {
      from: clamp(centre[axisKey] - (half * direction)),
      to: clamp(centre[axisKey] + (half * direction))
    }
    const outer = { from: start, to: end }

    for (const side of ['from', 'to']) {
      const length = Math.abs(outer[side] - edges[side])
      const element = spans[side]
      if (length <= 0) {
        element.style.display = 'none'
        continue
      }
      setSvgLine(element, {
        from: pointAlong(annotation, edges[side]),
        to: pointAlong(annotation, outer[side])
      })
      element.style.setProperty('--nz-span-length', String(length))
    }
  }

  function drawDimension(stop, layout) {
    const annotation = layout.annotation
    const { axis, from, to, label } = annotation

    /* The number goes in the middle of the break, so both arrows come out the
       same length however the retired plate box happened to be positioned. */
    const spanCentre = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2
    }

    drawSpanHalves(annotation, spanCentre)
    setSvgLine(extensions.from, annotation.extensions.from)
    setSvgLine(extensions.to, annotation.extensions.to)

    const arrowSize = annotation.arrow?.size ?? 20
    arrows.from.setAttribute('points', arrowPoints(from.x, from.y, axis, -1, arrowSize))
    arrows.to.setAttribute('points', arrowPoints(to.x, to.y, axis, 1, arrowSize))

    spanGradient.setAttribute('x1', String(from.x))
    spanGradient.setAttribute('y1', String(from.y))
    spanGradient.setAttribute('x2', String(to.x))
    spanGradient.setAttribute('y2', String(to.y))
    const spanStroke = annotation.spanGradient
      ? 'url(#nz-hardware-scale-gradient)'
      : annotation.spanColor
    spans.from.style.stroke = spanStroke
    spans.to.style.stroke = spanStroke
    extensions.from.style.stroke = annotation.extensionColor
    extensions.to.style.stroke = annotation.extensionColor
    arrows.from.style.fill = annotation.arrowColors.from
    arrows.to.style.fill = annotation.arrowColors.to
    root.style.setProperty('--nz-dimension-stroke', `${annotation.strokeWidth}px`)
    root.style.setProperty('--nz-extension-dash', annotation.dashPattern.join(' '))
    root.style.setProperty('--nz-dimension-color', annotation.color)
    root.style.setProperty('--nz-dimension-label-color', label.color)

    dimensionLabel.textContent = stop.dimension.label
    dimensionLabel.style.left = `${spanCentre.x}px`
    dimensionLabel.style.top = `${spanCentre.y}px`
  }

  function applyContentStop(stop) {
    const layout = nanoscaleLayoutAt(stop.index)
    const identityBox = layout.ui.identity.box
    const comparisonBox = layout.ui.comparison.box
    placeBox(identity, identityBox)
    placeBox(comparison, comparisonBox)

    root.style.setProperty(
      '--nz-comparison-media-fill',
      fillToCss(layout.ui.comparison.media.fill, 'transparent')
    )
    root.style.setProperty('--nz-comparison-surface-fill', fillToCss(layout.ui.comparison.fill))
    root.style.setProperty(
      '--nz-caption-fill',
      fillToCss(layout.ui.comparison.footer.fill, 'transparent')
    )
    root.style.setProperty(
      '--nz-comparison-stroke',
      fillToCss({
        color: layout.ui.comparison.media.stroke.color,
        opacity: layout.ui.comparison.media.strokeOpacity
      })
    )
    root.style.setProperty(
      '--nz-comparison-shadow',
      [
        shadowToCss(layout.ui.comparison.shadow),
        layout.ui.comparison.surface.effectVisible
          ? `0 ${layout.ui.comparison.surface.glassOffsetY}px ` +
            `${layout.ui.comparison.surface.glassBlur}px #00000040`
          : null
      ].filter(Boolean).join(', ')
    )
    root.style.setProperty(
      '--nz-comparison-backdrop-filter',
      layout.ui.comparison.surface.effectVisible
        ? `blur(${layout.ui.comparison.surface.refractionRadius}px)`
        : 'none'
    )
    root.style.setProperty('--nz-comparison-caption-color', layout.ui.comparison.captionColor)
    root.style.setProperty(
      '--nz-comparison-caption-size',
      `${layout.ui.comparison.footer.type.fontSize}px`
    )
    root.style.setProperty(
      '--nz-comparison-caption-weight',
      String(layout.ui.comparison.footer.type.fontWeight)
    )
    root.style.setProperty(
      '--nz-comparison-caption-leading',
      `${layout.ui.comparison.footer.type.lineHeight}px`
    )
    root.style.setProperty('--nz-comparison-caption-height', `${layout.ui.comparison.footer.box.height}px`)

    const identityLayout = layout.ui.identity
    root.style.setProperty('--nz-identity-title-x', `${identityLayout.title.box.x}px`)
    root.style.setProperty('--nz-identity-title-y', `${identityLayout.title.box.y}px`)
    root.style.setProperty('--nz-identity-title-width', `${identityLayout.title.box.width}px`)
    root.style.setProperty('--nz-identity-title-height', `${identityLayout.title.box.height}px`)
    root.style.setProperty('--nz-identity-title-size', `${identityLayout.title.type.fontSize}px`)
    root.style.setProperty('--nz-identity-title-weight', String(identityLayout.title.type.fontWeight))
    root.style.setProperty('--nz-identity-title-tracking', identityLayout.title.type.letterSpacing)
    root.style.setProperty('--nz-identity-title-leading', `${identityLayout.title.type.lineHeight}px`)
    root.style.setProperty('--nz-identity-body-x', `${identityLayout.body.box.x}px`)
    root.style.setProperty('--nz-identity-body-y', `${identityLayout.body.box.y}px`)
    root.style.setProperty('--nz-identity-body-width', `${identityLayout.body.box.width}px`)
    root.style.setProperty('--nz-identity-body-height', `${identityLayout.body.box.height}px`)
    root.style.setProperty('--nz-identity-body-size', `${identityLayout.body.type.fontSize}px`)
    root.style.setProperty('--nz-identity-body-weight', String(identityLayout.body.type.fontWeight))
    root.style.setProperty('--nz-identity-body-tracking', identityLayout.body.type.letterSpacing)
    root.style.setProperty('--nz-identity-body-leading', `${identityLayout.body.type.lineHeight}px`)
    const identitySurface = identityLayout.surface
    const identitySurfaceEnabled = identitySurface.effectVisible
    identity.style.setProperty(
      '--kiosk-explainer-background',
      fillToCss(identitySurface.fill, 'transparent')
    )
    identity.style.setProperty(
      '--kiosk-explainer-box-shadow',
      identitySurfaceEnabled
        ? `0 ${identitySurface.glassOffsetY}px ${identitySurface.glassBlur}px rgb(0 0 0 / 0.25), ` +
          'inset 0 1px 0 rgb(255 255 255 / 0.8), ' +
          'inset 0 0 0 1px rgb(255 255 255 / 0.28)'
        : '0 4px 20px rgb(31 55 80 / 0.14)'
    )
    identity.style.setProperty(
      '--kiosk-explainer-backdrop-filter',
      identitySurfaceEnabled ? `blur(${identitySurface.refractionRadius}px)` : 'none'
    )


    updateKioskExplainer(explainers.identity, {
      body: stop.description,
      /* A stop may carry a longer heading for the card than the label used to
         announce it; most do not, and fall back to the label. */
      title: stop.headline ?? stop.name
    })
    setNanoscaleComparisonMediaStackStop(comparisonMediaStack, stop, {
      alt: comparisonAlt(stop)
    })
    comparisonCaption.textContent = stop.comparison.caption
    scrubberNumber.textContent = stop.number
    drawDimension(stop, layout)

  }

  function applyTimelineStop(timelineIndex) {
    if (timelineIndex === renderedTimelineStop) return
    renderedTimelineStop = timelineIndex
    root.dataset.stop = String(timelineIndex)
    revealedArtLayers.forEach(layer => {
      layer.element.style.opacity = timelineIndex === layer.stop ? layer.opacity : '0'
    })
    const timelineStop = nanoscaleTimelineStopAt(timelineIndex)
    if (timelineStop.kind !== 'content') {
      hideNanoscaleComparisonMediaStack(comparisonMediaStack)
      return
    }
    applyContentStop(timelineStop)
  }

  function announceTimelineStop(timelineIndex) {
    if (timelineIndex === announcedTimelineStop) return
    announcedTimelineStop = timelineIndex
    const timelineStop = nanoscaleTimelineStopAt(timelineIndex)
    if (timelineStop.kind === 'splash') {
      status.textContent =
        `${timelineStop.title}. ${timelineStop.body} ${timelineStop.instruction}.`
      return
    }
    if (timelineStop.kind === 'finale') {
      announcedFinaleSection = timelineStop.id
      status.textContent = `${timelineStop.title}. ${timelineStop.paragraphs.join(' ')}`
      return
    }
    status.textContent =
      `${timelineStop.number} of 0${NANOSCALE_LAST_CONTENT_STOP}. ${timelineStop.name}, ` +
      `${timelineStop.dimension.label}, about the size of ${timelineStop.comparison.caption}. ` +
      timelineStop.description
  }

  function setAccessibleVisibility(element, visible) {
    element.setAttribute('aria-hidden', String(!visible))
    element.toggleAttribute('inert', !visible)
  }

  function setExplainerVisibility(explainer, visible) {
    const next = Boolean(visible)
    if (explainerVisibility.get(explainer.element) !== next) {
      updateKioskExplainer(explainer, {
        ariaHidden: !next,
        replay: next,
        visible: next
      })
      explainerVisibility.set(explainer.element, next)
    }
    explainer.element.toggleAttribute('inert', !next)
  }

  function renderCamera() {
    const sample = sampleNanoscaleCamera(progress)
    const presentation = nanoscalePresentationFrame(sample)
    const active = new Set(sample.layers.map(layer => layer.layerId))
    const finaleEntryProgress = clamp(progress - NANOSCALE_LAST_CONTENT_STOP, 0, 1)
    const finaleEntryEased = finaleEntryProgress * finaleEntryProgress *
      (3 - (2 * finaleEntryProgress))
    const pullback = NANOSCALE_FINALE_LAYOUT.pullback
    const stackScale = 1 - ((1 - pullback.scale) * finaleEntryEased)
    const stackOpacity = 1 - (pullback.fade * finaleEntryEased)
    const preparedSegment = Number.isInteger(sample.progress) &&
      sample.progress < NANOSCALE_PRESENTATION_SEGMENTS.length
      ? sample.progress
      : progress >= NANOSCALE_LAST_CONTENT_STOP
        ? NANOSCALE_PRESENTATION_SEGMENTS.at(-1)
        : null
    presentation.cameraTransforms.forEach((baseCameraTransform, segment) => {
      const camera = stackCameras[segment]
      const promoted = segment === presentation.movingSegment || segment === preparedSegment
      const cameraTransform = segment === NANOSCALE_PRESENTATION_SEGMENTS.at(-1) && finaleEntryProgress > 0
        ? nanoscalePullbackCameraTransform(baseCameraTransform, stackScale)
        : baseCameraTransform
      const identity = cameraTransform.scale === 1 &&
        cameraTransform.translateX === 0 && cameraTransform.translateY === 0
      const transform = identity
        ? 'none'
        : promoted
          ? nanoscaleCameraCssTransform(cameraTransform)
          : nanoscaleSceneCssTransform(cameraTransform)
      if (writtenPresentationTransforms[segment] !== transform) {
        camera.style.transform = transform
        writtenPresentationTransforms[segment] = transform
      }
      /* W4 also owns the finale-entry fade. Give its existing surface the opacity
         reason as soon as that bounded camera is prepared, so entering the
         finale does not rebuild the full retained stack on its first frame. */
      const promotion = promoted
        ? segment === NANOSCALE_PRESENTATION_SEGMENTS.at(-1)
          ? 'transform, opacity'
          : 'transform'
        : 'auto'
      if (writtenPresentationPromoted[segment] !== promotion) {
        camera.style.willChange = promotion
        writtenPresentationPromoted[segment] = promotion
      }
      const opacity = String(segment === NANOSCALE_PRESENTATION_SEGMENTS.at(-1)
        ? stackOpacity
        : 1)
      if (writtenPresentationOpacities[segment] !== opacity) {
        camera.style.opacity = opacity
        writtenPresentationOpacities[segment] = opacity
      }
    })

    presentation.layers.forEach(({ layer, localTransform }, order) => {
      const element = sceneElements.get(layer.layerId)
      const written = sceneStyles.get(element)
      const transform = nanoscaleSceneCssTransform(localTransform)
      const opacity = String(layer.opacity)
      const zIndex = String(order + 1)
      /*
       * Retained children remain fixed in the initial stage coordinate space.
       * Only the imminent or moving bounded wrapper owns a compositor hint;
       * completed wrappers remain 2D matrices and flatten into their parent.
       */
      const opacityPromoted = layer.opacity > 0 && layer.opacity < 1

      if (written.transform !== transform) {
        written.camera.style.transform = transform
        written.transform = transform
      }
      if (written.opacity !== opacity) {
        element.style.opacity = opacity
        written.opacity = opacity
      }
      if (written.zIndex !== zIndex) {
        element.style.zIndex = zIndex
        written.zIndex = zIndex
      }
      if (written.opacityPromoted !== opacityPromoted) {
        element.style.willChange = opacityPromoted ? 'opacity' : 'auto'
        written.opacityPromoted = opacityPromoted
      }
      if (written.visible !== true) {
        element.style.visibility = 'visible'
        written.visible = true
      }
    })

    for (const [layerId, element] of sceneElements) {
      if (active.has(layerId)) continue
      const written = sceneStyles.get(element)
      if (written.visible !== false) {
        element.style.opacity = '0'
        element.style.visibility = 'hidden'
        written.camera.style.willChange = 'auto'
        element.style.willChange = 'auto'
        written.opacity = '0'
        written.visible = false
        written.opacityPromoted = false
      }
    }
    return { finaleEntryEased, finaleEntryProgress }
  }

  function render() {
    frame = null
    const nearest = nearestNanoscaleStop(progress, NANOSCALE_V3_STOPS)
    /* Deliberately not gated on `gesture === null`. Resting a hand on the glass
       after a pinch is not the same as still zooming, and requiring the release
       meant the copy for a stop stayed hidden for as long as someone kept
       touching it. What settles the module is the content coming to rest on a
       stop, which the position test below measures directly. */
    const settled = settle === null && Math.abs(progress - nearest) <= 0.001
    const contentSettled = settled && nearest > 0 && arrivedStop === nearest
    const reveal = contentSettled
      ? nanoscaleRevealState(reducedMotion?.matches ? Number.POSITIVE_INFINITY : performance.now() - settledAt)
      : { visual: true, identity: false, measurement: false }

    applyTimelineStop(arrivedStop)
    const { finaleEntryEased, finaleEntryProgress } = renderCamera()
    const finaleSample = sampleNanoscaleFinale(progress)
    const finaleVisible = finaleEntryProgress > 0
    const finaleIsMoving = finaleVisible && (gesture !== null || settle !== null)

    /* The two full-stage Figma frames form one virtual track. `progress` is its
       only state, so reversing through any fractional position is deterministic. */
    if (writtenFinalePromoted !== finaleIsMoving) {
      stack.style.willChange = 'auto'
      finaleTrack.style.willChange = finaleIsMoving ? 'transform' : 'auto'
      writtenFinalePromoted = finaleIsMoving
    }
    const finaleKey = [
      finaleSample.trackY,
      finaleSample.atmosphereOpacity,
      finaleSample.impact.heading,
      ...finaleSample.impact.paragraphs,
      finaleSample.impact.prompt,
      finaleSample.scale.heading,
      ...finaleSample.scale.paragraphs,
      finaleSample.scale.figure
    ].map(value => value.toFixed(4)).join('|')
    if (finaleKey !== writtenFinale) {
      finaleTrack.style.transform = `translate3d(0, ${finaleSample.trackY.toFixed(2)}px, 0)`
      finaleAtmosphere.style.opacity = finaleSample.atmosphereOpacity.toFixed(4)
      finaleGuide.style.opacity = finaleSample.impact.heading.toFixed(4)
      finaleHeadings.get('impact').style.opacity = finaleSample.impact.heading.toFixed(4)
      finaleSample.impact.paragraphs.forEach((opacity, index) => {
        finaleParagraphs.get(`impact-${index}`).style.opacity = opacity.toFixed(4)
      })
      finalePrompt.style.opacity = finaleSample.impact.prompt.toFixed(4)
      finaleHeadings.get('scale').style.opacity = finaleSample.scale.heading.toFixed(4)
      finaleSample.scale.paragraphs.forEach((opacity, index) => {
        finaleParagraphs.get(`scale-${index}`).style.opacity = opacity.toFixed(4)
      })
      finaleFigure.style.opacity = finaleSample.scale.figure.toFixed(4)
      writtenFinale = finaleKey
    }
    finale.style.visibility = finaleVisible ? 'visible' : 'hidden'
    root.dataset.finaleSection = finaleSample.dominantSection
    /* Keyed on the screen being presented rather than on the scrubber having
       landed on stop 7: the last screen is reached by the finale's free scroll,
       which holds wherever the hand let go and only registers an arrival if it
       lands exactly on the stop. Opacity is what "this screen is up" actually
       means here.

       Half rather than nearly-all, because the free scroll will happily rest
       part way through the fade — at 6.9 the screen is most of the way in, and
       waiting for 1 would leave someone looking at a finished screen with the
       count still reading zero. The gap between the two thresholds stops a rest
       near the boundary from restarting it over and over. */
    if (finaleSample.scale.figure >= 0.5) startCount()
    else if (finaleSample.scale.figure < 0.2) resetCount()

    const splashVisible = settled && nearest === 0 && arrivedStop === 0
    const specimenSettled = contentSettled && arrivedStop <= NANOSCALE_LAST_CONTENT_STOP
    root.classList.toggle('is-splash', splashVisible)
    root.classList.toggle('has-science-ui', arrivedStop > 0)
    root.classList.toggle('is-settled', settled)
    root.classList.toggle('is-identity', reveal.identity && specimenSettled)
    root.classList.toggle('is-measurement', reveal.measurement && specimenSettled)
    /* The last numbered stop only. The earlier stops have the scrubber and the
       specimen to work through; 05 is where the sequence runs out and there is
       nothing on screen to say the module carries on below it. */
    root.classList.toggle(
      'is-scroll-cue',
      specimenSettled && arrivedStop === NANOSCALE_LAST_CONTENT_STOP
    )

    setExplainerVisibility(explainers.intro, splashVisible)
    setAccessibleVisibility(instruction, splashVisible)
    setExplainerVisibility(explainers.identity, specimenSettled && reveal.identity)
    setAccessibleVisibility(comparison, specimenSettled && reveal.measurement)
    setAccessibleVisibility(finale, finaleVisible && !finaleIsMoving)
    for (const [id, section] of finaleSections) {
      setAccessibleVisibility(
        section,
        finaleVisible && !finaleIsMoving && id === finaleSample.dominantSection
      )
    }
    setAccessibleVisibility(finalePrompt, false)
    if (settled) {
      announceTimelineStop(nearest)
    } else if (finaleVisible && !finaleIsMoving && announcedFinaleSection !== finaleSample.dominantSection) {
      announcedFinaleSection = finaleSample.dominantSection
      announceTimelineStop(finaleSample.dominantSection === 'impact' ? 6 : 7)
    }

    if (contentSettled && !reveal.measurement) requestRender()

    const markerOffsets = NANOSCALE_SCRUBBER.tickOffsets
    const contentProgress = clamp(progress - 1, 0, NANOSCALE_LAST_CONTENT_STOP - 1)
    const markerFromIndex = Math.floor(contentProgress)
    const markerToIndex = Math.ceil(contentProgress)
    const markerLocalProgress = contentProgress - markerFromIndex
    const markerFrom = markerOffsets[markerFromIndex]
    const markerTo = markerOffsets[markerToIndex]
    /* Figma's odd-width marker/number boxes are centred half a pixel left of
       their 4px tick strokes. Preserve that authored subpixel registration. */
    const markerX = `${(markerFrom + ((markerTo - markerFrom) * markerLocalProgress) - 0.5).toFixed(2)}px`
    if (markerX !== writtenMarkerX) {
      marker.style.setProperty('--nz-marker-x', markerX)
      scrubberNumber.style.setProperty('--nz-marker-x', markerX)
      writtenMarkerX = markerX
    }

    const numberOpacity = (1 - finaleEntryEased).toFixed(3)
    if (numberOpacity !== writtenNumberOpacity) {
      scrubberNumber.style.opacity = numberOpacity
      root.style.setProperty('--nz-scrubber-opacity', numberOpacity)
      /* Same curve as the timeline: both belong to the numbered stops, and both
         are answered by the act of scrolling on. */
      scrollCue.style.opacity = numberOpacity
      writtenNumberOpacity = numberOpacity
    }

    const scrubberColors = nanoscaleScrubberColorsAt(
      progress,
      NANOSCALE_LAST_CONTENT_STOP,
      ticks.length
    )
    const scrubberColorKey = [
      scrubberColors.track,
      scrubberColors.marker,
      scrubberColors.number,
      ...scrubberColors.ticks
    ].join('|')
    if (scrubberColorKey !== writtenScrubberColors) {
      root.style.setProperty('--nz-scrubber-axis-color', scrubberColors.track)
      root.style.setProperty('--nz-scrubber-marker-color', scrubberColors.marker)
      root.style.setProperty('--nz-scrubber-number-color', scrubberColors.number)
      ticks.forEach((tick, index) => {
        tick.style.backgroundColor = scrubberColors.ticks[index]
      })
      writtenScrubberColors = scrubberColorKey
    }

    const scrim = nanoscaleScrubberScrimAt(progress, NANOSCALE_LAST_CONTENT_STOP)
    /* Below a hair of blur the plate is invisible anyway, and `none` keeps the
       stage out of a backdrop root while the camera is moving. */
    const scrimFilter = scrim.blur < 0.05 ? 'none' : `blur(${scrim.blur.toFixed(2)}px)`
    const scrimFill = scrim.strength < 0.001
      ? 'transparent'
      : fillToCss({ color: scrim.color, opacity: Number(scrim.strength.toFixed(3)) })
    const scrimKey = `${scrimFill} ${scrimFilter}`
    if (scrimKey !== writtenScrim) {
      root.style.setProperty('--nz-scrubber-scrim-fill', scrimFill)
      root.style.setProperty('--nz-scrubber-scrim-filter', scrimFilter)
      writtenScrim = scrimKey
    }
  }

  function requestRender() {
    if (disposed || frame !== null) return
    frame = requestAnimationFrame(render)
  }

  function setProgress(next) {
    const clamped = clamp(next, 0, LAST_STOP)
    if (clamped === progress) return
    progress = clamped
    requestRender()
  }

  function arriveAt(target) {
    const changedStop = arrivedStop !== target
    progress = target
    arrivedStop = target
    if (changedStop) settledAt = performance.now()
    requestRender()
  }

  function settleTo(target, velocity) {
    settle?.cancel()
    settle = null
    if (Math.abs(progress - target) <= 0.001) {
      arriveAt(target)
      return
    }
    if (reducedMotion?.matches) {
      arriveAt(target)
      return
    }

    const from = progress
    const settleMinimum = Math.min(from, target)
    const settleMaximum = Math.max(from, target)
    const started = performance.now()
    let settleFrame = requestAnimationFrame(step)

    function step(now) {
      if (disposed) return
      const sample = sampleSettlingMotion({
        from,
        target,
        initialVelocity: velocity,
        elapsedMs: now - started,
        minimum: settleMinimum,
        maximum: settleMaximum
      })
      setProgress(sample.progress)
      /* A high release velocity can mathematically overshoot a critically
         damped target. The selected stop is a sticky boundary, so reaching
         that boundary completes this settle instead of entering the next
         camera segment and reversing. */
      const reachedTarget = Math.abs(sample.progress - target) <= 1e-9
      if (sample.settled || reachedTarget) {
        settle = null
        arriveAt(target)
        return
      }
      settleFrame = requestAnimationFrame(step)
    }

    settle = { cancel: () => cancelAnimationFrame(settleFrame) }
    requestRender()
  }

  function restart() {
    settle?.cancel()
    settle = null
    progress = 0
    arrivedStop = 0
    renderedTimelineStop = -1
    announcedTimelineStop = -1
    announcedFinaleSection = null
    settledAt = performance.now()
    requestRender()
  }

  function beginGesture() {
    settle?.cancel()
    settle = null
    gesture = {
      startProgress: progress,
      lastProgress: progress,
      lastAt: performance.now(),
      velocity: 0,
      mode: null,
      pinchStart: pointers.size >= 2 ? pinchDistance([...pointers.values()]) : null,
      pointerStart: [...pointers.values()][0]
    }
    root.classList.add('is-zooming')
  }

  function updateGesture() {
    if (!gesture) return
    /* A hold-snap may still be easing into its stop; the hand takes it back. */
    if (settle) {
      settle.cancel()
      settle = null
    }
    const points = [...pointers.values()]
    let delta = 0

    if (points.length >= 2) {
      gesture.mode = 'snap'
      if (gesture.pinchStart === null) gesture.pinchStart = pinchDistance(points)
      delta = pinchDeltaToProgress(gesture.pinchStart, pinchDistance(points))
    } else if (gesture.pointerStart && points[0]) {
      delta = dragDeltaToProgress(
        points[0].y - gesture.pointerStart.y,
        stageScaleOf(root),
        DESIGN_PIXELS_PER_STOP
      )
    }

    const proposed = gesture.startProgress + delta
    if (gesture.mode === null && Math.abs(delta) > 0.001) {
      gesture.mode = isFreeNanoscaleFinaleGesture({
        startProgress: gesture.startProgress,
        deltaProgress: delta,
        pointerCount: points.length,
        reducedMotion: reducedMotion?.matches
      }) ? 'finale-free' : 'snap'
    }
    const next = gesture.mode === 'finale-free'
      ? holdNanoscaleFinaleProgress(proposed)
      : clamp(
          constrainGestureProgress(proposed, gesture.startProgress, NANOSCALE_V3_STOPS),
          0,
          LAST_STOP
        )

    const now = performance.now()
    const elapsed = Math.max(1, now - gesture.lastAt)
    gesture.velocity = ((next - gesture.lastProgress) / elapsed) * 1000
    gesture.lastProgress = next
    gesture.lastAt = now
    setProgress(next)
    scheduleHoldSnap()
  }

  /* A gesture that stops moving is finished in every way that matters to the
     visitor, so it snaps to its stop rather than waiting for the release. */
  function snapWhileHeld() {
    holdSnapTimer = null
    if (disposed || !gesture || gesture.mode === 'finale-free') return
    const target = getVelocityAwareSnapTarget(progress, 0, {
      gestureStartProgress: gesture.startProgress,
      stops: NANOSCALE_V3_STOPS
    })
    if (Math.abs(progress - target) <= 0.001) return
    settleTo(target, 0)
    /* Re-baseline on where the gesture is being taken and where the fingers are
       now — the same thing beginGesture does when the pointer count changes —
       so moving again carries on from the snapped position instead of jumping
       back onto the pre-snap trajectory. */
    const points = [...pointers.values()]
    gesture.startProgress = target
    gesture.lastProgress = target
    gesture.velocity = 0
    gesture.pointerStart = points[0] ?? gesture.pointerStart
    gesture.pinchStart = points.length >= 2 ? pinchDistance(points) : null
  }

  function scheduleHoldSnap() {
    if (holdSnapTimer !== null) clearTimeout(holdSnapTimer)
    holdSnapTimer = setTimeout(snapWhileHeld, NANOSCALE_HOLD_SNAP_MS)
  }

  function cancelHoldSnap() {
    if (holdSnapTimer !== null) clearTimeout(holdSnapTimer)
    holdSnapTimer = null
  }

  function endGesture() {
    cancelHoldSnap()
    root.classList.remove('is-zooming')
    if (!gesture) return
    if (gesture.mode === 'finale-free') {
      const held = holdNanoscaleFinaleProgress(progress)
      gesture = null
      if (Math.abs(held - 6) <= 0.001 || Math.abs(held - 7) <= 0.001) {
        arriveAt(Math.round(held))
      } else {
        progress = held
        requestRender()
      }
      return
    }
    const target = getVelocityAwareSnapTarget(progress, gesture.velocity, {
      gestureStartProgress: gesture.startProgress,
      stops: NANOSCALE_V3_STOPS
    })
    const velocity = gesture.velocity
    gesture = null
    settleTo(target, velocity)
  }

  root.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-nz-action]')) return
    onActivity?.()
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    root.setPointerCapture?.(event.pointerId)
    beginGesture()
  }, { signal: listeners.signal })

  root.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    updateGesture()
  }, { signal: listeners.signal })

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    root.addEventListener(type, event => {
      if (!pointers.delete(event.pointerId)) return
      if (pointers.size === 0) endGesture()
      else beginGesture()
    }, { signal: listeners.signal })
  }

  root.addEventListener('wheel', event => {
    event.preventDefault()
    onActivity?.()
    cancelHoldSnap()
    if (countFrame !== null) cancelAnimationFrame(countFrame)
    if (wheelUnlockTimer !== null) clearTimeout(wheelUnlockTimer)
    wheelUnlockTimer = setTimeout(() => {
      wheelTarget = null
      wheelUnlockTimer = null
    }, 180)
    if (wheelTarget !== null) return
    const direction = Math.sign(event.deltaY) * -1
    const anchor = nearestNanoscaleStop(progress, NANOSCALE_V3_STOPS)
    wheelTarget = nearestNanoscaleStop(anchor + direction, NANOSCALE_V3_STOPS)
    settleTo(wheelTarget, 0)
  }, { passive: false, signal: listeners.signal })

  root.addEventListener('keydown', event => {
    if (event.target.closest('[data-nz-action]')) return
    const advanceKeys = new Set(['ArrowUp', 'ArrowRight', 'PageUp', '+', '='])
    const retreatKeys = new Set(['ArrowDown', 'ArrowLeft', 'PageDown', '-', '_'])
    let target = null
    if (advanceKeys.has(event.key)) target = nearestNanoscaleStop(progress + 1, NANOSCALE_V3_STOPS)
    else if (retreatKeys.has(event.key)) target = nearestNanoscaleStop(progress - 1, NANOSCALE_V3_STOPS)
    else if (event.key === 'Home') target = NANOSCALE_V3_STOPS[0]
    else if (event.key === 'End') target = LAST_STOP
    if (target === null) return
    event.preventDefault()
    onActivity?.()
    settleTo(target, 0)
  }, { signal: listeners.signal })

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-nz-action]')?.dataset.nzAction
    if (!action) return
    onActivity?.()
    if (action === 'restart') restart()
    else if (action === 'exit') navigate.menu?.()
  }, { signal: listeners.signal })

  /* Establish the compact tooltip's hidden baseline before the initial splash
     class is applied so it uses the same authored entrance on first mount. */
  void instruction.offsetWidth
  render()
  root.classList.add('is-ready')

  let presentationWarmup = null

  function nextPaintFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve))
  }

  /* Decoding preserves CPU-side pixels, but a layer that has never been painted
     can still upload its texture on the first zoom frame. ModuleHost calls this
     while the stage is visible behind its opaque transition wipe. */
  function warmCameraTextures() {
    presentationWarmup ??= (async () => {
      stackCameras.forEach((camera, segment) => {
        camera.style.transform = 'none'
        camera.style.opacity = '1'
        camera.style.willChange = 'auto'
        writtenPresentationTransforms[segment] = null
        writtenPresentationPromoted[segment] = null
        writtenPresentationOpacities[segment] = null
      })
      for (const [layerId, element] of sceneElements) {
        if (disposed || signal?.aborted) return
        const written = sceneStyles.get(element)
        element.style.visibility = 'visible'
        element.style.opacity = '1'
        element.style.zIndex = '20'
        written.camera.style.transform = 'matrix(1, 0, 0, 1, 0, 0)'
        written.camera.style.willChange = 'auto'
        element.style.willChange = 'opacity'
        written.transform = null
        written.opacity = null
        written.zIndex = null
        written.visible = true
        written.opacityPromoted = true

        /* Two compositor frames give the browser a paint and a texture commit
           for the current scene before the next heavy image replaces it. */
        await nextPaintFrame()
        await nextPaintFrame()
      }
      if (!disposed && !signal?.aborted) renderCamera()
    })()
    return presentationWarmup
  }

  function dispose() {
    if (disposed) return
    disposed = true
    settle?.cancel()
    if (frame !== null) cancelAnimationFrame(frame)
    if (wheelUnlockTimer !== null) clearTimeout(wheelUnlockTimer)
    listeners.abort()
    pointers.clear()
    disposeKioskExplainer(explainers.intro)
    disposeKioskExplainer(explainers.identity)
    root.remove()
    signal?.removeEventListener?.('abort', dispose)
  }

  signal?.addEventListener?.('abort', dispose, { once: true })
  return { dispose, presentationReady: warmCameraTextures }
}

export default { mount }

import {
  composeNanoscaleSimilarities,
  invertNanoscaleSimilarity,
  sampleNanoscalePresentationSegment
} from './nanoscale-camera.js'

/* CSS does not benefit from sub-pixel floating-point noise. Canonicalizing the
   scene-local transforms keeps their style strings byte-identical while one of
   the five bounded presentation wrappers is moving. */
const LOCAL_TRANSFORM_PRECISION = 1e10
export const NANOSCALE_PRESENTATION_SEGMENTS = Object.freeze([0, 1, 2, 3, 4])
const PRESENTATION_SEGMENT_COUNT = NANOSCALE_PRESENTATION_SEGMENTS.length
const IDENTITY = Object.freeze({ scale: 1, translateX: 0, translateY: 0 })
const PRESENTATION_SEGMENT_ENDPOINTS = Object.freeze(Array.from(
  { length: PRESENTATION_SEGMENT_COUNT },
  (_, segment) => sampleNanoscalePresentationSegment(segment, 1)
))

function canonicalNumber(value) {
  const rounded = Math.round(value * LOCAL_TRANSFORM_PRECISION) / LOCAL_TRANSFORM_PRECISION
  return Object.is(rounded, -0) ? 0 : rounded
}

function canonicalSimilarity(transform) {
  return Object.freeze({
    scale: canonicalNumber(transform.scale),
    translateX: canonicalNumber(transform.translateX),
    translateY: canonicalNumber(transform.translateY)
  })
}

/**
 * Re-expresses sampled scene transforms below nested per-handoff cameras.
 *
 * Every handoff owns one nested, bounded camera wrapper. Completed wrappers
 * keep their end transform while the next outer wrapper moves, so scene-local
 * transforms never change and integer stops require no raster-heavy rebase.
 * The composed pixels are algebraically identical to the original sample.
 */
export function nanoscalePresentationFrame(sample) {
  if (!sample?.presentationTransform || !Array.isArray(sample.layers)) {
    throw new TypeError('Nanoscale presentation requires a sampled camera frame')
  }

  const progress = Math.min(PRESENTATION_SEGMENT_COUNT, Math.max(0, sample.progress))
  const completedSegments = Math.floor(progress)
  const movingSegment = Number.isInteger(progress) ? null : completedSegments
  const cameraTransforms = Object.freeze(Array.from(
    { length: PRESENTATION_SEGMENT_COUNT },
    (_, segment) => {
      if (segment < completedSegments) {
        return PRESENTATION_SEGMENT_ENDPOINTS[segment]
      }
      if (segment === movingSegment) {
        return sampleNanoscalePresentationSegment(segment, progress - segment)
      }
      return IDENTITY
    }
  ))
  const cameraTransform = cameraTransforms.reduce(
    (inner, outer) => composeNanoscaleSimilarities(outer, inner),
    IDENTITY
  )
  const inversePresentation = invertNanoscaleSimilarity(cameraTransform)
  return Object.freeze({
    cameraTransform,
    cameraTransforms,
    movingSegment,
    layers: Object.freeze(sample.layers.map(layer => Object.freeze({
      layer,
      localTransform: canonicalSimilarity(composeNanoscaleSimilarities(
        inversePresentation,
        layer.cameraTransform
      ))
    })))
  })
}

/** A 2D residual transform does not independently promote every retained scene. */
export function nanoscaleSceneCssTransform(transform) {
  if (
    !transform ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0 ||
    !Number.isFinite(transform.translateX) ||
    !Number.isFinite(transform.translateY)
  ) {
    throw new TypeError('Nanoscale scene transform must be a finite similarity')
  }
  return `matrix(${transform.scale}, 0, 0, ${transform.scale}, ${transform.translateX}, ${transform.translateY})`
}

/** Composes the finale-entry pullback into W4 itself. */
export function nanoscalePullbackCameraTransform(
  cameraTransform,
  scale,
  origin = { x: 1080, y: 1920 }
) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new RangeError('Nanoscale pullback scale must be in (0, 1]')
  }
  return composeNanoscaleSimilarities({
    scale,
    translateX: origin.x * (1 - scale),
    translateY: origin.y * (1 - scale)
  }, cameraTransform)
}

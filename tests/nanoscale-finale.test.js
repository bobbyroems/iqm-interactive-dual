import assert from 'node:assert/strict'
import test from 'node:test'

import {
  holdNanoscaleFinaleProgress,
  isFreeNanoscaleFinaleGesture,
  sampleNanoscaleFinale
} from '../src/js/modules/nanoscale/nanoscale-finale.js'
import {
  NANOSCALE_LAST_CONTENT_STOP,
  NANOSCALE_V3_FINALE,
  NANOSCALE_V3_STOPS,
  NANOSCALE_V3_TIMELINE
} from '../src/js/modules/nanoscale/nanoscale-stops.js'
import { NANOSCALE_RUNTIME_IMAGE_PATHS } from '../src/js/modules/nanoscale/nanoscale-assets.js'
import { NANOSCALE_FINALE_LAYOUT, NANOSCALE_SCRUBBER } from '../src/js/modules/nanoscale/nanoscale-layout.js'

function numericLeaves(value) {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numericLeaves)
  if (value && typeof value === 'object') return Object.values(value).flatMap(numericLeaves)
  return []
}

test('timeline ends with the two authored finale screens', () => {
  assert.deepEqual(NANOSCALE_V3_STOPS, [0, 1, 2, 3, 4, 5, 6, 7])
  assert.equal(NANOSCALE_LAST_CONTENT_STOP, 5)
  assert.deepEqual(NANOSCALE_V3_FINALE.map(stop => stop.kind), ['finale', 'finale'])
  assert.deepEqual(NANOSCALE_V3_FINALE.map(stop => stop.timelineIndex), [6, 7])
  assert.equal(NANOSCALE_V3_FINALE[0].title, 'Small qubits. Big implications.')
  assert.equal(NANOSCALE_V3_FINALE[1].title, 'Built to scale')
  assert.equal(
    JSON.stringify(NANOSCALE_V3_TIMELINE).includes('The same million qubits'),
    false
  )
  assert.equal(NANOSCALE_SCRUBBER.width, 1109)
  assert.deepEqual(NANOSCALE_SCRUBBER.tickOffsets, [0, 277, 554, 831, 1108])
  assert.equal('codaOffset' in NANOSCALE_SCRUBBER, false)
  assert.deepEqual(NANOSCALE_FINALE_LAYOUT.track, { x: 0, y: 0, width: 2160, height: 7680 })
  /* The boxes IQM drew for the built-to-scale screen. */
  assert.deepEqual(NANOSCALE_FINALE_LAYOUT.sections[1].field, {
    x: 1305, y: 2058, width: 673, height: 323
  })
  assert.deepEqual(NANOSCALE_FINALE_LAYOUT.sections[1].marker, {
    x: 600, y: 2176, width: 20, height: 20
  })
  assert.deepEqual(NANOSCALE_FINALE_LAYOUT.sections[1].count, {
    x: 750, y: 1500, width: 660, height: 128
  })
  assert.deepEqual(NANOSCALE_FINALE_LAYOUT.sections[1].divider, {
    x: 1080, y: 1920, width: 1, height: 625
  })
  assert.ok(NANOSCALE_RUNTIME_IMAGE_PATHS.includes('assets/modules/nanoscale/footprint-field.webp'))
  assert.ok(NANOSCALE_RUNTIME_IMAGE_PATHS.includes('assets/modules/nanoscale/footprint-field-pixels.png'))
  assert.ok(NANOSCALE_RUNTIME_IMAGE_PATHS.includes('assets/modules/nanoscale/built-to-scale-marker.svg'))
})

test('finale sampler is finite, bounded and deterministic forward or reverse', () => {
  const forward = []
  for (let index = 0; index <= 200; index += 1) {
    const progress = 5 + (index / 100)
    const sample = sampleNanoscaleFinale(progress)
    forward.push(sample)
    for (const value of numericLeaves({
      entryProgress: sample.entryProgress,
      scrollProgress: sample.scrollProgress,
      atmosphereOpacity: sample.atmosphereOpacity,
      impact: sample.impact,
      scale: sample.scale
    })) {
      assert.ok(Number.isFinite(value), `non-finite value at ${progress}`)
      assert.ok(value >= 0 && value <= 1, `out-of-range value ${value} at ${progress}`)
    }
    assert.ok(Number.isFinite(sample.trackY))
  }

  const reverse = [...forward].reverse().map(sample => sampleNanoscaleFinale(sample.progress))
  assert.deepEqual(reverse, [...forward].reverse())
})

test('paragraph disclosure dims the preceding paragraph to 0.7', () => {
  const impact = sampleNanoscaleFinale(6)
  const scale = sampleNanoscaleFinale(7)
  assert.equal(impact.impact.paragraphs[0], 0.7)
  assert.equal(impact.impact.paragraphs[1], 1)
  assert.equal(scale.scale.paragraphs[0], 0.7)
  assert.equal(scale.scale.paragraphs[1], 1)
})

test('outgoing copy fades from 20vh to the top edge', () => {
  const fadeStart = 6 + ((1000 - 768) / 3840)
  const fadeEnd = 6 + (1000 / 3840)
  assert.ok(Math.abs(sampleNanoscaleFinale(fadeStart).impact.group - 1) < 1e-12)
  assert.ok(Math.abs(sampleNanoscaleFinale(fadeEnd).impact.group) < 1e-12)
  assert.ok(sampleNanoscaleFinale((fadeStart + fadeEnd) / 2).impact.group > 0)
  assert.ok(sampleNanoscaleFinale((fadeStart + fadeEnd) / 2).impact.group < 1)
})

test('track moves exactly one stage and preserves fractional release progress', () => {
  assert.equal(sampleNanoscaleFinale(6).trackY, 0)
  assert.equal(sampleNanoscaleFinale(6.5).trackY, -1920)
  assert.equal(sampleNanoscaleFinale(7).trackY, -3840)
  assert.equal(holdNanoscaleFinaleProgress(6.4375), 6.4375)
  assert.equal(holdNanoscaleFinaleProgress(5), 6)
  assert.equal(holdNanoscaleFinaleProgress(8), 7)
})

test('viewport-fixed impact atmosphere fades without a moving section edge', () => {
  assert.equal(sampleNanoscaleFinale(5).atmosphereOpacity, 0)
  assert.equal(sampleNanoscaleFinale(6).atmosphereOpacity, 1)
  assert.equal(sampleNanoscaleFinale(6.5).atmosphereOpacity, 0.5)
  assert.equal(sampleNanoscaleFinale(7).atmosphereOpacity, 0)
})

test('one-finger finale drag is free while pinch and reduced motion stay semantic', () => {
  assert.equal(isFreeNanoscaleFinaleGesture({ startProgress: 6, deltaProgress: 0.2 }), true)
  assert.equal(isFreeNanoscaleFinaleGesture({ startProgress: 7, deltaProgress: -0.2 }), true)
  assert.equal(isFreeNanoscaleFinaleGesture({ startProgress: 6, deltaProgress: -0.2 }), false)
  assert.equal(isFreeNanoscaleFinaleGesture({ startProgress: 6, deltaProgress: 0.2, pointerCount: 2 }), false)
  assert.equal(isFreeNanoscaleFinaleGesture({ startProgress: 6, deltaProgress: 0.2, reducedMotion: true }), false)
})

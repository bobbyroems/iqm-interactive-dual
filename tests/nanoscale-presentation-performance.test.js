import assert from 'node:assert/strict'
import test from 'node:test'

import {
  NANOSCALE_CAMERA_SCENES,
  composeNanoscaleSimilarities,
  sampleNanoscaleCamera,
  sampleNanoscalePresentationSegment
} from '../src/js/modules/nanoscale/nanoscale-camera.js'
import {
  NANOSCALE_PRESENTATION_SEGMENTS,
  nanoscalePresentationFrame,
  nanoscalePullbackCameraTransform
} from '../src/js/modules/nanoscale/nanoscale-presentation.js'
import { nestNanoscaleCameraMarkup } from '../src/js/modules/nanoscale/index.js'

const PIXEL_TOLERANCE = 0.001

function transformPixelError(actual, expected) {
  const corners = [
    [0, 0],
    [2160, 0],
    [0, 3840],
    [2160, 3840]
  ]
  return Math.max(...corners.map(([x, y]) => Math.hypot(
    ((x * actual.scale) + actual.translateX) -
      ((x * expected.scale) + expected.translateX),
    ((y * actual.scale) + actual.translateY) -
      ((y * expected.scale) + expected.translateY)
  )))
}

function presentationAt(progress) {
  return nanoscalePresentationFrame(sampleNanoscaleCamera(progress))
}

test('presentation DOM has one ordered wrapper for every content handoff', () => {
  assert.deepEqual(NANOSCALE_PRESENTATION_SEGMENTS, [0, 1, 2, 3, 4])
  assert.equal(
    NANOSCALE_PRESENTATION_SEGMENTS.length,
    NANOSCALE_CAMERA_SCENES.length - 1
  )
  assert.equal(presentationAt(2.5).cameraTransforms.length, 5)

  const markup = nestNanoscaleCameraMarkup('SCENES')
  const tokens = markup.match(/data-nz-stack-camera="\d+"|SCENES|<\/div>/g)
  const stack = []
  let sceneAncestors = null
  for (const token of tokens) {
    if (token.startsWith('data-nz-stack-camera')) {
      stack.push(Number(token.match(/\d+/)[0]))
    } else if (token === 'SCENES') {
      sceneAncestors = [...stack]
    } else {
      stack.pop()
    }
  }
  assert.deepEqual(sceneAncestors, [4, 3, 2, 1, 0])
  assert.deepEqual(stack, [])
})

test('shared presentation camera preserves every sampled scene pixel', () => {
  const samples = []
  for (let index = 0; index <= 100; index += 1) {
    samples.push(index / 20)
  }
  samples.push(5.25, 5.5, 5.75, 6, 6.5, 7)

  for (const progress of samples) {
    const frame = presentationAt(progress)
    for (const { layer, localTransform } of frame.layers) {
      const recomposed = composeNanoscaleSimilarities(
        frame.cameraTransform,
        localTransform
      )
      assert.ok(
        transformPixelError(recomposed, layer.cameraTransform) <= PIXEL_TOLERANCE,
        `scene ${layer.layerId} drifted at progress ${progress}`
      )
    }
  }
})

test('retained scene transforms stay permanent through stops, handoffs, and reverse', () => {
  const firstTransformByLayer = new Map()
  const probes = []
  for (let stop = 0; stop < 5; stop += 1) {
    for (const local of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) {
      probes.push(stop + local)
    }
  }

  for (const progress of [...probes, ...[...probes].reverse()]) {
    const frame = presentationAt(progress)
    for (const { layer, localTransform } of frame.layers) {
      const first = firstTransformByLayer.get(layer.layerId)
      if (first) {
        assert.deepEqual(
          localTransform,
          first,
          `scene ${layer.layerId} was re-rasterized at progress ${progress}`
        )
      } else {
        firstTransformByLayer.set(layer.layerId, localTransform)
      }
    }
  }

  assert.deepEqual(
    [...firstTransformByLayer.keys()],
    ['splash-room', 'cryostat', 'majorana-2', 'qpu-chip', 'qubit-array', 'nanowire']
  )
})

test('every nested compositor camera remains within one handoff zoom budget', () => {
  let maximumScale = 1
  for (let index = 0; index <= 500; index += 1) {
    const { cameraTransforms } = presentationAt(index / 100)
    maximumScale = Math.max(
      maximumScale,
      ...cameraTransforms.map(transform => transform.scale)
    )
  }
  assert.ok(maximumScale < 8, `one presentation segment reached ${maximumScale}x`)
})

test('every nested paint clip covers the viewport throughout its handoff', () => {
  const width = 2160
  const height = 3840
  const tolerance = 1e-7
  for (const segment of NANOSCALE_PRESENTATION_SEGMENTS) {
    for (let index = 0; index <= 1000; index += 1) {
      const transform = sampleNanoscalePresentationSegment(segment, index / 1000)
      assert.ok(transform.scale >= 1 - tolerance)
      assert.ok(transform.translateX <= tolerance)
      assert.ok(transform.translateY <= tolerance)
      assert.ok(transform.translateX >= (width * (1 - transform.scale)) - tolerance)
      assert.ok(transform.translateY >= (height * (1 - transform.scale)) - tolerance)
    }
  }
})

test('integer boundaries and finale keep the full retained stack continuous', () => {
  for (let stop = 1; stop <= 5; stop += 1) {
    const before = presentationAt(stop - 1e-7)
    const settled = presentationAt(stop)
    assert.deepEqual(
      before.layers.map(entry => entry.layer.layerId),
      settled.layers.map(entry => entry.layer.layerId)
    )
    before.layers.forEach((entry, index) => {
      const beforePixels = composeNanoscaleSimilarities(
        before.cameraTransform,
        entry.localTransform
      )
      const settledEntry = settled.layers[index]
      const settledPixels = composeNanoscaleSimilarities(
        settled.cameraTransform,
        settledEntry.localTransform
      )
      assert.ok(
        transformPixelError(beforePixels, settledPixels) <= PIXEL_TOLERANCE,
        `presentation jumped at stop ${stop}`
      )
    })
  }

  const settled = presentationAt(5)
  for (const progress of [5.25, 5.5, 5.75, 6, 6.5, 7]) {
    const finale = presentationAt(progress)
    assert.deepEqual(finale, settled)
    assert.equal(finale.layers.length, 5)
  }
})

test('finale pullback composes into the final bounded camera without pixel drift', () => {
  const base = sampleNanoscalePresentationSegment(4, 1)
  const origin = { x: 1080, y: 1920 }
  const points = [
    [0, 0],
    [2160, 0],
    [0, 3840],
    [2160, 3840],
    [origin.x, origin.y]
  ]

  for (const scale of [1, 0.8, 0.34]) {
    const combined = nanoscalePullbackCameraTransform(base, scale)
    for (const [x, y] of points) {
      const baseX = (x * base.scale) + base.translateX
      const baseY = (y * base.scale) + base.translateY
      const expectedX = origin.x + ((baseX - origin.x) * scale)
      const expectedY = origin.y + ((baseY - origin.y) * scale)
      assert.ok(Math.abs(((x * combined.scale) + combined.translateX) - expectedX) < 1e-7)
      assert.ok(Math.abs(((y * combined.scale) + combined.translateY) - expectedY) < 1e-7)
    }
  }
})

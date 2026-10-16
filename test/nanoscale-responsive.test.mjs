import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NANOSCALE_STAGE,
  fitNanoscaleViewport,
  nanoscaleGestureDistance
} from '../src/js/modules/nanoscale/nanoscale-layout.js'
import { dragDeltaToProgress, horizontalDragDeltaToProgress } from '../src/js/modules/nanoscale/zoom-model.js'

test('registered nanoscale artwork covers the viewport and stays centered without changing its aspect ratio', () => {
  for (const [width, height] of [[320, 320], [568, 320], [768, 600], [1440, 800], [2160, 3840], [3440, 900]]) {
    const { scale, left, top } = fitNanoscaleViewport(width, height)
    const renderedWidth = NANOSCALE_STAGE.width * scale
    const renderedHeight = NANOSCALE_STAGE.height * scale
    assert(left <= 1e-9 && top <= 1e-9)
    assert(renderedWidth >= width - 1e-9 && renderedHeight >= height - 1e-9)
    assert(Math.abs(renderedWidth - width) < 1e-9 || Math.abs(renderedHeight - height) < 1e-9)
    assert(Math.abs(left * 2 + renderedWidth - width) < 1e-9)
    assert(Math.abs(top * 2 + renderedHeight - height) < 1e-9)
  }
})

test('an unmeasured nanoscale viewport has a finite, nonzero scale', () => {
  const viewport = fitNanoscaleViewport(0, 0)
  assert(Number.isFinite(viewport.scale) && viewport.scale > 0)
})

test('one nanoscale stop takes a reachable client-space gesture regardless of aspect ratio', () => {
  for (const [width, height] of [[320, 320], [568, 320], [1440, 900], [2160, 3840]]) {
    const distance = nanoscaleGestureDistance(width, height)
    assert(distance >= 100 && distance <= 480)
    assert.equal(dragDeltaToProgress(-distance, 1, distance), 1)
    assert.equal(horizontalDragDeltaToProgress(distance, 1, distance), 1)
    assert.equal(dragDeltaToProgress(distance, 1, distance), -1)
  }
})

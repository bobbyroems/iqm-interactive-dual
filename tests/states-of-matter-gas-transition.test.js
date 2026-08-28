import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FRAME_COUNT,
  GAS_FADE_OUT_START_FRAME,
  visualStateForFrame
} from '../src/js/modules/states-of-matter/timeline.js'

test('gas is fully established before its exit begins', () => {
  assert.equal(visualStateForFrame(GAS_FADE_OUT_START_FRAME).vfx.fog, 1)
})

test('gas atmosphere and audio are gone on the first topoconductor frame', () => {
  const state = visualStateForFrame(FRAME_COUNT)

  assert.equal(state.phase.id, 'topoconductor')
  assert.equal(state.vfx.fog, 0)
  assert.equal(state.vfx.videoBlurPx, 0)
  assert.equal(state.vfx.whiteFogOpacity, 0)
  assert.equal(state.audio.steam, 0)
})

test('gas stays absent through the topoconductor range', () => {
  for (const frame of [FRAME_COUNT, FRAME_COUNT + 24, FRAME_COUNT + 99]) {
    assert.equal(visualStateForFrame(frame).vfx.fog, 0)
  }
})

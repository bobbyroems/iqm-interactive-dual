import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createQubitExplorerState,
  isQubitDragEnabled,
  isQubitSemiconductorVisible,
  QUBIT_MATERIAL_STEPS,
  QUBIT_PHASES,
  reduceQubitExplorerState
} from '../src/js/modules/qubit-explorer/qubit-state.js'

function reduce(state, type, payload = {}) {
  return reduceQubitExplorerState(state, { type, ...payload })
}

test('material lessons precede the combining prompt and drag interaction', () => {
  let state = createQubitExplorerState()

  assert.equal(state.phase, QUBIT_PHASES.INTRO)
  /* The module opens on a screen of its own now, so the copy is up from the
     first frame rather than being dismissed until the drag. */
  assert.equal(state.introDismissed, false)
  assert.equal(isQubitDragEnabled(state), false)

  state = reduce(state, 'INTRO_COMPLETE')
  assert.equal(state.phase, QUBIT_PHASES.MATERIALS)
  assert.equal(state.materialStep, QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR)
  assert.equal(isQubitDragEnabled(state), false)

  const ignoredDrag = reduce(state, 'DRAG_START')
  assert.equal(ignoredDrag, state)

  state = reduce(state, 'MATERIALS_NEXT')
  assert.equal(state.phase, QUBIT_PHASES.MATERIALS)
  assert.equal(state.materialStep, QUBIT_MATERIAL_STEPS.SEMICONDUCTOR)
  assert.equal(isQubitDragEnabled(state), false)

  state = reduce(state, 'MATERIALS_NEXT')
  assert.equal(state.phase, QUBIT_PHASES.READY)
  assert.equal(state.materialStep, null)
  assert.equal(state.introDismissed, false)
  assert.equal(isQubitDragEnabled(state), true)

  state = reduce(state, 'DRAG_START')
  assert.equal(state.phase, QUBIT_PHASES.DRAGGING)
  assert.equal(state.introDismissed, true)

  state = reduce(state, 'DROP', { valid: true })
  assert.equal(state.phase, QUBIT_PHASES.SNAPPING)

  state = reduce(state, 'SNAP_COMPLETE')
  assert.equal(state.phase, QUBIT_PHASES.TUNING)
})

test('skipping the entrance animation still starts with both material lessons', () => {
  /* A press during the entrance settles the opening screen rather than
     skipping past it: the visitor still reads it, and still meets both
     material lessons before the drag. What must not happen is landing in the
     materials, or past them, without having been shown either. */
  let state = reduce(createQubitExplorerState(), 'SKIP_INTRO')
  assert.equal(state.phase, QUBIT_PHASES.INTRO)
  assert.equal(state.introSettled, true)

  state = reduce(state, 'INTRO_COMPLETE')
  assert.equal(state.phase, QUBIT_PHASES.MATERIALS)
  assert.equal(state.materialStep, QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR)
  assert.equal(state.introDismissed, true)
})

test('the opening screen cannot be tapped through before it has settled', () => {
  /* Until the entrance animation has finished there is nothing to read yet, so
     a tap must not carry the visitor past it. */
  const fresh = createQubitExplorerState()
  assert.equal(fresh.introSettled, false)
  assert.equal(reduce(fresh, 'INTRO_SETTLED').introSettled, true)
})

test('both materials are on screen from the opening', () => {
  /* The board shows the pair from the first screen and lifts one out at a time
     rather than introducing them one at a time. The lesson that matters is the
     contrast, and the scene cannot draw a contrast against a slab that is not
     there yet — which is what the superconductor lesson used to ask it to do. */
  let state = createQubitExplorerState()
  assert.equal(isQubitSemiconductorVisible(state), true)

  assert.equal(isQubitSemiconductorVisible(reduce(state, 'SKIP_INTRO')), true)

  state = reduce(state, 'INTRO_COMPLETE')
  assert.equal(state.materialStep, QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR)
  assert.equal(isQubitSemiconductorVisible(state), true)

  state = reduce(state, 'MATERIALS_NEXT')
  assert.equal(state.materialStep, QUBIT_MATERIAL_STEPS.SEMICONDUCTOR)
  assert.equal(isQubitSemiconductorVisible(state), true)

  state = reduce(state, 'MATERIALS_NEXT')
  assert.equal(state.phase, QUBIT_PHASES.READY)
  assert.equal(isQubitSemiconductorVisible(state), true)

  /* Including after a restart: the next visitor meets the same pair. */
  assert.equal(isQubitSemiconductorVisible(reduce(state, 'RESTART')), true)
})

test('each material lesson lifts one slab out and lets the other fall back', () => {
  /* The focus value the scene dims against: negative lifts the superconductor,
     positive lifts the semiconductor. Which one is named is what decides it. */
  let state = reduce(createQubitExplorerState(), 'INTRO_COMPLETE')
  assert.equal(state.materialStep, QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR)

  state = reduce(state, 'MATERIALS_NEXT')
  assert.equal(state.materialStep, QUBIT_MATERIAL_STEPS.SEMICONDUCTOR)

  state = reduce(state, 'MATERIALS_NEXT')
  assert.equal(state.materialStep, null, 'the drag screen favours neither')
})

test('the dial can move away from and back to the completed position', () => {
  let state = createQubitExplorerState()
  state = reduce(state, 'INTRO_COMPLETE')
  state = reduce(state, 'MATERIALS_NEXT')
  state = reduce(state, 'MATERIALS_NEXT')
  state = reduce(state, 'DRAG_START')
  state = reduce(state, 'DROP', { valid: true })
  state = reduce(state, 'SNAP_COMPLETE')

  state = reduce(state, 'TUNE_INPUT', { value: 1 })
  assert.equal(state.phase, QUBIT_PHASES.COMPLETE)
  assert.equal(state.tuneProgress, 1)

  state = reduce(state, 'TUNE_INPUT', { value: 0.8 })
  assert.equal(state.phase, QUBIT_PHASES.TUNING)
  assert.equal(state.tuneProgress, 0.8)

  state = reduce(state, 'TUNE_INPUT', { value: 1 })
  assert.equal(state.phase, QUBIT_PHASES.COMPLETE)
  assert.equal(state.tuneProgress, 1)

  assert.deepEqual(reduce(state, 'RESTART'), createQubitExplorerState())
})

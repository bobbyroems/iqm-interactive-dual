import assert from 'node:assert/strict'
import test from 'node:test'

import {
  advanceQubitMaterialEntrance,
  easeQubitMaterialEntrance,
  QUBIT_MATERIAL_ENTRANCE,
  qubitMaterialEntranceOffset
} from '../src/js/modules/qubit-explorer/qubit-material-entrance.js'

test('material entrances share exact eased endpoints', () => {
  assert.equal(easeQubitMaterialEntrance(0), 0)
  assert.equal(easeQubitMaterialEntrance(1), 1)
  assert.equal(easeQubitMaterialEntrance(-1), 0)
  assert.equal(easeQubitMaterialEntrance(2), 1)
})

test('superconductor and semiconductor entrances are exact vertical mirrors', () => {
  for (let step = 0; step <= 20; step += 1) {
    const progress = step / 20
    assert.equal(
      qubitMaterialEntranceOffset(progress, 1),
      -qubitMaterialEntranceOffset(progress, -1)
    )
  }
})

test('a long frame cannot skip the entrance forward', () => {
  const expectedAdvance = QUBIT_MATERIAL_ENTRANCE.maxFrameDeltaSeconds /
    QUBIT_MATERIAL_ENTRANCE.durationSeconds

  assert.equal(advanceQubitMaterialEntrance(0, 1), expectedAdvance)
  assert.equal(advanceQubitMaterialEntrance(0, -1), 0)
  assert.equal(advanceQubitMaterialEntrance(0, Number.NaN), 0)
})

test('the entrance completes exactly after its configured duration', () => {
  let progress = 0
  const stepCount = Math.round(
    QUBIT_MATERIAL_ENTRANCE.durationSeconds /
    QUBIT_MATERIAL_ENTRANCE.maxFrameDeltaSeconds
  )
  assert.equal(stepCount, 27)

  for (let step = 0; step < stepCount; step += 1) {
    progress = advanceQubitMaterialEntrance(
      progress,
      QUBIT_MATERIAL_ENTRANCE.maxFrameDeltaSeconds
    )
  }

  assert.equal(progress, 1)
})

test('reduced motion resolves immediately to the final composition', () => {
  const progress = advanceQubitMaterialEntrance(0, 0, true)
  assert.equal(progress, 1)
  assert.equal(easeQubitMaterialEntrance(progress), 1)
  assert.equal(qubitMaterialEntranceOffset(progress, 1), 0)
  assert.equal(qubitMaterialEntranceOffset(progress, -1), -0)
})

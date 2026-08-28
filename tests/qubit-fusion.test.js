import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveQubitShellTransition } from '../src/js/modules/qubit-explorer/qubit-fusion.js'

test('starts as two shells and finishes as one unified shell', () => {
  assert.deepEqual(resolveQubitShellTransition(0), {
    progress: 0,
    splitShellWeight: 1,
    unifiedShellWeight: 0
  })
  assert.deepEqual(resolveQubitShellTransition(1), {
    progress: 1,
    splitShellWeight: 0,
    unifiedShellWeight: 1
  })
})

test('is reversible and has no completion latch', () => {
  const beforeCompletion = resolveQubitShellTransition(0.94)
  resolveQubitShellTransition(1)
  const afterBackingOff = resolveQubitShellTransition(0.94)

  assert.deepEqual(afterBackingOff, beforeCompletion)
  assert.equal(afterBackingOff.splitShellWeight, 1)
  assert.ok(afterBackingOff.unifiedShellWeight > 0)
  assert.ok(afterBackingOff.unifiedShellWeight < 1)
})

test('keeps at least one shell fully opaque throughout the handoff', () => {
  for (let step = 0; step <= 100; step += 1) {
    const transition = resolveQubitShellTransition(step / 100)
    assert.equal(
      Math.max(transition.splitShellWeight, transition.unifiedShellWeight),
      1
    )
  }
})

test('clamps progress and fades the split shells only under the unified shell', () => {
  assert.deepEqual(resolveQubitShellTransition(-1), resolveQubitShellTransition(0))
  assert.deepEqual(resolveQubitShellTransition(2), resolveQubitShellTransition(1))

  const finalHandoff = resolveQubitShellTransition(0.985)
  assert.equal(finalHandoff.unifiedShellWeight, 1)
  assert.ok(finalHandoff.splitShellWeight > 0)
  assert.ok(finalHandoff.splitShellWeight < 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import * as THREE from 'three'

import {
  alignNanowireGround,
  createNanowireExperienceGrid,
  createNanowireShadowCatcher,
  resolveNanowireShadowAtomCount
} from '../src/js/modules/build-nanowire/nanowire-scene.js'

const EPSILON = 1e-10

function assertParallel(actual, expected, message) {
  const alignment = Math.abs(actual.clone().normalize().dot(expected.clone().normalize()))
  assert.ok(1 - alignment < EPSILON, `${message}: ${alignment}`)
}

test('nanowire grid follows both model axes without changing the model transform', () => {
  const wire = new THREE.Group()
  wire.scale.setScalar(0.5)
  wire.position.set(-0.08, 0.165, 0)
  wire.rotation.set(0.03, -1.29, 0.16)

  const originalPosition = wire.position.clone()
  const originalQuaternion = wire.quaternion.clone()
  const originalScale = wire.scale.clone()
  const grid = createNanowireExperienceGrid(THREE)
  const shadowCatcher = createNanowireShadowCatcher(THREE)

  alignNanowireGround(THREE, wire, grid, shadowCatcher)

  assert.ok(wire.position.distanceTo(originalPosition) < EPSILON)
  assert.ok(1 - Math.abs(wire.quaternion.dot(originalQuaternion)) < EPSILON)
  assert.ok(wire.scale.distanceTo(originalScale) < EPSILON)

  const wireLongAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(wire.quaternion)
  const wireShortAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(wire.quaternion)
  const wireNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(wire.quaternion)
  const gridLongLine = new THREE.Vector3(1, 1, 0).applyQuaternion(grid.quaternion)
  const gridShortLine = new THREE.Vector3(1, -1, 0).applyQuaternion(grid.quaternion)
  const gridNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(grid.quaternion)
  const catcherNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(shadowCatcher.quaternion)

  assertParallel(gridLongLine, wireLongAxis, 'long grid lines should follow atom rows')
  assertParallel(gridShortLine, wireShortAxis, 'short grid lines should follow atom rows')
  assertParallel(gridNormal, wireNormal, 'grid plane should follow the atomic sheet')
  assertParallel(catcherNormal, wireNormal, 'shadow catcher should follow the grid plane')

  const gridOffset = originalPosition.clone().sub(grid.position)
  const catcherOffset = originalPosition.clone().sub(shadowCatcher.position)
  assert.ok(Math.abs(gridOffset.dot(wireNormal) - 0.1305) < EPSILON)
  assert.ok(Math.abs(catcherOffset.dot(wireNormal) - 0.1225) < EPSILON)
  assert.ok(gridOffset.clone().cross(wireNormal).length() < EPSILON)
  assert.ok(catcherOffset.clone().cross(wireNormal).length() < EPSILON)

  grid.geometry.dispose()
  grid.material.dispose()
  shadowCatcher.geometry.dispose()
  shadowCatcher.material.dispose()
})

test('only the foundation contributes to the first-screen shadow', () => {
  assert.equal(resolveNanowireShadowAtomCount(null), 24 * 8)
  assert.equal(resolveNanowireShadowAtomCount(0), 5 * 24 * 8)
})

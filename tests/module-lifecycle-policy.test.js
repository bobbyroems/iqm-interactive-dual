import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acquireNanowireScene
} from '../src/js/modules/build-nanowire/scene-mount.js'
import { moduleUnmountDelay } from '../src/js/core/module-resource-policy.js'
import {
  shouldMountVolumetricSteam
} from '../src/js/modules/states-of-matter/runtime-policy.js'

test('production kiosk keeps States of Matter on the procedural steam fallback', () => {
  assert.equal(shouldMountVolumetricSteam({ runtime: { isKiosk: true } }), false)
  assert.equal(shouldMountVolumetricSteam({ runtime: { isKiosk: false } }), true)
  assert.equal(shouldMountVolumetricSteam(), true)
})

test('nanowire disposes a scene that resolves after its mount was aborted', async () => {
  let resolveScene
  let inactive = false
  let disposeCount = 0
  const sceneReady = new Promise(resolve => {
    resolveScene = resolve
  })
  const pendingScene = acquireNanowireScene(() => sceneReady, () => inactive)

  inactive = true
  resolveScene({ dispose: () => { disposeCount += 1 } })

  await assert.rejects(pendingScene, error => error?.name === 'AbortError')
  assert.equal(disposeCount, 1)
})

test('nanowire transfers a live scene to the active mount without disposing it', async () => {
  let disposeCount = 0
  const controller = { dispose: () => { disposeCount += 1 } }

  assert.equal(
    await acquireNanowireScene(() => Promise.resolve(controller), () => false),
    controller
  )
  assert.equal(disposeCount, 0)
})

test('production kiosk releases an outgoing module without fade overlap', () => {
  assert.equal(moduleUnmountDelay({ isKiosk: true }), 0)
  assert.equal(moduleUnmountDelay({ isKiosk: false }), 400)
})

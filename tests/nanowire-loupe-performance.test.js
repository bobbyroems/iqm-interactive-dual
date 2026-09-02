import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLoupeFrameQueue,
  createLoupePointerMapping,
  mapLoupePointer,
  resolveGradientSpan
} from '../src/js/modules/build-nanowire/interaction.js'
import { disposeNanowireRenderer } from '../src/js/modules/build-nanowire/nanowire-scene.js'

test('loupe pointer mapping reuses cached geometry and caller-owned output', () => {
  const mapping = { left: 0, top: 0, scaleX: 0, scaleY: 0 }
  const point = { x: 0, y: 0, time: 0 }

  assert.strictEqual(createLoupePointerMapping(
    { left: 100, top: 50, width: 1_080, height: 1_284 },
    2_160,
    2_568,
    mapping
  ), mapping)
  assert.deepEqual(mapping, { left: 100, top: 50, scaleX: 2, scaleY: 2 })
  assert.strictEqual(mapLoupePointer(640, 692, 123, mapping, point), point)
  assert.deepEqual(point, { x: 1_080, y: 1_284, time: 123 })
})

test('loupe stages the latest scene centre before collapsing DOM work to one frame', () => {
  let nextFrame = 1
  let requestedFrames = 0
  let stagedSceneCenter = null
  let stagedSamples = 0
  const frames = new Map()
  const commits = []
  const queue = createLoupeFrameQueue(
    (x, y) => commits.push([x, y]),
    {
      requestFrame(callback) {
        const frame = nextFrame++
        requestedFrames += 1
        frames.set(frame, callback)
        return frame
      },
      cancelFrame(frame) {
        frames.delete(frame)
      },
      stageLatest(x, y) {
        stagedSceneCenter = [x, y]
        stagedSamples += 1
      }
    }
  )

  for (let sample = 0; sample < 240; sample += 1) queue.schedule(sample, sample * 2)

  assert.equal(requestedFrames, 1)
  assert.equal(commits.length, 0)
  /* The independently registered Three.js RAF can run now and still sees the
     newest centre before the queued DOM transform is committed. */
  assert.equal(stagedSamples, 240)
  assert.deepEqual(stagedSceneCenter, [239, 478])
  const firstFrame = frames.entries().next().value
  frames.delete(firstFrame[0])
  firstFrame[1](16.7)
  assert.deepEqual(commits, [[239, 478]])

  queue.schedule(300, 400)
  queue.schedule(301, 401)
  assert.equal(queue.flush(), true)
  assert.deepEqual(commits.at(-1), [301, 401])
  assert.equal(frames.size, 0)

  queue.schedule(500, 600)
  queue.cancel()
  assert.equal(queue.flush(), false)
  assert.equal(commits.length, 2)
})

test('nanowire gradient sampling can reuse one span object in the render loop', () => {
  const span = { lower: -1, upper: -1, mix: -1 }

  assert.strictEqual(resolveGradientSpan(0.375, 5, span), span)
  assert.deepEqual(span, { lower: 1, upper: 2, mix: 0.5 })
  assert.strictEqual(resolveGradientSpan(Number.NaN, 1, span), span)
  assert.deepEqual(span, { lower: 0, upper: 0, mix: 0 })
})

test('nanowire collapses renderer backing surfaces before context loss', () => {
  const calls = []
  const canvas = {
    width: 3_024,
    height: 5_208,
    remove() { calls.push('remove') }
  }
  const renderer = {
    domElement: canvas,
    setAnimationLoop(value) { calls.push(['animation', value]) },
    setRenderTarget(value) { calls.push(['target', value]) },
    setSize(width, height, updateStyle) { calls.push(['size', width, height, updateStyle]) },
    dispose() { calls.push('dispose') },
    forceContextLoss() { calls.push('context-loss') }
  }

  disposeNanowireRenderer(renderer)

  assert.deepEqual(calls, [
    ['animation', null],
    ['target', null],
    ['size', 1, 1, false],
    'dispose',
    'context-loss',
    'remove'
  ])
  assert.equal(canvas.width, 1)
  assert.equal(canvas.height, 1)
})

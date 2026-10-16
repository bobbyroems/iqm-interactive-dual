import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isDownwardSwipe,
  resolveLoupeTarget,
  resolveNanowireLoupeLayout
} from '../src/js/modules/build-nanowire/interaction.js'
import { resolveNanowireCameraFov } from '../src/js/modules/build-nanowire/nanowire-scene.js'

test('nanowire loupe bounds and initial position fit phone through kiosk workspaces', () => {
  for (const [width, height, diameter] of [
    [320, 280, 96], [568, 280, 96], [768, 600, 108],
    [1440, 500, 202], [2160, 2800, 302]
  ]) {
    const layout = resolveNanowireLoupeLayout(width, height, diameter)
    assert(layout.initialX >= layout.minX && layout.initialX <= layout.maxX)
    assert(layout.initialY >= layout.minY && layout.initialY <= layout.maxY)
    assert(layout.minX - layout.radius >= 0)
    assert(layout.maxX + layout.radius <= width)
    assert(layout.minY - layout.radius - diameter * 168 / 524 >= -0.001)
    assert(layout.maxY + layout.radius <= height)
    assert(Math.abs(layout.targeting.lockRadius / diameter - 52 / 524) < 1e-12)
  }
})

test('loupe bounds remain ordered when a container is temporarily smaller than the lens', () => {
  const layout = resolveNanowireLoupeLayout(1, 1, 96)
  assert.equal(layout.minX, layout.maxX)
  assert.equal(layout.minY, layout.maxY)
})

test('mobile swipes use a reachable threshold without weakening direction or timing checks', () => {
  const { swipeDistance } = resolveNanowireLoupeLayout(320, 280, 96)
  const start = { x: 0, y: 0, time: 0 }
  const options = { minimumDistance: swipeDistance }
  assert(isDownwardSwipe(start, { x: 5, y: 40, time: 200 }, options))
  assert(!isDownwardSwipe(start, { x: 0, y: 10, time: 200 }, options))
  assert(!isDownwardSwipe(start, { x: 50, y: 40, time: 200 }, options))
  assert(!isDownwardSwipe(start, { x: 0, y: 40, time: 2000 }, options))
})

test('magnifier targeting scales with the visible lens instead of kiosk pixels', () => {
  const { targeting } = resolveNanowireLoupeLayout(320, 280, 96)
  const target = { x: 160, y: 140 }
  assert(resolveLoupeTarget({ x: 165, y: 140 }, target, targeting).targeted)
  assert(!resolveLoupeTarget({ x: 180, y: 140 }, target, targeting).targeted)
})

test('camera preserves portrait framing and keeps wide scenes legible without unlimited zoom', () => {
  assert(Math.abs(resolveNanowireCameraFov(2160, 3720) - 31) < 0.001)
  const phone = resolveNanowireCameraFov(320, 280)
  const wide = resolveNanowireCameraFov(1920, 500)
  assert(phone > 0 && phone < 31)
  assert(wide >= 20 && wide <= phone)
  assert(Number.isFinite(resolveNanowireCameraFov(0, 0)))
})

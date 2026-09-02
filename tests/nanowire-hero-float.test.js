import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveNanowireIntroAtomState } from '../src/js/modules/build-nanowire/nanowire-scene.js'

/* IQM's note on the 25 Aug board: "Have the atom floating up and down." It is
   the single atom the module opens on, while it is the only thing on screen. */

const HERO = { long: 11, wide: 3 }
const NOT_HERO = { long: 4, wide: 3 }
const atomStage = { lineProgress: 0, sheetProgress: 0, atomProgress: 1, handoffProgress: 0 }

const heightAt = (coordinates, floatElapsed, timeline = atomStage, extra = {}) =>
  resolveNanowireIntroAtomState(coordinates, timeline, { floatElapsed, ...extra }, {}).y

test('the opening atom rises and falls', () => {
  const heights = Array.from({ length: 80 }, (_, i) => heightAt(HERO, i * 35))
  const span = Math.max(...heights) - Math.min(...heights)
  assert.ok(span > 0.05, `the atom barely moves: span was ${span}`)
  /* Small enough that it still reads as hanging there waiting to be tapped,
     rather than travelling somewhere. */
  assert.ok(span < 0.2, `the atom moves too far: span was ${span}`)
})

test('it returns to where it started', () => {
  /* A drift would leave the atom slowly climbing out of frame. */
  assert.ok(Math.abs(heightAt(HERO, 0) - heightAt(HERO, 2800)) < 1e-9)
  assert.ok(Math.abs(heightAt(HERO, 1400) - heightAt(HERO, 1400 + 2800)) < 1e-9)
})

test('only the atom the module opens on floats', () => {
  const others = Array.from({ length: 24 }, (_, i) => heightAt(NOT_HERO, i * 120))
  assert.equal(new Set(others).size, 1, 'atoms other than the hero should be unaffected')
})

test('the float gives way to the line building', () => {
  /* Once atoms start travelling into place the float would be fighting them,
     so it fades out across that transition rather than stopping abruptly. */
  const spanAt = lineProgress => {
    const timeline = { ...atomStage, lineProgress }
    const heights = Array.from({ length: 60 }, (_, i) => heightAt(HERO, i * 46, timeline))
    return Math.max(...heights) - Math.min(...heights)
  }
  const still = spanAt(0)
  const halfway = spanAt(0.5)
  const building = spanAt(1)
  assert.ok(halfway < still, 'the float should be shrinking as the line starts')
  assert.ok(building < 1e-9, 'the float should be gone once the line is building')
})

test('reduced motion leaves it still', () => {
  const heights = Array.from({ length: 40 }, (_, i) =>
    heightAt(HERO, i * 70, atomStage, { reducedMotion: true }))
  assert.equal(new Set(heights).size, 1)
})

test('a missing clock is not a crash or a jump', () => {
  for (const elapsed of [undefined, Number.NaN, Infinity, -500]) {
    const y = heightAt(HERO, elapsed)
    assert.ok(Number.isFinite(y), `floatElapsed ${elapsed} produced ${y}`)
  }
})

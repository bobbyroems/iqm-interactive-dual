import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatNanoscaleCount,
  nanoscaleCountState,
  NANOSCALE_COUNT_DURATION_MS,
  NANOSCALE_COUNT_STEP,
  NANOSCALE_V3_FINALE
} from '../src/js/modules/nanoscale/nanoscale-stops.js'

/* The counter IQM asked for on the built-to-scale screen: it climbs to a
   million qubits while the football field fills in behind it. */

const { counter } = NANOSCALE_V3_FINALE.at(-1)
const at = elapsed => nanoscaleCountState(elapsed, { target: counter.target })

test('the screen counts to the million its copy promises', () => {
  /* The paragraph above says "one qubit or one million qubits". If the count
     stops on 998,000 the screen contradicts itself in the reader's face. */
  assert.equal(counter.target, 1000000)
  assert.equal(at(NANOSCALE_COUNT_DURATION_MS).value, 1000000)
  assert.equal(at(NANOSCALE_COUNT_DURATION_MS * 4).value, 1000000)
  assert.equal(at(NANOSCALE_COUNT_DURATION_MS).progress, 1)
})

test('it starts from nothing', () => {
  assert.equal(at(0).value, 0)
  assert.equal(at(0).progress, 0)
})

test('it only ever climbs', () => {
  let previous = -1
  for (let step = 0; step <= 400; step += 1) {
    const { value, progress } = at((NANOSCALE_COUNT_DURATION_MS * step) / 300)
    assert.ok(value >= previous, `went backwards at step ${step}: ${previous} -> ${value}`)
    assert.ok(progress >= 0 && progress <= 1, `progress out of range: ${progress}`)
    previous = value
  }
})

test('it counts in ten thousands rather than every last digit', () => {
  /* The board shows it mid-flight at 550,000. A number changing all seven
     digits every frame is unreadable, so it steps while it runs. */
  for (let step = 1; step < 60; step += 1) {
    const { value } = at((NANOSCALE_COUNT_DURATION_MS * step) / 60)
    assert.equal(value % NANOSCALE_COUNT_STEP, 0, `${value} is not a round ten thousand`)
  }
})

test('the fill leads the number off the mark', () => {
  /* Eased out, so the field is visibly filling early rather than the whole
     thing crawling at a constant rate. */
  const quarter = at(NANOSCALE_COUNT_DURATION_MS * 0.25)
  assert.ok(quarter.progress > 0.25, `expected an early lead, got ${quarter.progress}`)
  assert.ok(quarter.progress < 0.95, `expected room left to run, got ${quarter.progress}`)
})

test('reduced motion arrives rather than travels', () => {
  const state = nanoscaleCountState(0, { target: counter.target, reducedMotion: true })
  assert.equal(state.value, 1000000)
  assert.equal(state.progress, 1)
})

test('a missing clock is not a crash or a wrong number', () => {
  for (const elapsed of [undefined, Number.NaN, -1000, Infinity]) {
    const state = nanoscaleCountState(elapsed, { target: counter.target })
    assert.ok(Number.isFinite(state.value), `${elapsed} produced ${state.value}`)
    assert.ok(state.value >= 0 && state.value <= counter.target)
    assert.ok(state.progress >= 0 && state.progress <= 1)
  }
  /* No target at all should read as zero, not NaN painted on the screen. */
  const empty = nanoscaleCountState(500, {})
  assert.equal(empty.value, 0)
})

test('the number is grouped the way the board writes it', () => {
  assert.equal(formatNanoscaleCount(1000000), '1,000,000')
  assert.equal(formatNanoscaleCount(550000), '550,000')
  assert.equal(formatNanoscaleCount(0), '0')
  assert.equal(formatNanoscaleCount(Number.NaN), '0')
})

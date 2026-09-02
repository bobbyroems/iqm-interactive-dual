import assert from 'node:assert/strict'
import test from 'node:test'

import {
  NANOWIRE_CORRECTED_PULSE,
  NANOWIRE_CORRECTION_COLOR_TRANSITION,
  NANOWIRE_FINAL_HANDOFF,
  NANOWIRE_FINAL_RISE,
  resolveCorrectedPulse,
  resolveNanowireCorrectionColorTransition,
  resolveNanowireFinalFlowElapsed,
  resolveNanowireFinalHandoff,
  resolveNanowireFinalRise
} from '../src/js/modules/build-nanowire/interaction.js'
import {
  NANOWIRE_FINAL_FLOW_BASE,
  NANOWIRE_FINAL_FLOW_PULSE,
  NANOWIRE_LOUPE_CORRECTED_GRADIENT
} from '../src/js/modules/build-nanowire/palette.js'

const {
  periodMs,
  frontWidth,
  trailWidth,
  glowTrailWidth,
  corePeak,
  glowPeak
} = NANOWIRE_CORRECTED_PULSE
const peak = corePeak + glowPeak
const at = (x, elapsed) => resolveCorrectedPulse({ x, y: 0.5, z: 0.5 }, elapsed)
const centreBend = Math.sin((0.5 * 1.15 + 0.5 * 0.32) * Math.PI) * 0.012
const headAt = elapsed => -frontWidth
  + (((elapsed % periodMs) / periodMs) * (1 + frontWidth + glowTrailWidth))
const sampleWire = (elapsed, steps = 400) =>
  Array.from({ length: steps + 1 }, (_, i) => at(i / steps, elapsed))

/* IQM's note on the 25 Aug board: "Entire nanowire transitions into a uniform
   blue. A smooth pulse/light wave travels from one end to the other. The flow
   is uninterrupted." Each of those is a claim worth holding onto. */

test('the completed light crosses briskly enough to read without waiting', () => {
  assert.equal(periodMs, 3000)
})

test('one light, not several', () => {
  /* The old finish ran a turbulent filament field, which is what made it read
     as a moving rainbow. Asked to carry a single pulse it carried several, so
     the thing to protect is that the wire is lit in exactly one place. */
  for (let step = 0; step < 12; step += 1) {
    const values = sampleWire((periodMs * step) / 12)
    let risingRuns = 0
    let rising = false
    for (let i = 1; i < values.length; i += 1) {
      const goingUp = values[i] > values[i - 1]
      if (goingUp && !rising) risingRuns += 1
      rising = goingUp
    }
    assert.ok(risingRuns <= 1, `expected at most one band, saw ${risingRuns} rising runs`)
  }
})

test('the light crosses the whole wire', () => {
  /* Both ends must actually be reached, not merely approached. */
  const lit = position => {
    for (let step = 0; step <= 240; step += 1) {
      if (at(position, (periodMs * step) / 240) > peak * 0.98) return true
    }
    return false
  }
  assert.ok(lit(0), 'the far end never lights')
  assert.ok(lit(1), 'the near end never lights')
  assert.ok(lit(0.5), 'the middle never lights')
})

test('it enters and leaves rather than appearing mid-wire', () => {
  /* At the start of a pass the head sits off the end, so the wire is dark. */
  assert.equal(at(0.5, 0), 0)
  assert.equal(at(1, 0), 0)
})

test('the band has no edge to see', () => {
  /* The quintic profile reaches zero without a visible step. */
  const elapsed = periodMs * 0.5
  let previous = 0
  let largestStep = 0
  for (let i = 0; i <= 10000; i += 1) {
    const value = at(i / 10000, elapsed)
    largestStep = Math.max(largestStep, Math.abs(value - previous))
    previous = value
  }
  assert.ok(largestStep < 0.004, `steps of ${largestStep} would read as a hard edge`)
})

test('the final band eases smoothly into its bright front and dimmer tail', () => {
  const elapsed = periodMs * 0.5
  const head = headAt(elapsed)
  const centre = head - centreBend
  const tail = Array.from(
    { length: 25 },
    (_, index) => at(centre - glowTrailWidth + (glowTrailWidth * index / 24), elapsed)
  )
  const front = Array.from(
    { length: 9 },
    (_, index) => at(centre + (frontWidth * index / 8), elapsed)
  )
  for (let index = 1; index < tail.length; index += 1) {
    assert.ok(tail[index] >= tail[index - 1], 'the tail should rise monotonically into its head')
  }
  for (let index = 1; index < front.length; index += 1) {
    assert.ok(front[index] <= front[index - 1], 'the leading edge should fall away from its head')
  }
})

test('the flow does not stop', () => {
  /* It loops seamlessly: the same instant of the next pass looks identical. */
  for (const position of [0, 0.25, 0.5, 0.75, 1]) {
    for (const offset of [0, periodMs * 0.37, periodMs * 0.81]) {
      assert.ok(
        Math.abs(at(position, offset) - at(position, offset + periodMs)) < 1e-9,
        'the pulse should repeat exactly'
      )
    }
  }
})

test('atoms outside the band are left at the base blue', () => {
  const elapsed = periodMs * 0.5
  const head = headAt(elapsed)
  const centre = head - centreBend
  assert.equal(at(centre + frontWidth * 1.2, elapsed), 0)
  assert.equal(at(centre - glowTrailWidth * 1.2, elapsed), 0)
  assert.ok(at(centre, elapsed) > peak * 0.99, 'the head itself should reach the authored peak')
})

test('nonsense inputs do not produce nonsense light', () => {
  /* A position that is not a number falls back to the start of the wire, the
     same way the flow field beside it does. That is a real place on the wire,
     so it can legitimately be lit — what matters is that nothing here can hand
     the material a NaN to interpolate a colour against. */
  for (const input of [null, undefined, {}, { x: Number.NaN }, { x: Infinity }]) {
    for (const elapsed of [0, 500, Number.NaN, -1, Infinity]) {
      const value = resolveCorrectedPulse(input, elapsed)
      assert.ok(
        Number.isFinite(value) && value >= 0 && value <= 1,
        `resolveCorrectedPulse(${JSON.stringify(input)}, ${elapsed}) gave ${value}`
      )
    }
  }
})

test('the finale preserves the travelling wave epoch while the model rises', () => {
  const repairStartedAt = 1_000
  const finalFlowStartedAt = 4_200
  const correctionTransitionDuration = 780
  assert.equal(resolveNanowireFinalFlowElapsed(finalFlowStartedAt, {
    repairStartedAt,
    correctionTransitionDuration,
    finalFlowStartedAt
  }), 2_420)
  assert.equal(resolveNanowireFinalFlowElapsed(finalFlowStartedAt + 300, {
    repairStartedAt,
    correctionTransitionDuration,
    finalFlowStartedAt
  }), 2_720)
  assert.equal(resolveNanowireFinalFlowElapsed(finalFlowStartedAt + 300, {
    repairStartedAt,
    correctionTransitionDuration,
    finalFlowStartedAt,
    reducedMotion: true
  }), 3_200)
})

test('perturbation settles into blue with a bounded, smooth colour transition', () => {
  const { durationMs } = NANOWIRE_CORRECTION_COLOR_TRANSITION
  const samples = Array.from(
    { length: 41 },
    (_, index) => resolveNanowireCorrectionColorTransition((durationMs * index) / 40)
  )
  assert.equal(samples[0], 0)
  assert.equal(samples.at(-1), 1)
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] >= samples[index - 1], 'the colour handoff must never reverse')
  }
  assert.ok(samples[1] < 0.001, 'the perturbation should not be cut off on the first frame')
  assert.ok(samples.at(-2) > 0.999, 'the blue should settle without a visible final step')
  assert.equal(resolveNanowireCorrectionColorTransition(0, { reducedMotion: true }), 1)
})

test('the repair-epoch blue sweep settles into the final-epoch sweep without a cut', () => {
  const { durationMs } = NANOWIRE_FINAL_HANDOFF
  const samples = Array.from(
    { length: 21 },
    (_, index) => resolveNanowireFinalHandoff((durationMs * index) / 20)
  )
  assert.equal(samples[0], 0)
  assert.equal(samples.at(-1), 1)
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] >= samples[index - 1], 'the handoff must never jump backwards')
  }
  assert.ok(samples[1] < 0.01, 'the outgoing field should not be cut off on the first frames')
  assert.ok(samples.at(-2) > 0.99, 'the final field should settle without a visible tail')
  assert.equal(resolveNanowireFinalHandoff(0, { reducedMotion: true }), 1)
})

test('the final light has one bright front with progressively dimmer atom columns behind it', () => {
  const elapsed = periodMs * 0.5
  const head = headAt(elapsed)
  const centreX = head - centreBend
  const centre = resolveCorrectedPulse({ x: centreX, y: 0.5, z: 0.5 }, elapsed)
  const coreShoulder = resolveCorrectedPulse(
    { x: centreX - trailWidth * 0.5, y: 0.5, z: 0.5 },
    elapsed
  )
  const outerGlow = resolveCorrectedPulse(
    { x: centreX - trailWidth * 1.25, y: 0.5, z: 0.5 },
    elapsed
  )
  const atomColumn = 1 / 23
  const descendingColumns = [0, 1, 2, 3].map(column =>
    resolveCorrectedPulse(
      { x: centreX - (atomColumn * column), y: 0.5, z: 0.5 },
      elapsed
    )
  )
  const rowSampleX = centreX - trailWidth * 0.4
  const nearRow = resolveCorrectedPulse({ x: rowSampleX, y: 0, z: 0 }, elapsed)
  const farRow = resolveCorrectedPulse({ x: rowSampleX, y: 1, z: 1 }, elapsed)
  assert.ok(frontWidth <= atomColumn * 1.1, 'the brightest front should stay near one atom column')
  assert.ok(trailWidth <= atomColumn * 3.1, 'the strong tail should stay within three atom columns')
  assert.ok(glowTrailWidth <= atomColumn * 5.6, 'the faint tail should stay close to the front')
  assert.ok(centre <= 0.7 && centre >= 0.64, 'the sweep should glow rather than bleach atoms white')
  assert.ok(coreShoulder > 0.3, 'the compact core should still have a soft shoulder')
  assert.ok(outerGlow > 0 && outerGlow < 0.08, 'the outer halo should be present but barely colour the atoms')
  for (let index = 1; index < descendingColumns.length; index += 1) {
    assert.ok(
      descendingColumns[index] < descendingColumns[index - 1],
      'each atom column behind the head should be darker than the one before it'
    )
  }
  assert.ok(Math.abs(nearRow - farRow) > 0.01, 'the front should not be a ruler-straight slice')
})

test('the completed qubit rises once and settles smoothly above the grid', () => {
  const samples = Array.from(
    { length: 21 },
    (_, index) => resolveNanowireFinalRise((NANOWIRE_FINAL_RISE.durationMs * index) / 20)
  )
  assert.equal(samples[0], 0)
  assert.equal(samples.at(-1), 1)
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] >= samples[index - 1], 'the completed wire must never dip back down')
  }
  assert.equal(resolveNanowireFinalRise(0, { reducedMotion: true }), 1)
})

test('every post-correct experience colour stays in the repaired blue family', () => {
  for (const color of [
    NANOWIRE_FINAL_FLOW_BASE,
    NANOWIRE_FINAL_FLOW_PULSE,
    ...NANOWIRE_LOUPE_CORRECTED_GRADIENT
  ]) {
    const red = (color >> 16) & 0xff
    const green = (color >> 8) & 0xff
    const blue = color & 0xff
    assert.ok(blue > red && blue >= green, `0x${color.toString(16)} leaves the blue family`)
  }
})

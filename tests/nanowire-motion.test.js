import assert from 'node:assert/strict'
import test from 'node:test'

import {
  NANOWIRE_EVENTS,
  NANOWIRE_INTRO_REDUCED_TIMING,
  NANOWIRE_INTRO_TIMING,
  NANOWIRE_LOUPE_TARGETING,
  NANOWIRE_PHASES,
  NANOWIRE_SCAN_VIBRATION,
  getSheetBuildTiming,
  nextNanowirePhase,
  resolveLoupeCenteringProgress,
  resolveLoupeTarget,
  resolveNanowireIntroGridOpacity,
  resolveNanowireIntroSequence,
  resolveScanVibrationEnvelope
} from '../src/js/modules/build-nanowire/interaction.js'
import { resolveNanowireIntroAtomState } from '../src/js/modules/build-nanowire/nanowire-scene.js'
import {
  NANOWIRE_MENU_COLOR_TREATMENT,
  NANOWIRE_MENU_ERROR_GRADIENT,
  NANOWIRE_MENU_FINAL_FLOW_BASE,
  NANOWIRE_MENU_FINAL_FLOW_PULSE,
  NANOWIRE_MENU_FOCUSED_ERROR_COLOR,
  NANOWIRE_MENU_INSPECTION_GRADIENT,
  NANOWIRE_MENU_INSPECTION_REPAIRED_GRADIENT,
  NANOWIRE_MENU_MATERIAL,
  sampleNanowireMenuLoop
} from '../src/js/modules/build-nanowire/menu-scene.js'
import {
  NANOWIRE_ATOM_SURFACE,
  NANOWIRE_COLORS,
  NANOWIRE_FINAL_FLOW_BASE,
  NANOWIRE_FINAL_FLOW_PULSE,
  NANOWIRE_LOUPE_CORRECTED_GRADIENT,
  NANOWIRE_LOUPE_ERROR_GRADIENT,
  NANOWIRE_PERTURBED_FLOW_GRADIENT
} from '../src/js/modules/build-nanowire/palette.js'
import { getModule } from '../src/js/modules/module-registry.js'

const INTRO_LONG_COUNT = 24
const INTRO_WIDE_COUNT = 8
const INTRO_ATOM_SPACING = 0.46
const INTRO_EPSILON = 1e-10

function sampleIntroFoundation(elapsed, options = {}) {
  const timeline = resolveNanowireIntroSequence(elapsed, options)
  const atoms = []
  for (let long = 0; long < INTRO_LONG_COUNT; long += 1) {
    for (let wide = 0; wide < INTRO_WIDE_COUNT; wide += 1) {
      atoms.push(resolveNanowireIntroAtomState(
        { long, wide },
        timeline,
        options,
        {}
      ))
    }
  }
  return { timeline, atoms }
}

test('intro timeline is sequential, bounded, monotonic, and exact', () => {
  const timing = NANOWIRE_INTRO_TIMING
  const lineStart = timing.atomEntrance + timing.atomHold
  const sheetStart = lineStart + timing.lineDuration + timing.lineHold
  const handoffStart = sheetStart + timing.sheetDuration + timing.sheetHold

  assert.equal(resolveNanowireIntroSequence(-1).stage, 'atom')
  assert.equal(resolveNanowireIntroSequence(Number.NaN).atomProgress, 1)
  assert.equal(timing.atomEntrance, 0)
  assert.equal(timing.atomHold, 120)
  assert.ok(timing.lineDuration >= 1_300)
  assert.ok(timing.lineHold >= 700)
  assert.ok(timing.sheetDuration >= 1_400)
  assert.equal(timing.totalDuration, 3_771)
  assert.equal(handoffStart + timing.handoffDuration, timing.totalDuration)
  assert.equal(resolveNanowireIntroSequence(lineStart).stage, 'line')
  assert.equal(resolveNanowireIntroSequence(lineStart).lineProgress, 0)
  assert.equal(resolveNanowireIntroSequence(sheetStart - 1).sheetProgress, 0)
  assert.equal(resolveNanowireIntroSequence(sheetStart).stage, 'sheet')
  assert.equal(resolveNanowireIntroSequence(handoffStart).stage, 'handoff')
  assert.equal(resolveNanowireIntroSequence(handoffStart).sheetProgress, 1)
  assert.equal(resolveNanowireIntroSequence(timing.totalDuration).stage, 'complete')
  assert.equal(resolveNanowireIntroSequence(timing.totalDuration).handoffProgress, 1)
  assert.equal(resolveNanowireIntroSequence(timing.totalDuration).complete, true)

  let previous = { atomProgress: 0, lineProgress: 0, sheetProgress: 0, handoffProgress: 0 }
  for (let elapsed = 0; elapsed <= timing.totalDuration; elapsed += 17) {
    const current = resolveNanowireIntroSequence(elapsed)
    for (const key of ['atomProgress', 'lineProgress', 'sheetProgress', 'handoffProgress']) {
      assert.ok(current[key] >= previous[key] && current[key] <= 1, `${key} at ${elapsed}ms`)
    }
    if (current.lineProgress < 1) assert.equal(current.sheetProgress, 0)
    if (current.sheetProgress < 1) assert.equal(current.handoffProgress, 0)
    previous = current
  }
})

test('intro grows one atom into one exact line and one exact foundation sheet', () => {
  const timing = NANOWIRE_INTRO_TIMING
  const lineEnd = timing.atomEntrance + timing.atomHold + timing.lineDuration
  const sheetEnd = lineEnd + timing.lineHold + timing.sheetDuration
  const sheetStart = lineEnd + timing.lineHold
  const openingAtomFrame = sampleIntroFoundation(0)
  const heldAtomFrame = sampleIntroFoundation(timing.atomEntrance + timing.atomHold - 1)
  const lineFrame = sampleIntroFoundation(lineEnd)
  const heldLineFrame = sampleIntroFoundation(sheetStart - 1)
  const sheetFrame = sampleIntroFoundation(sheetEnd)

  for (const atomFrame of [openingAtomFrame, heldAtomFrame]) {
    const visibleAtoms = atomFrame.atoms.filter(atom => atom.visible)
    assert.equal(atomFrame.timeline.stage, 'atom')
    assert.equal(visibleAtoms.length, 1)
    assert.ok(Math.abs(visibleAtoms[0].x) < INTRO_EPSILON)
    assert.ok(Math.abs(visibleAtoms[0].z) < INTRO_EPSILON)
    assert.ok(visibleAtoms[0].scale > 2.5)
    assert.ok(visibleAtoms[0].y > 0)
  }

  const visibleLine = lineFrame.atoms.filter(atom => atom.visible)
  assert.equal(visibleLine.length, INTRO_LONG_COUNT)
  assert.ok(visibleLine.every(atom => Math.abs(atom.z) < INTRO_EPSILON))
  const lineXs = visibleLine.map(atom => atom.x).sort((a, b) => a - b)
  for (let index = 1; index < lineXs.length; index += 1) {
    assert.ok(Math.abs((lineXs[index] - lineXs[index - 1]) - INTRO_ATOM_SPACING) < INTRO_EPSILON)
  }

  const visibleHeldLine = heldLineFrame.atoms.filter(atom => atom.visible)
  assert.equal(heldLineFrame.timeline.stage, 'line')
  assert.equal(heldLineFrame.timeline.sheetProgress, 0)
  assert.equal(visibleHeldLine.length, INTRO_LONG_COUNT)
  assert.ok(visibleHeldLine.every(atom => Math.abs(atom.z) < INTRO_EPSILON))

  assert.equal(sheetFrame.atoms.filter(atom => atom.visible).length, INTRO_LONG_COUNT * INTRO_WIDE_COUNT)
  for (let long = 0; long < INTRO_LONG_COUNT; long += 1) {
    for (let wide = 0; wide < INTRO_WIDE_COUNT; wide += 1) {
      const atom = sheetFrame.atoms[(long * INTRO_WIDE_COUNT) + wide]
      const expectedX = (long - ((INTRO_LONG_COUNT - 1) * 0.5)) * INTRO_ATOM_SPACING
      const expectedZ = (wide - ((INTRO_WIDE_COUNT - 1) * 0.5)) * INTRO_ATOM_SPACING
      assert.ok(Math.abs(atom.x - expectedX) < INTRO_EPSILON)
      assert.ok(Math.abs(atom.y) < INTRO_EPSILON)
      assert.ok(Math.abs(atom.z - expectedZ) < INTRO_EPSILON)
      assert.ok(Math.abs(atom.scale - 1) < INTRO_EPSILON)
    }
  }
})

test('foundation sheet adds readable line groups instead of revealing every row together', () => {
  const timing = NANOWIRE_INTRO_TIMING
  const sheetStart = timing.atomEntrance + timing.atomHold + timing.lineDuration + timing.lineHold
  const earlySheet = sampleIntroFoundation(sheetStart + (timing.sheetDuration * 0.25))
  const middleSheet = sampleIntroFoundation(sheetStart + (timing.sheetDuration * 0.45))
  const visibleRows = frame => [...new Set(frame.atoms
    .map((atom, index) => atom.visible ? index % INTRO_WIDE_COUNT : null)
    .filter(index => index !== null))]

  assert.deepEqual(visibleRows(earlySheet), [3, 4])
  assert.deepEqual(visibleRows(middleSheet), [1, 2, 3, 4, 5, 6])
})

test('reduced motion uses three still compositions and completes without spatial travel', () => {
  const timing = NANOWIRE_INTRO_REDUCED_TIMING
  assert.ok(timing.totalDuration <= 900)

  const reducedSheetStart = timing.atomEntrance + timing.atomHold + timing.lineDuration + timing.lineHold
  const openingAtomFrame = sampleIntroFoundation(0, { reducedMotion: true })
  const atomFrame = sampleIntroFoundation(timing.atomHold - 1, { reducedMotion: true })
  const lineFrame = sampleIntroFoundation(timing.atomHold + timing.lineDuration, { reducedMotion: true })
  const heldLineFrame = sampleIntroFoundation(reducedSheetStart - 1, { reducedMotion: true })
  const sheetFrame = sampleIntroFoundation(
    reducedSheetStart + timing.sheetDuration,
    { reducedMotion: true }
  )
  const complete = resolveNanowireIntroSequence(timing.totalDuration, { reducedMotion: true })

  assert.equal(openingAtomFrame.atoms.filter(atom => atom.visible).length, 1)
  assert.equal(atomFrame.atoms.filter(atom => atom.visible).length, 1)
  assert.equal(lineFrame.atoms.filter(atom => atom.visible).length, INTRO_LONG_COUNT)
  assert.equal(heldLineFrame.atoms.filter(atom => atom.visible).length, INTRO_LONG_COUNT)
  assert.ok(heldLineFrame.atoms.filter(atom => atom.visible)
    .every(atom => Math.abs(atom.z) < INTRO_EPSILON))
  assert.equal(sheetFrame.atoms.filter(atom => atom.visible).length, INTRO_LONG_COUNT * INTRO_WIDE_COUNT)
  assert.equal(complete.complete, true)
  assert.equal(complete.handoffProgress, 1)
})

test('Module 06 keeps its first rendered atom covered until the scene is presentation-ready', () => {
  assert.equal(getModule('build-nanowire')?.waitForPresentationReady, true)
})

test('scan vibration can sustain until inspection begins and then stop exactly', () => {
  const { duration, attack, release } = NANOWIRE_SCAN_VIBRATION

  assert.equal(resolveScanVibrationEnvelope(-1), 0)
  assert.equal(resolveScanVibrationEnvelope(0), 0)
  assert.equal(resolveScanVibrationEnvelope(attack), 1)
  assert.equal(resolveScanVibrationEnvelope(duration - release), 1)
  assert.equal(resolveScanVibrationEnvelope(duration), 0)
  assert.equal(resolveScanVibrationEnvelope(Number.NaN), 0)
  assert.equal(resolveScanVibrationEnvelope(attack, { reducedMotion: true }), 0)
  assert.equal(resolveScanVibrationEnvelope(attack, { active: false }), 0)
  assert.equal(resolveScanVibrationEnvelope(duration * 4, { sustain: true }), 1)
  assert.equal(resolveScanVibrationEnvelope(duration * 4, { sustain: true, active: false }), 0)

  const releaseMidpoint = duration - (release * 0.5)
  const releaseEnvelope = resolveScanVibrationEnvelope(releaseMidpoint)
  assert.ok(releaseEnvelope > 0 && releaseEnvelope < 1)

  for (let elapsed = -100; elapsed <= duration + 100; elapsed += 17) {
    const envelope = resolveScanVibrationEnvelope(elapsed)
    assert.ok(Number.isFinite(envelope))
    assert.ok(envelope >= 0 && envelope <= 1)
  }
})

test('nanowire phases keep scanning separate from loupe inspection and correction', () => {
  let phase = NANOWIRE_PHASES.loading
  assert.equal(nextNanowirePhase(phase, NANOWIRE_EVENTS.swiped), NANOWIRE_PHASES.loading)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.loaded)
  assert.equal(phase, NANOWIRE_PHASES.awaitingStart)
  assert.equal(nextNanowirePhase(phase, NANOWIRE_EVENTS.swiped), NANOWIRE_PHASES.awaitingStart)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.started)
  assert.equal(phase, NANOWIRE_PHASES.intro)
  assert.equal(nextNanowirePhase(phase, NANOWIRE_EVENTS.started), NANOWIRE_PHASES.intro)
  assert.equal(nextNanowirePhase(phase, NANOWIRE_EVENTS.swiped), NANOWIRE_PHASES.intro)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.introduced)
  assert.equal(phase, NANOWIRE_PHASES.ready)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.swiped)
  assert.equal(phase, NANOWIRE_PHASES.assembling)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.assembled)
  assert.equal(phase, NANOWIRE_PHASES.scanning)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.scanned)
  assert.equal(phase, NANOWIRE_PHASES.inspect)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.targeted)
  assert.equal(phase, NANOWIRE_PHASES.targeted)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.correct)
  assert.equal(phase, NANOWIRE_PHASES.correcting)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.repaired)
  assert.equal(phase, NANOWIRE_PHASES.repaired)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.finalized)
  assert.equal(phase, NANOWIRE_PHASES.finale)
  phase = nextNanowirePhase(phase, NANOWIRE_EVENTS.completed)
  assert.equal(phase, NANOWIRE_PHASES.complete)
})

test('the opening grid is visible while added sheets wait for the swipe', () => {
  const atom = resolveNanowireIntroSequence(0)
  const line = resolveNanowireIntroSequence(NANOWIRE_INTRO_TIMING.atomHold + 600)
  assert.ok(resolveNanowireIntroGridOpacity(atom) > 0)
  assert.ok(resolveNanowireIntroGridOpacity(line) >= resolveNanowireIntroGridOpacity(atom))
  for (let sheet = 0; sheet < 4; sheet += 1) {
    assert.deepEqual(getSheetBuildTiming(sheet), {
      visible: false,
      localElapsed: 0,
      revealProgress: 0
    })
  }
  assert.equal(getSheetBuildTiming(0, 0).visible, true)
})

test('repair unlocks only when the loupe is tightly centred and keeps stable hysteresis', () => {
  const defect = { x: 0, y: 0 }
  const { lockRadius, releaseRadius } = NANOWIRE_LOUPE_TARGETING

  assert.equal(resolveLoupeTarget({ x: lockRadius, y: 0 }, defect).targeted, true)
  assert.equal(resolveLoupeTarget({ x: lockRadius + 0.01, y: 0 }, defect).targeted, false)
  assert.equal(resolveLoupeTarget(
    { x: releaseRadius, y: 0 },
    defect,
    { wasTargeted: true }
  ).targeted, true)
  assert.equal(resolveLoupeTarget(
    { x: releaseRadius + 0.01, y: 0 },
    defect,
    { wasTargeted: true }
  ).targeted, false)
})

test('loupe centring progress is smooth, bounded, and exact at completion', () => {
  const { centeringDuration } = NANOWIRE_LOUPE_TARGETING

  assert.equal(resolveLoupeCenteringProgress(0), 0)
  assert.equal(resolveLoupeCenteringProgress(centeringDuration * 0.5), 0.5)
  assert.equal(resolveLoupeCenteringProgress(centeringDuration), 1)
  assert.equal(resolveLoupeCenteringProgress(centeringDuration + 100), 1)
  assert.equal(resolveLoupeCenteringProgress(Number.NaN), 0)
  assert.equal(resolveLoupeCenteringProgress(0, { reducedMotion: true }), 1)

  let previous = 0
  for (let elapsed = 0; elapsed <= centeringDuration; elapsed += 7) {
    const progress = resolveLoupeCenteringProgress(elapsed)
    assert.ok(progress >= previous && progress <= 1)
    previous = progress
  }
})

test('navigation nanowire uses the module surface and unmodified semantic palettes', () => {
  assert.deepEqual(NANOWIRE_MENU_MATERIAL, NANOWIRE_ATOM_SURFACE)
  assert.strictEqual(NANOWIRE_MENU_ERROR_GRADIENT, NANOWIRE_PERTURBED_FLOW_GRADIENT)
  assert.strictEqual(NANOWIRE_MENU_INSPECTION_GRADIENT, NANOWIRE_LOUPE_ERROR_GRADIENT)
  assert.strictEqual(
    NANOWIRE_MENU_INSPECTION_REPAIRED_GRADIENT,
    NANOWIRE_LOUPE_CORRECTED_GRADIENT
  )
  assert.strictEqual(NANOWIRE_MENU_FINAL_FLOW_BASE, NANOWIRE_FINAL_FLOW_BASE)
  assert.strictEqual(NANOWIRE_MENU_FINAL_FLOW_PULSE, NANOWIRE_FINAL_FLOW_PULSE)
  assert.equal(NANOWIRE_MENU_FOCUSED_ERROR_COLOR, NANOWIRE_COLORS.defectCore)
  assert.equal(NANOWIRE_MENU_COLOR_TREATMENT.paletteSaturation, 0)
  assert.equal(NANOWIRE_MENU_COLOR_TREATMENT.paletteLightness, 0)
})

test('navigation error reveal and repair use the module durations and sequencing', () => {
  const storyRate = 10 / 14
  const revealStart = 2.7 / storyRate
  const repairStart = 4.2 / storyRate

  assert.ok(sampleNanowireMenuLoop(revealStart).defectReveal < 1e-9)
  assert.equal(sampleNanowireMenuLoop(revealStart + 0.76).defectReveal, 1)
  assert.equal(sampleNanowireMenuLoop(repairStart).repairProgress, 0)
  assert.ok(Math.abs(sampleNanowireMenuLoop(repairStart + 0.31).repairProgress - 0.5) < 1e-9)

  const atomRepaired = sampleNanowireMenuLoop(repairStart + 0.62)
  assert.equal(atomRepaired.repairProgress, 1)
  assert.ok(atomRepaired.repairFieldProgress < 1e-9)
  assert.ok(atomRepaired.correctedFlowElapsed < 1e-9)

  const fieldMidpoint = sampleNanowireMenuLoop(repairStart + 0.62 + 0.36)
  assert.ok(Math.abs(fieldMidpoint.repairFieldProgress - 0.5) < 1e-9)
  assert.ok(Math.abs(fieldMidpoint.defectPresence - 0.5) < 1e-9)
  assert.ok(Math.abs(fieldMidpoint.correctedFlowElapsed - 360) < 1e-9)
  const fieldRepaired = sampleNanowireMenuLoop(repairStart + 0.62 + 0.72)
  assert.equal(fieldRepaired.repairFieldProgress, 1)
  assert.equal(fieldRepaired.defectPresence, 0)
})

test('navigation holds the static loupe palette between perturbation and repair', () => {
  const storyRate = 10 / 14
  const inspectionStart = 2.7 / storyRate
  const inspection = sampleNanowireMenuLoop(inspectionStart + 0.76)
  const repairStart = 4.2 / storyRate

  assert.equal(inspection.phase, 'defect')
  assert.equal(inspection.scanStrength, 0)
  assert.equal(inspection.inspectionProgress, 1)
  assert.equal(inspection.inspectionPresence, 1)
  assert.equal(inspection.vibrationStrength, 0)
  assert.equal(sampleNanowireMenuLoop(repairStart).inspectionPresence, 1)
  assert.equal(
    sampleNanowireMenuLoop(repairStart + 0.62 + 0.72).inspectionPresence,
    0
  )
})

test('navigation atoms vibrate only while perturbation is being diagnosed', () => {
  const beforePerturbation = sampleNanowireMenuLoop(0.7)
  const perturbation = sampleNanowireMenuLoop(2.1)
  const inspection = sampleNanowireMenuLoop(3.78)
  const reduced = sampleNanowireMenuLoop(2.1, { reducedMotion: true })

  assert.equal(beforePerturbation.vibrationStrength, 0)
  assert.equal(perturbation.phase, 'scanning')
  assert.ok(perturbation.scanStrength > 0.99)
  assert.ok(perturbation.vibrationStrength > 0.99)
  assert.equal(inspection.phase, 'defect')
  assert.equal(inspection.vibrationStrength, 0)
  assert.equal(reduced.vibrationStrength, 0)
  assert.equal(reduced.phase, 'neutral')
})

test('navigation nanowire keeps travelling throughout the complete loop', () => {
  const start = sampleNanowireMenuLoop(0)
  const middle = sampleNanowireMenuLoop(10.5)
  const neutralHold = sampleNanowireMenuLoop(18)
  const loopEnd = sampleNanowireMenuLoop(21)

  assert.equal(start.travelProgress, 0)
  assert.equal(middle.travelProgress, 0.5)
  assert.ok(neutralHold.travelProgress > middle.travelProgress)
  assert.equal(loopEnd.travelProgress, 0)
  assert.equal(sampleNanowireMenuLoop(10.5, { reducedMotion: true }).travelProgress, 0)
})

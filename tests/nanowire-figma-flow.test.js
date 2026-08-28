import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { NANOWIRE_COPY } from '../src/js/modules/build-nanowire/index.js'
import { nextPlayableModule } from '../src/js/modules/module-registry.js'

const source = await readFile(new URL('../src/js/modules/build-nanowire/index.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/js/modules/build-nanowire/build-nanowire.css', import.meta.url), 'utf8')
const appCss = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8')

test('Build a qubit uses the exact approved English copy', () => {
  assert.deepEqual(NANOWIRE_COPY.intro, {
    title: 'Build a qubit atom-by-atom',
    body: 'There’s no factory for this. Microsoft grows these materials atom-by-atom, placing each one where it belongs.',
    tooltip: 'Tap the atom to start'
  })
  assert.equal(NANOWIRE_COPY.ready.title, 'Why so precise?')
  assert.equal(NANOWIRE_COPY.defect.title, 'Can you find the defect?')
  assert.equal(NANOWIRE_COPY.finale.title, 'Every atom in place')
  assert.match(NANOWIRE_COPY.finale.body, /no “Correct” button/)
  assert.match(NANOWIRE_COPY.finale.footer, /near-flawless quantum material on demand/)
})

test('the module reuses the shared explainer and tooltip surfaces', () => {
  assert.match(source, /createKioskExplainer/)
  assert.match(source, /createKioskTooltip/)
  assert.doesNotMatch(source, /<div class="nw__prompt/)
  assert.doesNotMatch(source, /<div class="nw__instruction/)
  assert.match(appCss, /kiosk-explainer\[data-kiosk-explainer-variant='plain'\]/)
  assert.match(appCss, /kiosk-tooltip\.kiosk-tooltip--blue/)
})

test('background phases follow white, orange, repair blue, white finale', () => {
  const orange = css.indexOf('.nw__backdrop--perturbation')
  const blue = css.indexOf('.nw__backdrop--repair')
  assert.ok(orange >= 0 && blue > orange)
  assert.match(css, /data-phase="scanning"[^}]+nw__backdrop--perturbation/s)
  assert.match(css, /data-phase="correcting"[^}]+nw__backdrop--perturbation/s)
  assert.match(css, /data-phase="repaired"[^}]+nw__backdrop--repair/s)
  assert.doesNotMatch(css, /data-phase="finale"[^}]+nw__backdrop--repair/s)
  assert.match(css, /rgba\(255, 98, 0, 0\.4\)/)
  assert.match(css, /rgba\(77, 174, 227, 0\.4\)/)
  assert.match(css, /radial-gradient\(ellipse at 17% 83%/)
  assert.match(css, /animation: nw-repair-fluid-sweep 1450ms cubic-bezier/)
  assert.match(css, /data-phase="repaired"[^}]+nw__scene-wash[^}]+transparent 100%/s)
})

test('correction controls use exports while Vector 114 stays a non-runtime reference', async () => {
  const paths = [
    '../public/assets/modules/build-nanowire/precision-microscope.png',
    '../public/assets/modules/build-nanowire/correct-check.svg',
    '../public/assets/modules/build-nanowire/final-glow.svg'
  ]
  for (const path of paths) assert.ok((await readFile(new URL(path, import.meta.url))).byteLength > 0)
  assert.match(source, /precision-microscope\.png/)
  assert.match(source, /correct-check\.svg/)
  assert.doesNotMatch(source, /final-glow\.svg/)
  assert.doesNotMatch(css, /nw-final-glow/)
  assert.match(css, /height: 140px/)
  assert.match(css, /background: #580fb7/)
  assert.match(css, /background: #1d77ff/)
})

test('touch start, swipe arrow, and tooltip entrance are kiosk-safe', async () => {
  const sceneSource = await readFile(new URL(
    '../src/js/modules/build-nanowire/nanowire-scene.js',
    import.meta.url
  ), 'utf8')
  const arrow = await readFile(new URL(
    '../public/assets/modules/build-nanowire/swipe-down-arrow.svg',
    import.meta.url
  ), 'utf8')
  assert.match(source, /startButton\.addEventListener\('pointerup'/)
  assert.match(source, /const startIntro = \(\) =>/)
  assert.match(source, /scene\?\.getOpeningAtomScreenPosition\(\)/)
  assert.match(source, /--nw-atom-start-x/)
  assert.match(source, /--nw-atom-start-y/)
  assert.match(sceneSource, /atoms\.getMatrixAt\(INTRO_HERO_INDEX, openingAtomMatrix\)/)
  assert.match(source, /has-swipe-arrow/)
  assert.match(arrow, /stroke="#0078D4"/)
  assert.match(css, /\.nw__instruction\.is-showing[^}]+opacity: 1/s)
  assert.match(css, /nw-swipe-arrow-nudge/)
})

test('repair stops vibration, uses the blue-only sweep, and keeps the defect core red', async () => {
  const sceneSource = await readFile(new URL(
    '../src/js/modules/build-nanowire/nanowire-scene.js',
    import.meta.url
  ), 'utf8')
  assert.match(sceneSource, /const DEFECT_CORE_COLOR = NANOWIRE_COLORS\.defectCore/)
  assert.match(sceneSource, /const isScanning = scanStartedAt !== null && inspectionStartedAt === null/)
  assert.match(sceneSource, /const envelope = isScanning && !reducedMotion/)
  assert.doesNotMatch(sceneSource, /isCorrectionBeat|resolveCorrectedFlowField|correctionFlowColors/)
  assert.match(sceneSource, /else if \(repairStartedAt !== null\) \{\s+setCorrectionBeatColor/s)
  assert.match(sceneSource, /if \(finalFlowStartedAt !== null\) \{\s+setCorrectedFlowColor/s)
  assert.match(sceneSource, /resolveCorrectedPulse\(normalizedPosition, elapsed, correctedPulseOptions\)/)
  assert.match(sceneSource, /setPerturbedFlowColor\(normalizedPosition, repairStartedAt, target\)/)
  assert.match(sceneSource, /resolveNanowireCorrectionColorTransition\(repairElapsed/)
  assert.match(sceneSource, /repairElapsed - NANOWIRE_CORRECTION_COLOR_TRANSITION\.durationMs/)
  assert.match(sceneSource, /defectAtom\.scale\.setScalar\(1\.15 - \(repairSequence\.atomProgress \* 0\.15\)\)/)
  assert.doesNotMatch(sceneSource, /finalFlowStartedAt !== null \|\| repairCompleteAt !== null/)
  assert.match(sceneSource, /resolveNanowireFinalRise/)
  assert.match(sceneSource, /addScaledVector\(wireRiseDirection, NANOWIRE_FINAL_RISE\.distance \* progress\)/)
})

test('correction confirmation lasts long enough to read and uses the blue badge', () => {
  assert.match(source, /const CORRECTION_CONFIRMATION_HOLD_MS = 2_000/)
  assert.match(source, /const repair = scene\?\.repairDefect\(\)[\s\S]+await repair/)
  assert.match(css, /\.nw \.nw__corrected \{[^}]+background: #1d77ff;/s)
})

test('Up next keeps registry ownership of Build a Majorana 2', () => {
  const next = nextPlayableModule('build-nanowire')
  assert.equal(next?.id, 'build-majorana-2')
  assert.equal(next?.title, 'Build a Majorana 2')
  assert.match(source, /upNextBanner\?\.offer\(\)/)
  assert.match(source, /await wait\(FINAL_COPY_READING_LEAD_MS\)[\s\S]+upNextBanner\?\.offer\(\)/)
})

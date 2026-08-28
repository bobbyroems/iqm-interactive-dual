import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { nextPlayableModule } from '../src/js/modules/module-registry.js'
import {
  MAJORANA_FINALE_END_FRAME,
  MAJORANA_FINALE_END_REGISTRATION,
  MAJORANA_FINALE_START_REGISTRATION,
  sampleMajoranaFinaleCamera,
  sampleMajoranaFinaleComposition
} from '../src/js/modules/build-majorana-2/majorana-finale.js'
import { NANOSCALE_CAMERA_HANDOFFS } from '../src/js/modules/nanoscale/nanoscale-camera.js'

const source = await readFile(new URL(
  '../src/js/modules/build-majorana-2/index.js',
  import.meta.url
), 'utf8')
const css = await readFile(new URL(
  '../src/js/modules/build-majorana-2/majorana.css',
  import.meta.url
), 'utf8')
const appCss = await readFile(new URL(
  '../src/styles/app.css',
  import.meta.url
), 'utf8')
const finaleSource = await readFile(new URL(
  '../src/js/modules/build-majorana-2/majorana-finale.js',
  import.meta.url
), 'utf8')

test('Majorana v2 keeps the persistent utility header and removes section tabs', () => {
  assert.match(source, /data-majorana-action="restart"/)
  assert.match(source, /data-majorana-action="exit"/)
  assert.doesNotMatch(source, /class="majorana-progress/)
  assert.doesNotMatch(css, /\.majorana-progress/)
  assert.doesNotMatch(source, />MAJORANA\s*2</i)
})

test('component and channel copy follows the approved linear presentation', () => {
  assert.match(source, /Quantum Processing Module/)
  assert.match(source, /Together, the QPU stack and Cryo-CMOS make up two key components of Majorana 2\./)
  assert.match(source, /Quantum information channels/)
  assert.match(source, /Each of these channels carries unique information, from control instructions to readout\./)
  assert.match(source, />Instructions From External Instrumentation</)
  assert.match(source, />Control Signals To QPU</)
  assert.match(source, />Quantum Information Readout</)
  assert.match(source, /Tap anywhere to continue/)
})

test('channel overview is presentation-only and highlights the active label', () => {
  assert.doesNotMatch(source, /data-pathway-select="/)
  assert.match(source, /visual\.label\.classList\.toggle\('is-active', isActive\)/)
  assert.match(css, /\.majorana-pathway-tooltip\.is-active/)
})

test('Majorana v2 reuses shared kiosk surfaces and exposes missing-part states', () => {
  assert.match(source, /createKioskExplainer/)
  assert.match(source, /createKioskTooltip/)
  assert.match(source, /Awaiting instructions\. Add missing component\./)
  assert.match(source, /Awaiting quantum signals\. Add missing component\./)
  assert.match(source, /Together, the cryo-CMOS and QPU stack form a complete quantum processing module\./)
  assert.match(source, /Tap anywhere to finish/)
  assert.match(css, /\.majorana-module\.is-build-missing/)
})

test('Figma typography, holders and action colours cannot fall back to legacy sizing', () => {
  assert.match(css, /\.majorana-components-focus__intro \.kiosk-explainer__title[\s\S]*font-size: 96px/)
  assert.match(css, /\.majorana-components-focus__card \.kiosk-explainer__body[\s\S]*font-size: 60px/)
  assert.match(css, /top: 80px;[\s\S]*left: 424\.965px;[\s\S]*width: 1310\.068px;[\s\S]*height: 830\.757px/)
  assert.match(css, /background-color: rgba\(141, 200, 232, 0\.5\) !important/)
  assert.match(css, /color: #0078d4/)
  assert.match(css, /majorana-shared-tooltip[\s\S]*backdrop-filter: blur\(60px\)/)
  assert.match(css, /border-color: rgba\(255, 179, 187, 0\.7\);[\s\S]*background-color: rgba\(255, 179, 187, 0\.5\) !important/)
  assert.match(css, /color: #cf3919/)
  assert.match(source, /majorana-component-holder__border/)
  assert.match(css, /stroke-dasharray: 34px 26px/)
  assert.match(css, /--majorana-holder-border: rgba\(9, 31, 44, 0\.48\)/)
  assert.match(css, /rgba\(144, 87, 74, 0\) 0%[\s\S]*rgba\(246, 148, 127, 0\.3\) 100%/)
  assert.match(css, /is-build-complete \.majorana-build__tray[\s\S]*rgba\(255, 255, 255, 0\.6\)/)
  assert.match(css, /majorana-build__tray[\s\S]*background: rgba\(255, 255, 255, 0\.6\);[\s\S]*backdrop-filter: blur\(30px\)/)
})

test('component captions enter with their matching 3D models', () => {
  assert.match(css, /components-focus__card--qpu[\s\S]*transition-delay: 200ms/)
  assert.match(css, /components-focus__card--cmos[\s\S]*transition-delay: 0ms/)
  assert.match(css, /component-spotlight="qpu"[\s\S]*components-focus__card--cmos[\s\S]*opacity: 0/)
  assert.match(source, /registerComponentFocusOrigins\(\)/)
  assert.match(source, /sourceRect\.top - targetRect\.top/)
  assert.match(source, /componentsPhase = 'priming'/)
  assert.match(source, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(beginPaintedFocus\)/)
  assert.match(css, /data-components-phase="priming"[\s\S]*transition: none/)
  assert.match(css, /--component-enter-scale-x/)
  assert.match(css, /--component-enter-scale-y/)
})

test('the finale retains one Majorana plate through the reversed module 08 handoff', () => {
  assert.match(finaleSource, /assets\/modules\/nanoscale\/cryostat\.webp/)
  assert.match(finaleSource, /assets\/modules\/nanoscale\/majorana-2\.webp/)
  assert.doesNotMatch(finaleSource, /majorana-2-background\.webp/)
  assert.doesNotMatch(finaleSource, /majorana-chip-final\.png/)
  assert.match(finaleSource, /majorana-finale-chip-overlay/)
  assert.match(finaleSource, /finalePhase = 'chip-swap'/)
  assert.match(finaleSource, /finalePhase = 'registered-still'/)
  assert.match(finaleSource, /sampleNanoscaleCamera/)
  const start = sampleMajoranaFinaleCamera(0)
  assert.ok(Math.abs(start.scale - MAJORANA_FINALE_START_REGISTRATION.scale) < 1e-12)
  assert.ok(
    Math.abs(start.translateX - MAJORANA_FINALE_START_REGISTRATION.translateX) < 1e-12
  )
  assert.ok(
    Math.abs(start.translateY - MAJORANA_FINALE_START_REGISTRATION.translateY) < 1e-12
  )
  const end = sampleMajoranaFinaleCamera(1)
  assert.ok(Math.abs(end.scale - MAJORANA_FINALE_END_REGISTRATION.scale) < 1e-12)
  assert.ok(
    Math.abs(end.translateX - MAJORANA_FINALE_END_REGISTRATION.translateX) < 1e-12
  )
  assert.ok(
    Math.abs(end.translateY - MAJORANA_FINALE_END_REGISTRATION.translateY) < 1e-12
  )
  assert.deepEqual(
    sampleMajoranaFinaleComposition(0).layers.map(layer => layer.sceneId),
    ['cryostat', 'majorana-2']
  )
  assert.deepEqual(
    sampleMajoranaFinaleComposition(1).layers.map(layer => layer.sceneId),
    ['cryostat']
  )
  const retainedChipStart = sampleMajoranaFinaleComposition(0).majoranaCameraTransform
  assert.ok(Math.abs(retainedChipStart.scale - 1) < 1e-12)
  assert.ok(Math.abs(retainedChipStart.translateX) < 1e-12)
  assert.ok(Math.abs(retainedChipStart.translateY) < 1e-12)
  const retainedChipEnd = sampleMajoranaFinaleComposition(1).majoranaCameraTransform
  const module08Registration = NANOSCALE_CAMERA_HANDOFFS[1].registration
  assert.ok(Math.abs(retainedChipEnd.scale - module08Registration.scale) < 1e-12)
  assert.ok(
    Math.abs(retainedChipEnd.translateX - module08Registration.translateX) < 1e-12
  )
  assert.ok(
    Math.abs(retainedChipEnd.translateY - module08Registration.translateY) < 1e-12
  )
  assert.equal(MAJORANA_FINALE_END_FRAME.y, -120)
  assert.equal(MAJORANA_FINALE_END_FRAME.height, 2927.9)
  assert.ok(MAJORANA_FINALE_END_FRAME.x > 230)
  assert.ok(MAJORANA_FINALE_END_FRAME.x < 240)
  assert.doesNotMatch(finaleSource, /majorana-finale-chip-offset-y/)
  assert.doesNotMatch(finaleSource, /majorana-finale__final-chip/)
  assert.doesNotMatch(finaleSource, /module-08-majorana-2-final-crop/)
  assert.match(finaleSource, /majoranaCameraTransform/)
  assert.match(finaleSource, /sampleNanoscalePresentationSegment/)
  assert.match(css, /majorana-finale__pullout[\s\S]*left: 0;[\s\S]*width: 1800px;[\s\S]*height: 3114px/)
  assert.match(css, /majorana-finale__chip[\s\S]*top: 0;[\s\S]*left: 0;[\s\S]*width: 1300px;[\s\S]*height: 2466px/)
  assert.doesNotMatch(css, /majorana-finale__final-chip/)
  assert.match(css, /majorana-module\.is-finale \.majorana-build__tray[\s\S]*backdrop-filter: none/)
  assert.match(css, /transform-origin: -130px -993px/)
  assert.match(css, /transform-origin: -424\.965px -80px/)
  assert.equal(nextPlayableModule('build-majorana-2')?.id, 'nanoscale')
  assert.equal(nextPlayableModule('build-majorana-2')?.number, '08')
  assert.match(source, /upNextBanner\?\.offer\(\)/)
})

test('the shared Up next banner keeps the exact Figma palette inside module 06', () => {
  assert.match(css, /\.majorana-module button:not\(\.kiosk-up-next\)/)
  assert.match(appCss, /155\.022deg,[\s\S]*#2a446f 18\.186%[\s\S]*#0078d4 92\.465%/)
  assert.match(appCss, /\.kiosk-up-next__chip[\s\S]*background: #7aceef;[\s\S]*color: #091f2c;/)
  assert.match(appCss, /\.kiosk-up-next__title[\s\S]*color: #f4f3f5;/)
})

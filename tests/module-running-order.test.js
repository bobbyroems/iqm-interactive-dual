import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getModule,
  isPlayable,
  MODULES,
  nextPlayableModule
} from '../src/js/modules/module-registry.js'

/* The running order IQM set on 25 Aug. Numbers are printed labels rather than
   array indexes because 07 is a slot whose module is still in production. */
test('the floor runs in the 25 Aug order', () => {
  assert.deepEqual(MODULES.map(module => module.number), [
    '01', '02', '03', '04', '05', '06', '07', '08'
  ])
  assert.deepEqual(MODULES.map(module => module.id), [
    'quantum-vs-classical',
    'states-of-matter',
    'qubit-explorer',
    'protecting-information',
    'build-nanowire',
    'build-majorana-2',
    'measurement-based',
    'nanoscale'
  ])
})

test('every number is printed once, and the count reads 08', () => {
  const numbers = MODULES.map(module => module.number)
  assert.equal(new Set(numbers).size, numbers.length)
  assert.equal(String(MODULES.length).padStart(2, '0'), '08')
})

test('only the slot still in production is unplayable', () => {
  const unplayable = MODULES.filter(module => !isPlayable(module))
  assert.deepEqual(unplayable.map(module => module.id), ['measurement-based'])
  assert.equal(getModule('measurement-based').placeholder, true)
})

test("the band on 06 offers 08, because 07 is not built yet", () => {
  /* IQM asked for this hop by name. It is not special-cased anywhere: the
     placeholder is simply skipped, so the hop disappears on its own once 07
     ships and nothing needs changing to retire it. */
  assert.equal(nextPlayableModule('build-majorana-2').id, 'nanoscale')
  assert.equal(nextPlayableModule('build-majorana-2').number, '08')
})

test('each module offers the one after it', () => {
  assert.equal(nextPlayableModule('quantum-vs-classical').id, 'states-of-matter')
  assert.equal(nextPlayableModule('states-of-matter').id, 'qubit-explorer')
  assert.equal(nextPlayableModule('qubit-explorer').id, 'protecting-information')
  assert.equal(nextPlayableModule('protecting-information').id, 'build-nanowire')
  assert.equal(nextPlayableModule('build-nanowire').id, 'build-majorana-2')
})

test('the last module offers nothing, and an unknown id is not a crash', () => {
  assert.equal(nextPlayableModule('nanoscale'), null)
  assert.equal(nextPlayableModule('does-not-exist'), null)
})

test('the placeholder still reports what follows it', () => {
  /* Nothing offers a band from a slot that cannot be entered, but the lookup
     should answer rather than throw if something asks. */
  assert.equal(nextPlayableModule('measurement-based').id, 'nanoscale')
})

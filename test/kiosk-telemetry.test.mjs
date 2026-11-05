import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { KioskTelemetry } from '../src/js/core/kiosk-telemetry.js'
import { validateAnalytics } from '../electron/telemetry-privacy.cjs'

function fixture() {
  const events = [], errors = []
  let time = 0
  const tracker = new KioskTelemetry({
    uuid: randomUUID,
    now: () => time,
    bridge: {
      analyticsEnabled: true,
      diagnosticsEnabled: true,
      track(name, properties) {
        validateAnalytics(name, properties)
        events.push({ name, ...properties })
      },
      reportError(error, kind, moduleId) { errors.push({ error, kind, moduleId }) }
    }
  })
  return { tracker, events, errors, advance(ms) { time += ms } }
}

test('attract playback and startup do not create sessions', () => {
  const { tracker, events } = fixture()
  tracker.activity('attract')
  tracker.activity(null)
  assert.deepEqual(events, [])
})

test('one session spans deliberate menu navigation and module-to-module continuation', () => {
  const { tracker, events, advance } = fixture()
  tracker.menu('start')
  tracker.activity('menu')
  tracker.select('states-of-matter')
  advance(120)
  tracker.loading('states-of-matter')
  advance(180)
  tracker.ready('states-of-matter')
  tracker.select('build-majorana-2', 'module')
  tracker.loading('build-majorana-2')
  tracker.ready('build-majorana-2')
  tracker.menu()
  tracker.end()
  assert.equal(events.filter(event => event.name === 'session_started').length, 1)
  assert.equal(new Set(events.map(event => event.session_id)).size, 1)
  assert.equal(events.find(event => event.name === 'module_ready').load_ms, 300)
  assert.equal(events.findLast(event => event.name === 'module_selected').source, 'module')
  assert.deepEqual(events.map(event => event.sequence), events.map((_event, index) => index + 1))
})

test('the first idle stage ends the session; the second does not duplicate it', () => {
  const { tracker, events } = fixture()
  tracker.menu('start')
  tracker.select('states-of-matter')
  tracker.loading('states-of-matter')
  tracker.menu('idle')
  tracker.end('idle')
  assert.equal(events.filter(event => event.name === 'session_ended').length, 1)
  assert.equal(events.find(event => event.name === 'module_exited').reason, 'idle')
  assert.equal(events.filter(event => event.name === 'idle_return').length, 1)
  const firstSession = events[0].session_id
  tracker.activity('menu')
  assert.notEqual(events.at(-1).session_id, firstSession)
  assert.equal(events.at(-1).source, 'resume')
})

test('retries use distinct attempt IDs without inventing a module selection', () => {
  const { tracker, events } = fixture()
  tracker.select('states-of-matter')
  tracker.loading('states-of-matter')
  tracker.failed('states-of-matter', new Error('not tracked'), 'module_load')
  tracker.loading('states-of-matter')
  tracker.ready('states-of-matter')
  const attempts = events.filter(event => event.name === 'module_loading')
  assert.equal(attempts.length, 2)
  assert.notEqual(attempts[0].attempt_id, attempts[1].attempt_id)
  assert.equal(attempts[1].reason, 'retry')
  assert.equal(events.filter(event => event.name === 'module_selected').length, 1)
})

test('late readiness cannot be attributed to a different module', () => {
  const { tracker, events } = fixture()
  tracker.select('states-of-matter')
  tracker.loading('states-of-matter')
  tracker.select('build-majorana-2', 'module')
  tracker.ready('states-of-matter')
  assert.equal(events.filter(event => event.name === 'module_ready').length, 0)
})

test('disabled or absent bridges are safe and never create identifiers', () => {
  const tracker = new KioskTelemetry({ uuid() { throw new Error('Must not create a visitor identifier') } })
  tracker.menu('start')
  tracker.select('states-of-matter')
  tracker.loading('states-of-matter')
  tracker.ready('states-of-matter')
  tracker.end()
  assert.equal(tracker.session, null)
})

test('diagnostics do not forward raw error messages or arbitrary properties', () => {
  const { tracker, errors } = fixture()
  const error = new Error('private text')
  error.email = 'person@example.com'
  tracker.report(error, 'renderer_error')
  assert.deepEqual(Object.keys(errors[0].error).sort(), ['name', 'stack'])
  assert.equal(errors[0].error.message, undefined)
})

test('a broken bridge is logged without breaking the visitor flow', () => {
  let warnings = 0
  const tracker = new KioskTelemetry({
    bridge: { analyticsEnabled: true, track() { throw new Error('IPC unavailable') } },
    uuid: randomUUID,
    logger: { warn() { warnings++ } }
  })
  tracker.menu('start')
  tracker.end()
  assert.equal(warnings, 3)
  assert.equal(tracker.session, null)
})

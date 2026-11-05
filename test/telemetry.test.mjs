import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { TelemetryStore } from '../electron/telemetry-store.cjs'
import { sanitizeSentryEvent, validateAnalytics } from '../electron/telemetry-privacy.cjs'
import {
  IPC_CHANNEL, KioskTelemetry, isTelemetryRuntimeEnabled,
  loadTelemetryConfig, registerTelemetryIpc, validateConfig
} from '../electron/telemetry.cjs'
import { createRequire } from 'node:module'

const logger = { info() {}, warn() {}, error() {} }
const configInput = {
  enabled: true, kioskId: 'exhibit-01',
  posthog: { projectToken: 'phc_exampletoken123' },
  sentry: { dsn: 'https://abc123@o123.ingest.de.sentry.io/456' }
}
const analytics = () => ({ session_id: randomUUID(), sequence: 1, source: 'start' })

test('only explicitly tagged packaged production kiosks enable collection', () => {
  const require = createRequire(import.meta.url)
  const production = require('../package.json').build.extraMetadata
  const review = require('../scripts/electron-builder-review.cjs').extraMetadata
  const fullscreenReview = require('../scripts/electron-builder-review-fullscreen.cjs').extraMetadata
  const runtime = { isPackaged: true, isKiosk: true, ...production }
  assert.equal(isTelemetryRuntimeEnabled(runtime), true)
  for (const metadata of [review, fullscreenReview, {}]) {
    assert.equal(isTelemetryRuntimeEnabled({ isPackaged: true, isKiosk: true, ...metadata }), false)
  }
  assert.equal(isTelemetryRuntimeEnabled({ ...runtime, isPackaged: false }), false)
  assert.equal(isTelemetryRuntimeEnabled({ ...runtime, isKiosk: false }), false)
})

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'iqm-telemetry-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function fakeSentry() {
  let options, transport
  const pending = []
  return {
    onUncaughtExceptionIntegration: () => ({ name: 'OnUncaughtException' }),
    init(value) { options = value; transport = value.transport() },
    captureException(error, context) {
      const event = options.beforeSend({
        event_id: randomUUID().replaceAll('-', ''),
        timestamp: Date.now() / 1000,
        tags: context.tags,
        exception: { values: [{ type: error.name, value: error.message }] }
      })
      pending.push(transport.send([{}, [[{ type: 'event' }, event]]]))
    },
    async flush() { await Promise.all(pending); return true },
    get options() { return options }
  }
}

async function fixture(t, options = {}) {
  const calls = []
  const sentry = fakeSentry()
  const service = new KioskTelemetry({
    directory: await temporary(t),
    config: validateConfig(configInput),
    appVersion: '2.0.1',
    runtimeEnabled: true,
    logger,
    fetchImpl: async (url, request) => {
      calls.push({ url, request })
      const response = url.includes('posthog')
        ? { status: 1 }
        : { id: JSON.parse(request.body.split('\n')[0]).event_id }
      return { ok: true, json: async () => response }
    },
    ...options
  })
  await service.initialize(() => sentry)
  return { service, calls, sentry }
}

test('configuration accepts only EU ingestion and non-personal aliases', () => {
  const config = validateConfig(configInput)
  assert.match(config.sentryUrl, /^https:\/\/o123\.ingest\.de\.sentry\.io\/api\/456\/envelope\//)
  for (const dsn of [
    'https://abc123@o123.ingest.us.sentry.io/456',
    'http://abc123@o123.ingest.de.sentry.io/456',
    'https://abc123:secret@o123.ingest.de.sentry.io/456',
    'https://abc123@o123.ingest.de.sentry.io/456?secret=x'
  ]) assert.throws(() => validateConfig({ ...configInput, sentry: { dsn } }))
  assert.throws(() => validateConfig({ ...configInput, kioskId: 'person@example.com' }))
  for (const kioskId of [undefined, null, 123, {}]) {
    assert.throws(() => validateConfig({ ...configInput, kioskId }))
  }
  assert.throws(() => validateConfig({ ...configInput, posthog: { projectToken: 123 } }))
  assert.throws(() => validateConfig({ ...configInput, enabled: 'true' }))
})

test('missing and malformed configuration disables collection with an explicit log', async t => {
  const file = path.join(await temporary(t), 'config.json')
  const logs = []
  const capture = { info: message => logs.push(message), error: message => logs.push(message) }
  assert.equal(await loadTelemetryConfig(file, capture), null)
  await writeFile(file, '{invalid')
  assert.equal(await loadTelemetryConfig(file, capture), null)
  assert.equal(logs.length, 2)
  assert.ok(logs.every(message => message.includes('disabled')))
})

test('analytics rejects arbitrary properties, identifiers and free text', () => {
  const properties = analytics()
  assert.deepEqual(validateAnalytics('session_started', properties), properties)
  for (const extra of [{ email: 'person@example.com' }, { reason: 'free text' }, { duration_ms: Infinity }]) {
    assert.throws(() => validateAnalytics('session_started', { ...properties, ...extra }))
  }
  assert.throws(() => validateAnalytics('$identify', properties))
  assert.throws(() => validateAnalytics('module_ready', { ...properties, module_id: 'unknown' }))
  assert.throws(() => validateAnalytics('session_started', { session_id: 'persistent-person' }))
})

test('diagnostic filtering removes messages, identities, paths, requests and breadcrumbs', () => {
  const filtered = sanitizeSentryEvent({
    message: 'person@example.com',
    user: { username: 'PrivateName', ip_address: '192.0.2.1' },
    request: { headers: { authorization: 'secret-token' } },
    extra: { password: 'secret-token' },
    contexts: { device: { name: 'PrivateName' } },
    breadcrumbs: [{ message: 'PrivateName' }],
    tags: { error_kind: 'module_load', module_id: 'states-of-matter', email: 'person@example.com' },
    exception: { values: [{
      type: 'TypeError', value: 'PrivateName secret-token person@example.com',
      stacktrace: { frames: [
        { filename: 'C:\\Users\\PrivateName\\app\\main.cjs', lineno: 42, colno: 2, vars: { token: 'secret-token' } },
        { filename: 'https://private.example.com/person@example.com', lineno: 1 }
      ] }
    }] }
  }, { appVersion: '2.0.1', kioskId: 'exhibit-01' })
  const contents = JSON.stringify(filtered)
  for (const privateValue of ['PrivateName', 'secret-token', 'person@example.com', '192.0.2.1', 'authorization']) {
    assert.equal(contents.includes(privateValue), false, privateValue)
  }
  assert.equal(filtered.exception.values[0].stacktrace.frames[0].filename, 'app:///main.cjs')
  assert.equal(filtered.tags.module_id, 'states-of-matter')
})

test('delayed diagnostics preserve their original release and kiosk alias', () => {
  const event = sanitizeSentryEvent({
    release: 'iqm-kiosk@1.2.3', tags: { kiosk_id: 'previous-site' }
  }, { appVersion: '2.0.1', kioskId: 'new-site' })
  assert.equal(event.release, 'iqm-kiosk@1.2.3')
  assert.equal(event.tags.kiosk_id, 'previous-site')
})

test('queue survives restart, retains IDs, and does not persist ingestion keys', async t => {
  const { service, calls } = await fixture(t)
  service.record('session_started', analytics())
  service.captureError(new Error('sensitive error text'), 'renderer_error')
  await service.flush()
  assert.equal(calls.length, 0)
  const original = await service.store.snapshot()
  assert.equal(original.length, 2)
  const reopened = new TelemetryStore(service.store.directory, { logger })
  await reopened.initialize()
  assert.deepEqual((await reopened.snapshot()).map(record => record.id), original.map(record => record.id))
  for (const file of await readdir(service.store.directory)) {
    const contents = await readFile(path.join(service.store.directory, file), 'utf8')
    assert.equal(contents.includes(configInput.posthog.projectToken), false)
    assert.equal(contents.includes(configInput.sentry.dsn), false)
    assert.equal(contents.includes('sensitive error text'), false)
  }
})

test('queue enforces record, byte and age limits and counts drops', async t => {
  let now = 100000
  const store = new TelemetryStore(await temporary(t), {
    maxRecords: 2, maxBytes: 1000, retentionMs: 100, now: () => now, logger
  })
  await store.initialize()
  for (let index = 0; index < 3; index++) await store.enqueue('posthog', { index })
  assert.equal((await store.snapshot()).length, 2)
  assert.equal(store.dropped, 1)
  assert.ok(store.bytes <= 1000)
  await assert.rejects(store.enqueue('posthog', { text: 'x'.repeat(1001) }), /storage limit/)
  now += 101
  assert.equal((await store.snapshot()).length, 0)
  assert.equal(store.dropped, 3)
})

test('corrupt queue files are removed with a diagnostic and counted', async t => {
  const directory = await temporary(t)
  await writeFile(path.join(directory, `${randomUUID()}.json`), '{partial')
  let logged = false
  const store = new TelemetryStore(directory, { logger: { ...logger, error() { logged = true } } })
  await store.initialize()
  assert.equal(store.dropped, 1)
  assert.equal(logged, true)
  assert.equal((await readdir(directory)).length, 0)
})

test('byte capacity evicts the oldest record independently of the count limit', async t => {
  const store = new TelemetryStore(await temporary(t), { maxBytes: 400, logger })
  await store.initialize()
  await store.enqueue('posthog', { text: 'a'.repeat(120) })
  const latest = await store.enqueue('posthog', { text: 'b'.repeat(120) })
  const records = await store.snapshot()
  assert.equal(records.length, 1)
  assert.equal(records[0].id, latest)
  assert.ok(store.bytes <= 400)
  assert.equal(store.dropped, 1)
})

test('slow storage cannot create an unbounded in-memory write backlog', async t => {
  const store = new TelemetryStore(await temporary(t), { maxPending: 2, logger })
  await store.initialize()
  const first = store.enqueue('posthog', { index: 1 })
  const second = store.enqueue('posthog', { index: 2 })
  await assert.rejects(store.enqueue('posthog', { index: 3 }), /backlog/)
  await Promise.all([first, second])
  assert.equal((await store.snapshot()).length, 2)
  assert.equal(store.dropped, 1)
  assert.equal(store.pending, 0)
})

test('unconfigured, disabled, development and review runtimes collect nothing', async t => {
  for (const options of [
    { runtimeEnabled: false },
    { config: validateConfig({ ...configInput, enabled: false }) },
    { config: validateConfig({ ...configInput, posthog: {}, sentry: {} }) }
  ]) {
    const { service, calls, sentry } = await fixture(t, options)
    service.record('session_started', analytics())
    service.captureError(new Error('not collected'), 'renderer_error')
    assert.equal((await service.status()).posthog, 0)
    assert.equal((await service.status()).sentry, 0)
    assert.equal(calls.length, 0)
    assert.equal(sentry.options, undefined)
  }
})

test('Sentry enables only explicit diagnostics and a disk-only transport', async t => {
  const { sentry } = await fixture(t)
  assert.equal(sentry.options.defaultIntegrations, false)
  assert.deepEqual(sentry.options.integrations.map(item => item.name), ['OnUncaughtException'])
  assert.equal(sentry.options.ipcMode, 0)
  assert.equal(sentry.options.autoSessionTracking, false)
  assert.equal(sentry.options.dataCollection.userInfo, false)
  assert.equal(sentry.options.tracesSampleRate, 0)
})

test('only an explicit upload sends EU batches and envelopes, then acknowledges records', async t => {
  const { service, calls } = await fixture(t)
  service.record('session_started', analytics())
  service.captureError(new Error('not transmitted'), 'module_load', 'states-of-matter')
  assert.equal(calls.length, 0)
  assert.deepEqual(await service.upload(), { posthog: 1, sentry: 1, errors: [] })
  assert.equal((await service.store.snapshot()).length, 0)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://eu.i.posthog.com/batch/')
  const event = JSON.parse(calls[0].request.body).batch[0]
  assert.equal(event.properties.$process_person_profile, false)
  assert.equal(event.properties.$geoip_disable, true)
  assert.equal(event.distinct_id, event.properties.session_id)
  assert.equal(calls[0].request.redirect, 'error')
  assert.match(calls[1].url, /^https:\/\/o123\.ingest\.de\.sentry\.io\//)
  assert.equal(calls[1].request.body.includes('not transmitted'), false)
})

test('failed uploads retain stable event IDs and never retry in the background', async t => {
  let requests = 0
  const { service } = await fixture(t, {
    fetchImpl: async () => { requests++; return { ok: false, status: 429 } }
  })
  service.record('session_started', analytics())
  const before = await service.store.snapshot()
  const result = await service.upload()
  assert.equal(result.posthog, 0)
  assert.match(result.errors[0], /429/)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(requests, 1)
  assert.equal((await service.store.snapshot())[0].payload.uuid, before[0].payload.uuid)
})

test('unexpected success bodies are not treated as ingestion acknowledgement', async t => {
  const { service } = await fixture(t, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: 0 }) })
  })
  service.record('session_started', analytics())
  assert.equal((await service.upload()).errors.length, 1)
  assert.equal((await service.store.snapshot()).length, 1)
})

test('partial uploads acknowledge only the accepted batch', async t => {
  let requests = 0
  const { service } = await fixture(t, {
    fetchImpl: async () => ++requests === 1
      ? { ok: true, json: async () => ({ status: 1 }) }
      : { ok: false, status: 503 }
  })
  const session = analytics()
  for (let index = 0; index < 51; index++) service.record('session_started', session)
  const result = await service.upload()
  assert.equal(result.posthog, 50)
  assert.equal(result.errors.length, 1)
  assert.equal((await service.store.snapshot()).length, 1)
})

test('renderer interruption closes the current attempt and session', async t => {
  const { service } = await fixture(t)
  const session_id = randomUUID()
  service.record('session_started', { session_id, sequence: 1, source: 'start' })
  service.record('module_loading', {
    session_id, sequence: 2, attempt_id: randomUUID(), module_id: 'states-of-matter'
  })
  service.interrupt('renderer_crash')
  const records = (await service.store.snapshot()).map(record => record.payload)
  assert.deepEqual(records.map(record => record.event), [
    'session_started', 'module_loading', 'module_exited', 'session_ended'
  ])
  assert.equal(records[3].properties.sequence, 4)
  assert.equal(records[3].properties.reason, 'renderer_crash')
})

test('IPC accepts only the kiosk main frame and rate-limits invalid traffic', () => {
  let handler, recorded = 0, rejected = 0
  const webContents = { mainFrame: {} }
  registerTelemetryIpc({
    ipcMain: { on(channel, callback) { assert.equal(channel, IPC_CHANNEL); handler = callback } },
    getWebContents: () => webContents,
    telemetry: { record() { recorded++ } },
    logger: { warn() { rejected++ } }
  })
  const message = { type: 'analytics', name: 'session_started', properties: analytics() }
  handler({ sender: {}, senderFrame: webContents.mainFrame }, message)
  handler({ sender: webContents, senderFrame: {} }, message)
  for (let index = 0; index < 31; index++) {
    handler({ sender: webContents, senderFrame: webContents.mainFrame }, message)
  }
  assert.equal(recorded, 30)
  assert.equal(rejected, 3)
})

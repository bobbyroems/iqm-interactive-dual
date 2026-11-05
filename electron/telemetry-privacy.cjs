const { randomUUID } = require('node:crypto')

const MODULE_IDS = new Set([
  'quantum-vs-classical', 'states-of-matter', 'qubit-explorer',
  'protecting-information', 'build-nanowire', 'build-majorana-2',
  'measurement-based', 'nanoscale', 'quantum-platform'
])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const EVENT_NAMES = new Set([
  'session_started', 'session_ended', 'screen_viewed', 'module_selected',
  'module_loading', 'module_ready', 'module_failed', 'module_exited', 'idle_return'
])
const REASONS = new Set([
  'start', 'resume', 'navigation', 'menu', 'home', 'idle', 'module',
  'retry', 'renderer_crash', 'renderer_reload', 'shutdown'
])
const ERROR_KINDS = new Set([
  'renderer_error', 'unhandled_rejection', 'module_load', 'module_interaction',
  'module_warmup', 'renderer_unresponsive', 'renderer_recovered',
  'renderer_reload', 'renderer_crash', 'main_error'
])
const ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'TimeoutError', 'AbortError', 'DOMException'
])

function validateAnalytics(name, input) {
  if (!EVENT_NAMES.has(name) || !input || typeof input !== 'object' ||
      !UUID.test(input.session_id)) throw new Error('Invalid analytics event.')
  const properties = { session_id: input.session_id }
  for (const key of Object.keys(input)) {
    const value = input[key]
    if (key === 'session_id') continue
    if (key === 'attempt_id' && UUID.test(value)) properties[key] = value
    else if (['module_id', 'previous_module_id'].includes(key) && MODULE_IDS.has(value)) properties[key] = value
    else if (['reason', 'source'].includes(key) && REASONS.has(value)) properties[key] = value
    else if (key === 'screen' && ['menu', 'module'].includes(value)) properties[key] = value
    else if (['duration_ms', 'load_ms'].includes(key) &&
             Number.isSafeInteger(value) && value >= 0 && value <= 86400000) properties[key] = value
    else if (key === 'sequence' && Number.isSafeInteger(value) && value > 0 && value <= 10000000) properties[key] = value
    else throw new Error(`Unsupported analytics property: ${key}`)
  }
  if (name.startsWith('module_') && !properties.module_id) throw new Error('Module ID is required.')
  return properties
}

function safeFrames(frames = []) {
  return frames.slice(-30).flatMap(frame => {
    const basename = String(frame.filename || '').split(/[\\/]/).pop().split(/[?#]/)[0]
    if (!/^[a-zA-Z0-9_.-]+\.(?:[cm]?js|html)$/.test(basename)) return []
    const result = { filename: `app:///${basename}` }
    if (Number.isSafeInteger(frame.lineno) && frame.lineno > 0) result.lineno = frame.lineno
    if (Number.isSafeInteger(frame.colno) && frame.colno > 0) result.colno = frame.colno
    return [result]
  })
}

function sanitizeSentryEvent(event, { appVersion, kioskId }) {
  const tags = {
    kiosk_id: typeof event.tags?.kiosk_id === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(event.tags.kiosk_id)
      ? event.tags.kiosk_id : kioskId
  }
  if (ERROR_KINDS.has(event.tags?.error_kind)) tags.error_kind = event.tags.error_kind
  if (MODULE_IDS.has(event.tags?.module_id)) tags.module_id = event.tags.module_id
  const values = (event.exception?.values || []).slice(-3).map(exception => ({
    type: ERROR_TYPES.has(exception.type) ? exception.type : 'Error',
    value: 'Kiosk error; original message omitted for privacy.',
    stacktrace: { frames: safeFrames(exception.stacktrace?.frames) }
  }))
  return {
    event_id: /^[a-f0-9]{32}$/i.test(event.event_id) ? event.event_id : randomUUID().replaceAll('-', ''),
    timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Date.now() / 1000,
    platform: 'javascript',
    level: event.level === 'fatal' ? 'fatal' : 'error',
    release: /^iqm-kiosk@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(event.release)
      ? event.release : `iqm-kiosk@${appVersion}`,
    environment: 'production',
    tags,
    exception: { values: values.length ? values : [{ type: 'Error', value: 'Kiosk runtime failure.' }] }
  }
}

module.exports = { ERROR_KINDS, MODULE_IDS, sanitizeSentryEvent, validateAnalytics }

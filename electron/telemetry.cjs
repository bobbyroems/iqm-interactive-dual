const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { TelemetryStore } = require('./telemetry-store.cjs')
const { ERROR_KINDS, MODULE_IDS, sanitizeSentryEvent, validateAnalytics } = require('./telemetry-privacy.cjs')

const POSTHOG_HOST = 'https://eu.i.posthog.com'
const IPC_CHANNEL = 'kiosk:telemetry'

function isTelemetryRuntimeEnabled({ isPackaged, isKiosk, telemetryRuntime }) {
  return isPackaged === true && isKiosk === true && telemetryRuntime === 'production'
}

function validateConfig(input) {
  if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean') {
    throw new Error('Telemetry configuration requires an enabled boolean.')
  }
  if (typeof input.kioskId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(input.kioskId)) {
    throw new Error('Configure a non-personal kioskId alias (1-48 letters, digits, hyphens or underscores).')
  }
  const projectToken = input.posthog?.projectToken ?? ''
  if (typeof projectToken !== 'string' || (projectToken && !/^phc_[a-zA-Z0-9_-]{8,200}$/.test(projectToken))) {
    throw new Error('Invalid PostHog public project token.')
  }
  const dsn = input.sentry?.dsn ?? ''
  if (typeof dsn !== 'string') throw new Error('Sentry DSN must be a string.')
  let sentryUrl = null
  if (dsn) {
    const url = new URL(dsn)
    if (url.protocol !== 'https:' || !/^o\d+\.ingest\.de\.sentry\.io$/.test(url.hostname) ||
        !/^[a-zA-Z0-9]+$/.test(url.username) || url.password || url.port ||
        !/^\/\d+$/.test(url.pathname) || url.search || url.hash) {
      throw new Error('Sentry requires an EU HTTPS DSN copied from the project client keys.')
    }
    sentryUrl = `${url.origin}/api${url.pathname}/envelope/?sentry_version=7&sentry_key=${url.username}`
  }
  return { enabled: input.enabled, kioskId: input.kioskId, projectToken, dsn, sentryUrl }
}

async function loadTelemetryConfig(file, logger = console) {
  try {
    return validateConfig(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('[telemetry] No local configuration; collection is disabled.')
    } else {
      logger.error('[telemetry] Invalid configuration; collection is disabled.', error)
    }
    return null
  }
}

class KioskTelemetry {
  constructor({ directory, config, appVersion, runtimeEnabled, logger = console, fetchImpl = fetch, storeOptions }) {
    this.config = config
    this.appVersion = appVersion
    this.logger = logger
    this.fetch = fetchImpl
    this.enabled = runtimeEnabled && config?.enabled === true
    this.analyticsEnabled = this.enabled && Boolean(config.projectToken)
    this.diagnosticsEnabled = this.enabled && Boolean(config.dsn)
    this.store = new TelemetryStore(directory, { ...storeOptions, logger })
    this.sentry = null
    this.uploading = false
    this.lastError = null
    this.activeSession = null
    this.currentModule = null
  }

  async initialize(createSentry = () => require('@sentry/electron/main')) {
    await this.store.initialize()
    if (this.diagnosticsEnabled) {
      this.sentry = createSentry()
      this.sentry.init({
        dsn: this.config.dsn,
        release: `iqm-kiosk@${this.appVersion}`,
        environment: 'production',
        defaultIntegrations: false,
        integrations: [this.sentry.onUncaughtExceptionIntegration()],
        // Renderer diagnostics use the kiosk's own restricted bridge.
        ipcMode: 0,
        enableOpenTelemetrySetup: false,
        autoSessionTracking: false,
        sendClientReports: false,
        enableLogs: false,
        tracesSampleRate: 0,
        maxBreadcrumbs: 0,
        dataCollection: { userInfo: false, httpHeaders: false, cookies: false },
        beforeSend: event => sanitizeSentryEvent(event, this.metadata()),
        transport: () => ({
          send: async envelope => {
            for (const [header, payload] of envelope[1]) {
              if (header.type !== 'event') throw new Error('Unexpected Sentry envelope type.')
              await this.store.enqueue('sentry', sanitizeSentryEvent(payload, this.metadata()))
            }
            return { statusCode: 200 }
          },
          flush: async () => { await this.store.flush(); return true }
        })
      })
    }
    this.logger.info(`[telemetry] Local collection: analytics=${this.analyticsEnabled}, diagnostics=${this.diagnosticsEnabled}; uploads require operator confirmation.`)
  }

  metadata() {
    return { appVersion: this.appVersion, kioskId: this.config?.kioskId }
  }

  record(name, input) {
    if (!this.analyticsEnabled) return
    const properties = validateAnalytics(name, input)
    if (name === 'session_started') this.activeSession = { id: properties.session_id, startedAt: Date.now() }
    if (this.activeSession) this.activeSession.sequence = properties.sequence || 0
    if (name === 'module_loading') this.currentModule = { ...properties, startedAt: Date.now() }
    if (name === 'module_exited') this.currentModule = null
    if (name === 'session_ended') this.activeSession = null
    const event = {
      uuid: randomUUID(),
      event: name,
      distinct_id: properties.session_id,
      timestamp: new Date().toISOString(),
      properties: {
        ...properties,
        schema_version: 1,
        app_version: this.appVersion,
        kiosk_id: this.config.kioskId,
        $process_person_profile: false,
        $geoip_disable: true
      }
    }
    void this.store.enqueue('posthog', event).catch(error => this.storageError(error))
  }

  storageError(error) {
    this.lastError = 'Local telemetry storage failed. Check disk space and permissions.'
    this.logger.error('[telemetry] Could not persist an event.', error)
  }

  captureError(error, kind = 'main_error', moduleId) {
    if (!this.diagnosticsEnabled) return
    if (!ERROR_KINDS.has(kind) || (moduleId && !MODULE_IDS.has(moduleId))) {
      throw new Error('Invalid diagnostic context.')
    }
    const exception = new Error('Kiosk error; original message omitted for privacy.')
    exception.name = typeof error?.name === 'string' ? error.name.slice(0, 40) : 'Error'
    if (typeof error?.stack === 'string') exception.stack = error.stack.slice(0, 12000)
    this.sentry.captureException(exception, { tags: { error_kind: kind, ...(moduleId ? { module_id: moduleId } : {}) } })
  }

  interrupt(reason) {
    const session = this.activeSession
    if (!session) return
    if (this.currentModule) {
      const { module_id, attempt_id, startedAt } = this.currentModule
      this.record('module_exited', {
        session_id: session.id, module_id, attempt_id, reason,
        sequence: (session.sequence || 0) + 1,
        duration_ms: Math.min(86400000, Math.max(0, Date.now() - startedAt))
      })
    }
    this.record('session_ended', {
      session_id: session.id, reason,
      sequence: (session.sequence || 0) + 1,
      duration_ms: Math.min(86400000, Math.max(0, Date.now() - session.startedAt))
    })
  }

  async flush() {
    if (this.sentry && !await this.sentry.flush(2000)) {
      this.lastError = 'Some diagnostics could not be written before the flush deadline.'
      this.logger.error(`[telemetry] ${this.lastError}`)
    }
    await this.store.flush()
  }

  async status() {
    await this.flush()
    const records = await this.store.snapshot()
    return {
      analyticsEnabled: this.analyticsEnabled,
      diagnosticsEnabled: this.diagnosticsEnabled,
      posthog: records.filter(record => record.destination === 'posthog').length,
      sentry: records.filter(record => record.destination === 'sentry').length,
      bytes: this.store.bytes,
      droppedThisRun: this.store.dropped,
      oldestAt: records[0]?.createdAt || null,
      lastError: this.lastError || this.store.lastError
    }
  }

  async upload() {
    if (this.uploading) throw new Error('An operator upload is already running.')
    if (!this.enabled) throw new Error('Telemetry is disabled for this runtime/configuration.')
    this.uploading = true
    const result = { posthog: 0, sentry: 0, errors: [] }
    try {
      await this.flush()
      const snapshot = await this.store.snapshot()
      for (const destination of ['posthog', 'sentry']) {
        const records = snapshot.filter(record => record.destination === destination)
        if (!records.length) continue
        try {
          if (destination === 'posthog' && !this.config.projectToken) throw new Error('PostHog is not configured.')
          if (destination === 'sentry' && !this.config.dsn) throw new Error('Sentry is not configured.')
          const batchSize = destination === 'posthog' ? 50 : 1
          for (let index = 0; index < records.length; index += batchSize) {
            const batch = records.slice(index, index + batchSize)
            await this.send(destination, batch)
            await this.store.acknowledge(batch.map(record => record.id))
            result[destination] += batch.length
          }
        } catch (error) {
          result.errors.push(`${destination}: ${error.message}`)
          this.logger.error(`[telemetry] Operator upload failed for ${destination}.`, error)
        }
      }
      return result
    } finally {
      this.uploading = false
    }
  }

  async send(destination, records) {
    let url, body, contentType
    if (destination === 'posthog') {
      const batch = records.map(({ payload }) => {
        const properties = validateAnalytics(payload.event, Object.fromEntries(
          Object.entries(payload.properties).filter(([key]) => ![
            'schema_version', 'app_version', 'kiosk_id', '$process_person_profile', '$geoip_disable'
          ].includes(key))
        ))
        if (!/^[a-f0-9-]{36}$/i.test(payload.uuid) || !Number.isFinite(Date.parse(payload.timestamp)) ||
            !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(payload.properties.app_version) ||
            typeof payload.properties.kiosk_id !== 'string' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(payload.properties.kiosk_id)) {
          throw new Error('Invalid queued analytics metadata.')
        }
        return {
          uuid: payload.uuid, event: payload.event, timestamp: payload.timestamp,
          distinct_id: properties.session_id,
          properties: {
            ...properties, schema_version: 1,
            app_version: payload.properties.app_version,
            kiosk_id: payload.properties.kiosk_id,
            $process_person_profile: false, $geoip_disable: true
          }
        }
      })
      url = `${POSTHOG_HOST}/batch/`
      body = JSON.stringify({ api_key: this.config.projectToken, batch })
      contentType = 'application/json'
    } else {
      const event = sanitizeSentryEvent(records[0].payload, this.metadata())
      url = this.config.sentryUrl
      body = [
        JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: this.config.dsn }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify(event)
      ].join('\n')
      contentType = 'application/x-sentry-envelope'
    }
    const response = await this.fetch(url, {
      method: 'POST', headers: { 'Content-Type': contentType }, body,
      redirect: 'error', signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}; queued events retained. Retry manually later.`)
    const acknowledgement = await response.json()
    if (destination === 'posthog' ? acknowledgement.status !== 1 : acknowledgement.id !== records[0].payload.event_id) {
      throw new Error('Unexpected ingestion acknowledgement; queued events retained.')
    }
  }
}

function registerTelemetryIpc({ ipcMain, getWebContents, telemetry, logger = console }) {
  let windowStart = 0, count = 0
  ipcMain.on(IPC_CHANNEL, (event, message) => {
    const webContents = getWebContents()
    if (!webContents || event.sender !== webContents || event.senderFrame !== webContents.mainFrame) {
      logger.warn('[telemetry] Rejected an event from an unexpected frame.')
      return
    }
    if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0 }
    if (++count > 30) {
      if (count === 31) logger.warn('[telemetry] Renderer telemetry rate limit exceeded.')
      return
    }
    try {
      if (message?.type === 'analytics') telemetry.record(message.name, message.properties)
      else if (message?.type === 'error') telemetry.captureError(message.error, message.kind, message.moduleId)
      else throw new Error('Unsupported telemetry message.')
    } catch (error) {
      logger.warn('[telemetry] Rejected an invalid renderer event.', error)
    }
  })
}

module.exports = {
  IPC_CHANNEL, KioskTelemetry, isTelemetryRuntimeEnabled,
  loadTelemetryConfig, registerTelemetryIpc, validateConfig
}

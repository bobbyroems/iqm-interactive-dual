export class KioskTelemetry {
  constructor({
    bridge,
    now = () => performance.now(),
    uuid = () => crypto.randomUUID(),
    logger = console
  } = {}) {
    this.bridge = bridge
    this.now = now
    this.uuid = uuid
    this.logger = logger
    this.session = null
    this.attempt = null
  }

  emit(name, properties) {
    if (!this.bridge?.analyticsEnabled) return
    try {
      this.bridge.track(name, { session_id: this.session.id, sequence: ++this.session.sequence, ...properties })
    } catch (error) {
      this.logger.warn('[telemetry] Could not forward an analytics event.', error)
    }
  }

  begin(source) {
    if (!this.bridge?.analyticsEnabled || this.session) return
    this.session = { id: this.uuid(), startedAt: this.now(), sequence: 0 }
    this.emit('session_started', { source })
  }

  activity(screen) {
    if (screen === 'menu' || screen === 'module') this.begin('resume')
  }

  menu(reason = 'menu') {
    this.exit(reason)
    if (reason === 'idle') {
      this.end('idle')
      return
    }
    this.begin(reason === 'start' ? 'start' : 'resume')
    this.emit('screen_viewed', { screen: 'menu', reason })
  }

  select(moduleId, source = 'menu') {
    if (!this.bridge?.analyticsEnabled) return
    this.exit('module')
    this.begin(source === 'module' ? 'navigation' : 'resume')
    this.attempt = { moduleId, id: this.uuid(), startedAt: this.now(), loading: false }
    this.emit('module_selected', { ...this.moduleProperties(), source })
    this.emit('screen_viewed', { screen: 'module', module_id: moduleId, source })
  }

  moduleProperties() {
    return { module_id: this.attempt.moduleId, attempt_id: this.attempt.id }
  }

  loading(moduleId) {
    if (!this.bridge?.analyticsEnabled) return
    const retry = this.attempt?.moduleId === moduleId && this.attempt.loading
    if (!this.attempt || retry || this.attempt.moduleId !== moduleId) {
      this.exit(retry ? 'retry' : 'module')
      this.begin('resume')
      this.attempt = { moduleId, id: this.uuid(), startedAt: this.now() }
    }
    this.attempt.loading = true
    this.emit('module_loading', { ...this.moduleProperties(), reason: retry ? 'retry' : 'navigation' })
  }

  ready(moduleId) {
    if (this.attempt?.moduleId !== moduleId) return
    this.emit('module_ready', { ...this.moduleProperties(), load_ms: this.elapsed(this.attempt.startedAt) })
  }

  failed(moduleId, error, kind) {
    if (this.attempt?.moduleId === moduleId) {
      this.emit('module_failed', { ...this.moduleProperties() })
    }
    this.report(error, kind, moduleId)
  }

  report(error, kind, moduleId) {
    if (!this.bridge?.diagnosticsEnabled) return
    try {
      this.bridge.reportError({
        name: typeof error?.name === 'string' ? error.name.slice(0, 40) : 'Error',
        stack: typeof error?.stack === 'string' ? error.stack.slice(0, 12000) : ''
      }, kind, moduleId)
    } catch (failure) {
      this.logger.warn('[telemetry] Could not forward a diagnostic event.', failure)
    }
  }

  exit(reason) {
    if (!this.attempt) return
    this.emit('module_exited', {
      ...this.moduleProperties(), reason, duration_ms: this.elapsed(this.attempt.startedAt)
    })
    this.attempt = null
  }

  end(reason = 'home') {
    this.exit(reason)
    if (!this.session) return
    if (reason === 'idle') this.emit('idle_return', { reason })
    this.emit('session_ended', { reason, duration_ms: this.elapsed(this.session.startedAt) })
    this.session = null
  }

  elapsed(start) {
    return Math.min(86400000, Math.max(0, Math.round(this.now() - start)))
  }
}

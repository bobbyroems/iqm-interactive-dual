const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const DAY_MS = 86400000
const RECORD_LIMIT_BYTES = 32768
const RECORD_NAME = /^[a-f0-9-]{36}\.json$/

class TelemetryStore {
  constructor(directory, {
    maxBytes = 25 * 1024 * 1024,
    maxRecords = 10000,
    maxPending = 256,
    retentionMs = 7 * DAY_MS,
    now = Date.now,
    logger = console
  } = {}) {
    this.directory = directory
    this.maxBytes = maxBytes
    this.maxRecords = maxRecords
    this.maxPending = maxPending
    this.pending = 0
    this.retentionMs = retentionMs
    this.now = now
    this.logger = logger
    this.records = new Map()
    this.bytes = 0
    this.dropped = 0
    this.lastError = null
    this.tail = Promise.resolve()
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    for (const name of await fs.readdir(this.directory)) {
      if (!RECORD_NAME.test(name)) continue
      const file = path.join(this.directory, name)
      try {
        const stat = await fs.stat(file)
        if (stat.size > RECORD_LIMIT_BYTES) throw new Error('Record exceeds the size limit.')
        const record = JSON.parse(await fs.readFile(file, 'utf8'))
        if (record.id + '.json' !== name ||
            !['posthog', 'sentry'].includes(record.destination) ||
            !Number.isFinite(record.createdAt) || record.createdAt > this.now() ||
            !record.payload || typeof record.payload !== 'object') {
          throw new Error('Invalid stored record.')
        }
        this.records.set(record.id, { ...record, bytes: stat.size })
        this.bytes += stat.size
      } catch (error) {
        this.logger.error('[telemetry] Removing an unreadable queue record.', error)
        await fs.unlink(file)
        this.dropped += 1
      }
    }
    await this.prune()
  }

  run(operation) {
    const result = this.tail.then(operation)
    this.tail = result.catch(error => {
      this.lastError = 'A local queue operation failed. Check disk space and permissions.'
      this.logger.error('[telemetry] Local queue operation failed.', error)
    })
    return result
  }

  async prune() {
    const oldestFirst = [...this.records.values()].sort((a, b) => a.createdAt - b.createdAt)
    for (const record of oldestFirst) {
      if (record.createdAt > this.now() - this.retentionMs &&
          this.bytes <= this.maxBytes && this.records.size <= this.maxRecords) break
      await this.remove(record.id)
      this.dropped += 1
      this.logger.warn('[telemetry] Dropped a queued event at the retention/storage limit.')
    }
  }

  async remove(id) {
    const record = this.records.get(id)
    if (!record) return
    await fs.unlink(path.join(this.directory, `${id}.json`))
    this.records.delete(id)
    this.bytes -= record.bytes
  }

  enqueue(destination, payload) {
    if (this.pending >= this.maxPending) {
      this.dropped += 1
      this.lastError = 'Telemetry write backlog exceeded its limit; an event was dropped.'
      this.logger.error(`[telemetry] ${this.lastError}`)
      return Promise.reject(new Error(this.lastError))
    }
    this.pending += 1
    return this.run(async () => {
      const record = { id: randomUUID(), destination, createdAt: this.now(), payload }
      const contents = JSON.stringify(record)
      const bytes = Buffer.byteLength(contents)
      if (bytes > RECORD_LIMIT_BYTES || bytes > this.maxBytes) {
        throw new Error('Telemetry record exceeds the storage limit.')
      }
      const file = path.join(this.directory, `${record.id}.json`)
      const handle = await fs.open(file, 'wx', 0o600)
      let written = false
      try {
        await handle.writeFile(contents, 'utf8')
        await handle.sync()
        written = true
      } finally {
        await handle.close()
        if (!written) await fs.unlink(file)
      }
      this.records.set(record.id, { ...record, bytes })
      this.bytes += bytes
      await this.prune()
      return record.id
    }).finally(() => { this.pending -= 1 })
  }

  snapshot() {
    return this.run(async () => {
      await this.prune()
      return [...this.records.values()].sort((a, b) =>
        a.createdAt - b.createdAt ||
        (a.payload.properties?.sequence || 0) - (b.payload.properties?.sequence || 0))
    })
  }

  acknowledge(ids) {
    return this.run(async () => {
      for (const id of ids) await this.remove(id)
    })
  }

  async flush() {
    await this.tail
  }
}

module.exports = { TelemetryStore }

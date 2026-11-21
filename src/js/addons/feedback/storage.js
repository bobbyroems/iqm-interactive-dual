const DEFAULT_PREFERENCES = { enabled: true, delaySeconds: 60 }
const REASONS = ['clear', 'fun', 'confusing']

function validatePreferences(value) {
  if (!value || typeof value.enabled !== 'boolean' ||
      !Number.isInteger(value.delaySeconds) || value.delaySeconds < 0 ||
      value.delaySeconds > 600) {
    throw new Error('Feedback timing must be between 0 and 600 seconds.')
  }
  return { enabled: value.enabled, delaySeconds: value.delaySeconds }
}

function validateResponse(value) {
  if (!value || !Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5) {
    throw new Error('Choose a rating between 1 and 5 stars.')
  }
  if (!Array.isArray(value.reasons) || value.reasons.length > REASONS.length ||
      value.reasons.some(reason => !REASONS.includes(reason)) ||
      new Set(value.reasons).size !== value.reasons.length) {
    throw new Error('Choose only the available feedback reasons.')
  }
  if (value.moduleId !== null &&
      (typeof value.moduleId !== 'string' || !/^[a-z0-9-]{1,100}$/.test(value.moduleId))) {
    throw new Error('Invalid feedback module.')
  }
  return { rating: value.rating, reasons: [...value.reasons], moduleId: value.moduleId }
}

function readData(value) {
  if (value === undefined) {
    return { schemaVersion: 1, preferences: { ...DEFAULT_PREFERENCES }, responses: [] }
  }
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.responses)) {
    throw new Error('Feedback data has an unsupported format. Export or back up site data before repairing it.')
  }
  value.preferences = validatePreferences(value.preferences)
  for (const response of value.responses) {
    validateResponse(response)
    if (typeof response.id !== 'string' || typeof response.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(response.timestamp)) || typeof response.appVersion !== 'string') {
      throw new Error('Feedback data is damaged. Back up site data before repairing it.')
    }
  }
  return value
}

function summarize(data) {
  const count = data.responses.length
  const total = data.responses.reduce((sum, response) => sum + response.rating, 0)
  return {
    preferences: data.preferences,
    stats: { count, average: count ? total / count : null }
  }
}

function toCsv(responses) {
  const cell = value => {
    let text = String(value ?? '')
    if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  const rows = [
    ['id', 'timestamp', 'rating', 'reasons', 'moduleId', 'appVersion'],
    ...responses.map(row => [
      row.id, row.timestamp, row.rating, row.reasons.join(';'), row.moduleId, row.appVersion
    ])
  ]
  return `\uFEFF${rows.map(row => row.map(cell).join(',')).join('\r\n')}\r\n`
}

export function createFeedbackStore({
  appVersion,
  name = 'iqm-feedback',
  getIndexedDB = () => globalThis.indexedDB
}) {
  const open = () => new Promise((resolve, reject) => {
    const indexedDB = getIndexedDB()
    if (!indexedDB) {
      throw new Error('Local feedback storage is unavailable. Enable browser site storage and retry.')
    }
    let blocked = false
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('feedback')
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Feedback storage is blocked. Close other tabs using this site and retry.'))
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (blocked) database.close()
      else resolve(database)
    }
  })

  const transact = async (mode, action) => {
    const database = await open()
    return new Promise((resolve, reject) => {
      let transaction
      try {
        transaction = database.transaction('feedback', mode, { durability: 'strict' })
      } catch (error) {
        database.close()
        reject(error)
        return
      }
      let result
      let failure
      transaction.oncomplete = () => {
        database.close()
        resolve(result)
      }
      transaction.onabort = () => {
        database.close()
        reject(failure || transaction.error || new Error('Feedback storage transaction was aborted. Please retry.'))
      }
      const store = transaction.objectStore('feedback')
      const request = store.get('state')
      request.onsuccess = () => {
        try {
          const data = readData(request.result)
          result = action(data)
          if (mode === 'readwrite') store.put(data, 'state')
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
    })
  }

  return {
    getState: () => transact('readonly', summarize),
    submit: async value => {
      const response = validateResponse(value)
      return transact('readwrite', data => {
        if (!data.preferences.enabled) throw new Error('Feedback is currently turned off.')
        data.responses.push({
          ...response,
          id: Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
            byte => byte.toString(16).padStart(2, '0')).join(''),
          timestamp: new Date().toISOString(),
          appVersion
        })
        return summarize(data)
      })
    },
    setPreferences: async value => {
      const preferences = validatePreferences(value)
      return transact('readwrite', data => {
        data.preferences = preferences
        return summarize(data)
      })
    },
    exportCsv: () => transact('readonly', data => toCsv(data.responses)),
    clear: () => transact('readwrite', data => {
      data.responses = []
      return summarize(data)
    })
  }
}

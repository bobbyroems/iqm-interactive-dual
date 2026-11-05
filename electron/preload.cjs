const { contextBridge, ipcRenderer } = require('electron')

function readRuntimePayload() {
  const prefix = '--kiosk-runtime='
  const argument = process.argv.find(value => value.startsWith(prefix))

  if (!argument) return {}

  try {
    return JSON.parse(decodeURIComponent(argument.slice(prefix.length)))
  } catch (error) {
    console.warn('[preload] Could not parse kiosk runtime configuration.', error)
    return {}
  }
}

const runtime = readRuntimePayload()

contextBridge.exposeInMainWorld('kiosk', Object.freeze({
  platform: process.platform,
  appVersion: runtime.appVersion || '0.0.0',
  isDevelopment: Boolean(runtime.isDevelopment),
  isKiosk: Boolean(runtime.isKiosk),
  config: Object.freeze(runtime.config || {}),
  telemetry: Object.freeze({
    analyticsEnabled: Boolean(runtime.telemetry?.analyticsEnabled),
    diagnosticsEnabled: Boolean(runtime.telemetry?.diagnosticsEnabled),
    track(name, properties) {
      if (!runtime.telemetry?.analyticsEnabled) return
      ipcRenderer.send('kiosk:telemetry', { type: 'analytics', name, properties })
    },
    reportError(error, kind, moduleId) {
      if (!runtime.telemetry?.diagnosticsEnabled) return
      ipcRenderer.send('kiosk:telemetry', {
        type: 'error',
        error: {
          name: typeof error?.name === 'string' ? error.name.slice(0, 40) : 'Error',
          stack: typeof error?.stack === 'string' ? error.stack.slice(0, 12000) : ''
        },
        kind,
        moduleId
      })
    }
  })
}))

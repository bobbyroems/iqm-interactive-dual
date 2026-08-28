const { contextBridge } = require('electron')

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
  config: Object.freeze(runtime.config || {})
}))

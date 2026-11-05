const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron')
const {
  APP_PROTOCOL_PRIVILEGES, APP_PROTOCOL_SCHEME, createAppProtocolHandler, createAppUrl
} = require('../electron/app-protocol.cjs')
const { KioskTelemetry, registerTelemetryIpc, validateConfig } = require('../electron/telemetry.cjs')

protocol.registerSchemesAsPrivileged([
  { scheme: APP_PROTOCOL_SCHEME, privileges: APP_PROTOCOL_PRIVILEGES }
])
// The harness owns shutdown so destroying its window cannot skip async cleanup.
app.on('window-all-closed', () => {})

let directory, window, telemetry
let vendorRequests = 0
const deadline = setTimeout(() => {
  console.error('Telemetry Electron smoke test timed out.')
  window?.destroy()
  app.exit(1)
}, 60000)

async function waitFor(check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for the kiosk telemetry smoke test.')
}

async function main() {
  directory = process.env.IQM_TELEMETRY_SMOKE_DIR
  assert.ok(directory, 'Run this harness with npm run check:telemetry.')
  app.setPath('userData', directory)
  await app.whenReady()
  protocol.handle(APP_PROTOCOL_SCHEME, createAppProtocolHandler({
    rendererRoot: path.resolve(__dirname, '..', 'dist')
  }))
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_request, callback) => {
      vendorRequests += 1
      callback({ cancel: true })
    }
  )

  const uploads = []
  telemetry = new KioskTelemetry({
    directory: path.join(directory, 'telemetry'),
    config: validateConfig({
      enabled: true, kioskId: 'smoke-test',
      posthog: { projectToken: 'phc_smoketestonly' },
      sentry: { dsn: 'https://abc123@o123.ingest.de.sentry.io/456' }
    }),
    appVersion: '2.0.1',
    runtimeEnabled: true,
    fetchImpl: async (url, request) => {
      uploads.push({ url, request })
      const body = url.includes('posthog') ? { status: 1 } : {
        id: JSON.parse(request.body.split('\n')[0]).event_id
      }
      return { ok: true, json: async () => body }
    }
  })
  await telemetry.initialize()
  console.log('Telemetry smoke: SDK initialized with local transport.')
  registerTelemetryIpc({ ipcMain, getWebContents: () => window?.webContents, telemetry })
  const runtime = encodeURIComponent(JSON.stringify({
    isKiosk: false,
    appVersion: '2.0.1',
    telemetry: { analyticsEnabled: true, diagnosticsEnabled: true }
  }))
  window = new BrowserWindow({
    show: false,
    width: 540,
    height: 960,
    webPreferences: {
      preload: path.resolve(__dirname, '..', 'electron', 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [`--kiosk-runtime=${runtime}`]
    }
  })
  await window.loadURL(createAppUrl())
  console.log('Telemetry smoke: built renderer loaded.')
  const run = script => window.webContents.executeJavaScript(script, true)
  await waitFor(() => run('Boolean(window.__kioskApp)'))
  assert.equal(await run('typeof window.kiosk.telemetry.upload'), 'undefined')
  assert.equal(await run('typeof window.kiosk.telemetry.projectToken'), 'undefined')
  await run("document.getElementById('start-button').click()")
  await waitFor(async () => (await telemetry.status()).posthog >= 2)

  await run(`
    window.dispatchEvent(new ErrorEvent('error', {
      error: new TypeError('PRIVATE_MARKER person@example.com')
    }))
  `)
  await waitFor(async () => (await telemetry.status()).sentry >= 1)
  telemetry.captureError(new Error('PRIVATE_MARKER person@example.com'), 'main_error')

  // Use the real host without starting a GPU-heavy experience in this bridge test.
  await run(`(async () => {
    const app = window.__kioskApp
    app.telemetry.select('states-of-matter')
    await app.moduleHost.mount({
      id: 'states-of-matter',
      load: async () => ({ mount: () => () => {} })
    })
    app.openMenu('idle')
  })()`)
  await telemetry.flush()
  const records = await telemetry.store.snapshot()
  const events = records.filter(record => record.destination === 'posthog').map(record => record.payload)
  for (const name of ['session_started', 'module_selected', 'module_loading', 'module_ready', 'module_exited', 'idle_return', 'session_ended']) {
    assert.ok(events.some(event => event.event === name), `Expected ${name}`)
  }
  assert.equal(vendorRequests, 0, 'No automatic vendor requests')
  assert.equal(uploads.length, 0, 'No upload before explicit operator action')
  const diagnostics = records.filter(record => record.destination === 'sentry')
  assert.equal(diagnostics.length, 2)
  const contents = JSON.stringify(diagnostics)
  assert.equal(contents.includes('PRIVATE_MARKER'), false)
  assert.equal(contents.includes('person@example.com'), false)
  assert.ok(diagnostics.some(record => record.payload.exception.values[0].stacktrace.frames.length > 0))
  const result = await telemetry.upload()
  assert.equal(result.errors.length, 0)
  assert.equal(result.posthog, events.length)
  assert.equal(result.sentry, 2)
  assert.equal((await telemetry.store.snapshot()).length, 0)
  assert.equal(vendorRequests, 0)
  console.log(`Telemetry Electron smoke test passed: ${events.length} analytics events, two scrubbed SDK diagnostics, sandboxed bridge, no automatic uploads.`)
}

main().then(async () => {
  window?.destroy()
  await telemetry?.flush()
  clearTimeout(deadline)
  app.exit(0)
}).catch(error => {
  console.error(error)
  window?.destroy()
  clearTimeout(deadline)
  app.exit(1)
})

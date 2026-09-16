const { app, BrowserWindow, protocol } = require('electron')
const path = require('node:path')
const {
  APP_PROTOCOL_PRIVILEGES,
  APP_PROTOCOL_SCHEME,
  createAppProtocolHandler,
  createAppUrl
} = require('../electron/app-protocol.cjs')

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL_SCHEME,
    privileges: APP_PROTOCOL_PRIVILEGES
  }
])

const requiredFetchAssets = Object.freeze([
  {
    path: '/assets/modules/differences/Buoy.glb',
    minimumBytes: 150_000
  },
  {
    path: '/assets/modules/differences/coins/US Coins OBj.obj',
    minimumBytes: 200_000
  },
  {
    path: '/assets/modules/differences/coins/TwentyFive_Cent_Color.bmp',
    minimumBytes: 8_000_000
  }
])

app.whenReady().then(async () => {
  const rendererRoot = path.resolve(__dirname, '..', 'dist')
  protocol.handle(APP_PROTOCOL_SCHEME, createAppProtocolHandler({ rendererRoot }))

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    await window.loadURL(createAppUrl())
    const results = await window.webContents.executeJavaScript(`
      Promise.all(${JSON.stringify(requiredFetchAssets)}.map(async asset => {
        const response = await fetch(asset.path)
        const bytes = (await response.arrayBuffer()).byteLength
        return {
          ...asset,
          bytes,
          ok: response.ok && bytes >= asset.minimumBytes,
          status: response.status
        }
      }))
    `)
    const failures = results.filter(result => !result.ok)
    console.log(JSON.stringify(results, null, 2))
    if (failures.length) {
      throw new Error(`Packaged protocol smoke test failed for ${failures.length} asset(s)`)
    }
    console.log('Packaged protocol smoke test passed.')
  } finally {
    window.destroy()
  }
}).then(
  () => app.exit(0),
  error => {
    console.error(error)
    app.exit(1)
  }
)

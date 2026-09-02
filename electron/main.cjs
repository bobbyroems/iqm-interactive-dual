const {
  app,
  BrowserWindow,
  Menu,
  powerSaveBlocker,
  protocol,
  screen,
  session
} = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const {
  APP_PROTOCOL_PRIVILEGES,
  APP_PROTOCOL_SCHEME,
  createAppProtocolHandler,
  createAppUrl,
} = require('./app-protocol.cjs')
const { applyGraphicsPolicy } = require('./graphics-policy.cjs')
const { resolveRuntimeMode } = require('./runtime-mode.cjs')

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL_SCHEME,
    privileges: APP_PROTOCOL_PRIVILEGES
  }
])

function readDefaultLaunchMode() {
  try {
    const metadataPath = path.join(app.getAppPath(), 'package.json')
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    return metadata.defaultLaunchMode
  } catch (error) {
    console.warn(`[main] Could not read packaged launch mode: ${error.message}`)
    return 'kiosk'
  }
}

const {
  allowQuit,
  isDevelopment,
  isKiosk,
  isShellHosted,
  isWindowed
} = resolveRuntimeMode(process.argv.slice(1), readDefaultLaunchMode())

const defaultConfig = {
  design: { width: 2160, height: 3840 },
  display: { preferredLabel: 'elo', preferredIndex: null },
  development: {
    windowWidth: 540,
    windowHeight: 960,
    openDevTools: false,
    showHud: false,
    idleTimeoutMs: 600000
  },
  kiosk: { idleTimeoutMs: 60000, backgroundColor: '#090b1f' }
}

let mainWindow = null
let quitting = false
let powerSaveBlockerId = null
let unresponsiveReloadTimer = null

/* The 4K production surface combines large CSS tiles with WebGL and video.
   Keep those accelerated, while the Windows shell-hosted profile avoids both
   the driver-sensitive DirectComposition path and GPU rasterization of the
   oversized CSS layers. This is process-local and does not change Windows. */
applyGraphicsPolicy(app.commandLine, { isShellHosted, platform: process.platform })
app.commandLine.appendSwitch('disable-pinch')
app.commandLine.appendSwitch('overscroll-history-navigation', '0')
Menu.setApplicationMenu(null)

function clearUnresponsiveReloadTimer() {
  if (unresponsiveReloadTimer === null) return
  clearTimeout(unresponsiveReloadTimer)
  unresponsiveReloadTimer = null
}

function mergeConfig(base, override = {}) {
  return {
    ...base,
    ...override,
    design: { ...base.design, ...override.design },
    display: { ...base.display, ...override.display },
    development: { ...base.development, ...override.development },
    kiosk: { ...base.kiosk, ...override.kiosk }
  }
}

function getConfigPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'config', 'kiosk.config.json')
  }

  return path.join(__dirname, '..', 'config', 'kiosk.config.json')
}

function loadConfig() {
  const configPath = getConfigPath()

  try {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return mergeConfig(defaultConfig, fileConfig)
  } catch (error) {
    console.warn(`[main] Falling back to default configuration: ${error.message}`)
    return defaultConfig
  }
}

function registerRendererProtocol() {
  const rendererRoot = path.resolve(__dirname, '..', 'dist')
  protocol.handle(APP_PROTOCOL_SCHEME, createAppProtocolHandler({ rendererRoot }))
}

function listDisplays(displays, primaryDisplay) {
  return displays.map((display, index) => ({
    index,
    id: display.id,
    label: display.label || 'unknown',
    bounds: `${display.bounds.width}x${display.bounds.height}`,
    workArea: `${display.workArea.width}x${display.workArea.height}`,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    touchSupport: display.touchSupport,
    primary: display.id === primaryDisplay.id
  }))
}

function pickDisplay(config) {
  const displays = screen.getAllDisplays()
  const primaryDisplay = screen.getPrimaryDisplay()

  console.table(listDisplays(displays, primaryDisplay))

  const idOverride = process.env.KIOSK_DISPLAY_ID
  const indexOverride = process.env.KIOSK_DISPLAY_INDEX
  const labelOverride = process.env.KIOSK_DISPLAY_LABEL

  if (idOverride) {
    const match = displays.find(display => String(display.id) === String(idOverride))
    if (match) return match
  }

  const configuredIndex = indexOverride ?? config.display.preferredIndex
  if (configuredIndex !== null && configuredIndex !== undefined) {
    const match = displays[Number(configuredIndex)]
    if (match) return match
  }

  const preferredLabel = String(labelOverride ?? config.display.preferredLabel ?? '').toLowerCase()
  if (preferredLabel) {
    const match = displays.find(display =>
      String(display.label || '').toLowerCase().includes(preferredLabel)
    )
    if (match) return match
  }

  const externalDisplays = displays.filter(display => display.id !== primaryDisplay.id)
  return externalDisplays.sort((left, right) => {
    const leftArea = left.bounds.width * left.bounds.height
    const rightArea = right.bounds.width * right.bounds.height
    return rightArea - leftArea
  })[0] || primaryDisplay
}

function getDevelopmentBounds(display, config) {
  const { workArea } = display
  const designRatio = config.design.width / config.design.height
  const padding = 48
  const preferredWidth = Math.min(config.development.windowWidth, workArea.width - padding)
  const preferredHeight = Math.min(config.development.windowHeight, workArea.height - padding)

  let width = preferredWidth
  let height = width / designRatio

  if (height > preferredHeight) {
    height = preferredHeight
    width = height * designRatio
  }

  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height)
  }
}

function createWindow() {
  const config = loadConfig()
  const hasDisplayOverride = Boolean(
    process.env.KIOSK_DISPLAY_ID ||
    process.env.KIOSK_DISPLAY_INDEX ||
    process.env.KIOSK_DISPLAY_LABEL
  )
  const display = isWindowed && !hasDisplayOverride
    ? screen.getPrimaryDisplay()
    : pickDisplay(config)

  const windowOptions = isWindowed
    ? getDevelopmentBounds(display, config)
    : {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      }

  const runtimePayload = encodeURIComponent(JSON.stringify({
    appVersion: app.getVersion(),
    isDevelopment,
    isKiosk,
    isShellHosted,
    isWindowed,
    config
  }))

  mainWindow = new BrowserWindow({
    ...windowOptions,
    useContentSize: isWindowed,
    frame: isWindowed,
    resizable: isWindowed,
    /* Shell Launcher already owns the production window bounds. Entering
       Electron's native fullscreen state at the same time causes unstable
       composition on the event PC, while an equally sized borderless window
       is stable. Standalone kiosk previews retain native fullscreen. */
    fullscreen: isKiosk && !isShellHosted,
    kiosk: isKiosk && !isShellHosted,
    autoHideMenuBar: true,
    backgroundColor: config.kiosk.backgroundColor,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: isDevelopment,
      additionalArguments: [`--kiosk-runtime=${runtimePayload}`]
    }
  })

  if (isWindowed) {
    mainWindow.setAspectRatio(config.design.width / config.design.height)
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.on('unresponsive', () => {
    if (unresponsiveReloadTimer !== null) return
    console.warn('[main] Renderer became unresponsive; waiting for recovery.')
    unresponsiveReloadTimer = setTimeout(() => {
      unresponsiveReloadTimer = null
      if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
        console.error('[main] Renderer did not recover; reloading.')
        mainWindow.webContents.reload()
      }
    }, 5000)
  })
  mainWindow.webContents.on('responsive', () => {
    if (unresponsiveReloadTimer === null) return
    console.info('[main] Renderer recovered without a reload.')
    clearUnresponsiveReloadTimer()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    clearUnresponsiveReloadTimer()
    console.error('[main] Renderer process exited.', details)
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => mainWindow?.webContents.reload(), 1000)
    }
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const requestedQuit = input.type === 'keyDown' && input.control && input.shift &&
      input.key.toLowerCase() === 'q'

    if (requestedQuit && allowQuit) {
      event.preventDefault()
      quitting = true
      app.quit()
    }
  })

  mainWindow.on('close', event => {
    if (isKiosk && !allowQuit && !quitting) {
      event.preventDefault()
    }
  })
  mainWindow.on('closed', clearUnresponsiveReloadTimer)

  if (isDevelopment) {
    mainWindow.loadURL('http://127.0.0.1:5173/?dev=1')
    if (config.development.openDevTools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadURL(createAppUrl())
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    registerRendererProtocol()
    console.info('[main] GPU feature status', app.getGPUFeatureStatus())
    app.getGPUInfo('basic')
      .then(info => console.info('[main] GPU information', info))
      .catch(error => console.warn('[main] GPU information unavailable.', error))
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  quitting = true
  clearUnresponsiveReloadTimer()

  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

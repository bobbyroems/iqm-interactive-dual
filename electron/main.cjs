const {
  app,
  BrowserWindow,
  dialog,
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
const { resolveRuntimeMode } = require('./runtime-mode.cjs')

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL_SCHEME,
    privileges: APP_PROTOCOL_PRIVILEGES
  }
])

function readPackagedDefaults() {
  try {
    const metadataPath = path.join(app.getAppPath(), 'package.json')
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    return {
      defaultLaunchMode: metadata.defaultLaunchMode,
      defaultAllowQuit: metadata.defaultAllowQuit
    }
  } catch (error) {
    console.warn(`[main] Could not read packaged launch mode: ${error.message}`)
    /* Fail safe: an unreadable build is treated as production, which keeps
       quit behind a flag rather than handing it out by accident. */
    return { defaultLaunchMode: 'kiosk', defaultAllowQuit: false }
  }
}

const {
  allowQuit,
  isSupervised,
  isDevelopment,
  isKiosk,
  isWindowed
} = resolveRuntimeMode(process.argv.slice(1), readPackagedDefaults())

/* Every kiosk build covers its display on its own — borderless at the display's
   bounds and above the shell, which is the arrangement that proved stable on
   the event PC. */
const wantsFullDisplay = isKiosk

const defaultConfig = {
  design: { width: 2160, height: 3840 },
  display: { preferredLabel: 'elo', preferredIndex: null },
  development: {
    windowWidth: 540,
    windowHeight: 960,
    openDevTools: false,
    showHud: false,
    idleReturnToMenuMs: 600000,
    idleReturnToHomeMs: 600000
  },
  kiosk: {
    idleReturnToMenuMs: 120000,
    idleReturnToHomeMs: 120000,
    backgroundColor: '#090b1f'
  }
}

let mainWindow = null
let quitting = false
let powerSaveBlockerId = null
let unresponsiveReloadTimer = null
let placementInFlight = false
let activeDisplayId = null
let displaySettleTimer = null

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

/* A packaged app has no console, so the one thing that settles a "it does not
   fill the screen" report — which display was chosen, at what scale, and what
   the window ended up as — is invisible exactly where it is needed. Builds a
   person is driving leave it on disk to send back. */
function writeDisplayReport(display, strategy) {
  if (!allowQuit && !isSupervised) return

  try {
    const reportPath = path.join(app.getPath('userData'), 'display-report.txt')
    const report = [
      `written        ${new Date().toISOString()}`,
      `app            ${app.getVersion()}`,
      `launch mode    ${isKiosk ? 'kiosk' : isWindowed ? 'windowed' : 'development'}`,
      `strategy       ${strategy}`,
      `chosen display ${display.id} ${display.label || 'unknown'}`,
      `window bounds  ${JSON.stringify(mainWindow?.getBounds())}`,
      '',
      'all displays:',
      ...listDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay())
        .map(row => `  ${JSON.stringify(row)}`)
    ].join('\n')

    fs.writeFileSync(reportPath, `${report}\n`, 'utf8')
    console.info(`[main] Display report written to ${reportPath}`)
  } catch (error) {
    console.warn(`[main] Could not write the display report: ${error.message}`)
  }
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

  /* Ranked on what the kiosk screen actually is — a touchscreen, mounted the
     way the design is drawn — rather than on "anything but the primary", which
     sent the app off to the laptop the moment someone set the touchscreen as
     their main display. Being secondary is still a hint, just the weakest one,
     so an unchanged production PC still resolves the same way. */
  const designIsPortrait = config.design.height > config.design.width

  return [...displays].sort((left, right) => {
    const score = display =>
      (display.touchSupport === 'available' ? 4 : 0) +
      ((display.bounds.height > display.bounds.width) === designIsPortrait ? 2 : 0) +
      (display.id === primaryDisplay.id ? 0 : 1)

    return (score(right) - score(left)) ||
      (right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height)
  })[0] || primaryDisplay
}

/* A fullscreen review build has someone standing in front of it, so it asks
   instead of guessing — the guess costs a relaunch to correct, and which screen
   a laptop calls "main" changes between desks. Production must never block on
   input, a windowed build is small enough to drag, and an explicit override has
   already answered the question, so all three skip straight past. */
function chooseDisplay(config, hasDisplayOverride) {
  const displays = screen.getAllDisplays()
  const suggested = pickDisplay(config)

  if (!wantsFullDisplay || !allowQuit || hasDisplayOverride || displays.length < 2) {
    return suggested
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const suggestedIndex = Math.max(0, displays.findIndex(d => d.id === suggested.id))
  const buttons = displays.map((display, index) => {
    const notes = [
      display.id === primaryDisplay.id ? 'main' : null,
      display.touchSupport === 'available' ? 'touch' : null,
      index === suggestedIndex ? 'suggested' : null
    ].filter(Boolean)
    return `${index + 1}. ${display.label || 'Display'} ` +
      `${display.bounds.width}×${display.bounds.height}` +
      (notes.length ? ` (${notes.join(', ')})` : '')
  })

  const chosen = dialog.showMessageBoxSync({
    type: 'question',
    title: 'IQM Kiosk',
    message: 'Which screen should the kiosk open on?',
    detail: 'Ctrl+Shift+D moves it to the next screen later. Ctrl+Shift+Q quits.',
    buttons,
    defaultId: suggestedIndex,
    cancelId: suggestedIndex,
    noLink: true
  })

  return displays[chosen] || suggested
}

/* Both directions of the Windows fullscreen transition are asynchronous, and
   measurably so: bounds written before an exit has landed are discarded, and
   bounds read straight after an enter still describe the old window. Every step
   below waits out the previous one rather than trusting an immediate read. */
const FULLSCREEN_SETTLE_MS = 500

function settleFullscreen() {
  return new Promise(resolve => setTimeout(resolve, FULLSCREEN_SETTLE_MS))
}

function windowIsUsable() {
  return Boolean(mainWindow) && !mainWindow.isDestroyed()
}

/* Sizes the window to one display and, for a fullscreen build, takes it
   fullscreen there. A fullscreen window cannot be moved between displays on
   Windows, so it drops out first and goes back afterwards. */
async function placeWindowOnDisplay(display) {
  if (!windowIsUsable() || placementInFlight) return
  placementInFlight = true

  try {
    activeDisplayId = display.id
    if (mainWindow.isKiosk()) mainWindow.setKiosk(false)
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false)
      await settleFullscreen()
      if (!windowIsUsable()) return
    }

    mainWindow.setAlwaysOnTop(false)
    mainWindow.setBounds(display.bounds)

    let strategy = 'windowed'

    if (wantsFullDisplay) {
      /* Borderless at the display's own bounds and held above the shell, rather
         than Chromium's fullscreen. From the lab: native fullscreen leaves the
         taskbar's strip unpainted when the touchscreen is the only display,
         which is what a window merely sized to the screen looks like — so it
         was not entering fullscreen at all — and it picks the wrong size
         outright once a second display exists. The shell-hosted path already
         trusts an equally sized borderless window on this hardware. This also
         has no asynchronous transition to lose bounds to, so moving between
         displays is just a resize. */
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      strategy = 'borderless'
    }

    console.info(
      `[main] Display ${display.id} (${display.label || 'unknown'}) ` +
      `${display.bounds.width}x${display.bounds.height} @${display.scaleFactor}x ` +
      `rotation=${display.rotation}; strategy=${strategy}; ` +
      `window=${JSON.stringify(mainWindow.getBounds())}`
    )
    writeDisplayReport(display, strategy)
  } finally {
    placementInFlight = false
  }
}

/* Which display the kiosk lands on is a guess made before anyone is standing in
   front of it, and the guess is wrong often enough that a stranded window needs
   an escape. Gated on allowQuit so it exists on the builds a person is meant to
   be driving and not on an unattended production machine. */
async function moveToAdjacentDisplay() {
  const displays = screen.getAllDisplays()
  if (!mainWindow || mainWindow.isDestroyed() || displays.length < 2) return

  const current = screen.getDisplayMatching(mainWindow.getBounds())
  const currentIndex = displays.findIndex(display => display.id === current.id)
  await placeWindowOnDisplay(displays[(currentIndex + 1) % displays.length])
}

/* Windows reports one layout change as a burst of events, and the bounds it
   hands back partway through still describe the arrangement on its way out.
   Only the state things settle into is worth measuring, so the last event of a
   burst wins. */
const DISPLAY_SETTLE_MS = 1000

function clearDisplaySettleTimer() {
  if (displaySettleTimer === null) return
  clearTimeout(displaySettleTimer)
  displaySettleTimer = null
}

/* Switching the laptop's own screen off is a display change like any other,
   and Windows re-lays-out what survives it: the touchscreen slides to the
   origin and is re-scaled, so its bounds are not the ones the window was sized
   to. Nothing tells the window that happened, and a window still holding the
   old bounds uncovers a strip of desktop down its right and bottom edges. So
   it re-measures whichever display it is on every time the layout moves. */
function refreshPlacement() {
  if (!wantsFullDisplay || !windowIsUsable()) return

  /* A placement already under way is about to write bounds read before this
     change, so the fresh measurement has to come after it, not instead. */
  if (placementInFlight) {
    scheduleDisplayRefresh()
    return
  }

  const displays = screen.getAllDisplays()
  const display = displays.find(candidate => candidate.id === activeDisplayId) ||
    screen.getDisplayMatching(mainWindow.getBounds())

  void placeWindowOnDisplay(display)
}

function scheduleDisplayRefresh() {
  clearDisplaySettleTimer()
  displaySettleTimer = setTimeout(() => {
    displaySettleTimer = null
    refreshPlacement()
  }, DISPLAY_SETTLE_MS)
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
    : chooseDisplay(config, hasDisplayOverride)

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
    isWindowed,
    config
  }))

  mainWindow = new BrowserWindow({
    ...windowOptions,
    useContentSize: isWindowed,
    frame: isWindowed,
    resizable: isWindowed,
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

  /* Fullscreen is applied to the shown window rather than asked for in the
     constructor, and only once it is on screen: a hidden window does not run
     the transition, and asking for it up front lets Chromium resolve the
     fullscreen size against whichever display it happened to place the window
     on. The window is already borderless at the display's own size, so there is
     nothing to see between showing it and it going fullscreen. */
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (wantsFullDisplay) void placeWindowOnDisplay(display)
  })

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
    const chord = input.type === 'keyDown' && input.control && input.shift
    const requestedQuit = chord && input.key.toLowerCase() === 'q'
    const requestedDisplayChange = chord && input.key.toLowerCase() === 'd'

    if (requestedQuit && allowQuit) {
      event.preventDefault()
      quitting = true
      app.quit()
      return
    }

    if (requestedDisplayChange && (allowQuit || isSupervised)) {
      event.preventDefault()
      void moveToAdjacentDisplay()
    }
  })

  mainWindow.on('close', event => {
    if (isKiosk && !allowQuit && !quitting) {
      event.preventDefault()
    }
  })
  mainWindow.on('closed', () => {
    clearUnresponsiveReloadTimer()
    clearDisplaySettleTimer()
  })

  if (isDevelopment) {
    const devServerUrl = new URL('/?dev=1', process.env.IQM_DEV_SERVER_URL || 'http://127.0.0.1:5173')
    mainWindow.loadURL(devServerUrl.toString())
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

    if (wantsFullDisplay) {
      screen.on('display-added', scheduleDisplayRefresh)
      screen.on('display-removed', scheduleDisplayRefresh)
      screen.on('display-metrics-changed', scheduleDisplayRefresh)
    }

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  quitting = true
  clearUnresponsiveReloadTimer()
  clearDisplaySettleTimer()

  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

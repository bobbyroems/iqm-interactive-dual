const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const auditRoot = path.join(__dirname, '..', '.audit-electron-user-data')
const screenshotPath = path.join(__dirname, '..', '.audit-nanoscale-render.png')

app.setPath('userData', auditRoot)

function waitForLoad(webContents) {
  return new Promise((resolve, reject) => {
    webContents.once('did-finish-load', resolve)
    webContents.once('did-fail-load', (_event, code, description) => {
      reject(new Error(`did-fail-load ${code}: ${description}`))
    })
  })
}

async function waitForNanoscale(webContents) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const ready = await webContents.executeJavaScript(`Boolean(
      document.querySelector('.nz__intro') &&
      !document.querySelector('.module-host__loading')
    )`)
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the Nanoscale DOM')
}

app.whenReady().then(async () => {
  const runtimePayload = encodeURIComponent(JSON.stringify({
    appVersion: 'audit',
    isDevelopment: true,
    isKiosk: false,
    config: {
      design: { width: 2160, height: 3840 },
      development: { idleReturnToMenuMs: 600000, idleReturnToHomeMs: 600000 },
      kiosk: { idleReturnToMenuMs: 120000, idleReturnToHomeMs: 120000 }
    }
  }))
  const win = new BrowserWindow({
    width: 540,
    height: 960,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--kiosk-runtime=${runtimePayload}`]
    }
  })

  try {
    let loaded = waitForLoad(win.webContents)
    await win.loadURL('http://127.0.0.1:5173/?dev=1&audit=nanoscale')
    await loaded
    loaded = waitForLoad(win.webContents)
    await win.webContents.executeJavaScript(`
      sessionStorage.setItem('kiosk-dev-view', JSON.stringify({
        screen: 'module',
        moduleId: 'nanoscale'
      }))
      location.reload()
    `)
    await loaded
    await waitForNanoscale(win.webContents)
    await new Promise(resolve => setTimeout(resolve, 1200))

    const result = await win.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('#kiosk-stage')
      const intro = document.querySelector('.nz__intro')
      const title = intro?.querySelector('.kiosk-explainer__title')
      const body = intro?.querySelector('.kiosk-explainer__body')
      const instruction = document.querySelector('.nz__instruction')
      const instructionText = instruction?.querySelector('.kiosk-tooltip__text')
      const read = element => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          css: {
            top: style.top,
            left: style.left,
            width: style.width,
            height: style.height,
            boxSizing: style.boxSizing,
            padding: style.padding,
            margin: style.margin,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            textAlign: style.textAlign,
            transform: style.transform,
            overflow: style.overflow,
            display: style.display
          }
        }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        stageScale: getComputedStyle(stage).getPropertyValue('--stage-scale').trim(),
        stage: read(stage),
        intro: read(intro),
        title: read(title),
        body: read(body),
        instruction: read(instruction),
        instructionText: read(instructionText),
        readyState: document.readyState,
        moduleState: document.querySelector('#module-host')?.dataset.moduleState
        ,fontMetrics: (() => {
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          return ['Segoe Sans', 'Segoe UI Variable Text', 'Segoe UI Variable Display', 'Segoe UI', 'Arial'].map(family => {
            context.font = '600 36px "' + family + '"'
            const tooltip = context.measureText('Scroll to zoom').width
            context.font = '600 96px "' + family + '"'
            const title = context.measureText('Exploring the nanoscale').width
            context.font = '500 60px "' + family + '"'
            const bodyLine = context.measureText('Zoom from quantum hardware to').width
            return { family, tooltip, title, bodyLine }
          })
        })()
      }
    })()`)

    const image = await win.webContents.capturePage()
    fs.writeFileSync(screenshotPath, image.toPNG())
    console.log(JSON.stringify({ ...result, screenshotPath }, null, 2))
  } catch (error) {
    console.error(error.stack || error)
    process.exitCode = 1
  } finally {
    win.destroy()
    app.quit()
  }
})

const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

let server
let window
let timeout
let exitCode = 0
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

async function main() {
  await app.whenReady()
  const { createServer } = await import('vite')
  server = await createServer({
    configFile: path.resolve(__dirname, '..', 'vite.config.js'),
    server: { host: '127.0.0.1', port: 0 }
  })
  await server.listen()
  window = new BrowserWindow({
    width: 1366, height: 768, useContentSize: true, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true }
  })
  const page = window.webContents
  const run = source => page.executeJavaScript(source, true)
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const waitFor = expression => run(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 15000;
    const check = () => {
      if (${expression}) resolve();
      else if (performance.now() > deadline) reject(new Error('Menu check did not settle: ' + ${JSON.stringify(expression)}));
      else setTimeout(check, 30);
    };
    check();
  })`)
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}`)
  await waitFor("window.__kioskApp?.moduleCarousel.cards.length === 9 && document.body.classList.contains('is-browser')")
  await page.insertCSS('.screen--menu, .screen--menu * { animation: none !important; transition: none !important; }')
  await run(`(async () => {
    await document.fonts.ready;
    window.openedModules = [];
    window.__kioskApp.moduleCarousel.onOpen = id => openedModules.push(id);
    document.querySelector('#start-button').click();
  })()`)
  await waitFor("document.querySelector('.screen--menu').classList.contains('is-active')")
  const clickAt = point => {
    page.sendInputEvent({ type: 'mouseMove', ...point })
    page.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    page.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  }
  const sizes = [
    [1366, 768], [1024, 600], [1280, 720], [1440, 900], [1920, 1080],
    [2560, 1080], [3440, 1440], [768, 1024], [390, 844], [844, 390],
    [1366, 768]
  ]
  for (const [width, height] of sizes) {
    window.setContentSize(width, height)
    await waitFor(`innerWidth === ${width} && innerHeight === ${height}`)
    await settle()
    for (let index = 0; index < 9; index++) {
      await run(`window.__kioskApp.moduleCarousel.setIndex(${index}, { animate: false })`)
      await settle()
      const sample = await run(`(() => {
        const card = document.querySelector('.module-card.is-active');
        const footer = card.querySelector('.module-card__footer');
        const box = footer.getBoundingClientRect();
        const viewport = document.querySelector('.module-carousel__viewport').getBoundingClientRect();
        const pagination = document.querySelector('.module-carousel__pagination').getBoundingClientRect();
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        const points = [
          [centerX, box.top + 2], [centerX, box.bottom - 2],
          [box.left + 2, centerY], [box.right - 2, centerY]
        ];
        return {
          module: card.dataset.moduleId,
          footer: box.toJSON(), viewport: viewport.toJSON(), pagination: pagination.toJSON(),
          contained: box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1 &&
            box.left >= viewport.left - 1 && box.right <= viewport.right + 1 &&
            box.bottom <= innerHeight,
          separated: pagination.top - box.bottom >= 12,
          textFits: footer.scrollWidth <= footer.clientWidth + 1 &&
            footer.scrollHeight <= footer.clientHeight + 1,
          reachable: points.every(([x, y]) => footer.contains(document.elementFromPoint(x, y))),
          center: { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
        };
      })()`)
      assert(sample.contained && sample.separated && sample.textFits && sample.reachable,
        `${width}x${height}: ${JSON.stringify(sample)}`)
      clickAt(sample.center)
      await waitFor(`openedModules.at(-1) === ${JSON.stringify(sample.module)}`)
    }
    console.log(`Menu ${width}x${height}: all nine CTAs visible, separated from pagination and clickable`)
  }
}

Promise.race([main(), new Promise((_resolve, reject) => {
  timeout = setTimeout(() => reject(new Error('Menu layout check timed out')), 120000)
})]).catch(error => {
  console.error(error)
  exitCode = 1
}).finally(async () => {
  clearTimeout(timeout)
  await server?.close()
  app.exit(exitCode)
})

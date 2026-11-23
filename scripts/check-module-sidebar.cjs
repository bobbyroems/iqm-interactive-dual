const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

let server
let win
let exitCode = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
app.on('window-all-closed', () => {})

async function main() {
  await app.whenReady()
  const { createServer } = await import('vite')
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const port = server.httpServer.address().port
  win = new BrowserWindow({
    width: 576, height: 1024, useContentSize: true, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, partition: 'module-sidebar-check' }
  })
  const page = win.webContents
  const run = async source => {
    try {
      return await page.executeJavaScript(source, true)
    } catch (error) {
      throw new Error(`Renderer check failed: ${source.slice(0, 180)}`, { cause: error })
    }
  }
  const waitUntil = async (condition, timeout = 60000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await run(`Boolean(${condition})`)) return
      await sleep(100)
    }
    throw new Error(`Timed out: ${condition}`)
  }
  await win.loadURL(`http://127.0.0.1:${port}`)
  await waitUntil('Boolean(window.__kioskApp)')
  await run(`window.sidebarErrors = [];
    addEventListener('unhandledrejection', event => sidebarErrors.push(String(event.reason)));
    window.visible = selector => {
      const element = document.querySelector(selector);
      return element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && element.getBoundingClientRect().width > 0;
    }; void 0;`)
  assert.equal(await run(`visible('#module-sidebar-launcher')`), false, 'no launcher on Welcome')
  await run('__kioskApp.openMenu()')
  await sleep(400)
  assert.equal(await run(`visible('#module-sidebar-launcher')`), false, 'no launcher on module selection')
  await run(`__kioskApp.openModule('quantum-vs-classical')`)
  await waitUntil(`!__kioskApp.isOpeningExperience && document.querySelector('[data-module-stage][aria-busy="false"]')`)
  assert.equal(await run(`visible('#module-sidebar-launcher')`), true)
  assert.equal(await run(`visible('[data-qvc-action="exit"]')`), false, 'old utility controls replaced')

  const open = async () => {
    await run(`document.querySelector('#module-sidebar-launcher').click()`)
    await sleep(300)
    assert.equal(await run('__kioskApp.moduleSidebar.isOpen()'), true)
  }
  await open()
  const geometry = await run(`(async () => {
    for (const image of document.querySelectorAll('#module-sidebar img')) {
      if (image.classList.contains('module-sidebar__art')) image.scrollIntoView({ block: 'center' });
      try { await image.decode(); }
      catch (error) { throw new Error('Sidebar artwork failed to decode: ' + image.src + ': ' + error.message); }
    }
    document.querySelector('#module-sidebar-grid').scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scale = document.querySelector('#kiosk-stage').getBoundingClientRect().width / 2160;
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale };
    };
    return {
      panel: box('#module-sidebar-panel'),
      tile: box('[data-sidebar-module]'),
      restart: box('[data-sidebar-action="restart"]'),
      home: box('[data-sidebar-action="home"]'),
      count: document.querySelectorAll('[data-sidebar-module]').length,
      current: document.querySelector('[data-sidebar-module][aria-current]').dataset.sidebarModule,
      next: document.querySelector('.module-sidebar__badge:not([hidden])').parentElement.dataset.sidebarModule,
      focus: document.activeElement === document.querySelector('#module-sidebar-panel button'),
      inert: document.querySelector('#module-host').inert && document.querySelector('#kiosk-settings').inert,
      coversSettings: !!document.elementFromPoint(innerWidth * 0.9, innerHeight * 0.96).closest('#module-sidebar'),
      scrollable: document.querySelector('#module-sidebar-grid').scrollHeight > document.querySelector('#module-sidebar-grid').clientHeight,
      assets: [...document.querySelectorAll('#module-sidebar img')].every(image => image.naturalWidth > 0 && !image.src.includes('figma.com')),
      artwork: [...document.querySelectorAll('.module-sidebar__art')].map(image => ({
        id: image.parentElement.dataset.sidebarModule, width: image.getBoundingClientRect().width / scale,
        height: image.getBoundingClientRect().height / scale
      }))
    };
  })()`)
  assert.equal(geometry.count, 9)
  assert.equal(geometry.current, 'quantum-vs-classical')
  assert.equal(geometry.next, 'states-of-matter')
  assert.ok(geometry.focus && geometry.inert && geometry.scrollable && geometry.assets && geometry.coversSettings)
  assert.ok(Math.abs(geometry.panel.x - 540) < 1)
  assert.ok(Math.abs(geometry.panel.width - 1620) < 1)
  assert.ok(Math.abs(geometry.tile.height - 720) < 1)
  assert.ok(Math.abs(geometry.restart.y - 301) < 1)
  assert.ok(Math.abs(geometry.home.y - 481) < 1)
  assert.ok(geometry.artwork.every(image => Math.abs(image.width - 500) < 1 && image.height > 300))
  if (process.env.IQM_SIDEBAR_SCREENSHOT) {
    const fs = require('node:fs/promises')
    await sleep(200)
    await fs.writeFile(path.resolve(process.env.IQM_SIDEBAR_SCREENSHOT), (await page.capturePage()).toPNG())
  }

  await run(`document.querySelector('#module-sidebar-panel button').focus()`)
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] })
  await sleep(50)
  assert.equal(await run(`document.activeElement.dataset.sidebarModule`), 'quantum-platform', 'reverse Tab wraps')
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
  await sleep(50)
  assert.equal(await run(`document.activeElement.getAttribute('aria-label')`), 'Close module menu', 'Tab wraps')
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await sleep(50)
  assert.equal(await run(`__kioskApp.router.currentScreen`), 'module', 'Escape dismisses without navigating')
  assert.equal(await run(`__kioskApp.moduleSidebar.isOpen()`), false)
  assert.equal(await run(`document.activeElement.id`), 'module-sidebar-launcher')
  assert.equal(await run(`document.querySelector('#module-host').inert`), false)

  await open()
  await run(`window.previousStage = document.querySelector('[data-module-stage]');
    document.querySelector('[data-sidebar-module="quantum-vs-classical"]').click()`)
  assert.equal(await run(`document.querySelector('[data-module-stage]') === previousStage`), true, 'current tile preserves progress')
  assert.equal(await run(`__kioskApp.moduleSidebar.isOpen()`), false)
  await open()
  await run(`document.querySelector('.module-sidebar__backdrop').click()`)
  assert.equal(await run(`__kioskApp.moduleSidebar.isOpen()`), false)

  await open()
  await run(`document.querySelector('[data-sidebar-action="restart"]').click()`)
  await waitUntil(`!__kioskApp.isOpeningExperience && document.querySelector('[data-module-stage][aria-busy="false"]')`)
  assert.equal(await run(`document.querySelector('[data-module-stage]') !== previousStage`), true, 'Restart remounts from the beginning')
  assert.equal(await run('__kioskApp.activeModuleId'), 'quantum-vs-classical')

  const ids = await run(`(async () => (await import('/js/modules/module-registry.js')).MODULES.map(module => module.id))()`)
  for (const id of ids.slice(1)) {
    await open()
    await run(`document.querySelector('[data-sidebar-module="${id}"]').click()`)
    await waitUntil(`!__kioskApp.isOpeningExperience && document.querySelector('[data-module-stage="${id}"][aria-busy="false"]')`)
    assert.equal(await run('__kioskApp.activeModuleId'), id)
    assert.equal(await run('__kioskApp.moduleSidebar.isOpen()'), false)
    assert.equal(await run(`visible('#module-sidebar-launcher')`), true)
    console.log(`Sidebar navigation passed: ${id}`)
  }

  await open()
  assert.equal(await run(`document.querySelectorAll('.module-sidebar__badge:not([hidden])').length`), 0, 'last module has no next')
  // Exercise native touch scrolling, including touches beginning on a tile.
  await run(`document.querySelector('#module-sidebar-grid').scrollTop = 0`)
  page.debugger.attach('1.3')
  await page.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: 450, y: 850 }]
  })
  for (let y = 800; y >= 350; y -= 50) {
    await page.debugger.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: 450, y }]
    })
    await sleep(30)
  }
  await page.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(200)
  assert.ok(await run(`document.querySelector('#module-sidebar-grid').scrollTop > 100`), 'touch swipe scrolls module tiles')
  page.debugger.detach()
  await run(`document.querySelector('[data-sidebar-action="home"]').click()`)
  assert.equal(await run('__kioskApp.router.currentScreen'), 'attract')
  assert.equal(await run('__kioskApp.moduleSidebar.isOpen()'), false)
  await sleep(700)
  assert.equal(await run(`visible('#module-sidebar-launcher')`), false)
  assert.equal(await run(`document.querySelector('#kiosk-settings').inert`), false)

  await run(`(async () => { await __kioskApp.activateModule((await import('/js/modules/module-registry.js')).getModule('quantum-platform')); })()`)
  await waitUntil(`document.querySelector('[data-module-stage][aria-busy="false"]')`)
  await open()
  await run('__kioskApp.onIdle()')
  assert.equal(await run('__kioskApp.router.currentScreen'), 'menu', 'idle navigation closes drawer')
  assert.equal(await run('__kioskApp.moduleSidebar.isOpen()'), false)
  assert.deepEqual(await run('sidebarErrors'), [])
  console.log('Module sidebar passed: visibility, artwork, geometry, focus, dismissal, restart, all nine modules, touch scroll, Welcome and idle return.')
}

main().catch(error => {
  console.error(error)
  exitCode = 1
}).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  await server?.close()
  app.exit(exitCode)
})

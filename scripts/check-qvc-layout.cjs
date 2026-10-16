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
  const root = path.resolve(__dirname, '..')
  const { createServer } = await import('vite')
  server = await createServer({
    root: path.join(root, 'src'),
    publicDir: path.join(root, 'public'),
    configFile: false,
    optimizeDeps: { exclude: ['three'] },
    plugins: [{
      name: 'qvc-layout-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__qvc-layout', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(`<!doctype html><html><head>
            <link rel="stylesheet" href="/styles/tokens.css">
            <link rel="stylesheet" href="/styles/base.css">
            <link rel="stylesheet" href="/styles/app.css">
            <link rel="stylesheet" href="/js/modules/quantum-vs-classical/quantum-vs-classical.css">
            </head><body><main id="fixture" style="position:absolute;inset:0"></main></body></html>`)
        })
      }
    }],
    server: { host: '127.0.0.1', port: 0 }
  })
  await server.listen()
  window = new BrowserWindow({
    width: 320, height: 568, useContentSize: true, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true }
  })
  const page = window.webContents
  const errors = []
  page.on('console-message', ({ message }) => {
    if (/Uncaught|Failed to load resource/.test(message)) errors.push(message)
  })
  await window.loadURL('about:blank')
  page.debugger.attach('1.3')
  const cdp = (method, args) => page.debugger.sendCommand(method, args)
  await cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__qvc-layout`)
  const run = source => page.executeJavaScript(source, true)
  const waitFor = (expression, label) => run(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 45000;
    const check = () => {
      if (${expression}) resolve();
      else if (performance.now() > deadline) reject(new Error(${JSON.stringify(label)}));
      else setTimeout(check, 40);
    };
    check();
  })`)
  console.log('Mounting the production menu and its retained WebGL previews...')
  await run(`(async () => {
    const { mount } = await import('/js/modules/quantum-vs-classical/index.js');
    const { setUpNextCardsEnabled } = await import('/js/core/kiosk-settings.js');
    setUpNextCardsEnabled(false);
    const controller = new AbortController();
    window.abortQvc = () => controller.abort();
    window.failures = [];
    window.disposeQvc = await mount(document.querySelector('#fixture'), {
      signal: controller.signal, navigate: { menu: () => window.exited = true },
      onError: error => failures.push(error.message)
    });
    await document.fonts.ready;
    window.sampleLayout = () => {
      const root = document.querySelector('.qvc');
      const menu = root.dataset.view === 'menu';
      const host = root.querySelector(menu ? '.qvc__menu' : '.qvc__game-host');
      const visible = e => e.getClientRects().length && !e.closest('[hidden]') &&
        getComputedStyle(e).visibility !== 'hidden';
      const text = [...host.querySelectorAll('h2, p:not(.qvc__sr), .qvc__principle-label, .kiosk-tooltip__label, .qvc-flip__tally-label, .qvc-flip__tally-digit')].filter(visible);
      const textFits = e => {
        const box = e.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1 &&
          (!e.clientWidth || (e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1));
      };
      const header = root.querySelector('.qvc__header');
      const headerFits = [...header.querySelectorAll('button, .microsoft-brand')].filter(visible).every(e => {
        const box = e.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth + 1;
      });
      const canvas = root.querySelector('.qvc-game__canvas');
      const frame = canvas?.parentElement.getBoundingClientRect();
      const sceneFits = !canvas || (canvas.clientWidth >= 1 && canvas.clientHeight >= 279 &&
        Math.abs(canvas.getBoundingClientRect().width - frame.width) <= 1 &&
        frame.left >= 0 && frame.right <= innerWidth + 1);
      return {
        view: root.dataset.view, stage: root.querySelector('.qvc-game')?.dataset.stage,
        textFits: text.every(textFits), headerFits, sceneFits,
        readable: text.every(e => parseFloat(getComputedStyle(e).fontSize) >= 14),
        horizontalOverflow: host.scrollWidth > host.clientWidth + 1,
        text: text.map(e => ({ text: e.textContent, box: e.getBoundingClientRect().toJSON(), width: e.clientWidth, scrollWidth: e.scrollWidth, height: e.clientHeight, scrollHeight: e.scrollHeight }))
      };
    };
  })()`)
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const check = async label => {
    await settle()
    const sample = await run('sampleLayout()')
    assert(sample.textFits && sample.headerFits && sample.sceneFits && sample.readable && !sample.horizontalOverflow,
      `${label}: ${JSON.stringify(sample)}`)
  }
  const matrix = async label => {
    for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
      window.setContentSize(width, height)
      await waitFor(`innerWidth === ${width} && innerHeight === ${height}`, 'viewport resize')
      await check(`${label} ${width}x${height}`)
    }
    console.log(`${label}: six viewport layouts fit`)
  }
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const gameReady = name => waitFor(`document.querySelector('.qvc-${name} .is-ready') &&
    !document.querySelector('.qvc').classList.contains('is-transitioning')`, `${name} first frame`)
  const swipe = async (touch = false, cancel = false) => {
    await run("document.querySelector('.qvc-game__canvas').scrollIntoView({ block: 'center' })")
    await settle()
    const box = await run("document.querySelector('.qvc-game__canvas').getBoundingClientRect().toJSON()")
    const x = box.left + box.width / 2
    const y = box.top + box.height * 0.75
    if (touch) {
      await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
      await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 120, id: 1 }] })
      await cdp('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
    } else {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y - 120, button: 'left', buttons: 1 })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y - 120, button: 'left', clickCount: 1 })
    }
  }
  await matrix('Menu')
  assert(await run("document.querySelector('[data-qvc-game=\"entanglement\"]').disabled && document.querySelector('[data-qvc-game=\"interference\"]').disabled"))
  await click('[data-qvc-game="superposition"]')
  await gameReady('flip')
  await matrix('Superposition')
  window.setContentSize(320, 568)
  await waitFor('innerWidth === 320 && innerHeight === 568', 'phone resize')
  await run(`document.querySelector('.qvc-game__canvas').scrollIntoView({ block: 'center' });
    document.querySelector('.qvc-game__canvas').addEventListener('pointerdown', event => {
      window.resizePointerId = event.pointerId;
    }, { once: true })`)
  await settle()
  const dragBox = await run("document.querySelector('.qvc-game__canvas').getBoundingClientRect().toJSON()")
  const dragX = dragBox.left + dragBox.width / 2
  const dragY = dragBox.top + dragBox.height * 0.75
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragX, y: dragY, button: 'left', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragX, y: dragY - 80, button: 'left', buttons: 1 })
  assert(await run("document.querySelector('.qvc-game__canvas').hasPointerCapture(resizePointerId)"))
  window.setContentSize(568, 320)
  await waitFor("innerWidth === 568 && innerHeight === 320 && !document.querySelector('.qvc-game__canvas').hasPointerCapture(resizePointerId)", 'releasing a resized swipe')
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 160, y: 160, button: 'left', clickCount: 1 })
  assert.equal(await run("document.querySelector('.qvc-flip').dataset.state"), 'ready')
  window.setContentSize(320, 568)
  await waitFor('innerWidth === 320 && innerHeight === 568', 'phone resize')
  await swipe(true, true)
  assert.equal(await run("document.querySelector('.qvc-flip').dataset.state"), 'ready')
  await swipe(true)
  await waitFor("document.querySelector('.qvc-flip').dataset.state === 'landed'", 'classical coin landing')
  await waitFor("document.querySelector('.qvc-flip').classList.contains('is-copy-in')", 'classical narration')
  await check('Classical result')
  await swipe()
  await waitFor("document.querySelector('.qvc-flip').dataset.state === 'bullet'", 'superposition slow motion')
  await check('Slow-motion narration')
  await waitFor("document.querySelector('.qvc-flip').dataset.state === 'landed'", 'quantum coin landing')
  await waitFor("!document.querySelector('[data-qvc-game=\"entanglement\"]').disabled", 'unlocking entanglement')
  await check('Quantum result and tally')
  await click('[data-qvc-action="back"]')
  await waitFor("document.querySelector('.qvc').dataset.view === 'menu' && !document.querySelector('.qvc').classList.contains('is-transitioning')", 'returning to menu')
  await click('[data-qvc-game="entanglement"]')
  await gameReady('pair')
  await matrix('Entanglement')
  window.setContentSize(320, 568)
  await waitFor('innerWidth === 320 && innerHeight === 568', 'phone resize')
  await click('.qvc-pair__action')
  await waitFor("document.querySelector('.qvc-pair').dataset.state === 'entangled'", 'linked coins')
  await check('Linked coins')
  await click('.qvc-pair__action')
  await waitFor("document.querySelector('.qvc-pair').dataset.state === 'measured'", 'measured coins')
  await waitFor("!document.querySelector('[data-qvc-game=\"interference\"]').disabled", 'unlocking interference')
  await check('Measured coins')
  await run("document.querySelector('.qvc-game__canvas').scrollIntoView({ block: 'center' })")
  await settle()
  const measuredBox = await run("document.querySelector('.qvc-game__canvas').getBoundingClientRect().toJSON()")
  await cdp('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: measuredBox.left + measuredBox.width / 2, y: measuredBox.top + measuredBox.height / 2, id: 1 }]
  })
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await waitFor("document.querySelector('.qvc-pair').dataset.state === 'independent'", 'touch restart of measured coins')
  await click('[data-qvc-action="back"]')
  await waitFor("document.querySelector('.qvc').dataset.view === 'menu' && !document.querySelector('.qvc').classList.contains('is-transitioning')", 'returning to menu')
  await click('[data-qvc-game="interference"]')
  await gameReady('interference')
  await matrix('Interference')
  window.setContentSize(320, 568)
  await waitFor('innerWidth === 320 && innerHeight === 568', 'phone resize')
  for (let step = 0; step < 60; step++) {
    if (await run("document.querySelector('.qvc-interference').dataset.outcome === 'true'")) break
    await run("document.querySelector('.qvc-game__canvas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))")
    await run('new Promise(resolve => setTimeout(resolve, 750))')
    await check(`Interference step ${step}`)
  }
  assert.equal(await run("document.querySelector('.qvc-interference').dataset.outcome"), 'true')
  await check('Interference finale')
  await click('[data-qvc-action="restart"]')
  assert.equal(await run("document.querySelector('.qvc-interference').dataset.stage"), 'first-source')
  assert.equal(await run("document.querySelector('.qvc__game-host').scrollTop"), 0)
  await click('[data-qvc-action="exit"]')
  assert(await run('window.exited'))
  await run('abortQvc(); disposeQvc()')
  assert.equal(await run("document.querySelectorAll('.qvc canvas').length"), 0)
  assert.deepEqual(await run('failures'), [])
  assert.deepEqual(errors, [])
  console.log('QVC responsive menu, all three lessons, completion gates, gestures, restart and cleanup passed.')
}

Promise.race([main(), new Promise((_resolve, reject) => {
  timeout = setTimeout(() => reject(new Error('QVC layout check timed out')), 180_000)
})]).catch(error => {
  console.error(error)
  exitCode = 1
}).finally(async () => {
  clearTimeout(timeout)
  window?.destroy()
  await server?.close()
  app.exit(exitCode)
})

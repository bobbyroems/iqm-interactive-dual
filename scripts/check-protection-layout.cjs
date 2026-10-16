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
      name: 'protection-layout-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__protection-layout', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(`<!doctype html><html><head>
            <link rel="stylesheet" href="/styles/tokens.css">
            <link rel="stylesheet" href="/styles/base.css">
            <link rel="stylesheet" href="/styles/app.css">
            <link rel="stylesheet" href="/js/modules/protecting-information/protecting-information.css">
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
  const run = source => page.executeJavaScript(source, true)
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const ready = () => run(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 10000;
    const check = () => {
      const sample = sampleLayout();
      if (sample.boardFits && sample.dialFits) resolve(sample);
      else if (performance.now() > deadline) reject(new Error('Protection layout did not settle: ' + JSON.stringify(sample)));
      else setTimeout(check, 30);
    };
    check();
  })`)
  const resize = async (width, height) => {
    window.setContentSize(width, height)
    await run(`new Promise(resolve => {
      const check = () => innerWidth === ${width} && innerHeight === ${height} ? resolve() : setTimeout(check, 20);
      check();
    })`)
    await settle()
  }
  for (const visual of ['video', 'scene']) {
    await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: visual === 'video' ? 'reduce' : 'no-preference' }]
    })
    await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__protection-layout?visual=${visual}`)
    console.log(`Mounting real protection ${visual} treatment...`)
    await run(`(async () => {
      const { mount } = await import('/js/modules/protecting-information/index.js');
      const { setUpNextCardsEnabled } = await import('/js/core/kiosk-settings.js');
      setUpNextCardsEnabled(false);
      const controller = new AbortController();
      window.abortProtection = () => controller.abort();
      window.disposeProtection = await mount(document.querySelector('#fixture'), {
        signal: controller.signal, navigate: { menu: () => window.exited = true }
      });
      await document.fonts.ready;
      window.dialKey = (id, key) => document.querySelector('[data-pqi-dial="' + id + '"]')
        .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      window.sampleLayout = () => {
        const root = document.querySelector('.pqi');
        const experience = root.querySelector('.pqi__experience');
        const frame = root.querySelector('.pqi__visual').getBoundingClientRect();
        const board = root.querySelector('.pqi__visual-board').getBoundingClientRect();
        const video = root.querySelector('.pqi__video-stage')?.getBoundingClientRect();
        const scene = root.querySelector('.pqi__scene').getBoundingClientRect();
        const scale = board.width / 2160;
        const text = [...root.querySelectorAll('.pqi__content h2, .pqi__content p, .pqi__control-label, .pqi__control-state, .pqi__progress, .pqi__guidance .kiosk-tooltip__text')];
        const dials = [...root.querySelectorAll('.pqi__dial')];
        return {
          textFits: text.every(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1),
          readable: text.every(e => parseFloat(getComputedStyle(e).fontSize) >= (e.closest('.pqi__content') || e.matches('.pqi__progress') ? 16 : 14)),
          horizontalOverflow: experience.scrollWidth > experience.clientWidth + 1,
          boardFits: board.left >= frame.left - 1 && board.right <= frame.right + 1 &&
            board.top >= frame.top - 1 && board.bottom <= frame.bottom + 1 &&
            Math.abs(board.left + board.width / 2 - frame.left - frame.width / 2) <= 1 &&
            Math.abs(board.top + board.height / 2 - frame.top - frame.height / 2) <= 1 &&
            (Math.abs(board.width - frame.width) <= 1 || Math.abs(board.height - frame.height) <= 1),
          dialFits: dials.every(e => {
            const box = e.getBoundingClientRect();
            const control = e.closest('.pqi__control').getBoundingClientRect();
            return box.width >= 44 && Math.abs(box.width - box.height) < 1 &&
              box.left >= control.left - 1 && box.right <= control.right + 1;
          }),
          mediaRegistered: !video ||
            (Math.abs(video.width - 2160 * scale) <= 1 &&
             Math.abs(scene.left - video.left + 120 * scale) <= 1 &&
             Math.abs(scene.top - video.top + 930 * scale) <= 1 &&
             Math.abs(scene.width - video.width - 240 * scale) <= 1 &&
             Math.abs(scene.height - video.height - 1860 * scale) <= 1),
          complete: root.dataset.complete,
          visual: root.dataset.pqiVisual || 'scene',
          videoStages: root.querySelectorAll('.pqi__video-stage').length,
          text: text.map(e => ({ text: e.textContent, width: e.clientWidth, scroll: e.scrollWidth, height: e.clientHeight, scrollHeight: e.scrollHeight })),
          frame: frame.toJSON(), board: board.toJSON()
        };
      };
    })()`)
    for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
      await resize(width, height)
      for (const id of ['temperature', 'voltage', 'magnetic']) {
        await run(`document.querySelector('[data-pqi-dial="${id}"]').focus()`)
        await settle()
        const sample = await ready()
        assert(sample.textFits && sample.readable && !sample.horizontalOverflow && sample.dialFits && sample.boardFits && sample.mediaRegistered,
          `${visual} ${id} ${width}x${height}: ${JSON.stringify(sample)}`)
      }
      console.log(`${visual} at ${width}x${height}: fits`)
    }
    const treatment = await run('sampleLayout()')
    assert.equal(treatment.visual, visual, 'the requested visual must not silently fall back')
    if (visual === 'video') assert.equal(treatment.videoStages, 2)
    await resize(320, 568)
    await run(`for (const [id, steps] of [['temperature', 38], ['voltage', 23], ['magnetic', 20]]) {
      dialKey(id, 'Home');
      for (let i = 0; i < steps; i++) dialKey(id, 'ArrowRight');
    }`)
    await settle()
    assert.equal((await run('sampleLayout()')).complete, 'true')
    const complete = await ready()
    assert(complete.textFits && complete.readable && complete.mediaRegistered, JSON.stringify(complete))
    await run("dialKey('voltage', 'End')")
    assert.equal((await run('sampleLayout()')).complete, 'false')
    await run("document.querySelector('[data-pqi-action=\"restart\"]').click()")
    await settle()
    assert(await run("[...document.querySelectorAll('.pqi__dial')].every(e => e.getAttribute('aria-valuenow') === '0')"))
    await run(`document.querySelector('[data-pqi-dial="temperature"]').scrollIntoView({ block: 'center' })`)
    await settle()
    const dial = await run("document.querySelector('[data-pqi-dial=\"temperature\"]').getBoundingClientRect().toJSON()")
    const cx = dial.left + dial.width / 2
    const cy = dial.top + dial.height / 2
    const r = dial.width * 0.32
    const touch = visual === 'video'
    if (touch) {
      await page.debugger.sendCommand('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: cx, y: cy - r, id: 1 }]
      })
    } else {
      page.sendInputEvent({ type: 'mouseDown', x: Math.round(cx), y: Math.round(cy - r), button: 'left', clickCount: 1 })
    }
    await settle()
    for (const degrees of [30, 60, 90]) {
      const angle = degrees * Math.PI / 180
      const x = Math.round(cx + Math.sin(angle) * r)
      const y = Math.round(cy - Math.cos(angle) * r)
      if (touch) {
        await page.debugger.sendCommand('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x, y, id: 1 }]
        })
      } else {
        page.sendInputEvent({ type: 'mouseMove', x, y })
      }
      await settle()
    }
    assert(await run("Number(document.querySelector('[data-pqi-dial=\"temperature\"]').getAttribute('aria-valuenow')) >= 20"), 'real pointer rotation follows the resized dial')
    await resize(568, 320)
    assert.equal(await run("document.querySelector('.pqi__dial').classList.contains('is-dragging')"), false, 'resize releases a captured dial')
    if (touch) {
      await page.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      page.sendInputEvent({ type: 'mouseUp', x: 100, y: 150, button: 'left', clickCount: 1 })
    }
    await settle()
    await run("document.querySelector('[data-pqi-action=\"exit\"]').click()")
    assert(await run('window.exited'))
    await run('abortProtection()')
    assert.equal(await run("document.querySelectorAll('.pqi__video-stage, .pqi__canvas').length"), 0)
    await run('disposeProtection()')
  }
  assert.deepEqual(errors, [])
  console.log('Protection layouts, video/scene registration, keyboard/pointer tuning, resize and disposal passed.')
}

Promise.race([main(), new Promise((_resolve, reject) => {
  timeout = setTimeout(() => reject(new Error('Protection layout check timed out')), 180_000)
})]).catch(error => {
  console.error(error)
  exitCode = 1
}).finally(async () => {
  clearTimeout(timeout)
  window?.destroy()
  await server?.close()
  app.exit(exitCode)
})

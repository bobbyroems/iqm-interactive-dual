const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..')
let server
let window
let exitCode = 0

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

async function main() {
  await app.whenReady()
  console.log('Preparing nanowire fixture...')
  const { createServer } = await import('vite')
  server = await createServer({
    root: path.join(root, 'src'),
    publicDir: path.join(root, 'public'),
    configFile: false,
    optimizeDeps: { exclude: ['three'] },
    plugins: [{
      name: 'nanowire-layout-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__nanowire-layout', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(`<!doctype html><html><head>
            <link rel="stylesheet" href="/styles/tokens.css">
            <link rel="stylesheet" href="/styles/base.css">
            <link rel="stylesheet" href="/styles/app.css">
            <link rel="stylesheet" href="/js/modules/build-nanowire/build-nanowire.css">
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
  page.on('console-message', ({ level, message }) => {
    if (/Uncaught|WebGL.*(?:ERROR|CONTEXT_LOST)/i.test(message)) errors.push(message)
    if (level >= 2) console.error(message)
  })
  await window.loadURL('about:blank')
  page.debugger.attach('1.3')
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  console.log('Loading nanowire fixture...')
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__nanowire-layout`)
  const run = source => page.executeJavaScript(source, true)
  console.log('Mounting nanowire scene...')
  await run(`(async () => {
    const { mount } = await import('/js/modules/build-nanowire/index.js');
    const controller = new AbortController();
    window.disposeNanowire = () => controller.abort();
    await mount(document.querySelector('#fixture'), { signal: controller.signal });
    await document.fonts.ready;
    window.layoutSample = () => {
      const root = document.querySelector('.nw');
      const experience = root.querySelector('.nw__experience');
      const workspace = root.querySelector('.nw__workspace');
      const prompt = root.querySelector('.nw__prompt');
      const hint = root.querySelector('.nw__instruction');
      const media = prompt.querySelector('.kiosk-explainer__media');
      const copy = prompt.querySelector('.kiosk-explainer__copy');
      const guidance = root.querySelector('.nw__guidance');
      const guidanceScale = Number(getComputedStyle(guidance).zoom);
      const box = workspace.getBoundingClientRect();
      const text = [...prompt.querySelectorAll('.kiosk-explainer__title, .kiosk-explainer__body, .kiosk-explainer__footer')].filter(e => !e.hidden);
      const fits = e => {
        const r = e.getBoundingClientRect();
        return r.left >= -1 && r.right <= innerWidth + 1 &&
          e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1;
      };
      return {
        phase: root.dataset.phase,
        guidanceScale: getComputedStyle(root.querySelector('.nw__guidance')).zoom,
        guidanceHeight: guidance.getBoundingClientRect().height,
        guidanceBox: guidance.getBoundingClientRect().toJSON(),
        guidanceDimensions: [guidance.scrollWidth, guidance.clientWidth, guidance.scrollHeight, guidance.clientHeight],
        contentBoxes: [...text, ...(!media.hidden ? [media] : []), ...(!hint.hidden ? [hint] : [])].map(e => e.getBoundingClientRect().toJSON()),
        guidanceFits: guidance.scrollWidth <= guidance.clientWidth + 1 &&
          [...text, ...(!media.hidden ? [media] : []), ...(!hint.hidden ? [hint] : [])].every(e => {
            const r = e.getBoundingClientRect();
            const bounds = guidance.getBoundingClientRect();
            return r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1;
          }),
        noInternalScroll: getComputedStyle(guidance).overflowY === 'clip',
        copyToRight: media.hidden || copy.getBoundingClientRect().left >= media.getBoundingClientRect().right - 1,
        mediaLeftAligned: media.hidden || Math.abs(media.getBoundingClientRect().left -
          prompt.getBoundingClientRect().left - parseFloat(getComputedStyle(prompt).paddingLeft) * guidanceScale) <= 1,
        viewport: [innerWidth, innerHeight],
        text: text.map(e => ({ width: e.clientWidth, scroll: e.scrollWidth, font: getComputedStyle(e).fontSize })),
        textFits: text.every(fits),
        hintFits: hint.hidden || fits(hint),
        readable: text.every(e => parseFloat(getComputedStyle(e).fontSize) >= 18.4),
        workspaceWidth: box.width, workspaceHeight: box.height,
        separated: guidance.getBoundingClientRect().bottom <= box.top + 1,
        noHorizontalScroll: experience.scrollWidth <= experience.clientWidth + 1,
        lens: root.querySelector('.nw__loupe').getBoundingClientRect().toJSON(),
        glass: root.querySelector('.nw__loupe-glass').getBoundingClientRect().toJSON(),
        canvasWidth: root.querySelector('.nw__canvas').clientWidth,
        workspace: box.toJSON()
      };
    };
  })()`)
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const resize = async (width, height) => {
    window.setContentSize(width, height)
    await run(`new Promise(resolve => {
      const check = () => innerWidth === ${width} && innerHeight === ${height}
        ? resolve() : setTimeout(check, 30);
      check();
    })`)
    await settle()
  }
  const waitForPhase = phase => run(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 15000;
    const check = () => {
      const phase = document.querySelector('.nw').dataset.phase;
      if (phase === ${JSON.stringify(phase)}) resolve();
      else if (performance.now() > deadline) reject(new Error('Waiting for ${phase}, got ' + phase));
      else setTimeout(check, 30);
    };
    check();
  })`)
  const viewports = [[320, 568], [568, 320], [768, 1024], [1440, 900], [1920, 1080], [2160, 3840]]
  const checkLayouts = async label => {
    for (const [width, height] of viewports) {
      await resize(width, height)
      const sample = await run('layoutSample()')
      const context = `${label} ${width}x${height}: ${JSON.stringify(sample)}`
      assert.equal(Number(sample.guidanceScale), 0.5, context)
      assert(sample.guidanceHeight <= 201 && sample.copyToRight, context)
      assert(sample.guidanceFits && sample.noInternalScroll, context)
      assert(sample.mediaLeftAligned, context)
      assert(sample.textFits && sample.hintFits && sample.readable, context)
      assert(sample.separated && sample.noHorizontalScroll, context)
      assert(sample.workspaceHeight >= 280 && sample.workspaceWidth <= width && sample.workspaceWidth >= width - 20, context)
      assert.equal(sample.canvasWidth, sample.workspaceWidth, context)
      console.log(`${label} ${width}x${height}: fits`)
    }
  }
  await checkLayouts('intro')
  await run("document.querySelector('[data-nw-action=\"start\"]').click()")
  await waitForPhase('ready')
  await checkLayouts('microscope')
  await resize(320, 568)
  await run(`document.querySelector('.nw__workspace').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
  await waitForPhase('inspect')
  await checkLayouts('inspection')
  await resize(320, 568)
  const before = await run('layoutSample()')
  assert(before.lens.left >= -1 && before.lens.right <= 321)
  assert(before.lens.top >= before.workspace.top - 1 && before.lens.bottom <= before.workspace.bottom + 1)
  await run(`(async () => {
    const loupe = document.querySelector('.nw__loupe');
    for (let i = 0; i < 100 && document.querySelector('.nw').dataset.phase === 'inspect'; i++) {
      const key = i < 30 ? 'ArrowLeft' : i < 60 ? 'ArrowDown' : 'ArrowRight';
      loupe.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  })()`)
  await waitForPhase('complete')
  await checkLayouts('finale')
  await resize(320, 568)
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  })
  await run(`document.querySelector('[data-nw-action="restart"]').click()`)
  await waitForPhase('awaitingStart')
  await run(`document.querySelector('[data-nw-action="start"]').click()`)
  await waitForPhase('ready')
  const scrollToScene = async () => {
    await run("document.querySelector('.nw__experience').scrollTop = document.querySelector('.nw__experience').scrollHeight")
    await settle()
    return run('layoutSample()')
  }
  const swipe = await scrollToScene()
  const swipeX = Math.round(swipe.workspaceWidth / 2)
  const swipeY = Math.round(swipe.workspace.top + 40)
  page.sendInputEvent({ type: 'mouseDown', x: swipeX, y: swipeY, button: 'left', clickCount: 1 })
  page.sendInputEvent({ type: 'mouseMove', x: swipeX, y: swipeY + 60 })
  page.sendInputEvent({ type: 'mouseUp', x: swipeX, y: swipeY + 60, button: 'left', clickCount: 1 })
  await waitForPhase('inspect')
  let sample = await scrollToScene()
  const grabLens = () => {
    const x = Math.round(sample.lens.x + sample.lens.width / 2)
    const y = Math.round(sample.lens.y + sample.lens.height / 2)
    page.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  }
  grabLens()
  await settle()
  assert(await run("document.querySelector('.nw__loupe').classList.contains('is-dragging')"), JSON.stringify(sample))
  await resize(768, 1024)
  assert(!await run("document.querySelector('.nw__loupe').classList.contains('is-dragging')"))
  page.sendInputEvent({ type: 'mouseUp', x: 150, y: 500, button: 'left', clickCount: 1 })
  await resize(320, 568)
  sample = await scrollToScene()
  grabLens()
  await settle()
  const centerX = Math.round(sample.workspaceWidth / 2)
  const centerY = Math.round(sample.workspace.top + sample.workspaceHeight * 0.6)
  page.sendInputEvent({ type: 'mouseMove', x: centerX, y: centerY })
  await settle()
  for (let y = 90; y < sample.workspaceHeight - 45; y += 30) {
    for (let x = 50; x < sample.workspaceWidth - 45; x += 30) {
      if (await run("document.querySelector('.nw').dataset.phase !== 'inspect'")) break
      page.sendInputEvent({ type: 'mouseMove', x, y: Math.round(sample.workspace.top + y) })
      await settle()
    }
    if (await run("document.querySelector('.nw').dataset.phase !== 'inspect'")) break
  }
  page.sendInputEvent({ type: 'mouseUp', x: centerX, y: centerY, button: 'left', clickCount: 1 })
  await resize(568, 320)
  await waitForPhase('complete')
  console.log('Pointer swipe, magnifier drag, resize during capture/lock and animated restart passed.')
  await run('disposeNanowire()')
  assert.equal(await run("document.querySelectorAll('.nw canvas').length"), 0)
  assert.deepEqual(errors, [])
  console.log('Nanowire responsive layouts, keyboard flow, resize and disposal passed.')
}

let timeout
Promise.race([
  main(),
  new Promise((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Nanowire layout check timed out')), 120_000)
  })
]).catch(error => {
  console.error(error)
  exitCode = 1
}).finally(async () => {
  clearTimeout(timeout)
  window?.destroy()
  await server?.close()
  app.exit(exitCode)
})

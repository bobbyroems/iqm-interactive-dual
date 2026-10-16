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
      name: 'nanoscale-layout-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__nanoscale-layout', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(`<!doctype html><html><head>
            <link rel="stylesheet" href="/styles/tokens.css">
            <link rel="stylesheet" href="/styles/base.css">
            <link rel="stylesheet" href="/styles/app.css">
            <link rel="stylesheet" href="/js/modules/nanoscale/nanoscale.css">
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
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__nanoscale-layout`)
  const run = source => page.executeJavaScript(source, true)
  console.log('Mounting nanoscale and warming registered textures...')
  await run(`(async () => {
    const { mount } = await import('/js/modules/nanoscale/index.js');
    const { nanoscaleLayoutAt } = await import('/js/modules/nanoscale/nanoscale-layout.js');
    const { setUpNextCardsEnabled } = await import('/js/core/kiosk-settings.js');
    // Keep the timed outro modal from interrupting the viewport matrix.
    setUpNextCardsEnabled(false);
    const controller = new AbortController();
    window.abortNanoscale = () => controller.abort();
    window.nanoscale = await mount(document.querySelector('#fixture'), {
      signal: controller.signal, navigate: { menu: () => window.exited = true }
    });
    await nanoscale.presentationReady();
    await document.fonts.ready;
    window.pointerReleases = 0;
    document.querySelector('.nz').addEventListener('pointerup', () => pointerReleases++);
    window.scenePoint = () => {
      for (let y = innerHeight - 40; y > 100; y -= 20) {
        for (const x of [innerWidth / 2, innerWidth / 4]) {
          if ([x - 90, x, x + 90].every(px =>
            document.elementFromPoint(px, y)?.closest('[data-nz-visual]'))) {
            return { x: Math.round(x), y: Math.round(y) };
          }
        }
      }
      throw new Error('No exposed artwork area for a gesture');
    };
    window.key = key => document.querySelector('.nz').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    window.sampleLayout = () => {
      const root = document.querySelector('.nz');
      const stop = Number(root.dataset.stop);
      const visual = root.querySelector('.nz__visual');
      const body = root.querySelector('.nz__body');
      const board = root.querySelector('.nz__board');
      const media = root.querySelector('.nz__comparison-media-frame');
      const stack = root.querySelector('.nz__comparison-media-stack');
      const panel = stop === 0 ? root.querySelector('.nz__intro') : stop === 6
        ? root.querySelector('.nz__finale-section') : root.querySelector('.nz__identity');
      const text = [...panel.querySelectorAll('h2, h3, p, .kiosk-explainer__subtitle')].filter(e => !e.hidden);
      if (stop > 0 && stop < 6) text.push(...root.querySelector('.nz__comparison-footer').children);
      if (stop === 6) text.push(...panel.querySelectorAll('.nz__finale-scale-label'));
      const fits = e => {
        const box = e.getBoundingClientRect();
        const owner = (e.closest('.nz__comparison-footer') || panel).getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1 &&
          box.left >= owner.left - 1 && box.right <= owner.right + 1 &&
          e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1;
      };
      const box = board.getBoundingClientRect();
      const frame = visual.getBoundingClientRect();
      const dimension = root.querySelector('.nz__dimension-label').getBoundingClientRect();
      const annotation = stop > 0 && stop < 6 ? nanoscaleLayoutAt(stop - 1).annotation : null;
      const scale = box.width / 2160;
      const finale = root.querySelector('.nz__finale');
      const controls = root.querySelector('.nz__controls').getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      const marker = root.querySelector('.nz__scrubber-marker').getBoundingClientRect();
      const tick = root.querySelectorAll('.nz__tick')[Math.max(0, Math.min(stop - 1, 4))].getBoundingClientRect();
      return {
        stop, viewport: [innerWidth, innerHeight],
        classes: root.className,
        panelState: { hidden: panel.hidden, className: panel.className, ariaHidden: panel.getAttribute('aria-hidden') },
        settled: root.classList.contains('is-settled') &&
          panel.getAttribute('aria-hidden') !== 'true' && panel.getBoundingClientRect().width > 0 &&
          (stop === 0 || stop === 6 || root.classList.contains('is-measurement')),
        textFits: text.every(fits),
        readable: text.every(e => parseFloat(getComputedStyle(e).fontSize) >=
          (e.matches('.nz__finale-scale-label') || e.closest('.nz__comparison-footer') ? 14 : 16)),
        horizontalOverflow: body.scrollWidth > body.clientWidth + 1 ||
          (stop === 6 && finale.scrollWidth > finale.clientWidth + 1),
        controlsPinned: stop === 0 || stop === 6 ||
          (Math.abs(controls.bottom - rootBox.bottom) <= 1 && controls.top >= rootBox.top &&
           controls.left >= rootBox.left - 1 && controls.right <= rootBox.right + 1 &&
           body.getBoundingClientRect().bottom <= controls.top + 1),
        annotationRegistered: !annotation ||
          (Math.abs(dimension.left + dimension.width / 2 - box.left - (annotation.from.x + annotation.to.x) / 2 * scale) <= 1 &&
           Math.abs(dimension.top + dimension.height / 2 - box.top - (annotation.from.y + annotation.to.y) / 2 * scale) <= 1),
        boardCovers: box.left <= frame.left + 1 && box.right >= frame.right - 1 &&
          box.top <= frame.top + 1 && box.bottom >= frame.bottom - 1 &&
          Math.abs(frame.width - root.clientWidth) <= 1 && Math.abs(frame.height - root.clientHeight) <= 1,
        board: box.toJSON(),
        boardStyle: { inline: board.style.cssText, computed: getComputedStyle(board).transform, height: getComputedStyle(board).height },
        markerError: Math.abs((marker.left + marker.width / 2) - (tick.left + tick.width / 2)),
        mediaWidth: media.clientWidth,
        stackWidth: stack?.getBoundingClientRect().width,
        visual: frame.toJSON(),
        panel: panel.getBoundingClientRect().toJSON(),
        text: text.map(e => ({ text: e.textContent, width: e.clientWidth, scroll: e.scrollWidth, size: getComputedStyle(e).fontSize }))
      };
    };
  })()`)
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
  const resize = async (width, height) => {
    window.setContentSize(width, height)
    await run(`new Promise(resolve => {
      const check = () => innerWidth === ${width} && innerHeight === ${height}
        ? resolve() : setTimeout(check, 20);
      check();
    })`)
    await settle()
    await run(`document.querySelector('.nz__visual').scrollIntoView({ block: 'nearest' })`)
    await settle()
  }
  const key = async value => {
    await run(`key(${JSON.stringify(value)})`)
    await settle()
  }
  const mouseUp = async (x, y) => {
    const { previous, width, height } = await run('({ previous: pointerReleases, width: innerWidth, height: innerHeight })')
    page.sendInputEvent({
      type: 'mouseUp', x: Math.min(x, width - 1), y: Math.min(y, height - 1),
      button: 'left', clickCount: 1
    })
    await run(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const check = () => {
        if (pointerReleases > ${previous}) resolve();
        else if (performance.now() > deadline) reject(new Error('Mouse release was not delivered'));
        else setTimeout(check, 20);
      };
      check();
    })`)
    await settle()
  }
  const ready = expectedStop => run(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 10000;
    const check = () => {
      const sample = sampleLayout();
      const mediaReady = sample.stop === 0 || sample.stop === 6 ||
        Math.abs(sample.mediaWidth - sample.stackWidth) <= 1;
      if (sample.stop === ${expectedStop} && sample.settled && sample.boardCovers && mediaReady) resolve();
      else if (performance.now() > deadline) reject(new Error('Presentation did not settle at stop ${expectedStop}: ' + JSON.stringify(sample)));
      else setTimeout(check, 30);
    };
    check();
  })`)
  for (let stop = 0; stop <= 6; stop++) {
    if (stop) await key('ArrowRight')
    for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
      await resize(width, height)
      await ready(stop)
      const sample = await run('sampleLayout()')
      const label = `stop ${stop} at ${width}x${height}`
      const context = `${label}: ${JSON.stringify(sample)}`
      assert.equal(sample.stop, stop, context)
      assert(sample.textFits && sample.readable && !sample.horizontalOverflow && sample.boardCovers, context)
      if (stop > 0 && stop < 6) {
        assert(sample.controlsPinned, context)
        assert(await run(`(() => {
          const body = document.querySelector('.nz__body');
          body.scrollTop = body.scrollHeight;
          return sampleLayout().controlsPinned &&
            document.querySelector('.nz__details').getBoundingClientRect().bottom <=
            document.querySelector('.nz__controls').getBoundingClientRect().top + 1;
        })()`), 'controls remain pinned and content clears them when scrolled')
        assert(sample.annotationRegistered, context)
        assert(sample.markerError <= 1.1, context)
        assert(Math.abs(sample.mediaWidth - sample.stackWidth) <= 1, context)
      }
      console.log(`${label}: fits`)
    }
  }
  assert.equal(await run("document.querySelector('.nz__finale-count-value').textContent"), '1,000,000')
  await resize(320, 568)
  await key('Home')
  await ready(0)
  await run(`document.querySelector('.nz__body').scrollTop = document.querySelector('.nz__visual').offsetTop`)
  await settle()
  const { x, y } = await run('scenePoint()')
  page.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  page.sendInputEvent({ type: 'mouseMove', x, y: y - 200 })
  await settle()
  await mouseUp(x, y - 200)
  assert.equal(await run("document.querySelector('.nz').dataset.stop"), '1')
  const ignored = await run(`(() => {
    const e = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    document.querySelector('.nz__identity').dispatchEvent(e);
    return !e.defaultPrevented && document.querySelector('.nz').dataset.stop === '1';
  })()`)
  assert(ignored, 'copy remains scrollable rather than hijacking the zoom')
  await run(`document.querySelector('.nz__visual').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`)
  await settle()
  assert.equal(await run("document.querySelector('.nz').dataset.stop"), '2')
  await run(`document.querySelector('[data-nz-action="restart"]').click()`)
  await settle()
  assert.equal(await run("document.querySelector('.nz').dataset.stop"), '0')
  await ready(0)
  await resize(768, 1024)
  const { x: centerX, y: centerY } = await run('scenePoint()')
  const touches = distance => [
    { x: centerX - distance / 2, y: centerY, id: 1 },
    { x: centerX + distance / 2, y: centerY, id: 2 }
  ]
  await page.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(80) })
  await page.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(180) })
  await page.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await ready(1)
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  })
  await key('Home')
  await ready(0)
  for (let stop = 1; stop <= 6; stop++) {
    await key('ArrowRight')
    await ready(stop)
    for (const [width, height] of [[320, 568], [568, 320], [1440, 900]]) {
      await resize(width, height)
      await ready(stop)
      const sample = await run('sampleLayout()')
      assert(sample.textFits && sample.readable && !sample.horizontalOverflow && sample.controlsPinned, JSON.stringify(sample))
    }
  }
  await resize(320, 568)
  const finaleScrolls = await run(`(() => {
    const finale = document.querySelector('.nz__finale');
    finale.scrollTop = 100;
    return finale.scrollHeight > finale.clientHeight && finale.scrollTop > 0;
  })()`)
  assert(finaleScrolls, 'finale copy remains readable by scrolling on a short viewport')
  await key('ArrowLeft')
  await ready(5)
  await resize(2160, 3840)
  const { x: lastX, y: lastY } = await run('scenePoint()')
  page.sendInputEvent({ type: 'mouseDown', x: lastX, y: lastY, button: 'left', clickCount: 1 })
  page.sendInputEvent({ type: 'mouseMove', x: lastX, y: lastY - 50 })
  await settle()
  assert(await run("document.querySelector('.nz').classList.contains('is-zooming')"), 'hiding identity and the final scroll cue does not cancel a live gesture')
  await mouseUp(lastX, lastY - 50)
  await key('Home')
  await ready(0)
  await resize(768, 1024)
  const { x: heldX, y: heldY } = await run('scenePoint()')
  page.sendInputEvent({ type: 'mouseDown', x: heldX, y: heldY, button: 'left', clickCount: 1 })
  page.sendInputEvent({ type: 'mouseMove', x: heldX, y: heldY - 50 })
  await settle()
  assert(await run("document.querySelector('.nz').classList.contains('is-zooming')"), 'hiding guidance does not cancel a live gesture')
  await resize(1024, 768)
  assert.equal(await run("document.querySelector('.nz').classList.contains('is-zooming')"), false, 'resize releases the active gesture')
  await mouseUp(heldX, heldY - 50)
  await key('Home')
  await ready(0)
  await run(`document.querySelector('[data-nz-action="exit"]').click()`)
  assert(await run('window.exited'))
  await run('abortNanoscale()')
  assert.equal(await run("document.querySelectorAll('.nz').length"), 0)
  assert.deepEqual(errors, [])
  console.log('Nanoscale viewport layouts, registered artwork, timeline, pointer/wheel flow and disposal passed.')
}

Promise.race([main(), new Promise((_resolve, reject) => {
  timeout = setTimeout(() => reject(new Error('Nanoscale layout check timed out')), 120_000)
})]).catch(error => {
  console.error(error)
  exitCode = 1
}).finally(async () => {
  clearTimeout(timeout)
  window?.destroy()
  await server?.close()
  app.exit(exitCode)
})

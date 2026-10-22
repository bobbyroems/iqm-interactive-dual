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
      name: 'majorana-layout-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__majorana-layout', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(`<!doctype html><html><head>
            <link rel="stylesheet" href="/styles/tokens.css">
            <link rel="stylesheet" href="/styles/base.css">
            <link rel="stylesheet" href="/styles/app.css">
            <link rel="stylesheet" href="/js/modules/build-majorana-2/majorana.css">
            </head><body><div id="kiosk-stage" style="position:absolute;inset:0">
            <main id="fixture" style="position:absolute;inset:0"></main>
            </div></body></html>`)
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
  await page.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  const run = source => page.executeJavaScript(source, true)
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const waitFor = expression => run(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 45000;
    const check = () => {
      if (${expression}) resolve();
      else if (performance.now() > deadline) reject(new Error('Majorana check did not settle: ' + ${JSON.stringify(expression)} +
        (typeof sampleBuildLayout === 'function' && document.querySelector('[data-majorana-root]')?.dataset.currentView === 'build'
          ? ': ' + JSON.stringify(sampleBuildLayout()) : '')));
      else setTimeout(check, 30);
    };
    check();
  })`)
  const resize = async (width, height) => {
    window.setContentSize(width, height)
    await waitFor(`innerWidth === ${width} && innerHeight === ${height}`)
    await settle()
    if (await run(`typeof sampleBuildLayout === 'function' &&
      document.querySelector('[data-majorana-root]')?.dataset.currentView === 'build'`)) {
      await waitFor('sampleBuildLayout().artworkFits && sampleBuildLayout().labelsReadable')
    }
    if (await run(`typeof samplePathwaysLayout === 'function' &&
      document.querySelector('[data-majorana-root]')?.dataset.currentView === 'pathways'`)) {
      await waitFor('samplePathwaysLayout().artworkFits')
    }
    if (await run(`typeof sampleComponentsLayout === 'function' &&
      document.querySelector('[data-majorana-root]')?.dataset.currentView === 'components'`)) {
      await waitFor('sampleComponentsLayout().artworkFits')
    }
  }
  const centerOf = selector => run(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`)
  const touch = async (type, point) => {
    await page.debugger.sendCommand('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [{ ...point, id: 1 }] : []
    })
    await settle()
  }
  const enterComponents = async () => {
    await run(`document.querySelector('[data-majorana-action="start"]').click()`)
    await waitFor("document.querySelector('[data-majorana-root]').dataset.componentsPhase === 'focus'")
    await settle()
  }
  const enterPathways = async () => {
    await run(`document.querySelector('[data-majorana-action="next-pathways"]').click()`)
    await waitFor(`document.querySelector('[data-majorana-root]').dataset.currentView === 'pathways' &&
      !document.querySelector('[data-majorana-root]').classList.contains('is-section-transitioning')`)
    await settle()
  }
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__majorana-layout`)
  await run(`(async () => {
    const { mount } = await import('/js/modules/build-majorana-2/index.js');
    const { getModule } = await import('/js/modules/module-registry.js');
    const { setUpNextCardsEnabled } = await import('/js/core/kiosk-settings.js');
    setUpNextCardsEnabled(false);
    window.mountMajorana = options => mount(document.querySelector('#fixture'), {
      module: getModule('build-majorana-2'),
      navigate: { menu: () => window.exited = true },
      ...options
    });
    window.startScene = new Promise(resolve => window.releaseScene = resolve);
    window.lifecycle = new AbortController();
    window.disposeMajorana = mountMajorana({ sceneStartPromise: startScene, signal: lifecycle.signal });
    await document.fonts.ready;
    window.sampleLayout = () => {
      const root = document.querySelector('[data-majorana-root]');
      const intro = root.querySelector('.majorana-intro');
      const header = root.querySelector('.majorana-module__header');
      const button = root.querySelector('[data-majorana-action="start"]');
      const scene = root.querySelector('[data-model-slot="intro"]');
      const frame = intro.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const sceneBox = scene.getBoundingClientRect();
      const canvas = scene.querySelector('canvas');
      const inside = (a, b) => a.left >= b.left - 1 && a.top >= b.top - 1 &&
        a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
      const actions = [...header.querySelectorAll('button')];
      return {
        horizontalOverflow: intro.scrollWidth > intro.clientWidth + 1 ||
          header.scrollWidth > header.clientWidth + 1,
        buttonFits: buttonBox.width >= 44 && buttonBox.height >= 44 &&
          button.scrollWidth <= button.clientWidth + 1 &&
          inside(buttonBox, frame),
        readable: parseFloat(getComputedStyle(button).fontSize) >= 16,
        artFits: sceneBox.width > 0 && sceneBox.height > 0 &&
          sceneBox.left >= frame.left - 1 && sceneBox.right <= frame.right + 1 &&
          sceneBox.top + intro.scrollTop >= frame.top - 1 &&
          sceneBox.bottom + intro.scrollTop <= frame.top + intro.scrollHeight + 1 &&
          sceneBox.bottom <= buttonBox.top + 1,
        sceneAspect: sceneBox.width / sceneBox.height,
        canvasFits: canvas && inside(canvas.getBoundingClientRect(), sceneBox) &&
          Math.abs(canvas.clientWidth - scene.clientWidth) <= 1 &&
          Math.abs(canvas.clientHeight - scene.clientHeight) <= 1,
        headerFits: actions.every(action => {
          const box = action.getBoundingClientRect();
          return box.width >= 44 && box.height >= 44 &&
            inside(box, header.getBoundingClientRect()) &&
            Boolean(action.getAttribute('aria-label'));
        }),
        bandAligned: Math.abs(root.querySelector('.kiosk-module-band')
          .getBoundingClientRect().top - header.getBoundingClientRect().bottom) <= 1,
        view: root.dataset.currentView,
        scene: sceneBox.toJSON(), button: buttonBox.toJSON(), frame: frame.toJSON()
      };
    };
    window.sampleComponentsLayout = () => {
      const root = document.querySelector('[data-majorana-root]');
      const section = root.querySelector('.majorana-components');
      const frame = section.getBoundingClientRect();
      const workspace = root.querySelector('.majorana-components__schematic').getBoundingClientRect();
      const art = root.querySelector('.majorana-components__artwork').getBoundingClientRect();
      const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 &&
        a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
      const buttons = [...root.querySelectorAll('[data-majorana-component-inspect]')];
      const text = [...section.querySelectorAll('.kiosk-explainer__title, .kiosk-explainer__body, .majorana-components__instruction')];
      const continueButton = root.querySelector('[data-majorana-action="next-pathways"]');
      const reachable = e => {
        const box = e.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44 &&
          box.left >= frame.left - 1 && box.right <= frame.right + 1 &&
          box.top + section.scrollTop >= frame.top - 1 &&
          box.bottom + section.scrollTop <= frame.top + section.scrollHeight + 1;
      };
      return {
        horizontalOverflow: section.scrollWidth > section.clientWidth + 1,
        artworkFits: art.width > 0 && inside(art, workspace) &&
          Math.abs(art.left + art.width / 2 - workspace.left - workspace.width / 2) <= 1 &&
          Math.abs(art.top + art.height / 2 - workspace.top - workspace.height / 2) <= 1,
        readable: text.every(e => parseFloat(getComputedStyle(e).fontSize) >= 16 &&
          e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1),
        targetsReachable: buttons.every(reachable) && !continueButton.hidden && reachable(continueButton),
        modelsFit: buttons.every(button => {
          const host = button.querySelector('[data-majorana-component-model]');
          const canvas = host.querySelector('canvas');
          return canvas && inside(host.getBoundingClientRect(), button.closest('.majorana-components__part').getBoundingClientRect()) &&
            inside(canvas.getBoundingClientRect(), host.getBoundingClientRect());
        }),
        phase: root.dataset.componentsPhase,
        art: art.toJSON(), workspace: workspace.toJSON(), frame: frame.toJSON(),
        models: buttons.map(button => ({
          button: button.getBoundingClientRect().toJSON(),
          host: button.querySelector('[data-majorana-component-model]').getBoundingClientRect().toJSON(),
          canvas: button.querySelector('canvas')?.getBoundingClientRect().toJSON(),
          part: button.closest('.majorana-components__part').getBoundingClientRect().toJSON(),
          transform: getComputedStyle(button).transform
        })),
        text: text.map(e => ({ text: e.textContent, width: e.clientWidth, scrollWidth: e.scrollWidth,
          height: e.clientHeight, scrollHeight: e.scrollHeight, font: getComputedStyle(e).fontSize }))
      };
    };
    window.samplePathwaysLayout = () => {
      const root = document.querySelector('[data-majorana-root]');
      const section = root.querySelector('.majorana-pathways');
      const workspace = root.querySelector('.majorana-pathways__workspace').getBoundingClientRect();
      const art = root.querySelector('.majorana-pathways__artwork').getBoundingClientRect();
      const scale = art.width / 2160;
      const model = root.querySelector('[data-model-slot="pathways"]').getBoundingClientRect();
      const text = [...section.querySelectorAll('.kiosk-explainer__title, .kiosk-explainer__body, [data-pathway-key]')];
      const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 &&
        a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
      const button = root.querySelector('[data-majorana-action="next-build"]');
      const buttonBox = button.getBoundingClientRect();
      const key = [...root.querySelectorAll('[data-pathway-key]')];
      const badges = [...root.querySelectorAll('[data-pathway-label]')];
      return {
        horizontalOverflow: section.scrollWidth > section.clientWidth + 1,
        artworkFits: art.width > 0 && inside(art, workspace) &&
          Math.abs(art.left + art.width / 2 - workspace.left - workspace.width / 2) <= 1 &&
          Math.abs(art.top + art.height / 2 - workspace.top - workspace.height / 2) <= 1,
        registered: inside(model, art) &&
          Math.abs(model.left - art.left - 130 * scale) <= 1 &&
          Math.abs(model.top - art.top - 993 * scale) <= 1 &&
          Math.abs(model.width - 1900 * scale) <= 1 &&
          Math.abs(model.height - 2006.246 * scale) <= 1 &&
          [...section.querySelectorAll('[data-pathway]')].every(e => inside(e.getBoundingClientRect(), art)),
        readable: text.every(e => parseFloat(getComputedStyle(e).fontSize) >= 16 &&
          e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1),
        labelsReadable: badges.every(e => {
          const title = e.querySelector('.majorana-pathway-tooltip__title');
          return parseFloat(getComputedStyle(title).fontSize) * scale >= 15.9 &&
            inside(e.getBoundingClientRect(), art);
        }) && [...section.querySelectorAll('figcaption')].every(e =>
          parseFloat(getComputedStyle(e).fontSize) * scale >= 13.9),
        keyMatches: key.length === 3 && badges.every(badge =>
          key.find(e => e.dataset.pathwayKey === badge.dataset.pathwayLabel)
            ?.querySelector('span').textContent === badge.textContent.trim()),
        ready: !button.hidden,
        controlsFit: !button.hidden && buttonBox.width >= 44 && buttonBox.height >= 44 &&
          button.scrollWidth <= button.clientWidth + 1 &&
          buttonBox.left >= 0 && buttonBox.right <= innerWidth + 1,
        copy: section.querySelector('.majorana-pathways__copy').getBoundingClientRect().toJSON(),
        art: art.toJSON(), workspace: workspace.toJSON(),
        text: text.map(e => ({
          text: e.textContent, width: e.clientWidth, scrollWidth: e.scrollWidth,
          height: e.clientHeight, scrollHeight: e.scrollHeight,
          fontSize: getComputedStyle(e).fontSize
        }))
      };
    };
    window.sampleBuildLayout = () => {
      const root = document.querySelector('[data-majorana-root]');
      const build = root.querySelector('.majorana-build');
      const workspace = root.querySelector('.majorana-build__workspace').getBoundingClientRect();
      const artwork = root.querySelector('.majorana-build__artwork').getBoundingClientRect();
      const scale = artwork.width / 2160;
      const cards = [...root.querySelectorAll('[data-build-part]')];
      const text = [...root.querySelectorAll('.majorana-build__content h2, .majorana-build__content .kiosk-explainer__body, .majorana-build__content .kiosk-tooltip__text')]
        .filter(e => e.getClientRects().length > 0);
      return {
        horizontalOverflow: build.scrollWidth > build.clientWidth + 1,
        artworkFits: artwork.left >= workspace.left - 1 && artwork.right <= workspace.right + 1 &&
          artwork.top >= workspace.top - 1 && artwork.bottom <= workspace.bottom + 1 &&
          Math.abs(artwork.left + artwork.width / 2 - workspace.left - workspace.width / 2) <= 1 &&
          (root.classList.contains('is-finale-complete')
            ? Math.abs(artwork.bottom - workspace.bottom) <= 1
            : Math.abs(artwork.top + artwork.height / 2 - workspace.top - workspace.height / 2) <= 1),
        readable: text.every(e => parseFloat(getComputedStyle(e).fontSize) >= 16 &&
          e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1),
        labelsReadable: [...root.querySelectorAll('.majorana-build-part__label, .majorana-build__placed-label')]
          .every(e => parseFloat(getComputedStyle(e).fontSize) * scale >= 13.9),
        targetsReachable: cards.filter(card => !card.disabled).every(card => {
          const box = card.getBoundingClientRect();
          return box.width >= 44 && box.height >= 44 &&
            box.left >= workspace.left - 1 && box.right <= workspace.right + 1 &&
            box.top >= workspace.top - 1 && box.bottom <= workspace.bottom + 1;
        }),
        seated: cards.filter(card => card.disabled).every(card => {
          const box = card.querySelector('.majorana-build-part__visual').getBoundingClientRect();
          const slot = root.querySelector('[data-build-slot="' + card.dataset.buildPart + '"]').getBoundingClientRect();
          return Math.abs(box.left + box.width / 2 - slot.left - slot.width / 2) <= 1 &&
            Math.abs(box.top + box.height / 2 - slot.top - slot.height / 2) <= 1 &&
            Math.abs(box.height - slot.height) <= 1;
        }),
        finaleFillsView: (() => {
          const frame = build.getBoundingClientRect();
          const style = getComputedStyle(build);
          return Math.abs(workspace.top - frame.top - parseFloat(style.paddingTop)) <= 1 &&
            Math.abs(workspace.bottom - frame.bottom + parseFloat(style.paddingBottom)) <= 1 &&
            Math.abs(workspace.left - frame.left - parseFloat(style.paddingLeft)) <= 1 &&
            Math.abs(workspace.right - frame.right + parseFloat(style.paddingRight)) <= 1 &&
            Math.abs(artwork.bottom - innerHeight + parseFloat(style.paddingBottom)) <= 1 &&
            Math.abs(artwork.width - Math.min(workspace.width, workspace.height * 2160 / 3000)) <= 1 &&
            build.scrollHeight <= build.clientHeight + 1 && build.scrollTop === 0;
        })(),
        phase: root.dataset.buildPhase, workspace: workspace.toJSON(), artwork: artwork.toJSON(),
        labelScale: getComputedStyle(root.querySelector('.majorana-build__workspace')).getPropertyValue('--majorana-build-scale'),
        labels: [...root.querySelectorAll('.majorana-build-part__label, .majorana-build__placed-label')]
          .map(e => ({ text: e.textContent, font: getComputedStyle(e).fontSize, pixels: parseFloat(getComputedStyle(e).fontSize) * scale })),
        text: text.map(e => ({ text: e.textContent, width: e.clientWidth, scrollWidth: e.scrollWidth }))
      };
    };
  })()`)
  assert(await run("document.querySelector('[data-majorana-action=\"start\"]').disabled"), 'Start waits for the real scene')
  await run('releaseScene()')
  await waitFor("document.querySelector('[data-model-stage]').classList.contains('is-ready')")
  for (const motion of ['reduce', 'no-preference']) {
    await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: motion }]
    })
    for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
      await resize(width, height)
      await run(`document.querySelector('[data-majorana-action="start"]').scrollIntoView({ block: 'nearest' })`)
      await settle()
      const sample = await run('sampleLayout()')
      assert(!sample.horizontalOverflow && sample.buttonFits && sample.readable &&
        sample.artFits && sample.canvasFits && sample.headerFits && sample.bandAligned,
      `${motion} ${width}x${height}: ${JSON.stringify(sample)}`)
      assert(Math.abs(sample.sceneAspect - 1800 / 1952) < 0.002, 'the model keeps its authored aspect, not viewport aspect')
      console.log(`Majorana intro ${motion} ${width}x${height}: fits`)
    }
  }
  await resize(320, 568)
  await run(`document.documentElement.style.fontSize = '200%';
    document.querySelector('[data-majorana-action="start"]').scrollIntoView({ block: 'nearest' })`)
  await settle()
  const largeText = await run('sampleLayout()')
  assert(!largeText.horizontalOverflow && largeText.buttonFits && largeText.headerFits &&
    largeText.bandAligned && largeText.artFits, `200% text: ${JSON.stringify(largeText)}`)
  await run(`document.documentElement.style.fontSize = '';
    document.querySelector('[data-majorana-action="start"]').scrollIntoView({ block: 'nearest' })`)
  await settle()
  await run(`document.querySelector('[data-majorana-action="exit"]').focus()`)
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
  page.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
  await settle()
  assert(await run("document.activeElement.dataset.majoranaAction === 'start'"), 'Tab reaches Get started')
  assert(await run(`getComputedStyle(document.activeElement).outlineStyle !== 'none'`))
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  page.sendInputEvent({ type: 'char', keyCode: '\r' })
  page.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await waitFor("document.querySelector('[data-majorana-root]').dataset.currentView === 'components'")
  await run(`document.querySelector('[data-majorana-action="restart"]').click()`)
  await waitFor("document.querySelector('[data-majorana-root]').dataset.currentView === 'intro'")
  await settle()
  assert((await run('sampleLayout()')).canvasFits, 'Restart returns the live canvas to the fitted intro slot')
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await resize(1440, 900)
  await enterComponents()
  const checkComponents = async motion => {
    for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
      await resize(width, height)
      const sample = await run('sampleComponentsLayout()')
      assert(!sample.horizontalOverflow && sample.artworkFits && sample.readable &&
        sample.targetsReachable && sample.modelsFit,
      `Components ${motion} ${width}x${height}: ${JSON.stringify(sample)}`)
      console.log(`Majorana components ${motion} ${width}x${height}: fits`)
    }
  }
  await checkComponents('reduce')
  await resize(320, 568)
  await run("document.documentElement.style.fontSize = '200%'")
  await waitFor(`parseFloat(getComputedStyle(document.querySelector('.majorana-components .kiosk-explainer__body')).fontSize) >= 32`)
  await waitFor('sampleComponentsLayout().artworkFits')
  const largeComponentsText = await run('sampleComponentsLayout()')
  assert(!largeComponentsText.horizontalOverflow && largeComponentsText.readable &&
    largeComponentsText.targetsReachable && largeComponentsText.modelsFit,
  `Components 200% text: ${JSON.stringify(largeComponentsText)}`)
  await run("document.documentElement.style.fontSize = ''")
  await waitFor(`parseFloat(getComputedStyle(document.querySelector('.majorana-components .kiosk-explainer__body')).fontSize) < 32`)
  await run(`document.querySelector('[data-majorana-component-inspect="qpu-stack"]').scrollIntoView({ block: 'center' })`)
  await settle()
  const inspectionStart = await centerOf('[data-majorana-component-inspect="qpu-stack"]')
  await touch('touchStart', inspectionStart)
  await touch('touchMove', { x: inspectionStart.x + 40, y: inspectionStart.y + 15 })
  assert(await run(`(() => {
    const button = document.querySelector('[data-majorana-component-inspect="qpu-stack"]');
    return button.classList.contains('is-interacting') &&
      parseFloat(button.style.getPropertyValue('--inspect-rotate-y')) > 20 &&
      parseFloat(button.style.getPropertyValue('--inspect-rotate-x')) < 0;
  })()`), 'touch inspection rotates the component using its responsive width')
  await touch('touchEnd')
  assert.equal(await run("document.querySelector('[data-majorana-root]').dataset.currentView"), 'components',
    'inspecting a component no longer advances through a full-view tap target')
  await run(`document.querySelector('[data-majorana-component-inspect="cryo-cmos"]').scrollIntoView({ block: 'center' })`)
  await settle()
  const mouseInspection = await centerOf('[data-majorana-component-inspect="cryo-cmos"]')
  await page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...mouseInspection, button: 'left', buttons: 1, clickCount: 1
  })
  await page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: mouseInspection.x - 35, y: mouseInspection.y + 10, button: 'left', buttons: 1
  })
  await settle()
  assert(await run(`parseFloat(document.querySelector('[data-majorana-component-inspect="cryo-cmos"]')
    .style.getPropertyValue('--inspect-rotate-y')) < -15`), 'mouse inspection rotates Cryo-CMOS')
  await resize(568, 320)
  assert.equal(await run("document.querySelectorAll('.majorana-focus-component.is-interacting').length"), 0,
    'resizing releases an active inspection')
  await page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...mouseInspection, button: 'left', buttons: 0, clickCount: 1
  })
  await run(`document.querySelector('[data-majorana-action="next-pathways"]').focus()`)
  await settle()
  assert(await run(`document.activeElement.dataset.majoranaAction === 'next-pathways' &&
    getComputedStyle(document.activeElement).outlineStyle !== 'none'`), 'Components Continue remains keyboard accessible')
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  page.sendInputEvent({ type: 'char', keyCode: '\r' })
  page.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await waitFor(`document.querySelector('[data-majorana-root]').dataset.currentView === 'pathways' &&
    !document.querySelector('[data-majorana-root]').classList.contains('is-section-transitioning')`)
  await settle()
  await waitFor('samplePathwaysLayout().ready')
  await waitFor('samplePathwaysLayout().artworkFits && samplePathwaysLayout().labelsReadable')
  const checkPathways = async motion => {
    for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
      await resize(width, height)
      const sample = await run('samplePathwaysLayout()')
      assert(!sample.horizontalOverflow && sample.artworkFits && sample.registered &&
        sample.readable && sample.labelsReadable && sample.keyMatches && sample.controlsFit,
      `Pathways ${motion} ${width}x${height}: ${JSON.stringify(sample)}`)
      console.log(`Majorana pathways ${motion} ${width}x${height}: fits`)
    }
  }
  await checkPathways('reduce')
  assert(await run(`[...document.querySelectorAll('[data-pathway-pulse]')].every(e => e.hidden)`),
    'reduced motion shows the complete static pathways without looping pulses')
  await resize(320, 568)
  await run("document.documentElement.style.fontSize = '200%'")
  await settle()
  await waitFor(`parseFloat(getComputedStyle(document.querySelector('.majorana-pathways .kiosk-explainer__body')).fontSize) >= 32`)
  await waitFor('samplePathwaysLayout().artworkFits')
  const largePathwaysText = await run('samplePathwaysLayout()')
  assert(!largePathwaysText.horizontalOverflow && largePathwaysText.readable &&
    largePathwaysText.artworkFits && largePathwaysText.registered && largePathwaysText.controlsFit,
  `Pathways 200% text: ${JSON.stringify(largePathwaysText)}`)
  await run("document.documentElement.style.fontSize = ''")
  await settle()
  await waitFor(`parseFloat(getComputedStyle(document.querySelector('.majorana-pathways .kiosk-explainer__body')).fontSize) < 32`)
  await run(`document.querySelector('[data-majorana-action="next-build"]').focus()`)
  await settle()
  assert(await run(`document.activeElement.dataset.majoranaAction === 'next-build' &&
    getComputedStyle(document.activeElement).outlineStyle !== 'none'`), 'keyboard focus reaches the explicit Pathways Continue action')
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  page.sendInputEvent({ type: 'char', keyCode: '\r' })
  page.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await waitFor(`document.querySelector('[data-majorana-root]').dataset.currentView === 'build' &&
    !document.querySelector('[data-majorana-root]').classList.contains('is-section-transitioning')`)
  await settle()
  const checkBuild = async () => {
    for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
      await resize(width, height)
      await waitFor('sampleBuildLayout().artworkFits')
      const sample = await run('sampleBuildLayout()')
      assert(!sample.horizontalOverflow && sample.artworkFits && sample.readable &&
        sample.labelsReadable && sample.targetsReachable && sample.seated,
      `Build ${width}x${height}: ${JSON.stringify(sample)}`)
      console.log(`Majorana build ${sample.phase} ${width}x${height}: fits`)
    }
  }
  await checkBuild()
  await resize(320, 568)
  await run(`document.querySelector('.majorana-build__workspace').scrollIntoView({ block: 'center' })`)
  await settle()
  const dragPart = async (part, slot, valid) => {
    const start = await centerOf(`[data-build-part="${part}"] .majorana-build-part__visual`)
    const target = await centerOf(`[data-build-slot="${slot}"]`)
    await touch('touchStart', start)
    await touch('touchMove', target)
    const visual = await centerOf(`[data-build-part="${part}"] .majorana-build-part__visual`)
    assert(Math.abs(visual.x - target.x) < 2,
      `drag follows client-space motion through the local artwork scale: ${JSON.stringify({ start, target, visual })}`)
    await touch('touchEnd')
    if (valid) await waitFor(`document.querySelector('[data-build-part="${part}"]').disabled`)
    else await waitFor(`!document.querySelector('[data-build-part="${part}"]').classList.contains('is-returning')`)
  }
  await dragPart('qpu-stack', 'cryo-cmos', false)
  assert(await run("!document.querySelector('[data-build-part=\"qpu-stack\"]').disabled"), 'an invalid drop does not place a component')
  await touch('touchStart', await centerOf('[data-build-part="qpu-stack"] .majorana-build-part__visual'))
  await touch('touchMove', await centerOf('[data-build-slot="qpu-stack"]'))
  await resize(568, 320)
  assert.equal(await run("document.querySelectorAll('.majorana-build-part.is-dragging').length"), 0, 'resize cancels capture')
  await touch('touchEnd')
  assert(await run("!document.querySelector('[data-build-part=\"qpu-stack\"]').disabled"))
  await resize(320, 568)
  await run(`document.querySelector('.majorana-build__workspace').scrollIntoView({ block: 'center' })`)
  await settle()
  await dragPart('qpu-stack', 'qpu-stack', true)
  await waitFor("!document.querySelector('.majorana-build-part.is-seating')")
  await checkBuild()
  await resize(1440, 900)
  await run(`document.querySelector('.majorana-build__workspace').scrollIntoView({ block: 'center' })`)
  await settle()
  const remaining = await centerOf('[data-build-part="cryo-cmos"] .majorana-build-part__visual')
  const destination = await centerOf('[data-build-slot="cryo-cmos"]')
  await page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...remaining, button: 'left', buttons: 1, clickCount: 1
  })
  await settle()
  assert(await run("document.querySelector('[data-build-part=\"cryo-cmos\"]').classList.contains('is-dragging')"),
    `mouse captures the remaining part: ${JSON.stringify({ remaining, destination })}`)
  await page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved', ...destination, button: 'left', buttons: 1
  })
  await settle()
  const moved = await centerOf('[data-build-part="cryo-cmos"] .majorana-build-part__visual')
  assert(Math.abs(moved.x - destination.x) < 2,
    `mouse drag tracks the artwork: ${JSON.stringify({ remaining, destination, moved })}`)
  await page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...destination, button: 'left', buttons: 0, clickCount: 1
  })
  await settle()
  assert(await run(`(() => {
    const card = document.querySelector('[data-build-part="cryo-cmos"]');
    return card.disabled || card.classList.contains('is-snapping');
  })()`), await run(`JSON.stringify({
    card: document.querySelector('[data-build-part="cryo-cmos"]').className,
    feedback: document.querySelector('[data-build-feedback]').textContent,
    slot: document.querySelector('[data-build-slot="cryo-cmos"]').getBoundingClientRect().toJSON()
  })`))
  await waitFor("document.querySelector('[data-build-part=\"cryo-cmos\"]').disabled")
  await waitFor("!document.querySelector('[data-majorana-action=\"finish\"]').hidden")
  await waitFor("!document.querySelector('.majorana-build-part.is-seating')")
  await checkBuild()
  const assemblySize = await run('sampleBuildLayout().artwork.width')
  await run(`document.querySelector('[data-majorana-action="finish"]').click()`)
  await waitFor("document.querySelector('[data-majorana-root]').classList.contains('is-finale-complete')")
  await waitFor('sampleBuildLayout().artworkFits && sampleBuildLayout().finaleFillsView')
  const completedFinale = await run('sampleBuildLayout()')
  assert(completedFinale.artworkFits, `the registered finale stays in the fitted workspace: ${JSON.stringify(completedFinale)}`)
  assert(await run('sampleBuildLayout().artwork.width') >= assemblySize - 1, 'the ending never shrinks into the former copy area')
  for (const [width, height] of [[320, 568], [568, 320], [768, 1024], [1440, 900], [2160, 3840], [3440, 1440]]) {
    await resize(width, height)
    const finale = await run('sampleBuildLayout()')
    assert(finale.artworkFits && finale.finaleFillsView, `Finale ${width}x${height}: ${JSON.stringify(finale)}`)
  }
  await run(`document.querySelector('[data-majorana-action="restart"]').click()`)
  assert.equal(await run("document.querySelectorAll('.majorana-build-part.is-placed').length"), 0)
  await run(`document.querySelector('[data-majorana-action="exit"]').click()`)
  assert(await run('window.exited'), 'Exit retains its navigation callback')
  await run('lifecycle.abort(); disposeMajorana()')
  assert.equal(await run("document.querySelectorAll('[data-majorana-root], #fixture canvas').length"), 0)
  console.log('Keyboard entry, restart, exit and abort cleanup: passed')

  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  })
  await resize(768, 1024)
  await run(`(async () => {
    const { createMajoranaScene } = await import('/js/modules/build-majorana-2/majorana-scene.js');
    const { playMajoranaPortalTransition } = await import('/js/core/experience-portal.js');
    const stage = document.querySelector('#kiosk-stage');
    const menu = document.createElement('section');
    menu.className = 'module-card is-active';
    menu.style.cssText = 'position:absolute;left:40px;top:150px;width:240px;height:240px';
    const source = document.createElement('div');
    source.style.cssText = 'width:100%;height:100%';
    menu.append(source);
    stage.append(menu);
    const preview = await createMajoranaScene({ host: source, navigationPreview: true });
    await playMajoranaPortalTransition({
      stage, menuScreen: menu, sourceElement: source, sceneController: preview,
      prepare: async () => {
        let release;
        const gate = new Promise(resolve => release = resolve);
        const ready = new Promise((resolve, reject) => {
          const fixture = document.querySelector('#fixture');
          fixture.addEventListener('majorana:scene-ready', resolve, { once: true });
          fixture.addEventListener('majorana:scene-error', event => reject(event.detail.error), { once: true });
        });
        window.disposeMajorana = mountMajorana({ sceneStartPromise: gate, majoranaSceneController: preview });
        return {
          destinationElement: document.querySelector('[data-model-slot="intro"]'),
          sceneReady: ready,
          handoffScene: () => { release(); return ready; }
        };
      }
    });
    menu.remove();
  })()`)
  await settle()
  assert((await run('sampleLayout()')).canvasFits, 'the real carousel portal lands in the fitted intro slot')
  assert.equal(await run("document.querySelectorAll('.experience-portal').length"), 0)
  await run(`document.querySelector('[data-majorana-action="start"]').click()`)
  await waitFor("document.querySelector('[data-majorana-root]').dataset.componentsPhase === 'focusing'")
  await resize(568, 320)
  await waitFor("document.querySelector('[data-majorana-root]').dataset.componentsPhase === 'focus'")
  await checkComponents('no-preference')
  await enterPathways()
  assert(await run("document.querySelector('[data-majorana-action=\"next-build\"]').hidden"),
    'normal motion retains the authored intro before enabling Continue')
  await waitFor("!document.querySelector('[data-majorana-action=\"next-build\"]').hidden")
  await checkPathways('no-preference')
  await resize(320, 568)
  await run(`document.querySelector('.majorana-pathways__workspace').scrollIntoView({ block: 'center' })`)
  await settle()
  await page.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: 160, y: 380, id: 1 }]
  })
  await page.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchEnd', touchPoints: []
  })
  assert.equal(await run("document.querySelector('[data-majorana-root]').dataset.currentView"), 'pathways',
    'touching the artwork does not advance the scrollable lesson')
  await waitFor(`(() => {
    const pulse = document.querySelector('[data-pathway="external"] [data-pathway-pulse]');
    if (pulse.hidden) return false;
    const matrix = new DOMMatrix(getComputedStyle(pulse).transform);
    return matrix.m42 > 300 && matrix.m42 < 1200;
  })()`)
  assert(await run(`(() => {
    const pathway = document.querySelector('[data-pathway="external"]');
    const pulse = pathway.querySelector('[data-pathway-pulse]');
    const matrix = new DOMMatrix(getComputedStyle(pulse).transform);
    return Math.abs(matrix.m41 - pathway.offsetWidth / 2) < 1;
  })()`), 'pulses use local artwork coordinates rather than scaled screen dimensions')
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await waitFor(`[...document.querySelectorAll('[data-pathway-pulse]')].every(e => e.hidden)`)
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  })
  await run(`document.querySelector('[data-majorana-action="next-build"]').click()`)
  await waitFor(`document.querySelector('[data-majorana-root]').dataset.currentView === 'build' &&
    !document.querySelector('[data-majorana-root]').classList.contains('is-section-transitioning')`)
  await settle()
  for (const part of ['cryo-cmos', 'qpu-stack']) {
    await run(`document.querySelector('[data-build-part="${part}"]').focus()`)
    await settle()
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    page.sendInputEvent({ type: 'char', keyCode: '\r' })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await waitFor(`document.querySelector('[data-build-part="${part}"]').disabled`)
  }
  await waitFor("!document.querySelector('[data-majorana-action=\"finish\"]').hidden")
  await run(`document.querySelector('[data-majorana-action="finish"]').click()`)
  await waitFor("document.querySelector('.majorana-finale').dataset.finalePhase === 'chip-swap'")
  await resize(320, 568)
  await waitFor("document.querySelector('[data-majorana-root]').classList.contains('is-finale-complete')")
  await waitFor('sampleBuildLayout().artworkFits && sampleBuildLayout().finaleFillsView')
  const normalFinale = await run('sampleBuildLayout()')
  assert(normalFinale.artworkFits && normalFinale.finaleFillsView,
    `normal-motion finale fills the view after resizing during the handoff: ${JSON.stringify(normalFinale)}`)
  await run(`document.querySelector('[data-majorana-action="restart"]').click()`)
  assert.equal(await run("document.querySelectorAll('.majorana-build-part.is-placed').length"), 0)
  await run('disposeMajorana()')
  console.log('Real carousel scene handoff, reverse-order keyboard assembly and animated finale resize: passed')

  await resize(320, 568)
  await run(`window.disposeMajorana = mountMajorana({
    majoranaSceneController: {
      attachToModule() { throw new Error('Expected layout diagnostic scene failure'); },
      dispose() {}
    }
  }); undefined`)
  await waitFor("document.querySelector('[data-model-loading]').classList.contains('has-error')")
  await settle()
  assert(await run(`(() => {
    const panel = document.querySelector('[data-model-loading]');
    const box = panel.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth &&
      box.top >= 0 && box.bottom <= innerHeight &&
      panel.scrollWidth <= panel.clientWidth + 1 &&
      parseFloat(getComputedStyle(panel).fontSize) >= 16 &&
      document.querySelector('[data-majorana-action="start"]').disabled;
  })()`), 'a failed load is visible and readable without enabling Start')
  await run('disposeMajorana()')
  assert.deepEqual(errors, [])
  console.log('Majorana intro, Components, Pathways and build layouts, touch/mouse inspection and drops, keyboard continuation, readable key, scaled pulses, resize, completion, finale, restart, portal handoff, load failure and cleanup passed.')
}

Promise.race([main(), new Promise((_resolve, reject) => {
  timeout = setTimeout(() => reject(new Error('Majorana entry layout check timed out')), 180_000)
})]).catch(error => {
  console.error(error)
  exitCode = 1
}).finally(async () => {
  clearTimeout(timeout)
  window?.destroy()
  await server?.close()
  app.exit(exitCode)
})

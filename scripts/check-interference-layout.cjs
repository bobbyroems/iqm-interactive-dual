/* Render the production guidance UI without starting the WebGL simulation.
   Verify text containment, diagram separation and hint placement after reflow. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'iqm-interference-layout-'))
let server
let window

app.commandLine.appendSwitch('force-device-scale-factor', '1')

async function main() {
  await app.whenReady()
  console.log('Preparing layout fixture…')
  const { createServer } = await import('vite')
  const fixture = (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html><head>
      <link rel="stylesheet" href="/styles/tokens.css">
      <link rel="stylesheet" href="/styles/base.css">
      <link rel="stylesheet" href="/styles/app.css">
      <link rel="stylesheet" href="/js/modules/quantum-vs-classical/quantum-vs-classical.css">
      </head><body><div id="audit-stage" style="position:absolute;width:2160px;height:3840px;transform-origin:top left">
      <div class="qvc"><div class="qvc-game qvc-interference" id="audit-host"></div></div>
      </div></body></html>`)
  }
  server = await createServer({
    root: path.join(root, 'src'),
    publicDir: path.join(root, 'public'),
    configFile: false,
    cacheDir: path.join(output, 'vite-cache'),
    optimizeDeps: { noDiscovery: true },
    plugins: [{
      name: 'interference-layout-fixture',
      configureServer(vite) { vite.middlewares.use('/__interference-layout-audit', fixture) }
    }],
    server: { host: '127.0.0.1', port: 0 }
  })
  await server.listen()
  console.log('Loading layout fixture…')
  const port = server.httpServer.address().port
  window = new BrowserWindow({
    width: 720, height: 1280, useContentSize: true, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true }
  })
  const page = window.webContents
  await window.loadURL('about:blank')
  page.debugger.attach('1.3')
  await page.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await window.loadURL(`http://127.0.0.1:${port}/__interference-layout-audit`)
  console.log('Mounting production panels…')
  const run = source => page.executeJavaScript(source, true)
  await run(`(async () => {
    const { createInterferenceGuidance } = await import('/js/modules/quantum-vs-classical/interference-guidance.js');
    const { updateKioskExplainer } = await import('/js/core/kiosk-explainer.js');
    const { updateKioskTooltip } = await import('/js/core/kiosk-tooltip.js');
    const { INTERFERENCE_TIPS, INTERFERENCE_FINALE } = await import('/js/modules/quantum-vs-classical/interference-presentation.js');
    const stageForPanel = { intro: 'first-source', one: 'first-lesson', bridge: 'second-source', constructive: 'second-lesson', destructive: 'third-lesson', add: 'field-sequence' };
    window.audit = createInterferenceGuidance();
    document.querySelector('#audit-host').append(audit.element);
    window.showPanel = key => {
      const final = key === 'finale';
      audit.lesson.hidden = final;
      audit.lesson.classList.toggle('is-showing', !final);
      for (const panel of audit.lesson.children) panel.hidden = panel.dataset.lessonStage !== key;
      updateKioskExplainer(audit.finaleExplainer, { visible: final });
      updateKioskTooltip(audit.interactionTooltip, { visible: true, text: final ? INTERFERENCE_FINALE.tip : INTERFERENCE_TIPS[stageForPanel[key]] });
      return final ? audit.finaleExplainer.element : audit.lesson.querySelector('[data-lesson-stage="' + key + '"]');
    };
    await document.fonts.ready;
    window.auditFrame = () => new Promise(resolve => setTimeout(resolve, 40));
    window.measurePanel = panel => {
      const scale = innerWidth / 2160;
      const box = panel.getBoundingClientRect();
      const title = panel.querySelector('.kiosk-explainer__title');
      const body = panel.querySelector('.kiosk-explainer__body');
      const copy = panel.querySelector('.kiosk-explainer__copy');
      const tip = audit.interactionTooltip.element;
      const tipBox = tip.getBoundingClientRect();
      const media = panel.querySelector('.kiosk-explainer__media:not([hidden])');
      const textFits = element => {
        if (element.hidden) return true;
        const own = element.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element);
        return element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1 &&
          [...range.getClientRects()].every(r => r.left >= own.left - 1 && r.right <= own.right + 1 &&
            r.top >= own.top - 1 && r.bottom <= own.bottom + 1 && r.left >= box.left && r.right <= box.right && r.bottom <= box.bottom);
      };
      const bodyBox = body.getBoundingClientRect();
      const topBox = (title.hidden ? body : title).getBoundingClientRect();
      return {
        textBoxes: [title, body].map(e => ({ text: e.textContent, hidden: e.hidden, width: e.clientWidth, scrollWidth: e.scrollWidth, height: e.clientHeight, scrollHeight: e.scrollHeight, box: e.getBoundingClientRect().toJSON(), font: getComputedStyle(e).fontFamily })),
        height: box.height / scale,
        contained: [title, body].every(textFits),
        onScreen: box.left >= 0 && box.right <= innerWidth + 1 && tipBox.bottom <= innerHeight,
        topPadding: (topBox.top - box.top) / scale,
        bottomPadding: (box.bottom - bodyBox.bottom) / scale,
        titleGap: title.hidden ? null : (bodyBox.top - title.getBoundingClientRect().bottom) / scale,
        mediaGap: media ? (copy.getBoundingClientRect().left - media.getBoundingClientRect().right) / scale : null,
        tipGap: (tipBox.top - box.bottom) / scale,
        tipFits: tip.scrollWidth <= tip.clientWidth + 1 && tipBox.left >= 0 && tipBox.right <= innerWidth + 1,
        infoIcon: tip.querySelector('.kiosk-tooltip__icon svg').getBoundingClientRect().width > 0
      };
    };
  })()`)
  const keys = ['intro', 'one', 'bridge', 'constructive', 'destructive', 'add', 'finale']
  const samples = []
  console.log('Checking panel geometry…')
  for (const width of [720, 1080]) {
    window.setContentSize(width, width * 16 / 9)
    await run(`new Promise(resolve => {
      if (innerWidth === ${width}) resolve();
      else addEventListener('resize', resolve, { once: true });
    })`)
    await run(`document.querySelector('#audit-stage').style.transform = 'scale(' + innerWidth / 2160 + ')'`)
    for (const mode of ['current', 'longer-copy', 'fallback-font']) {
      for (const key of keys) {
        const sample = await run(`(async () => {
          const panel = showPanel(${JSON.stringify(key)});
          const title = panel.querySelector('.kiosk-explainer__title');
          const body = panel.querySelector('.kiosk-explainer__body');
          body.dataset.original ??= body.innerHTML;
          title.dataset.original ??= title.textContent;
          body.innerHTML = body.dataset.original;
          title.textContent = title.dataset.original;
          panel.style.removeProperty('--font-display');
          if (${JSON.stringify(mode)} === 'fallback-font') panel.style.setProperty('--font-display', 'Arial, sans-serif');
          if (${JSON.stringify(mode)} === 'longer-copy') {
            body.append(document.createTextNode(' ' + body.textContent));
            if (!title.hidden) title.append(document.createTextNode(' ' + title.textContent));
          }
          await document.fonts.ready;
          await auditFrame();
          return measurePanel(panel);
        })()`)
        const label = `${width}px ${key} ${mode}`
        samples.push({ label, ...sample })
        if (!sample.contained) {
          fs.writeFileSync(path.join(output, 'failure.png'), (await page.capturePage()).toPNG())
          console.error(JSON.stringify({ output, sample }, null, 2))
        }
        assert(sample.contained, `${label}: clipped text`)
        assert(sample.onScreen && sample.tipFits, `${label}: outside screen`)
        assert(sample.topPadding >= 59 && sample.bottomPadding >= 59, `${label}: insufficient padding`)
        assert(sample.titleGap === null || Math.abs(sample.titleGap - 60) < 1, `${label}: title/body spacing`)
        assert(sample.mediaGap === null || Math.abs(sample.mediaGap - 60) < 1, `${label}: diagram spacing`)
        assert(Math.abs(sample.tipGap - 60) < 1 && sample.infoIcon, `${label}: hint spacing/icon`)
        if (width === 720 && mode === 'current') {
          const crop = { x: 0, y: 60, width, height: Math.ceil((280 + sample.height + 180) / 3 - 60) }
          fs.writeFileSync(path.join(output, `${key}.png`), (await page.capturePage(crop)).toPNG())
        }
      }
    }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(samples, null, 2))
  console.log(`Passed ${samples.length} rendered layout checks across all seven panels.\nScreenshots and results: ${output}`)
  await run('audit.dispose()')
}

const deadline = setTimeout(() => {
  console.error('Interference layout audit timed out after 60 seconds.')
  app.exit(1)
}, 60000)

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  clearTimeout(deadline)
  window?.destroy()
  await server?.close()
  app.exit(process.exitCode || 0)
})

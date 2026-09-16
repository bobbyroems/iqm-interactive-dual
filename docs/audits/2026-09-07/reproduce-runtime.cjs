const fs = require('node:fs')
const vm = require('node:vm')
const { spawn } = require('node:child_process')
const { createRequire } = require('node:module')
const root = process.env.IQM_AUDIT_ROOT || process.cwd()
const req = createRequire(root + '/package.json')
const { app, BrowserWindow } = req('electron')
const source = fs.readFileSync(root + '/scripts/leak-soak.cjs', 'utf8')
const instrumentation = vm.runInNewContext(source.match(/const INSTRUMENTATION = (`[\s\S]*?`)\n\n\/\*/)[1])
const sleep = ms => new Promise(r => setTimeout(r, ms))
const output = '/tmp/iqm-audit-runtime.json'
const results = { environment: {}, samples: [], faults: [] }
let server, win
function save() { fs.writeFileSync(output, JSON.stringify(results, null, 2)) }
async function main() {
  server = spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5244', '--strictPort'], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore'
  })
  await app.whenReady()
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:5244')).ok) break } catch {}
    await sleep(100)
  }
  win = new BrowserWindow({ width: 540, height: 960, show: true, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false
  } })
  const wc = win.webContents
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2 && !message.includes('THREE.Clock')) results.faults.push(message.slice(0, 1200))
  })
  await win.loadURL('about:blank')
  wc.debugger.attach('1.3')
  const cdp = (method, params) => wc.debugger.sendCommand(method, params)
  await cdp('Page.enable')
  await cdp('HeapProfiler.enable')
  await cdp('Performance.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation + `
  globalThis.__auditFrames = new Map();
  const originalRAF = requestAnimationFrame, originalCancel = cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    const site = new Error().stack.split('\\n').slice(2, 5).join(' | ');
    const id = originalRAF(stamp => { __auditFrames.delete(id); callback(stamp) });
    __auditFrames.set(id, site); return id;
  };
  globalThis.cancelAnimationFrame = id => { __auditFrames.delete(id); originalCancel(id) };
  globalThis.__auditErrors = [];
  addEventListener('unhandledrejection', event => __auditErrors.push(String(event.reason)));
  ` })
  await win.loadURL('http://127.0.0.1:5244')
  const run = js => wc.executeJavaScript(js, true)
  const waitUntil = async (expr, timeout = 45000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await run(expr)) return
      await sleep(100)
    }
    throw new Error('Timed out: ' + expr)
  }
  await waitUntil('Boolean(globalThis.__kioskApp)')
  await run(`__kioskApp.runtime.isKiosk = true; __kioskApp.openMenu()`)
  await sleep(12000)
  results.environment = { versions: process.versions, gpu: app.getGPUFeatureStatus(), metrics: await run(`({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})`), policy: 'runtime.isKiosk enabled after bootstrap to retain audit app handle' }
  const sample = async label => {
    await cdp('HeapProfiler.collectGarbage')
    await sleep(700)
    const data = await run(`({ ...__leakSample(), frames: [...__auditFrames.values()], screen: __kioskApp.router.currentScreen, errors: __auditErrors.slice() })`)
    const dom = await cdp('Memory.getDOMCounters')
    results.samples.push({ label, ...data, ...dom })
    save()
    console.log(label, JSON.stringify({ gl: data.gl, nodes: dom.nodes, frames: data.frames.filter(s => s.includes('superposition-game')).length }))
  }
  const openSuperposition = async () => {
    await run(`__kioskApp.openModule('quantum-vs-classical')`)
    await waitUntil(`!__kioskApp.isOpeningExperience && !!document.querySelector('[data-qvc-game="superposition"]')`)
    await run(`document.querySelector('[data-qvc-game="superposition"]').click()`)
    await waitUntil(`!!document.querySelector('.qvc-game__canvas.is-ready') && !document.querySelector('.qvc').classList.contains('is-transitioning')`)
  }
  await openSuperposition()
  await run(`document.querySelector('[data-qvc-action="back"]').click()`)
  await waitUntil(`document.querySelector('.qvc')?.dataset.view === 'menu' && !document.querySelector('.qvc').classList.contains('is-transitioning')`)
  await run('__kioskApp.openMenu()')
  await sleep(1200)
  await sample('normal-back baseline')
  for (let i = 1; i <= 2; i++) {
    await openSuperposition()
    await run(`document.querySelector('[data-qvc-action="back"]').click(); setTimeout(() => __kioskApp.openMenu(), 40)`)
    await sleep(1800)
    await sample('exit-during-back ' + i)
  }
  await run(`__kioskApp.openModule('build-nanowire')`)
  await waitUntil(`!__kioskApp.isOpeningExperience && document.querySelector('.nw')?.classList.contains('is-scene-ready')`)
  results.nanowire = await run(`(() => { const c = document.querySelector('.nw__canvas'), r = c.getBoundingClientRect(); return { buffer: [c.width,c.height], display: [r.width,r.height], dpr:devicePixelRatio,pixelRatioToDisplay:(c.width*c.height)/(r.width*r.height*devicePixelRatio**2) } })()`)
  await run('__kioskApp.openMenu()')
  await sleep(1200)
  // Inject one transient manifest-read failure, then restore the actual fetch.
  results.manifestRetry = await run(`(async () => {
    const m = await import('/js/core/alpha-video.js'); m.resetAlphaVideoManifest();
    const original = fetch; let calls = 0;
    globalThis.fetch = (...a) => { calls++; if(calls === 1) return Promise.reject(new Error('audit: transient manifest read')); return original(...a) };
    const outcomes = [];
    for(let i=0;i<2;i++) { try { await m.loadAlphaVideoManifest(); outcomes.push('success') } catch(e) { outcomes.push(e.message) } }
    globalThis.fetch = original; m.resetAlphaVideoManifest();
    const recovered = await m.loadAlphaVideoManifest();
    return { calls, outcomes, manualResetRecovers: !!recovered.clips };
  })()`)
  // Exercise the real subgame transition with a GPU constructor failure.
  await run(`__kioskApp.openModule('quantum-vs-classical')`)
  await waitUntil(`!__kioskApp.isOpeningExperience && !!document.querySelector('[data-qvc-game="superposition"]')`)
  await run(`(async () => {
    const m = await import('/js/modules/quantum-vs-classical/index.js');
    const context = await m.preload(); globalThis.__auditOriginalThree = context.assets.THREE;
    context.assets.THREE = { ...context.assets.THREE, WebGLRenderer: class { constructor() { throw new Error('audit: GPU context allocation failed') } } };
    document.querySelector('[data-qvc-game="superposition"]').click();
  })()`)
  await sleep(3000)
  results.gameFailure = await run(`({ transitioning: document.querySelector('.qvc').classList.contains('is-transitioning'), busy: document.querySelector('.qvc').getAttribute('aria-busy'), hostState: document.querySelector('#module-host').dataset.moduleState, errors: __auditErrors.slice() })`)
  await run(`(async () => { const m=await import('/js/modules/quantum-vs-classical/index.js'); (await m.preload()).assets.THREE=__auditOriginalThree; __kioskApp.openMenu() })()`)
  save()
}
main().then(() => { console.log('AUDIT COMPLETE', output); win?.destroy(); server?.kill(); app.exit(0) }, error => {
  results.error = error.stack; save(); console.error(error); win?.destroy(); server?.kill(); app.exit(1)
})

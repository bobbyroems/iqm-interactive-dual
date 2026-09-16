const fs = require('node:fs')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawn } = require('node:child_process')
const { createRequire } = require('node:module')
const root = process.env.IQM_AUDIT_ROOT || process.cwd()
const req = createRequire(root + '/package.json')
const { app, BrowserWindow } = req('electron')
const source = fs.readFileSync(root + '/scripts/leak-soak.cjs', 'utf8')
const instrumentation = vm.runInNewContext(source.match(/const INSTRUMENTATION = (`[\s\S]*?`)\n\n\/\*/)[1])
const sleep = ms => new Promise(r => setTimeout(r, ms))
const output = path.join(os.tmpdir(), 'iqm-qvc-warmup.json')
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

  const programs = () => run('__leak.gl.counts.program.created')
  const mount = async name => {
    await run(`(async () => {
      const context = await (await import('/js/modules/quantum-vs-classical/index.js')).preload();
      const file = '${name}-game.js';
      const exports = await import('/js/modules/quantum-vs-classical/' + file);
      const create = exports['${name === 'superposition' ? 'createSuperpositionGame' : 'createInterferenceGame'}'];
      const host = document.createElement('div'); host.id = 'warmup-test-host';
      host.style.cssText = 'position:absolute;inset:0;z-index:100';
      document.getElementById('kiosk-stage').append(host);
      const band = {element: document.createElement('div'), offerNext(){}, withdrawOffer(){}, clearPagination(){}, mountPagination(){}};
      globalThis.__warmController = await create(host, {...context, band, popupHost:host, onActivity(){}, onGameComplete(){}, showUpNext(){}, openGame(){}});
    })()`)
    await waitUntil(`!!document.querySelector('#warmup-test-host .is-ready')`)
  }
  const unmount = () => run(`__warmController.dispose(); __warmController=null; document.getElementById('warmup-test-host').remove()`)
  await mount('superposition')
  const superReady = await programs()
  const swipe = async () => {
    const point = await run(`(() => {const r=document.querySelector('#warmup-test-host canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.7}})()`)
    await cdp('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1})
    await cdp('Input.dispatchMouseEvent', {type:'mouseMoved', x:point.x, y:point.y-120, button:'left', buttons:1})
    await cdp('Input.dispatchMouseEvent', {type:'mouseReleased', x:point.x, y:point.y-120, button:'left', clickCount:1})
  }
  await swipe()
  await waitUntil(`!!document.querySelector('#warmup-test-host [data-state="landed"]')`)
  const afterClassical = await programs()
  await swipe()
  await waitUntil(`!!document.querySelector('#warmup-test-host [data-state="bullet"]')`)
  await sleep(1800)
  const afterBullet = await programs()
  results.superposition = {superReady, afterClassical, afterBullet}
  save()
  assert.equal(afterBullet, superReady, 'slow motion should reuse precompiled programs')
  await unmount()
  await mount('interference')
  const interferenceReady = await programs()
  for (let step=0; step<45; step++) {
    if (await run(`!!document.querySelector('#warmup-test-host [data-outcome="true"]')`)) break
    await run(`document.querySelector('#warmup-test-host canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    await sleep(800)
  }
  await waitUntil(`!!document.querySelector('#warmup-test-host [data-outcome="true"]')`)
  await sleep(6500)
  const afterFinale = await programs()
  results.interference = {interferenceReady, afterFinale}
  results.errors = await run('__auditErrors.slice()')
  save()
  assert.equal(afterFinale, interferenceReady, 'finale should reuse precompiled programs')
  assert.deepEqual(results.errors, [])
  await unmount()
}
main().then(() => { console.log('WARMUP CHECK PASSED', output); win?.destroy(); server?.kill(); app.exit(0) }, error => {
  results.error = error.stack; save(); console.error(error); win?.destroy(); server?.kill(); app.exit(1)
})

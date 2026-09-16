/*
 * Runtime leak soak. Drives the app through carousel navigation in Electron,
 * confirms readiness and teardown, then measures retained resources after GC.
 * Instrumentation is installed before app code. backgroundThrottling stays off
 * so render loops execute even when another window is foreground.
 *
 * WebGL objects are counted at create/delete calls, independently of Three.js
 * renderer.info. WebGPU allocation tracking and FPS profiling are out of scope.
 * Review mode is separate because it enables experimental scenes disabled in kiosks.
 *
 * Usage: npm run leak:soak -- [--cycles N] [--dwell MS] [--only id,id] [--mode kiosk|review]
 * Set LEAK_SOAK_DOM_SNAPSHOT=1 to include DOM snapshots when investigating growth.
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const require_ = require

const HOST = '127.0.0.1'
const PORT = Number(process.env.LEAK_SOAK_PORT || 5233)
const DEV_URL = `http://${HOST}:${PORT}`

function parseArgs(argv) {
  const args = {
    cycles: 3,
    mode: 'kiosk',
    dwell: 8000,
    only: null,
    out: path.join(os.tmpdir(), 'iqm-leak-soak.log')
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--mode') args.mode = String(argv[++i])
    else if (flag === '--cycles') args.cycles = Number(argv[++i])
    else if (flag === '--dwell') args.dwell = Number(argv[++i])
    else if (flag === '--only') args.only = String(argv[++i]).split(',').map(s => s.trim())
    else if (flag === '--out') args.out = path.resolve(String(argv[++i]))
  }
  if (!['kiosk', 'review'].includes(args.mode)) throw new Error('Use --mode kiosk or review')
  if (!Number.isInteger(args.cycles) || args.cycles < 1 || !Number.isFinite(args.dwell) || args.dwell < 0) throw new Error('Invalid cycles/dwell')
  return args
}

/* Electron is a GUI-subsystem binary on Windows, so stdout never reaches the
   shell that launched it. Every line goes to a file as well, and that file is
   the report. */
let logPath = null
function log(line = '') {
  console.log(line)
  if (logPath) {
    try { fs.appendFileSync(logPath, line + '\n') } catch { /* report is best-effort */ }
  }
}

function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, response => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) resolve()
        else retry()
      })
      request.on('error', retry)
      request.setTimeout(2000, () => request.destroy())
    }
    const retry = () => {
      if (Date.now() > deadline) reject(new Error(`Dev server did not answer at ${url}`))
      else setTimeout(attempt, 400)
    }
    attempt()
  })
}

function startDevServer() {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const child = spawn(
    command,
    ['vite', '--host', HOST, '--port', String(PORT), '--strictPort'],
    { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', shell: process.platform === 'win32' }
  )
  return child
}

/* Runs before any application script. Everything it records is a raw count of
   WebGL and media lifecycle events; interpretation happens in the reporter. */
const INSTRUMENTATION = `
(() => {
  const L = { gl: { contexts: [], counts: {} }, videos: new Set(), seq: 0 }
  globalThis.__leak = L
  L.errors = []
  self.addEventListener('error', event => L.errors.push(event.message))
  self.addEventListener('unhandledrejection', event => L.errors.push(String(event.reason)))
  L.frames = new Map()
  const raf = self.requestAnimationFrame.bind(self)
  const cancel = self.cancelAnimationFrame.bind(self)
  self.requestAnimationFrame = callback => {
    const site = new Error().stack.split('\\n')[2] || '(unknown)'
    const id = raf(stamp => { L.frames.delete(id); callback(stamp) })
    L.frames.set(id, site)
    return id
  }
  self.cancelAnimationFrame = id => { L.frames.delete(id); cancel(id) }

  const originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = originalGetContext.call(this, type, ...rest)
    if (context && /webgl/i.test(String(type))) {
      L.gl.contexts.push({ type, ref: new WeakRef(context) })
    }
    return context
  }

  const PAIRS = [
    ['createTexture', 'deleteTexture', 'texture'],
    ['createBuffer', 'deleteBuffer', 'buffer'],
    ['createProgram', 'deleteProgram', 'program'],
    ['createShader', 'deleteShader', 'shader'],
    ['createFramebuffer', 'deleteFramebuffer', 'framebuffer'],
    ['createRenderbuffer', 'deleteRenderbuffer', 'renderbuffer'],
    ['createVertexArray', 'deleteVertexArray', 'vao']
  ]
  for (const Proto of [self.WebGLRenderingContext, self.WebGL2RenderingContext]) {
    if (!Proto) continue
    for (const [make, drop, name] of PAIRS) {
      L.gl.counts[name] = L.gl.counts[name] || { created: 0, deleted: 0 }
      const proto = Proto.prototype
      if (typeof proto[make] === 'function' && !proto[make].__leakHooked) {
        const original = proto[make]
        proto[make] = function (...a) { L.gl.counts[name].created += 1; return original.apply(this, a) }
        proto[make].__leakHooked = true
      }
      if (typeof proto[drop] === 'function' && !proto[drop].__leakHooked) {
        const original = proto[drop]
        proto[drop] = function (...a) { L.gl.counts[name].deleted += 1; return original.apply(this, a) }
        proto[drop].__leakHooked = true
      }
    }
  }

  /* WeakRef only: the registry must never be the thing keeping an element
     alive, or every video would look retained. */
  const registered = new WeakSet()
  const register = element => {
    if (!(element instanceof HTMLVideoElement) || registered.has(element)) return
    registered.add(element)
    element.__leakId = ++L.seq
    L.videos.add(new WeakRef(element))
  }
  const walk = node => {
    if (!node) return
    if (node instanceof HTMLVideoElement) register(node)
    if (node.querySelectorAll) node.querySelectorAll('video').forEach(register)
  }
  const observe = () => {
    walk(document.body)
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) walk(node)
    }).observe(document.body, { childList: true, subtree: true })
  }
  if (document.body) observe()
  else document.addEventListener('DOMContentLoaded', observe, { once: true })

  /* Every listener on every target, keyed by type plus the call site, so a
     leak names its own source line instead of having to be bisected by hand.
     Registrations tied to an AbortSignal or marked { once: true } are skipped:
     both are torn down without ever calling removeEventListener, so counting
     them would report the app's normal cleanup as a leak. */
  L.sites = new Map()
  L.siteTargets = new Map()
  const callSite = () => {
    const stack = (new Error().stack || '').split('\\n')
    for (const line of stack.slice(2)) {
      if (line.includes('__leak') || line.includes('addEventListener')) continue
      return line.trim().slice(0, 160)
    }
    return '(unknown)'
  }
  const targetName = target => {
    if (target === self) return 'window'
    if (target === document) return 'document'
    if (target && target.nodeName) {
      return target.nodeName.toLowerCase() +
        (target.className && typeof target.className === 'string'
          ? '.' + target.className.split(/\\s+/)[0] : '')
    }
    return Object.prototype.toString.call(target)
  }
  const baseAdd = EventTarget.prototype.addEventListener
  const baseRemove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (type, handler, options) {
    if (!(options && (options.signal || options.once))) {
      const key = targetName(this) + ' ' + type + '  @ ' + callSite()
      L.sites.set(key, (L.sites.get(key) || 0) + 1)
      const live = L.siteTargets.get(key) || []
      live.push(new WeakRef(this))
      L.siteTargets.set(key, live)
      try {
        let byTarget = L.siteByHandler.get(handler)
        if (!byTarget) { byTarget = new Map(); L.siteByHandler.set(handler, byTarget) }
        byTarget.set(targetName(this) + ' ' + type, key)
      } catch { /* primitives are not weak-keyable */ }
    }
    return baseAdd.call(this, type, handler, options)
  }
  EventTarget.prototype.removeEventListener = function (type, handler, options) {
    const byTarget = L.siteByHandler.get(handler)
    const key = byTarget && byTarget.get(targetName(this) + ' ' + type)
    if (key) L.sites.set(key, (L.sites.get(key) || 0) - 1)
    return baseRemove.call(this, type, handler, options)
  }

  /* Listener bookkeeping on the two targets that outlive every module. */
  L.siteByHandler = new WeakMap()
  L.listeners = new Map()
  for (const target of [self, document]) {
    const scope = target === self ? 'window' : 'document'
    const bag = new Map()
    L.listeners.set(scope, bag)
    const add = target.addEventListener.bind(target)
    const remove = target.removeEventListener.bind(target)
    target.addEventListener = function (type, handler, options) {
      /* An AbortSignal or { once: true } removes the listener without ever
         calling removeEventListener, so counting those registrations reports
         the app's own cleanup as a leak. */
      if (!(options && (options.signal || options.once))) {
        bag.set(type, (bag.get(type) || 0) + 1)
      }
      return add(type, handler, options)
    }
    target.removeEventListener = function (type, handler, options) {
      bag.set(type, (bag.get(type) || 0) - 1)
      return remove(type, handler, options)
    }
  }

  globalThis.__leakSample = () => {
    const gl = {}
    for (const key of Object.keys(L.gl.counts)) {
      gl[key] = L.gl.counts[key].created - L.gl.counts[key].deleted
    }
    const listeners = {}
    for (const [scope, bag] of L.listeners) {
      for (const [type, count] of bag) if (count !== 0) listeners[scope + ':' + type] = count
    }
    const retainedVideos = []
    for (const ref of L.videos) {
      const video = ref.deref()
      if (!video || video.isConnected) continue
      /* Post-GC, a detached element that still reports a selected resource is
         holding a decoder the module never released. */
      if (video.readyState > 0 || video.networkState !== 0) {
        retainedVideos.push({
          id: video.__leakId,
          className: video.className || '(none)',
          file: (video.currentSrc || video.getAttribute('src') || '').split('/').pop(),
          readyState: video.readyState,
          networkState: video.networkState,
          bufferedSeconds: video.buffered.length
            ? Number(video.buffered.end(video.buffered.length - 1).toFixed(2))
            : 0
        })
      }
    }
    /* Report a site only when registrations outnumber removals AND at least
       that many of its targets are still reachable after collection. A
       listener on an element the collector already reclaimed costs nothing. */
    const sites = {}
    for (const [key, count] of L.sites) {
      if (count <= 0) continue
      const targets = L.siteTargets.get(key) || []
      const aliveTargets = targets.filter(ref => ref.deref()).length
      if (aliveTargets > 0) sites[key] = Math.min(count, aliveTargets)
    }
    return {
      sites,
      connectedNodes: (() => { const walker = document.createTreeWalker(document); let count = 1; while (walker.nextNode()) count++; return count })(),
      errors: L.errors.slice(),
      activeFrames: Object.fromEntries([...L.frames.values()].map(site => [site, [...L.frames.values()].filter(value => value === site).length])),
      gl,
      glContexts: L.gl.contexts.length,
      glContextsLive: L.gl.contexts.filter(entry => {
        const context = entry.ref.deref()
        return context && !context.isContextLost()
      }).length,
      canvases: document.querySelectorAll('canvas').length,
      listeners,
      retainedVideos
    }
  }
})()
`

/* Exercise real carousel navigation and confirm readiness and teardown. */
const DRIVER = `
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const waitFor = async (predicate, label, timeout = 45000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (__leak.errors.length) throw new Error(__leak.errors.join('; '))
      if (document.querySelector('#module-host')?.dataset.moduleState === 'error') throw new Error('Module failed: ' + label)
      if (predicate()) return
      await sleep(50)
    }
    throw new Error('Timed out: ' + label)
  }
  const menu = async () => {
    document.querySelector('[data-action="menu"]').click()
    await waitFor(() => document.querySelector('[data-screen="menu"].is-active') && !document.querySelector('[data-module-stage]'), 'module teardown')
    await sleep(1000)
  }
  const open = async id => {
    const footer = document.querySelector('[data-module-id="' + id + '"].module-card .module-card__footer')
    if (!footer) throw new Error('Unknown module: ' + id)
    footer.click()
    await sleep(700)
    if (!document.querySelector('[data-screen="module"].is-active')) footer.click()
    await waitFor(() => document.querySelector('#module-host')?.dataset.moduleId === id &&
      document.querySelector('[data-module-stage][aria-busy="false"]') &&
      !document.querySelector('.screen-wipe.is-active') &&
      !document.querySelector('.is-experience-transitioning') &&
      !document.querySelector('.is-preparing-entry'), 'ready ' + id)
  }
  globalThis.__leakDriver = {
    menu,
    async cycleModule(id, dwell) {
      await open(id)
      await sleep(dwell)
      await menu()
    },
    async cycleAbandonedBack() {
      await open('quantum-vs-classical')
      document.querySelector('[data-qvc-game="superposition"]').click()
      await waitFor(() => document.querySelector('.qvc-game__canvas.is-ready') && !document.querySelector('.qvc.is-transitioning'), 'superposition')
      document.querySelector('[data-qvc-action="back"]').click()
      await sleep(40)
      await menu()
    },
    async loadSubScenes() {
      const base = location.origin + '/js/modules/quantum-vs-classical/'
      const [index, superposition, entanglement, interference] = await Promise.all([
        import(base + 'index.js'),
        import(base + 'superposition-game.js'),
        import(base + 'entanglement-game.js'),
        import(base + 'interference-game.js')
      ])
      globalThis.__subContext = await index.preload()
      globalThis.__subFactories = {
        superposition: superposition.createSuperpositionGame,
        entanglement: entanglement.createEntanglementGame,
        interference: interference.createInterferenceGame
      }
      return Object.keys(globalThis.__subFactories)
    },
    async cycleSubScene(name, dwell) {
      const stage = document.getElementById('kiosk-stage') || document.body
      const host = document.createElement('div')
      host.style.cssText = 'position:absolute;inset:0;z-index:5'
      stage.append(host)
      const band = {
        element: document.createElement('div'),
        offerNext() {}, withdrawOffer() {}, clearPagination() {}, mountPagination() {}
      }
      const controller = await globalThis.__subFactories[name](host, {
        ...globalThis.__subContext,
        band, popupHost: host,
        onActivity() {}, openGame() {}, onGameComplete() {}, showUpNext() {}
      })
      await waitFor(() => host.querySelector('.qvc-game__canvas.is-ready'), 'sub-scene ' + name)
      await sleep(dwell)
      controller.dispose()
      host.remove()
      await sleep(1500)
    }
  }
  return true
})()
`

const GL_KEYS = ['texture', 'buffer', 'program', 'shader', 'framebuffer', 'renderbuffer', 'vao']

async function main() {
  const args = parseArgs(process.argv.slice(2))
  logPath = args.out
  try { fs.writeFileSync(logPath, '') } catch { /* report is best-effort */ }
  const { app, BrowserWindow } = require_('electron')

  const server = startDevServer()
  const shutdownServer = () => { if (!server.killed) server.kill() }
  process.on('exit', shutdownServer)

  await app.whenReady()
  await waitForServer(DEV_URL)

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.resolve(__dirname, '../electron/preload.cjs'),
      additionalArguments: ['--kiosk-runtime=' + encodeURIComponent(JSON.stringify({ isKiosk: args.mode === 'kiosk', isDevelopment: false, config: {} }))],
      /* A throttled window stops servicing rAF, so nothing renders and every
         GPU counter reads zero. This is the difference between measuring the
         app and measuring an idle tab. */
      backgroundThrottling: false
    }
  })

  const contents = window.webContents
  contents.on('render-process-gone', (_event, details) => {
    log('Renderer exited: ' + JSON.stringify(details))
    shutdownServer()
    app.exit(1)
  })
  /* A BrowserWindow has no renderer until something is loaded, and CDP
     commands sent before one exists never resolve — Page.enable simply hangs.
     Load a blank document first, attach, then register the instrumentation and
     navigate for real so the hooks still precede every application script. */
  await window.loadURL('about:blank')
  contents.debugger.attach('1.3')
  await contents.debugger.sendCommand('Page.enable')
  await contents.debugger.sendCommand('Performance.enable')
  await contents.debugger.sendCommand('HeapProfiler.enable')
  await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: INSTRUMENTATION
  })

  const rendererPid = () => contents.getOSProcessId()
  const processMemoryMB = () => {
    const pid = rendererPid()
    const metric = app.getAppMetrics().find(entry => entry.pid === pid)
    if (!metric?.memory) return null
    const working = metric.memory.workingSetSize ?? metric.memory.privateBytes
    return working ? Number((working / 1024).toFixed(1)) : null
  }

  const sample = async () => {
    /* Force collection before reading anything: an uncollected detached node
       is not a leak, and without this step the two are indistinguishable. */
    await contents.debugger.sendCommand('HeapProfiler.collectGarbage')
    await new Promise(resolve => setTimeout(resolve, 900))
    // Flush layout/pseudo-element reconstruction before collection. Otherwise
    // Home/Menu ::after nodes can still belong to the previous screen's style.
    await contents.debugger.sendCommand('DOMSnapshot.captureSnapshot', { computedStyles: [] })
    // JS and Blink release cross-heap references in successive collections.
    // Yield between them so finalizers can run; take the last state, not a
    // tolerance or a selected low-water mark that could conceal real growth.
    for (let pass = 0; pass < 3; pass++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      await contents.debugger.sendCommand('HeapProfiler.collectGarbage')
    }
    const page = await contents.executeJavaScript('globalThis.__leakSample()', true)
    const dom = await contents.debugger.sendCommand('Memory.getDOMCounters')
    const domSnapshot = process.env.LEAK_SOAK_DOM_SNAPSHOT === '1'
      ? await contents.debugger.sendCommand('DOMSnapshot.captureSnapshot', { computedStyles: [] })
      : undefined
    const { metrics } = await contents.debugger.sendCommand('Performance.getMetrics')
    const metric = name => metrics.find(entry => entry.name === name)?.value ?? 0
    return {
      ...page,
      domSnapshot,
      nodes: dom.nodes,
      documents: dom.documents,
      jsEventListeners: dom.jsEventListeners,
      jsHeapMB: Number((metric('JSHeapUsedSize') / 1048576).toFixed(1)),
      rendererMB: processMemoryMB()
    }
  }

  await window.loadURL(DEV_URL)
  await contents.executeJavaScript(
    'new Promise(r => setTimeout(r, 4000)).then(() => Boolean(document.getElementById("module-grid")?.children.length))',
    true
  )
  await contents.executeJavaScript(DRIVER, true)

  const run = js => contents.executeJavaScript(js, true)
  const runtimeMode = await run('window.kiosk?.isKiosk')
  if (runtimeMode !== (args.mode === 'kiosk')) throw new Error('Electron preload did not set the requested runtime mode')
  const rows = []

  const measure = async (label, kind, cycle) => {
    /* Two warm-up passes first: the pooled renderers, shader programs and asset
       caches are all built on first use, and counting that as a leak is how a
       one-time allocation gets mistaken for per-visit growth. */
    await cycle()
    await cycle()
    const before = await sample()
    const samples = [before]
    for (let i = 0; i < args.cycles; i += 1) {
      await cycle()
      samples.push(await sample())
    }
    const after = samples.at(-1)

    const glDelta = {}
    for (const key of GL_KEYS) glDelta[key] = (after.gl[key] ?? 0) - (before.gl[key] ?? 0)
    const listenerDelta = {}
    for (const key of new Set([...Object.keys(before.listeners), ...Object.keys(after.listeners)])) {
      const delta = (after.listeners[key] ?? 0) - (before.listeners[key] ?? 0)
      if (delta > 0) listenerDelta[key] = delta
    }
    const frameDelta = {}
    for (const [site, count] of Object.entries(after.activeFrames)) {
      const delta = count - (before.activeFrames[site] || 0)
      if (delta > 0) frameDelta[site] = delta
    }
    if (after.errors.length) throw new Error(after.errors.join('; '))
    const siteDelta = {}
    for (const key of new Set([...Object.keys(before.sites), ...Object.keys(after.sites)])) {
      const delta = (after.sites[key] ?? 0) - (before.sites[key] ?? 0)
      if (delta > 0) siteDelta[key] = delta
    }

    rows.push({
      target: label,
      kind,
      mode: args.mode,
      cycles: args.cycles,
      samples,
      glDelta,
      glLeakPerCycle: Object.fromEntries(
        GL_KEYS.map(key => [key, Number((glDelta[key] / args.cycles).toFixed(2))])
      ),
      newContexts: after.glContexts - before.glContexts,
      nodesDelta: after.nodes - before.nodes,
      listenersDelta: after.jsEventListeners - before.jsEventListeners,
      documentsDelta: after.documents - before.documents,
      taggedListenerDelta: listenerDelta,
      leakingListenerSites: siteDelta,
      activeFrameDelta: frameDelta,
      retainedVideosBefore: before.retainedVideos.length,
      retainedVideosAfter: after.retainedVideos.length,
      retainedVideoDetail: after.retainedVideos,
      jsHeapMB: [before.jsHeapMB, after.jsHeapMB],
      rendererMB: [before.rendererMB, after.rendererMB]
    })
    const last = rows[rows.length - 1]
    fs.writeFileSync(String(logPath).replace(/\.log$/, '.json'), JSON.stringify(rows, null, 2))
    log(`  ${label}: gl=${JSON.stringify(last.glDelta)} nodes=${last.nodesDelta} ` +
      `listeners=${last.listenersDelta} video=${last.retainedVideosAfter - last.retainedVideosBefore} ` +
      `ctx=${last.newContexts}`)
    return last
  }

  const MODULES = [
    'quantum-vs-classical', 'states-of-matter', 'qubit-explorer', 'protecting-information',
    'build-nanowire', 'build-majorana-2', 'measurement-based', 'nanoscale'
  ]
  const targets = args.only
    ? MODULES.filter(id => args.only.includes(id))
    : MODULES
  if (args.only?.some(id => !MODULES.includes(id))) throw new Error('Unknown module in --only')

  console.log(`\nLeak soak — ${args.cycles} cycles per target, ${args.dwell}ms dwell\n`)
  console.log('modules (mount -> unmount through the real host):')
  await run('__leakDriver.menu()')
  await run(`Promise.all([
    import('/js/modules/nanoscale/nanoscale-assets.js').then(m => m.preloadNanoscaleAssets()),
    import('/js/modules/quantum-vs-classical/index.js').then(m => m.preload())
  ]).then(() => true)`)
  for (const id of targets) {
    await measure(id, 'module', () => run(`__leakDriver.cycleModule(${JSON.stringify(id)}, ${args.dwell})`))
  }

  if (!args.only || args.only.includes('quantum-vs-classical')) {
    await measure('qvc-abandoned-back', 'transition', () => run('__leakDriver.cycleAbandonedBack()'))
  }

  if (!args.only) {
    console.log('\nsub-scenes (mounted through their own factories):')
    const names = await run('__leakDriver.loadSubScenes()')
    for (const name of names) {
      await measure(name, 'sub-scene',
        () => run(`__leakDriver.cycleSubScene(${JSON.stringify(name)}, ${args.dwell})`))
    }
  }

  const findings = rows.filter(row =>
    GL_KEYS.some(key => row.glDelta[key] > 0) ||
    row.retainedVideosAfter > row.retainedVideosBefore ||
    Object.keys(row.taggedListenerDelta).length > 0 ||
    Object.keys(row.leakingListenerSites).length > 0 ||
    Object.keys(row.activeFrameDelta).length > 0 ||
    row.nodesDelta > 0
  )

  log('')
  log('='.repeat(78))
  if (!findings.length) {
    log('No retained growth detected in the measured cycles (GPU, DOM, RAF, listeners and media).')
  } else {
    log(`${findings.length} target(s) have retained growth requiring inspection:`)
    log('')
    for (const row of findings) {
      log(`  ${row.target} (${row.kind}), ${row.cycles} cycles`)
      const gl = GL_KEYS.filter(key => row.glDelta[key] > 0)
        .map(key => `${key} ${row.glDelta[key] > 0 ? '+' : ''}${row.glDelta[key]} (${row.glLeakPerCycle[key]}/cycle)`)
      if (gl.length) log(`    gpu: ${gl.join(', ')}`)
      if (Object.keys(row.taggedListenerDelta).length) {
        log(`    globals: ${JSON.stringify(row.taggedListenerDelta)}`)
      }
      if (row.nodesDelta > 0) {
        log(`    dom: +${row.nodesDelta} nodes retained after forced GC ` +
          `(${(row.nodesDelta / row.cycles).toFixed(0)}/cycle)`)
      }
      for (const [site, count] of Object.entries(row.leakingListenerSites)) {
        log(`    listener +${count} (${(count / row.cycles).toFixed(1)}/cycle): ${site}`)
      }
      for (const [site, count] of Object.entries(row.activeFrameDelta)) log('    active RAF +' + count + ': ' + site)
      const videoDelta = row.retainedVideosAfter - row.retainedVideosBefore
      if (videoDelta > 0) {
        const perCycle = (videoDelta / row.cycles).toFixed(1)
        log(`    media: +${videoDelta} decoders retained after forced GC (${perCycle}/cycle)`)
        for (const video of row.retainedVideoDetail.slice(0, 6)) {
          log(`      ${video.className} ${video.file} ` +
            `readyState=${video.readyState} networkState=${video.networkState} ` +
            `buffered=${video.bufferedSeconds}s`)
        }
      }
      log('')
    }
  }
  log('='.repeat(78))
  log('')
  log('full table (delta across the measured cycles, sampled after forced GC):')
  const pad = (value, width) => String(value).padStart(width)
  log('  target                        tex  buf prog  fbo  vao   nodes  lstn video newCtx')
  for (const row of rows) {
    log('  ' + String(row.target).padEnd(28) +
      pad(row.glDelta.texture, 4) + pad(row.glDelta.buffer, 5) + pad(row.glDelta.program, 5) +
      pad(row.glDelta.framebuffer, 5) + pad(row.glDelta.vao, 5) +
      pad(row.nodesDelta, 8) + pad(row.listenersDelta, 6) +
      pad(row.retainedVideosAfter - row.retainedVideosBefore, 6) + pad(row.newContexts, 7))
  }
  log('')
  for (const row of rows) {
    log(`  ${String(row.target).padEnd(28)} heap ${row.jsHeapMB.join(' -> ')} MB` +
      `   renderer RSS ${row.rendererMB.join(' -> ')} MB`)
  }
  try {
    fs.writeFileSync(String(logPath).replace(/\.log$/, '.json'), JSON.stringify(rows, null, 2))
  } catch { /* report is best-effort */ }

  contents.debugger.detach()
  window.destroy()
  shutdownServer()
  app.exit(findings.length ? 1 : 0)
}

main().catch(error => {
  log('leak soak failed: ' + (error && error.stack || error))
  try { require_('electron').app.exit(1) } catch { process.exit(1) }
})

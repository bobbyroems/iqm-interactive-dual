const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { Readable } = require('node:stream')
const { app, BrowserWindow, protocol, session } = require('electron')
const {
  APP_PROTOCOL_PRIVILEGES,
  APP_PROTOCOL_SCHEME,
  createAppProtocolHandler,
  createAppUrl
} = require('../electron/app-protocol.cjs')
const { version } = require('../package.json')

protocol.registerSchemesAsPrivileged([{
  scheme: APP_PROTOCOL_SCHEME,
  privileges: APP_PROTOCOL_PRIVILEGES
}])
app.on('window-all-closed', () => {})

let window
let server
const directory = process.env.IQM_FEEDBACK_CHECK_DIRECTORY
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function setupProbe(run) {
  await run(`(async () => {
    globalThis.__feedbackModule = await import('/__feedback-storage.js');
    globalThis.__feedbackTestStore = __feedbackModule.createFeedbackStore({ appVersion: 'probe' });
    globalThis.__rawFeedback = (name, mode = 'readonly', value) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('feedback', mode);
        const store = transaction.objectStore('feedback');
        let result;
        const operation = mode === 'readwrite' ? store.put(value, 'state') : store.get('state');
        operation.onsuccess = () => { result = operation.result };
        transaction.oncomplete = () => { database.close(); resolve(result) };
        transaction.onabort = () => { database.close(); reject(transaction.error) };
      };
    });
  })()`)
}

async function checkStorage(run) {
  await run(`globalThis.__storageCheck = __feedbackModule.createFeedbackStore({
    name: 'feedback-storage-check', appVersion: '2.0.1'
  }); void 0`)
  assert.deepEqual((await run('__storageCheck.getState()')).stats, { count: 0, average: null })
  await run(`__storageCheck.submit({
    rating: 4, reasons: ['clear', 'fun'], moduleId: 'states-of-matter',
    timestamp: 'forged', appVersion: 'forged'
  })`)
  await run(`__storageCheck.submit({ rating: 1, reasons: [], moduleId: null })`)
  let data = await run(`__rawFeedback('feedback-storage-check')`)
  assert.equal(data.responses[0].appVersion, '2.0.1')
  assert.ok(Number.isFinite(Date.parse(data.responses[0].timestamp)))
  assert.notEqual(data.responses[0].id, data.responses[1].id)
  assert.deepEqual(data.responses[0].reasons, ['clear', 'fun'])
  assert.deepEqual((await run('__storageCheck.getState()')).stats, { count: 2, average: 2.5 })
  await run(`globalThis.__otherStore = __feedbackModule.createFeedbackStore({
    name: 'feedback-storage-check', appVersion: 'next'
  }); void 0`)
  assert.deepEqual((await run('__otherStore.getState()')).stats, { count: 2, average: 2.5 })
  await run('__storageCheck.clear()')
  await run(`Promise.all(Array.from({ length: 10 }, (_, index) =>
    (index % 2 ? __storageCheck : __otherStore).submit({ rating: 4, reasons: [], moduleId: null })
  ))`)
  assert.equal((await run('__storageCheck.getState()')).stats.count, 10, 'concurrent connections never lose responses')
  await run('__storageCheck.setPreferences({ enabled: false, delaySeconds: 120 })')
  await assert.rejects(run('__otherStore.submit({ rating: 4, reasons: [], moduleId: null })'), /turned off/)
  assert.deepEqual((await run('__otherStore.getState()')).preferences, { enabled: false, delaySeconds: 120 })
  await run('__storageCheck.setPreferences({ enabled: true, delaySeconds: 90 })')

  await run(`globalThis.__originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.transaction.db.name === 'feedback-storage-check') {
        this.transaction.abort();
        return;
      }
      return __originalPut.apply(this, args);
    }; void 0`)
  await assert.rejects(run('__storageCheck.submit({ rating: 5, reasons: [], moduleId: null })'), /aborted/)
  await run('IDBObjectStore.prototype.put = __originalPut; void 0')
  assert.equal((await run('__storageCheck.getState()')).stats.count, 10, 'aborted writes never report or persist success')

  data = await run(`__rawFeedback('feedback-storage-check')`)
  for (const damaged of [null, { schemaVersion: 2, responses: [] }, {
    ...data, responses: [{ ...data.responses[0], rating: 9 }]
  }]) {
    await run(`__rawFeedback('feedback-storage-check', 'readwrite', ${JSON.stringify(damaged)})`)
    for (const operation of [
      '__storageCheck.getState()',
      '__storageCheck.submit({ rating: 4, reasons: [], moduleId: null })',
      '__storageCheck.setPreferences({ enabled: true, delaySeconds: 60 })',
      '__storageCheck.clear()'
    ]) await assert.rejects(run(operation))
    assert.deepEqual(await run(`__rawFeedback('feedback-storage-check')`), damaged)
  }
  await run(`__rawFeedback('feedback-storage-check', 'readwrite', ${JSON.stringify(data)})`)
  await run(`globalThis.__csvStore = __feedbackModule.createFeedbackStore({
    name: 'feedback-storage-check', appVersion: '=unsafe,"quoted"'
  }); __csvStore.submit({ rating: 4, reasons: ['clear', 'fun'], moduleId: 'states-of-matter' })`)
  const csv = await run('__csvStore.exportCsv()')
  assert.ok(csv.startsWith('\uFEFF"id","timestamp","rating","reasons","moduleId","appVersion"\r\n'))
  assert.ok(csv.includes('"clear;fun","states-of-matter","\'=unsafe,""quoted"""'))
  const cleared = await run('__csvStore.clear()')
  assert.deepEqual(cleared.stats, { count: 0, average: null })
  assert.deepEqual(cleared.preferences, { enabled: true, delaySeconds: 90 })
}

async function runScenario({ url, browser }) {
  const runtime = encodeURIComponent(JSON.stringify({
    appVersion: version, isDevelopment: true, isKiosk: false, config: {}
  }))
  window = new BrowserWindow({
    width: 540, height: 960, useContentSize: true, show: true,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      ...(browser ? {} : {
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        additionalArguments: [`--kiosk-runtime=${runtime}`]
      })
    }
  })
  const run = async script => {
    try {
      return await window.webContents.executeJavaScript(script, true)
    } catch (error) {
      throw new Error(`${error.message}\nRenderer expression: ${script.slice(0, 200)}`, { cause: error })
    }
  }
  const waitFor = async expression => {
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      if (await run(expression)) return
      await sleep(50)
    }
    throw new Error(`Timed out waiting for ${expression}`)
  }
  const load = async () => {
    await window.loadURL(url)
    await waitFor('Boolean(window.__kioskApp?.feedback)')
    await run('__kioskApp.feedback.ready')
    await setupProbe(run)
  }
  await load()
  assert.equal(await run('typeof window.kiosk?.feedback'), 'undefined', 'no feedback IPC bridge is needed')
  if (browser) assert.equal(await run('typeof window.kiosk'), 'undefined')
  await checkStorage(run)
  const store = {
    getState: () => run('__feedbackTestStore.getState()'),
    exportCsv: () => run('__feedbackTestStore.exportCsv()')
  }
  assert.equal(await run('document.querySelector(".feedback-launcher").hidden'), true)
  await run('__kioskApp.openMenu(); document.querySelector(".feedback-launcher").click()')
  assert.equal(await run('__kioskApp.feedback.isOpen()'), true)
  assert.equal(await run('document.querySelector("#kiosk-settings").inert'), true)
  assert.equal(await run('document.activeElement.getAttribute("name")'), 'rating')
  assert.equal(await run('document.querySelector(".feedback-modal [type=submit]").disabled'), true)
  assert.equal(await run('document.querySelectorAll(".feedback-modal input").length'), 5)
  await run('document.querySelector("#feedback-title").click()')
  assert.equal(await run('__kioskApp.feedback.isOpen()'), true)
  await run('document.querySelector(".feedback-overlay").click()')
  assert.equal(await run('__kioskApp.feedback.isOpen()'), false)
  assert.equal((await store.getState()).stats.count, 0)
  await run('document.querySelector(".feedback-launcher").click()')
  await run(`document.querySelector('.feedback-star input[value="4"]').click()`)
  assert.equal(await run('document.querySelectorAll(".feedback-star[data-selected=true]").length'), 4)
  await run(`document.querySelector('.feedback-stars input:checked').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true, cancelable: true
    }))`)
  assert.equal(await run('document.activeElement.type'), 'submit')
  assert.equal(await run(`(() => {
    const modal = document.querySelector('.feedback-modal').getBoundingClientRect();
    const stars = [...document.querySelectorAll('.feedback-star')].map(el => el.getBoundingClientRect());
    const actions = document.querySelector('.feedback-modal .feedback-actions').getBoundingClientRect();
    return modal.left >= 0 && modal.top >= 0 && modal.right <= innerWidth &&
      modal.bottom <= innerHeight && stars.every(rect => rect.width >= 44 && rect.height >= 44) &&
      Math.abs(modal.width / modal.height - 1.22) < 0.02 && actions.top > modal.top + modal.height * 0.8;
  })()`), true)
  await run(`globalThis.__originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      if (this.name === 'iqm-feedback' && args[1] === 'readwrite') {
        throw new DOMException('Test: browser storage quota exceeded.', 'QuotaExceededError');
      }
      return __originalTransaction.apply(this, args);
    }; void 0`)
  assert.equal(await run(`document.querySelector(".feedback-modal form").requestSubmit();
    __kioskApp.feedback.isOpen()`), false, 'Send closes the modal synchronously')
  await waitFor('document.querySelector(".feedback-snackbar").textContent.includes("quota exceeded")')
  assert.equal((await store.getState()).stats.count, 0)
  assert.equal(await run('document.querySelector(".feedback-snackbar button").hidden'), false)
  await run('IDBDatabase.prototype.transaction = __originalTransaction; void 0')
  await run('document.querySelector(".feedback-snackbar button").click()')
  await waitFor('document.querySelector(".feedback-snackbar").textContent.includes("Thank you!")')
  assert.equal(await run('__kioskApp.feedback.isOpen()'), false)
  assert.equal(await run('document.querySelector("#kiosk-settings").inert'), false)
  assert.equal(await run(`(() => {
    const rect = document.querySelector('.feedback-snackbar').getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth &&
      innerHeight - rect.bottom >= 16 && innerHeight - rect.bottom <= 64;
  })()`), true)
  const saved = (await run(`__rawFeedback('iqm-feedback')`)).responses[0]
  assert.equal(saved.rating, 4)
  assert.deepEqual(saved.reasons, [])
  assert.equal(saved.appVersion, version)
  await waitFor('document.querySelector(".feedback-snackbar").hidden')
  await run(`document.querySelector('[data-feedback-delay]').value = '0';
    document.querySelector('[data-feedback-delay]').dispatchEvent(new Event('change'))`)
  await waitFor('document.querySelector(".feedback-controls__message").textContent.includes("settings saved")')

  await load()
  assert.deepEqual((await store.getState()).stats, { count: 1, average: 4 })
  assert.equal((await store.getState()).preferences.delaySeconds, 0, 'preferences persist across reload')
  await run('__kioskApp.goHome(); __kioskApp.openMenu(); __kioskApp.openModule("qubit-explorer")')
  await waitFor('__kioskApp.router.currentScreen === "module" && !__kioskApp.isOpeningExperience')
  await run('__kioskApp.openMenu()')
  assert.equal(await run('__kioskApp.feedback.isOpen()'), true)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitFor('!__kioskApp.feedback.isOpen()')
  assert.equal(await run('__kioskApp.router.currentScreen'), 'menu')
  await run('__kioskApp.openModule("qubit-explorer")')
  await waitFor('!__kioskApp.isOpeningExperience')
  await run('__kioskApp.openMenu()')
  assert.equal(await run('__kioskApp.feedback.isOpen()'), false)
  await run('__kioskApp.goHome(); __kioskApp.openMenu(); __kioskApp.openModule("qubit-explorer")')
  await waitFor('!__kioskApp.isOpeningExperience')
  await run('__kioskApp.onIdle()')
  assert.equal(await run('__kioskApp.feedback.isOpen()'), false)
  await run('__kioskApp.onIdle()')
  assert.equal(await run('__kioskApp.router.currentScreen'), 'attract')
  await run('__kioskApp.openMenu(); document.querySelector(".feedback-launcher").click()')
  assert.equal(await run('document.querySelectorAll(".feedback-star input:checked").length'), 0)
  assert.equal(await run(`document.querySelector('.feedback-star input[value="2"]').click();
    document.querySelector('.feedback-modal form').requestSubmit();
    const closed = !__kioskApp.feedback.isOpen();
    __kioskApp.goHome();
    closed`), true)
  await waitFor('document.querySelector("[data-feedback-stats]").textContent.startsWith("2 responses")')
  assert.equal(await run('document.querySelector(".feedback-snackbar").hidden'), true)
  await run('__kioskApp.openMenu()')
  assert.deepEqual((await store.getState()).stats, { count: 2, average: 3 })
  const exportPath = path.join(directory, `${browser ? 'browser' : 'electron'}-ratings.csv`)
  const downloaded = new Promise((resolve, reject) => {
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(exportPath)
      item.once('done', (_done, state) => {
        if (state === 'completed') resolve()
        else reject(new Error(`CSV download ${state}`))
      })
    })
  })
  await run('document.querySelector("[data-feedback-export]").click()')
  await downloaded
  await waitFor('document.querySelector(".feedback-controls__message").textContent.includes("download started")')
  assert.equal(await fs.readFile(exportPath, 'utf8'), await store.exportCsv())
  await run('globalThis.confirm = () => false; document.querySelector("[data-feedback-clear]").click()')
  assert.equal(await run('document.querySelector(".feedback-controls__message").textContent'), 'Canceled.')
  assert.equal((await store.getState()).stats.count, 2)
  await run('globalThis.confirm = () => true; document.querySelector("[data-feedback-clear]").click()')
  await waitFor('document.querySelector(".feedback-controls__message").textContent.includes("deleted")')
  assert.equal((await store.getState()).stats.count, 0)
  await run('document.querySelector("[data-feedback-enabled]").click()')
  await waitFor('document.querySelector(".feedback-controls__message").textContent.includes("settings saved")')
  await load()
  assert.deepEqual((await store.getState()).preferences, { enabled: false, delaySeconds: 0 })
  assert.equal(await run('document.querySelector(".feedback-launcher").hidden'), true)
  await run('__kioskApp.feedback.dispose()')
  assert.equal(await run('Boolean(document.querySelector(".feedback-snackbar"))'), false)
  window.destroy()
  console.log(`Feedback ${browser ? 'browser (HTTP, no preload)' : 'Electron (packaged protocol)'} check passed: real IndexedDB, concurrent/aborted writes, corruption protection, reload persistence, modal/snackbar, retry, CSV download and confirmed clear.`)
}

async function main() {
  if (!directory) throw new Error('Run this check through node scripts/check-feedback.mjs.')
  app.setPath('userData', path.join(directory, 'profile'))
  await app.whenReady()
  const renderer = createAppProtocolHandler({ rendererRoot: path.join(__dirname, '..', 'dist') })
  const storageSource = await fs.readFile(path.join(__dirname, '..', 'src', 'js', 'addons', 'feedback', 'storage.js'), 'utf8')
  const serve = request => new URL(request.url).pathname === '/__feedback-storage.js'
    ? new Response(storageSource, { headers: { 'Content-Type': 'text/javascript' } })
    : renderer(request)
  protocol.handle(APP_PROTOCOL_SCHEME, serve)
  server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      const result = await serve(new Request(createAppUrl(pathname), {
        method: request.method, headers: request.headers
      }))
      response.writeHead(result.status, Object.fromEntries(result.headers))
      if (result.body) Readable.fromWeb(result.body).pipe(response)
      else response.end()
    } catch (error) {
      console.error('Feedback check HTTP request failed.', error)
      response.writeHead(500).end('Feedback check request failed.')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  session.defaultSession.webRequest.onBeforeRequest({
    urls: ['http://*/*', 'https://*/*']
  }, (details, callback) => callback({ cancel: new URL(details.url).origin !== origin }))
  await runScenario({ url: `${origin}/index.html`, browser: true })
  await runScenario({ url: createAppUrl(), browser: false })
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  if (window && !window.isDestroyed()) window.destroy()
  if (server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  app.exit(process.exitCode || 0)
})

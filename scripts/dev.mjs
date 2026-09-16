import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const host = '127.0.0.1'
const startingPort = 5173

let electronProcess = null
let shuttingDown = false

const vite = await createServer({
  server: {
    host,
    port: startingPort,
    strictPort: false
  }
})

async function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (electronProcess && !electronProcess.killed) electronProcess.kill()
  await vite.close()
  process.exitCode = exitCode
}

try {
  await vite.listen()
  vite.printUrls()

  const address = vite.httpServer?.address()
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not report a TCP development port.')
  }

  const devServerUrl = `http://${host}:${address.port}`
  if (address.port !== startingPort) {
    console.info(`[dev] Port ${startingPort} is busy; using ${address.port}.`)
  }

  electronProcess = spawn(electronPath, ['.', '--dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      IQM_DEV_SERVER_URL: devServerUrl
    },
    stdio: 'inherit'
  })

  electronProcess.once('error', error => {
    console.error('[dev] Electron failed to start.', error)
    void shutdown(1)
  })
  electronProcess.once('exit', code => {
    void shutdown(code ?? 0)
  })
} catch (error) {
  console.error('[dev] Development server failed to start.', error)
  await shutdown(1)
}

process.once('SIGINT', () => { void shutdown(0) })
process.once('SIGTERM', () => { void shutdown(0) })

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'

const directory = await mkdtemp(path.join(os.tmpdir(), 'iqm-telemetry-smoke-'))
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(import.meta.dirname, 'check-telemetry.cjs')], {
      stdio: 'inherit',
      env: { ...process.env, IQM_TELEMETRY_SMOKE_DIR: directory }
    })
    child.once('error', reject)
    child.once('exit', (status, signal) => {
      if (signal) reject(new Error(`Electron telemetry check terminated by ${signal}.`))
      else resolve(status ?? 1)
    })
  })
  process.exitCode = code
} finally {
  // Chromium holds profile files until Electron exits, including on Windows.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

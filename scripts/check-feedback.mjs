import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const directory = await mkdtemp(path.join(os.tmpdir(), 'iqm-feedback-smoke-'))
try {
  const script = fileURLToPath(new URL('./check-feedback.cjs', import.meta.url))
  const environment = { ...process.env, IQM_FEEDBACK_CHECK_DIRECTORY: directory }
  delete environment.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, [script], { stdio: 'inherit', env: environment })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Feedback check terminated by ${signal}.`))
      else resolve(code ?? 1)
    })
  })
  process.exitCode = code
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

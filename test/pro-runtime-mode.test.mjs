import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { resolveRuntimeMode } = require('../electron/runtime-mode.cjs')

test('supervised launch cannot bypass the native PIN using app quit/review flags', () => {
  for (const flags of [[], ['--allow-quit'], ['--windowed'], ['--dev'], ['--dev', '--windowed', '--allow-quit']]) {
    const mode = resolveRuntimeMode(['--supervised', ...flags], { defaultLaunchMode: 'windowed', defaultAllowQuit: true })
    assert.equal(mode.allowQuit, false)
    assert.equal(mode.isKiosk, true)
    assert.equal(mode.isDevelopment, false)
    assert.equal(mode.isWindowed, false)
  }
})
test('ordinary review and Enterprise runtime defaults remain independent of Pro supervision', () => {
  assert.equal(resolveRuntimeMode([], { defaultAllowQuit: true }).allowQuit, true)
  assert.equal(resolveRuntimeMode(['--allow-quit']).allowQuit, true)
  assert.equal(resolveRuntimeMode(['--dev']).isWindowed, true)
  assert.equal(resolveRuntimeMode(['--windowed']).allowQuit, true)
  assert.equal(resolveRuntimeMode([]).allowQuit, false)
  assert.equal(resolveRuntimeMode([]).isSupervised, false)
})

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  applyGraphicsPolicy,
  getGraphicsSwitches
} = require('../electron/graphics-policy.cjs')

test('Windows production kiosk uses the low-pressure compositor policy', () => {
  assert.deepEqual(
    getGraphicsSwitches({ isShellHosted: true, platform: 'win32' }),
    ['disable-direct-composition', 'disable-gpu-rasterization']
  )
})

test('review windows and non-Windows builds keep their default compositor', () => {
  assert.deepEqual(
    getGraphicsSwitches({ isShellHosted: false, platform: 'win32' }),
    []
  )
  assert.deepEqual(
    getGraphicsSwitches({ isShellHosted: true, platform: 'darwin' }),
    []
  )
})

test('graphics policy applies every selected Chromium switch', () => {
  const appended = []
  const switches = applyGraphicsPolicy(
    { appendSwitch: name => appended.push(name) },
    { isShellHosted: true, platform: 'win32' }
  )

  assert.deepEqual(switches, ['disable-direct-composition', 'disable-gpu-rasterization'])
  assert.deepEqual(appended, switches)
})

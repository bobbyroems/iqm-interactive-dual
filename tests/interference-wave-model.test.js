import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createInterferenceWaveField,
  INTERFERENCE_TOUCH_RIPPLE_INTERVAL,
  INTERFERENCE_TOUCH_RIPPLE_LIMIT
} from '../src/js/modules/quantum-vs-classical/interference-wave-model.js'

const POSITIONS = [
  { x: -1, z: 0 },
  { x: 1, z: 0 }
]

test('touch ripples are rate limited without growing beyond the fixed pool', () => {
  const field = createInterferenceWaveField({ positions: POSITIONS })

  assert.equal(field.addTouchRipple(0, 0, 0), true)
  assert.equal(field.addTouchRipple(0.1, 0.1, INTERFERENCE_TOUCH_RIPPLE_INTERVAL / 2), false)
  assert.equal(field.touchRippleCount, 1)

  for (let index = 1; index <= INTERFERENCE_TOUCH_RIPPLE_LIMIT + 2; index += 1) {
    assert.equal(
      field.addTouchRipple(index, index, index * INTERFERENCE_TOUCH_RIPPLE_INTERVAL),
      true
    )
  }

  assert.equal(field.touchRippleCount, INTERFERENCE_TOUCH_RIPPLE_LIMIT)
})

test('reset clears the touch-ripple cooldown', () => {
  const field = createInterferenceWaveField({ positions: POSITIONS })

  assert.equal(field.addTouchRipple(0, 0, 10), true)
  field.reset()
  assert.equal(field.addTouchRipple(0, 0, 0), true)
})

test('touch ripples preserve the original fully additive wave field', () => {
  const sampleTime = 1
  const first = createInterferenceWaveField({ positions: POSITIONS })
  const second = createInterferenceWaveField({ positions: POSITIONS })
  const combined = createInterferenceWaveField({ positions: POSITIONS })

  first.addTouchRipple(0, 0, 0)
  second.addTouchRipple(0.3, 0, INTERFERENCE_TOUCH_RIPPLE_INTERVAL)
  combined.addTouchRipple(0, 0, 0)
  combined.addTouchRipple(0.3, 0, INTERFERENCE_TOUCH_RIPPLE_INTERVAL)

  for (const sampleX of [0.2, 0.6, 1, 1.2]) {
    const firstHeight = first.sample(sampleX, 0, sampleTime).height
    const secondHeight = second.sample(sampleX, 0, sampleTime).height
    const combinedHeight = combined.sample(sampleX, 0, sampleTime).height
    assert.ok(Math.abs(combinedHeight - (firstHeight + secondHeight)) < 1e-12)
  }
})

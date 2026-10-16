import test from 'node:test'
import assert from 'node:assert/strict'
import { fitProtectionVisual, PROTECTION_VISUAL_STAGE } from '../src/js/modules/protecting-information/protecting-information-layout.js'
import { valueFromDialPoint } from '../src/js/modules/protecting-information/protecting-information-state.js'
import { accumulateDialTurn } from '../src/js/modules/protecting-information/parameter-dial.js'

test('the registered protection composition fits and centers in responsive artwork areas', () => {
  for (const [width, height] of [[288, 280], [536, 280], [736, 460], [1408, 600], [2064, 1728], [3344, 648]]) {
    const { scale, left, top } = fitProtectionVisual(width, height)
    const renderedWidth = PROTECTION_VISUAL_STAGE.width * scale
    const renderedHeight = PROTECTION_VISUAL_STAGE.height * scale
    assert(left >= -1e-9 && top >= -1e-9)
    assert(renderedWidth <= width + 1e-9 && renderedHeight <= height + 1e-9)
    assert(Math.abs(left * 2 + renderedWidth - width) < 1e-9)
    assert(Math.abs(top * 2 + renderedHeight - height) < 1e-9)
  }
  assert(Number.isFinite(fitProtectionVisual(0, 0).scale))
})

test('dial rotation uses the rendered bounds at every responsive size', () => {
  for (const size of [88, 128, 240, 420]) {
    const bounds = { left: 24, top: 100, width: size, height: size }
    const centerX = bounds.left + size / 2
    const centerY = bounds.top + size / 2
    for (const [dx, dy, expected] of [[0, -1, 0], [1, 0, 0.25], [0, 1, 0.5], [-1, 0, 0.75]]) {
      assert.equal(valueFromDialPoint({ x: centerX + dx * size / 3, y: centerY + dy * size / 3 }, bounds), expected)
    }
  }
  assert.equal(accumulateDialTurn(0, 0, 90), 0.25)
  assert.equal(accumulateDialTurn(0, 0, 350), 0)
  assert.equal(accumulateDialTurn(1, 350, 10), 1)
})

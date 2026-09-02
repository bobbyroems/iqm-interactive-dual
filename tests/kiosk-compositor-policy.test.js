import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')

function ruleStartingWith(selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `Missing CSS rule starting with ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  assert.notEqual(open, -1, `Missing declaration block for ${selector}`)
  assert.notEqual(close, -1, `Unclosed declaration block for ${selector}`)
  return css.slice(open + 1, close)
}

test('production kiosk removes the oversized animated aurora surfaces', () => {
  const block = ruleStartingWith('body.is-kiosk .screen--attract::before,')
  assert.match(block, /display:\s*none/)
  assert.match(block, /animation:\s*none/)
  assert.match(block, /will-change:\s*auto/)

  // The authored review-window treatment remains available outside kiosk mode.
  const authoredBlock = ruleStartingWith('.screen--attract::before,')
  assert.match(authoredBlock, /inset:\s*-35%/)
  assert.match(authoredBlock, /will-change:\s*transform/)
})

test('production kiosk does not permanently promote the full carousel track', () => {
  const block = ruleStartingWith('body.is-kiosk .module-carousel__track')
  assert.match(block, /translateX\(/)
  assert.match(block, /transition:\s*none/)
  assert.match(block, /will-change:\s*auto/)
  assert.match(
    ruleStartingWith('body.is-kiosk .module-card.is-distant'),
    /visibility:\s*hidden/
  )
  assert.match(
    ruleStartingWith('body.is-kiosk .module-card.is-distant.is-carousel-transition-card'),
    /visibility:\s*visible/
  )
})

test('production kiosk avoids duplicate screen transitions and backdrop copies', () => {
  const screenBlock = ruleStartingWith('body.is-kiosk .screen {')
  assert.match(screenBlock, /opacity:\s*1/)
  assert.match(screenBlock, /transition:\s*none/)

  const statesVideoBlock = ruleStartingWith('body.is-kiosk .som__video')
  assert.match(statesVideoBlock, /filter:\s*none/)
  assert.match(statesVideoBlock, /will-change:\s*auto/)

  const backdropBlock = ruleStartingWith('body.is-kiosk #kiosk-stage *')
  assert.match(backdropBlock, /-webkit-backdrop-filter:\s*none\s*!important/)
  assert.match(backdropBlock, /backdrop-filter:\s*none\s*!important/)
})

test('production attract screen does not temporarily promote the 4K hero', () => {
  const block = ruleStartingWith('body.is-kiosk .screen--attract.is-active .attract-footer,')
  assert.match(block, /animation:\s*none/)
  assert.match(css, /body\.is-kiosk \.screen--attract\.is-active \.attract-chip,/)
  assert.match(css, /body\.is-kiosk \.screen\.is-active \.reveal-word__inner,/)
})

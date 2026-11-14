import assert from 'node:assert/strict'
import test from 'node:test'
import { ModuleCarousel } from '../src/js/core/module-carousel.js'

test('keyboard activation opens the selected card without targeting its decorative footer', () => {
  const opened = []
  const card = { dataset: { moduleId: 'measurement-based' } }
  const carousel = {
    cards: [card], currentIndex: 0,
    onOpen: id => opened.push(id)
  }
  const event = {
    detail: 0,
    target: { closest: selector => selector === '[data-module-id]' ? card : null }
  }
  ModuleCarousel.prototype.handleCardClick.call(carousel, event)
  assert.deepEqual(opened, ['measurement-based'])
  event.detail = 1
  ModuleCarousel.prototype.handleCardClick.call(carousel, event)
  assert.equal(opened.length, 1, 'pointer clicks outside the footer must retain preview interactions')
})

test('vertical wheel scrolling remains available in an overflowing menu viewport', () => {
  const carousel = {
    viewport: { contains: () => true, scrollHeight: 300, clientHeight: 180 },
    lastWheelAt: -1000,
    moveBy: () => assert.fail('vertical scrolling must not select another card')
  }
  ModuleCarousel.prototype.handleWheel.call(carousel, {
    deltaY: 40, deltaX: 0,
    preventDefault: () => assert.fail('native vertical scrolling must not be prevented')
  })
  let moved = 0
  carousel.moveBy = direction => { moved = direction }
  ModuleCarousel.prototype.handleWheel.call(carousel, {
    deltaY: 0, deltaX: 40, preventDefault() {}
  })
  assert.equal(moved, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ModuleCarousel,
  boundedCarouselCandidateIndexes,
  createBoundedCarouselMotionPlan
} from '../src/js/core/module-carousel.js'

test('adjacent kiosk motion FLIPs only cards visible before and after the snap', () => {
  assert.deepEqual(boundedCarouselCandidateIndexes(2, 3, 7), [2, 3])

  const plan = createBoundedCarouselMotionPlan({
    beforeCards: [
      { cardIndex: 1, left: -1112, opacity: 0.32, visible: true },
      { cardIndex: 2, left: 0, opacity: 1, visible: true },
      { cardIndex: 3, left: 1112, opacity: 0.32, visible: true }
    ],
    afterCards: [
      { cardIndex: 2, left: -1112, opacity: 0.32, visible: true },
      { cardIndex: 3, left: 0, opacity: 1, visible: true }
    ],
    direction: 1,
    nextIndex: 3,
    previousIndex: 2,
    scale: 0.5,
    step: 2224
  })

  assert.deepEqual(plan.map(actor => actor.cardIndex), [2, 3])
  assert.deepEqual(plan.map(actor => actor.fromX), [2224, 2224])
  assert.deepEqual(plan.map(actor => actor.toX), [0, 0])
  assert.deepEqual(plan.map(actor => [actor.fromOpacity, actor.toOpacity]), [
    [1, 0.32],
    [0.32, 1]
  ])
})

test('bounded kiosk motion never selects more than three card surfaces', () => {
  for (let previousIndex = 0; previousIndex < 7; previousIndex += 1) {
    for (let nextIndex = 0; nextIndex < 7; nextIndex += 1) {
      assert.ok(
        boundedCarouselCandidateIndexes(previousIndex, nextIndex, 7).length <= 3,
        `motion ${previousIndex}->${nextIndex} exceeded the bounded card budget`
      )
    }
  }
})

test('wrap motion uses only outgoing and incoming cards with a one-card sweep', () => {
  assert.deepEqual(boundedCarouselCandidateIndexes(6, 0, 7), [6, 0])

  const plan = createBoundedCarouselMotionPlan({
    beforeCards: [
      { cardIndex: 5, left: -2224, opacity: 0.32, visible: true },
      { cardIndex: 6, left: 0, opacity: 1, visible: true }
    ],
    afterCards: [
      { cardIndex: 6, left: 13344, opacity: 0.2, visible: false },
      { cardIndex: 0, left: 0, opacity: 1, visible: true }
    ],
    direction: 1,
    nextIndex: 0,
    previousIndex: 6,
    scale: 1,
    step: 2224
  })

  assert.equal(plan.length, 2)
  assert.deepEqual(plan[0], {
    cardIndex: 6,
    fromOpacity: 1,
    fromX: -13344,
    retainVisibility: true,
    toOpacity: 0,
    toX: -15568
  })
  assert.deepEqual(plan[1], {
    cardIndex: 0,
    fromOpacity: 0.32,
    fromX: 2224,
    retainVisibility: false,
    toOpacity: 1,
    toX: 0
  })
})

test('drag snapback is omitted when the measured visual state is already settled', () => {
  const cards = [
    { cardIndex: 1, left: 0, opacity: 1, visible: true }
  ]
  assert.deepEqual(createBoundedCarouselMotionPlan({
    afterCards: cards,
    beforeCards: cards,
    direction: 0,
    nextIndex: 1,
    previousIndex: 1,
    scale: 1,
    step: 2224
  }), [])
})

test('completed bounded motion releases animation effects and temporary visibility', () => {
  let cancelled = 0
  let visibilityReleased = 0
  let rootStateReleased = 0
  const carousel = Object.create(ModuleCarousel.prototype)
  carousel.cardMotion = {
    token: 4,
    animations: [{ cancel: () => { cancelled += 1 } }],
    retainedCards: [{
      classList: {
        remove: className => {
          assert.equal(className, 'is-carousel-transition-card')
          visibilityReleased += 1
        }
      }
    }]
  }
  carousel.root = {
    classList: {
      remove: className => {
        assert.equal(className, 'is-card-transitioning')
        rootStateReleased += 1
      }
    }
  }

  carousel.finishBoundedCardMotion(3)
  assert.equal(cancelled, 0)
  carousel.finishBoundedCardMotion(4)
  assert.equal(carousel.cardMotion, null)
  assert.equal(cancelled, 1)
  assert.equal(visibilityReleased, 1)
  assert.equal(rootStateReleased, 1)
})

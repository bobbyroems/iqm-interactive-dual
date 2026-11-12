import assert from 'node:assert/strict'
import test from 'node:test'
import { KioskApp } from '../src/js/app.js'
import { ModuleCarousel } from '../src/js/core/module-carousel.js'

test('menu media loads only for the selected card while the carousel is active', () => {
  const events = []
  const media = id => ({
    dataset: { previewSrc: `${id}.webp` },
    set src(value) { events.push(['load', value]) },
    removeAttribute() { delete this.dataset.previewSrc }
  })
  const selected = media('selected')
  const hidden = media('hidden')
  const video = id => ({
    play() { events.push(['play', id]); return Promise.resolve() },
    pause() { events.push(['pause', id]) }
  })
  const cards = [selected, hidden].map((image, index) => ({
    querySelectorAll: () => image.dataset.previewSrc ? [image] : [],
    querySelector: () => videos[index]
  }))
  const videos = [video('selected'), video('hidden')]
  const carousel = { cards, currentIndex: 0, active: false }
  const update = () => ModuleCarousel.prototype.updatePreviewVideoPlayback.call(carousel)

  update()
  assert.equal(events.some(([event]) => event === 'load'), false)
  events.length = 0
  carousel.active = true
  update()
  assert.deepEqual(events, [
    ['load', 'selected.webp'],
    ['play', 'selected'],
    ['pause', 'hidden']
  ])
  events.length = 0
  update()
  assert.equal(events.some(([event]) => event === 'load'), false)
  carousel.currentIndex = 1
  update()
  assert.ok(events.some(([event, source]) => event === 'load' && source === 'hidden.webp'))
})

test('browser menu starts only the selected live preview and suspends Majorana when leaving its card', () => {
  const events = []
  const card = { dataset: { moduleId: 'nanoscale' } }
  const app = {
    router: { currentScreen: 'attract' },
    moduleCarousel: { cards: [card], currentIndex: 0 },
    eagerPreviews: false,
    ensureShapeScenes: () => events.push('shape'),
    ensureMajoranaMenuPreview: () => events.push('majorana'),
    majoranaPreviewController: { setSuspended: value => events.push(value) }
  }
  const update = () => KioskApp.prototype.updateMenuPreviews.call(app)

  update()
  assert.deepEqual(events, [])
  app.router.currentScreen = 'menu'
  update()
  assert.deepEqual(events, ['shape', true])
  events.length = 0
  card.dataset.moduleId = 'build-majorana-2'
  update()
  assert.deepEqual(events, ['shape', false, 'majorana'])
  events.length = 0
  card.dataset.moduleId = 'states-of-matter'
  update()
  assert.deepEqual(events, ['shape', true])
})

test('browser shape loading ignores unselected cards before importing the scene pool', async () => {
  const hidden = {
    closest: () => ({ dataset: { moduleId: 'states-of-matter' } }),
    hasAttribute: () => false
  }
  const app = {
    eagerPreviews: false,
    moduleGrid: { querySelectorAll: () => [hidden] },
    moduleCarousel: { cards: [{ dataset: { moduleId: 'build-majorana-2' } }], currentIndex: 0 }
  }
  assert.equal(await KioskApp.prototype.ensureShapeScenes.call(app), null)
  assert.equal(app.shapeScenePoolPromise, undefined)
})

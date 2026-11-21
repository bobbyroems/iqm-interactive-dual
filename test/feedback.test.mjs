import assert from 'node:assert/strict'
import test from 'node:test'
import { FeedbackSession } from '../src/js/addons/feedback/session.js'
import { createFeedbackStore } from '../src/js/addons/feedback/storage.js'

const response = { rating: 4, reasons: [], moduleId: 'states-of-matter' }
const preferences = { enabled: true, delaySeconds: 60 }

test('unavailable or denied browser storage rejects explicitly and can be retried', async () => {
  let available = false
  const store = createFeedbackStore({
    appVersion: 'test',
    getIndexedDB: () => {
      if (!available) return undefined
      throw new DOMException('Site storage is blocked.', 'SecurityError')
    }
  })
  await assert.rejects(store.getState(), /unavailable/)
  await assert.rejects(store.submit(response), /unavailable/)
  available = true
  await assert.rejects(store.getState(), { name: 'SecurityError' })
})

test('invalid ratings, reasons and module identifiers are rejected before accessing storage', async () => {
  const store = createFeedbackStore({
    appVersion: 'test',
    getIndexedDB: () => { throw new Error('Storage must not be accessed for invalid input.') }
  })
  for (const rating of [0, 6, 2.5, '5', NaN]) {
    await assert.rejects(store.submit({ ...response, rating }), /between 1 and 5 stars/)
  }
  for (const reasons of [['other'], ['fun', 'fun'], null]) {
    await assert.rejects(store.submit({ ...response, reasons }), /available feedback reasons/)
  }
  for (const moduleId of ['=FORMULA()', 'x'.repeat(101)]) {
    await assert.rejects(store.submit({ ...response, moduleId }), /Invalid feedback module/)
  }
  await assert.rejects(store.submit(null), /between 1 and 5 stars/)
  for (const delaySeconds of [-1, 601, 1.5, '60', NaN]) {
    await assert.rejects(store.setPreferences({ enabled: true, delaySeconds }), /between 0 and 600 seconds/)
  }
})

test('automatic prompting waits for the exact threshold and a module-to-menu return', () => {
  let time = 0
  const session = new FeedbackSession({ now: () => time })
  assert.equal(session.visit('menu', {}, preferences), false)
  assert.equal(session.visit('module', { moduleId: 'qubit-explorer' }, preferences), false)
  time = 59999
  assert.equal(session.visit('menu', {}, preferences), false)
  time = 60000
  assert.equal(session.visit('menu', {}, preferences), true)
  session.markPrompted()
  time = 120000
  assert.equal(session.visit('menu', {}, preferences), false)
  assert.equal(session.lastModuleId, 'qubit-explorer')
})

test('manual/skip suppression resets on attract; idle returns and disabled feedback never prompt', () => {
  let time = 0
  const session = new FeedbackSession({ now: () => time })
  session.visit('module', { moduleId: 'states-of-matter' }, preferences)
  time = 60000
  assert.equal(session.visit('menu', { automatic: false }, preferences), false)
  assert.equal(session.visit('menu', {}, { ...preferences, enabled: false }), false)
  session.markPrompted()
  assert.equal(session.visit('menu', {}, preferences), false)
  session.visit('attract', {}, preferences)
  assert.equal(session.lastModuleId, null)
  assert.equal(session.prompted, false)
  session.visit('module', { moduleId: 'qubit-explorer' }, preferences)
  time = 120000
  assert.equal(session.visit('menu', {}, preferences), true)
})

test('zero delay still requires a module; browsing the initial menu never prompts', () => {
  const session = new FeedbackSession({ now: () => 0 })
  const immediate = { enabled: true, delaySeconds: 0 }
  assert.equal(session.visit('menu', {}, immediate), false)
  session.visit('module', { moduleId: 'qubit-explorer' }, immediate)
  assert.equal(session.visit('menu', {}, immediate), true)
})

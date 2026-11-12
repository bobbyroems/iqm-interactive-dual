import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const loader = await readFile(new URL('../src/js/clarity.js', import.meta.url), 'utf8')
const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8')

function loadClarity(window = {}) {
  const scripts = []
  const warnings = []
  const context = {
    window,
    document: {
      createElement(tag) {
        assert.equal(tag, 'script')
        return {
          addEventListener(event, callback) {
            assert.equal(event, 'error')
            this.onError = callback
          }
        }
      },
      head: { appendChild: script => scripts.push(script) }
    },
    console: { warn: message => warnings.push(message) }
  }
  vm.runInNewContext(loader, context)
  return { window, scripts, warnings }
}

test('Clarity uses an asynchronous external loader and queues early calls', () => {
  const { window, scripts } = loadClarity()
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0].src, 'https://www.clarity.ms/tag/yq1mx1084q')
  assert.equal(scripts[0].async, true)
  window.clarity('event', 'test-event')
  assert.deepEqual(Array.from(window.clarity.q[0]), ['event', 'test-event'])
})

test('Clarity preserves an existing API and reports load failures', () => {
  const clarity = () => {}
  const { window, scripts, warnings } = loadClarity({ clarity })
  assert.equal(window.clarity, clarity)
  scripts[0].onError()
  assert.deepEqual(warnings, ['[clarity] Analytics could not load; kiosk operation is unaffected.'])
})

test('CSP allows Clarity endpoints without allowing inline scripts or other origins', () => {
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1]
  const directives = Object.fromEntries(policy.split(';').map(directive => {
    const [name, ...sources] = directive.trim().split(/\s+/)
    return [name, sources]
  }))
  assert.deepEqual(directives['default-src'], ["'self'"])
  assert.deepEqual(directives['script-src'], ["'self'", "'wasm-unsafe-eval'", 'https://*.clarity.ms'])
  assert.deepEqual(directives['connect-src'], [
    "'self'", 'blob:', 'ws://127.0.0.1:*', 'https://*.clarity.ms', 'https://c.bing.com'
  ])
  assert.deepEqual(directives['img-src'], [
    "'self'", 'data:', 'blob:', 'https://*.clarity.ms', 'https://c.bing.com'
  ])
  assert.match(html, /<script type="module" src="\/js\/clarity\.js"><\/script>/)
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/)
})

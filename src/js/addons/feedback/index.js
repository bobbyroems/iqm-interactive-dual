import { FeedbackSession } from './session.js'
import { createFeedbackStore } from './storage.js'
import { version as appVersion } from '../../../../package.json'

export function createFeedbackAddon({
  stage,
  settingsPanel,
  api = createFeedbackStore({ appVersion }),
  onActivity = () => {},
  onBeforeOpen = () => {}
}) {
  const abort = new AbortController()
  const session = new FeedbackSession()
  const launcher = document.createElement('button')
  launcher.type = 'button'
  launcher.className = 'feedback-launcher'
  launcher.textContent = 'Give feedback'
  launcher.setAttribute('aria-haspopup', 'dialog')
  launcher.hidden = true

  const overlay = document.createElement('div')
  overlay.className = 'feedback-overlay'
  overlay.setAttribute('data-clarity-mask', 'true')
  overlay.hidden = true
  overlay.innerHTML = `
    <section class="feedback-modal" role="dialog" aria-modal="true"
      aria-labelledby="feedback-title" aria-describedby="feedback-rating-guide" tabindex="-1">
      <h2 id="feedback-title">How is it going so far?</h2>
      <form>
        <fieldset class="feedback-rating">
          <legend>Your rating</legend>
          <div class="feedback-stars">
            ${[1, 2, 3, 4, 5].map(rating => `
              <label class="feedback-star">
                <input type="radio" name="rating" value="${rating}" aria-label="${rating} ${rating === 1 ? 'star' : 'stars'}" required>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"/></svg>
              </label>`).join('')}
          </div>
          <p class="feedback-rating-label" id="feedback-rating-guide" aria-live="polite">1 = Not great, 5 = Excellent</p>
        </fieldset>
        <div class="feedback-actions">
          <button type="button" class="feedback-button" data-feedback-skip>Not now</button>
          <button type="submit" class="feedback-button feedback-button--primary" disabled>Send feedback</button>
        </div>
      </form>
    </section>`

  const snackbar = document.createElement('div')
  snackbar.className = 'feedback-snackbar'
  snackbar.setAttribute('role', 'status')
  snackbar.setAttribute('aria-live', 'polite')
  snackbar.setAttribute('aria-atomic', 'true')
  snackbar.setAttribute('data-clarity-mask', 'true')
  snackbar.hidden = true
  const snackbarMessage = document.createElement('span')
  const snackbarRetry = document.createElement('button')
  snackbarRetry.type = 'button'
  snackbarRetry.className = 'feedback-button'
  snackbarRetry.textContent = 'Retry'
  snackbarRetry.hidden = true
  snackbar.append(snackbarMessage, snackbarRetry)
  document.body.append(snackbar)

  const controls = document.createElement('section')
  controls.className = 'kiosk-settings__group feedback-controls'
  controls.setAttribute('data-clarity-mask', 'true')
  controls.innerHTML = `
    <h2 class="kiosk-settings__label">Visitor feedback</h2>
    <fieldset disabled>
      <label class="feedback-toggle"><input type="checkbox" data-feedback-enabled> Enable feedback</label>
      <label class="feedback-delay">Prompt after <output>60 s</output>
        <input class="kiosk-settings__slider" type="range" min="0" max="600" step="15"
          value="60" aria-label="Feedback prompt delay in seconds" data-feedback-delay>
      </label>
      <p class="feedback-controls__hint">On the next menu return, once per visitor. Idle returns do not prompt.</p>
      <p data-feedback-stats>No responses yet.</p>
      <div class="feedback-actions">
        <button type="button" class="feedback-button" data-feedback-export>Export CSV</button>
        <button type="button" class="feedback-button" data-feedback-clear>Clear data</button>
      </div>
    </fieldset>
    <p class="feedback-controls__message" role="status" aria-live="polite"></p>
    <button type="button" class="feedback-button" data-feedback-retry hidden>Retry storage</button>`
  settingsPanel.append(controls)
  stage.append(launcher, overlay)

  const find = selector => overlay.querySelector(selector)
  const form = find('form')
  const modal = find('[role="dialog"]')
  const submit = find('[type="submit"]')
  const skip = find('[data-feedback-skip]')
  const enabled = controls.querySelector('[data-feedback-enabled]')
  const delay = controls.querySelector('[data-feedback-delay]')
  const settingsMessage = controls.querySelector('.feedback-controls__message')
  const settingsFields = controls.querySelector('fieldset')
  const retry = controls.querySelector('[data-feedback-retry]')
  const stats = controls.querySelector('[data-feedback-stats]')
  let state = null
  let open = false
  let saving = false
  let previousFocus = null
  let inertElements = []
  let responseModuleId = null
  let visitorGeneration = 0
  let snackbarTimer = null
  let pendingResponse = null
  const downloads = new Map()

  const listen = (element, type, listener, options = {}) => {
    element.addEventListener(type, listener, { ...options, signal: abort.signal })
  }
  const request = (method, payload) => api[method](payload)
  const downloadCsv = csv => {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'iqm-feedback.csv'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    downloads.set(url, window.setTimeout(() => {
      URL.revokeObjectURL(url)
      downloads.delete(url)
    }, 1000))
  }
  const updateLauncher = () => {
    launcher.hidden = !state?.preferences.enabled || session.screen !== 'menu'
  }
  const renderState = next => {
    state = next
    enabled.checked = state.preferences.enabled
    delay.value = String(state.preferences.delaySeconds)
    controls.querySelector('output').textContent = `${state.preferences.delaySeconds} s`
    stats.textContent = state.stats.count
      ? `${state.stats.count} responses | Average ${state.stats.average.toFixed(2)} / 5`
      : 'No responses yet.'
    updateLauncher()
  }
  const reportError = (target, error) => {
    console.error('[feedback]', error)
    target.textContent = error.message
  }
  const hideSnackbar = () => {
    window.clearTimeout(snackbarTimer)
    snackbarTimer = null
    snackbar.hidden = true
  }
  const showSnackbar = (text, { failed = false, dismissAfterMs = 0 } = {}) => {
    hideSnackbar()
    snackbarRetry.hidden = !failed
    snackbar.hidden = false
    snackbarMessage.textContent = text
    if (dismissAfterMs) {
      snackbarTimer = window.setTimeout(hideSnackbar, dismissAfterMs)
    }
  }
  const close = ({ restoreFocus = true } = {}) => {
    if (!open) return
    open = false
    overlay.hidden = true
    for (const [element, wasInert] of inertElements) element.inert = wasInert
    inertElements = []
    if (restoreFocus && previousFocus?.isConnected && !previousFocus.closest('[inert], [hidden]')) {
      previousFocus.focus({ preventScroll: true })
    }
  }
  const show = () => {
    if (!state?.preferences.enabled || open || saving) return
    onBeforeOpen()
    hideSnackbar()
    pendingResponse = null
    session.markPrompted()
    responseModuleId = session.lastModuleId
    previousFocus = document.activeElement
    form.reset()
    submit.disabled = true
    skip.disabled = false
    for (const star of overlay.querySelectorAll('.feedback-star')) {
      star.removeAttribute('data-selected')
    }
    find('.feedback-rating-label').textContent = '1 = Not great, 5 = Excellent'
    inertElements = [...stage.children]
      .filter(element => element !== overlay)
      .map(element => [element, element.inert])
    for (const [element] of inertElements) element.inert = true
    overlay.hidden = false
    open = true
    onActivity()
    find('input[name="rating"]').focus({ preventScroll: true })
  }

  listen(launcher, 'click', show)
  listen(skip, 'click', () => close())
  listen(overlay, 'click', event => {
    if (event.target === overlay) close()
  })
  listen(overlay, 'keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    if (event.key !== 'Tab') return
    const elements = [...overlay.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      .filter(element => !element.closest('[hidden]'))
      .filter(element => element.type !== 'radio' || element.checked ||
        (!form.querySelector('input[name="rating"]:checked') &&
          element === find('input[name="rating"]')))
    const first = elements[0]
    const last = elements.at(-1)
    if (!first) {
      event.preventDefault()
      modal.focus()
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  })
  listen(form, 'change', () => {
    const selected = form.querySelector('input[name="rating"]:checked')
    submit.disabled = !selected || saving
    if (!selected) return
    const rating = Number(selected.value)
    for (const star of overlay.querySelectorAll('.feedback-star')) {
      star.dataset.selected = String(Number(star.querySelector('input').value) <= rating)
    }
    find('.feedback-rating-label').textContent = `${rating} of 5 stars`
  })
  const saveResponse = async response => {
    if (saving) return
    saving = true
    pendingResponse = response
    launcher.disabled = true
    submit.disabled = true
    snackbarRetry.disabled = true
    const currentVisitor = visitorGeneration
    showSnackbar('Saving feedback...')
    try {
      const next = await request('submit', response)
      if (abort.signal.aborted) return
      renderState(next)
      pendingResponse = null
      if (currentVisitor === visitorGeneration) {
        showSnackbar('Thank you! Your feedback has been saved.', { dismissAfterMs: 4000 })
      }
    } catch (error) {
      console.error('[feedback]', error)
      if (!abort.signal.aborted && currentVisitor === visitorGeneration) {
        showSnackbar(error.message, { failed: true })
      }
    } finally {
      saving = false
      launcher.disabled = false
      snackbarRetry.disabled = false
    }
  }
  listen(snackbarRetry, 'click', () => {
    if (pendingResponse) void saveResponse(pendingResponse)
  })
  listen(form, 'submit', async event => {
    event.preventDefault()
    if (saving || !open || !form.reportValidity()) return
    const response = {
      rating: Number(form.querySelector('input[name="rating"]:checked').value),
      reasons: [],
      moduleId: responseModuleId
    }
    close()
    await saveResponse(response)
  })

  const settingsAction = async (method, payload, success) => {
    settingsFields.disabled = true
    settingsMessage.textContent = 'Working...'
    try {
      const result = await request(method, payload)
      if (method === 'setPreferences' || method === 'clear') renderState(result)
      if (method === 'exportCsv') downloadCsv(result)
      settingsMessage.textContent = success
    } catch (error) {
      reportError(settingsMessage, error)
      if (state) renderState(state)
    } finally {
      settingsFields.disabled = !state
    }
  }
  const savePreferences = () => settingsAction('setPreferences', {
    enabled: enabled.checked,
    delaySeconds: Number(delay.value)
  }, 'Feedback settings saved.')
  listen(enabled, 'change', savePreferences)
  listen(delay, 'input', () => {
    controls.querySelector('output').textContent = `${delay.value} s`
  })
  listen(delay, 'change', savePreferences)
  listen(controls.querySelector('[data-feedback-export]'), 'click', () =>
    settingsAction('exportCsv', undefined, 'Feedback CSV download started.'))
  listen(controls.querySelector('[data-feedback-clear]'), 'click', () => {
    const confirmed = window.confirm(
      'Permanently delete all saved feedback for this site and browser profile? ' +
      'Export a CSV first if you need to keep these responses. Settings will not be deleted.'
    )
    if (confirmed) void settingsAction('clear', undefined, 'Saved feedback deleted.')
    else settingsMessage.textContent = 'Canceled.'
  })

  const load = async () => {
    retry.hidden = true
    settingsMessage.textContent = 'Loading feedback storage...'
    try {
      const next = await request('getState')
      if (abort.signal.aborted) return
      renderState(next)
      settingsFields.disabled = false
      settingsMessage.textContent = 'Anonymous feedback stays in this browser profile unless exported.'
    } catch (error) {
      reportError(settingsMessage, error)
      retry.hidden = false
    }
  }
  listen(retry, 'click', load)
  const ready = load()

  return {
    ready,
    onScreen(screen, options) {
      close({ restoreFocus: false })
      if (screen === 'attract') {
        visitorGeneration++
        pendingResponse = null
        hideSnackbar()
      }
      const shouldPrompt = session.visit(screen, options, state?.preferences)
      updateLauncher()
      if (shouldPrompt) show()
    },
    isOpen: () => open,
    close,
    dispose() {
      close({ restoreFocus: false })
      hideSnackbar()
      abort.abort()
      for (const [url, timer] of downloads) {
        window.clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      downloads.clear()
      launcher.remove()
      overlay.remove()
      controls.remove()
      snackbar.remove()
    }
  }
}

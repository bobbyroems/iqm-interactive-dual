/**
 * The band a module shows once it is finished, offering the next module.
 *
 * Module 01 already had one of these between its three principles, and it is
 * the shape IQM asked for across the floor on 25 Aug: a quiet bar at the top
 * of the stage rather than a card that interrupts. This is the shared version
 * for module-to-module hops. Module 01's own between-principles band is left
 * where it is — it belongs to that module's internal sequence, not to the run.
 *
 * The band does not decide what comes next. A module passes the title and what
 * to do, so the same component serves whatever the registry says follows.
 */

import { assetUrl } from './asset-url.js'

/* Long enough that the band does not talk over whatever the module does to
   celebrate finishing, short enough that someone who is done is not left
   looking at a finished screen wondering what happens now. Five seconds read
   as the second of those on the floor — long enough that visitors thought the
   module had simply ended — so the beat is now about the length of the closing
   animation rather than a pause after it. Modules that want the band the
   instant they finish pass delayMs: 0. */
export const UP_NEXT_BANNER_DELAY_MS = 1500

function bannerMarkup(title) {
  const chevron = assetUrl('assets/ui/chevron-right-light.svg')
  return `
    <button class="kiosk-up-next" type="button" data-up-next hidden>
      <span class="kiosk-up-next__chip">Up next</span>
      <span class="kiosk-up-next__title">${title}</span>
      <span class="kiosk-up-next__icon" aria-hidden="true">
        <img src="${chevron}" alt="" draggable="false">
      </span>
    </button>
  `
}

/**
 * @param {object} options
 * @param {string} options.title Name of the module being offered.
 * @param {() => void} options.onContinue Run when the visitor takes the offer.
 * @param {number} [options.delayMs] Wait before the band appears.
 */
export function createUpNextBanner({ title, onContinue, delayMs = UP_NEXT_BANNER_DELAY_MS }) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = bannerMarkup(title).trim()
  const element = wrapper.firstElementChild

  let revealTimer = null
  let disposed = false

  element.setAttribute('aria-label', `Up next: ${title}`)
  element.addEventListener('click', () => {
    if (disposed) return
    onContinue?.()
  })

  return {
    element,

    /** Reveals the band after its delay. Calling it again does not restart it. */
    offer() {
      if (disposed || revealTimer !== null || !element.hidden) return
      revealTimer = window.setTimeout(() => {
        revealTimer = null
        if (disposed) return
        element.hidden = false
        /* Two frames: the first puts it in the DOM at its resting transform,
           the second lets the transition run. Setting both in one frame skips
           the animation and the band simply appears. */
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (!disposed) element.dataset.showing = 'true'
          })
        })
      }, delayMs)
    },

    /** Takes the band back off screen and cancels a pending offer. */
    withdraw() {
      if (revealTimer !== null) window.clearTimeout(revealTimer)
      revealTimer = null
      delete element.dataset.showing
      element.hidden = true
    },

    dispose() {
      disposed = true
      if (revealTimer !== null) window.clearTimeout(revealTimer)
      revealTimer = null
      element.remove()
    }
  }
}

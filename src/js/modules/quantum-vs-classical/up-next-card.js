/**
 * The "Up next" card shown once a visitor has taken one of the three games all
 * the way through.
 *
 * Superposition and Entanglement both end this way and differ only in the
 * artwork, the destination and the line offering another go, so the card is one
 * component parameterised by those three things.
 *
 * It is the first half of a pair. The card is a moment: it interrupts, offers
 * the next module, and can be declined. Declining it — dismissing, or choosing
 * to play again — reveals the persistent band at the top of the experience,
 * which is the quiet version of the same offer for someone who has decided to
 * stay. That ordering is why the band is not simply unlocked when the game
 * finishes: showing both at once would make the same offer twice.
 */

import { assetUrl } from '../../core/asset-url.js'
import { areUpNextCardsEnabled, onUpNextCardsChange } from '../../core/kiosk-settings.js'

const EXIT_FALLBACK_MS = 260

/* How long the result stays uninterrupted before the card offers what is next.
 *
 * The card covers the thing the visitor just produced — the coins they landed,
 * the pair that matched — and appearing on the same beat as the result talks
 * over it. Five seconds is long enough to look at what happened and read the
 * line explaining it, and short enough that someone who is finished is not left
 * wondering whether anything else happens. */
export const UP_NEXT_DELAY_MS = 5000

function cardMarkup({ title, visual, visualAlt, replayHint }) {
  const closeIcon = assetUrl('assets/ui/exit-x.svg')
  const chevron = assetUrl('assets/ui/chevron-right-light.svg')
  return `
    <div class="qvc-up-next-card" data-up-next-card hidden>
      <div class="qvc-up-next-card__scrim" data-card-scrim></div>
      <div class="qvc-up-next-card__panel" role="dialog" aria-modal="true" aria-label="Up next: ${title}">
        <div class="qvc-up-next-card__visual">
          <img src="${assetUrl(visual)}" alt="${visualAlt}" draggable="false">
          <button class="qvc-up-next-card__close" type="button" data-card-close aria-label="Stay in this experience">
            <img src="${closeIcon}" alt="" draggable="false">
          </button>
        </div>
        <button class="qvc-up-next-card__go" type="button" data-card-go>
          <span class="qvc-up-next-card__chip">Up next</span>
          <span class="qvc-up-next-card__title">${title}</span>
          <span class="qvc-up-next-card__chevron">
            <img src="${chevron}" alt="" draggable="false">
          </span>
        </button>
      </div>
      ${replayHint
        ? `<button
             class="qvc-up-next-card__replay kiosk-tooltip kiosk-tooltip--light"
             type="button"
             data-card-replay
           ><span class="kiosk-tooltip__text">${replayHint}</span></button>`
        : ''}
    </div>
  `
}

/**
 * @param {object} options
 * @param {string} options.title next module's name, shown on the band
 * @param {string} options.visual card artwork, relative to the asset root
 * @param {string} options.visualAlt
 * @param {string} [options.replayHint] line offering another go, below the card
 * @param {() => void} options.onContinue chosen the next module
 * @param {() => void} [options.onReplay] chose to play this game again
 * @param {() => void} [options.onShow] the card actually appeared
 * @param {() => void} [options.onDismiss] declined, by any route
 * @param {boolean} [options.reducedMotion]
 */
export function createUpNextCard({
  title,
  visual,
  visualAlt,
  replayHint = '',
  onContinue,
  onReplay,
  onShow,
  onDismiss,
  reducedMotion = false
}) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = cardMarkup({ title, visual, visualAlt, replayHint }).trim()
  const element = wrapper.firstElementChild
  const panel = element.querySelector('.qvc-up-next-card__panel')
  const goButton = element.querySelector('[data-card-go]')
  const closeButton = element.querySelector('[data-card-close]')
  const scrim = element.querySelector('[data-card-scrim]')
  const replayButton = element.querySelector('[data-card-replay]')

  let open = false
  let exitTimer = null
  let pendingShow = null

  function cancelExit() {
    if (exitTimer === null) return
    window.clearTimeout(exitTimer)
    exitTimer = null
  }

  /* A scheduled card must never arrive after the visitor has moved on. They can
     start another round inside the delay, and a card that appeared over a coin
     already back in the air would be interrupting rather than offering. */
  /* Turning the setting off should take the card off the screen it is already
     covering, not only stop the next one — and it counts as declining it, so
     the quiet band the card would have handed over to still appears. */
  const stopWatchingSetting = onUpNextCardsChange(enabled => {
    if (!enabled) dismiss()
  })

  function cancelPending() {
    if (pendingShow === null) return
    window.clearTimeout(pendingShow)
    pendingShow = null
  }

  function dismiss() {
    if (!open) return
    close()
    onDismiss?.()
  }

  function close() {
    cancelPending()
    if (!open) return
    open = false
    element.classList.remove('is-showing')
    element.setAttribute('aria-hidden', 'true')
    element.toggleAttribute('inert', true)
    element.inert = true
    if (reducedMotion) {
      element.hidden = true
      return
    }
    /* Hidden only once the fade has run, so the card does not vanish mid
       transition; the timer is the fallback for a transition that never fires. */
    cancelExit()
    exitTimer = window.setTimeout(() => {
      exitTimer = null
      if (!open) element.hidden = true
    }, EXIT_FALLBACK_MS)
  }

  goButton.addEventListener('click', () => {
    close()
    onContinue?.()
  })
  closeButton.addEventListener('click', dismiss)
  /* The scrim dismisses too. The card is an offer, not a decision the visitor
     has to make before they can carry on. */
  scrim.addEventListener('click', dismiss)
  /* The replay line is a real target, not just a caption — both cards name a
     tap, and this is the thing being tapped. */
  replayButton?.addEventListener('click', () => {
    close()
    onReplay?.()
    onDismiss?.()
  })

  function reveal() {
    if (open) return
    cancelExit()
    open = true
    element.hidden = false
    element.setAttribute('aria-hidden', 'false')
    element.toggleAttribute('inert', false)
    element.inert = false
    if (!reducedMotion) {
      element.classList.remove('is-showing')
      void element.offsetWidth
    }
    element.classList.add('is-showing')
    onShow?.()
  }

  return {
    element,
    panel,

    get isOpen() {
      return open
    },

    /* `delayMs` holds the card back so the result it covers can be looked at
       first. onShow fires when it actually appears, not when it is scheduled —
       a game deciding whether it has already made the offer has to key off the
       card being seen, or a cancelled one would count. */
    show(delayMs = 0) {
      if (open) return
      /* Turned off in settings. The band this card would have unlocked still
         appears in its own time, so the way on is never actually removed. */
      if (!areUpNextCardsEnabled()) return
      cancelPending()
      if (delayMs > 0) {
        pendingShow = window.setTimeout(() => {
          pendingShow = null
          reveal()
        }, delayMs)
        return
      }
      reveal()
    },

    cancelPending,
    dismiss,
    close,

    dispose() {
      cancelExit()
      cancelPending()
      stopWatchingSetting()
      element.remove()
    }
  }
}

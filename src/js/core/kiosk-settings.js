/*
 * Kiosk settings surface: a cog in the bottom-right corner of the stage that
 * springs open a frosted popover holding the sound and layout controls.
 *
 * AGENTS.md sends floating panels to createKioskExplainer. This is the
 * documented interactive-dialog exception — the explainer models a passive
 * title/body surface, with no launcher, no open/closed state and no focusable
 * controls to keep out of the tab order while it is closed.
 *
 * The spring lives in CSS so the panel, the cog and the segment thumb all ride
 * the same curve; this module only owns state and the enter/exit sequencing.
 */
import { getVolume, setVolume } from './kiosk-audio.js'

/* Whether the "Up next" card is allowed to interrupt. It is a card rather than
   a banner — it covers the result the visitor just produced and waits to be
   dismissed — so during a testing session there has to be a way to stop it
   without stripping the offer out of the build. The quiet band it unlocks is
   unaffected: that one does not interrupt anything.

   Off by default. The card interrupts the result the visitor has just produced
   and waits to be dismissed, and the quiet band it would have unlocked offers
   the same way on without stopping anyone — so the offer is not lost by
   starting here, only the interruption.

   Deliberately not persisted either way. A kiosk that came back from a restart
   in a state nobody chose would be a hard fault to diagnose on a floor. */
let upNextCardsEnabled = false
const upNextListeners = new Set()

export function areUpNextCardsEnabled() {
  return upNextCardsEnabled
}

export function setUpNextCardsEnabled(next) {
  const value = next !== false
  if (value === upNextCardsEnabled) return
  upNextCardsEnabled = value
  for (const listener of upNextListeners) listener(value)
}

/** Lets a card that is already on screen close itself when they are turned off. */
export function onUpNextCardsChange(listener) {
  upNextListeners.add(listener)
  return () => upNextListeners.delete(listener)
}

/* Matches the exit transform in .kiosk-settings__panel — the panel is only
   taken out of the layout once it has finished shrinking into the cog. */
const PANEL_EXIT_MS = 200

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function createKioskSettings({ root = document, onLayoutChange } = {}) {
  const container = root.getElementById('kiosk-settings')
  const launcher = root.getElementById('kiosk-settings-launcher')
  const panel = root.getElementById('kiosk-settings-panel')
  if (!container || !launcher || !panel) return null

  let open = false
  let exitTimer = null

  panel.inert = true

  const setOpen = next => {
    if (next === open) return
    open = next
    launcher.setAttribute('aria-expanded', String(open))

    if (open) {
      window.clearTimeout(exitTimer)
      exitTimer = null
      panel.hidden = false
      panel.inert = false
      /* The panel has to sit in the layout in its collapsed state for a frame
         before data-open flips, or the spring has nothing to run from.
         Reading a metric forces that layout pass. */
      void panel.offsetWidth
      container.dataset.open = 'true'
      return
    }

    container.dataset.open = 'false'
    panel.inert = true
    if (prefersReducedMotion()) {
      panel.hidden = true
      return
    }
    exitTimer = window.setTimeout(() => {
      panel.hidden = true
      exitTimer = null
    }, PANEL_EXIT_MS)
  }

  launcher.addEventListener('click', () => setOpen(!open))

  /* A tap anywhere else dismisses the popover. Captured so it closes even when
     the tap lands on a control that stops the event on its way back up. */
  root.addEventListener('pointerdown', event => {
    if (!open || container.contains(event.target)) return
    setOpen(false)
  }, true)

  bindVolume(root)
  bindUpNext(root, container)
  const layout = bindLayout(root, container, onLayoutChange)

  return {
    close: () => setOpen(false),
    isOpen: () => open,
    layout
  }
}

function bindVolume(root) {
  const slider = root.getElementById('volume-slider')
  if (!slider) return
  slider.value = String(getVolume())
  slider.addEventListener('input', () => setVolume(slider.valueAsNumber))
}

/* Same segmented control as the layout one, marking itself through data-upnext
   so the two thumbs move independently. */
function bindUpNext(root, container) {
  const group = root.getElementById('kiosk-settings-upnext')
  if (!group) return
  const segments = [...group.querySelectorAll('.kiosk-settings__segment')]
  const current = areUpNextCardsEnabled() ? 'on' : 'off'
  container.dataset.upnext = current
  /* Marked from the value, not from the markup, so the default lives in one
     place and the control cannot disagree with what the cards are doing. */
  for (const option of segments) {
    option.setAttribute('aria-checked', String(option.dataset.upnext === current))
  }

  group.addEventListener('click', event => {
    const segment = event.target.closest('.kiosk-settings__segment')
    if (!segment || !group.contains(segment)) return
    const next = segment.dataset.upnext
    if (next === container.dataset.upnext) return
    container.dataset.upnext = next
    for (const option of segments) {
      option.setAttribute('aria-checked', String(option === segment))
    }
    setUpNextCardsEnabled(next === 'on')
  })
}

/* The segmented control owns the selection: it marks its own thumb through
   data-layout on the settings element, and hands the value to the caller,
   which is what actually restyles the menu. */
function bindLayout(root, container, onLayoutChange) {
  const group = root.getElementById('kiosk-settings-layout')
  if (!group) return container.dataset.layout || 'top'
  const segments = [...group.querySelectorAll('.kiosk-settings__segment')]

  group.addEventListener('click', event => {
    const segment = event.target.closest('.kiosk-settings__segment')
    if (!segment || !group.contains(segment)) return
    const next = segment.dataset.layout
    if (next === container.dataset.layout) return
    container.dataset.layout = next
    for (const option of segments) {
      option.setAttribute('aria-checked', String(option === segment))
    }
    onLayoutChange?.(next)
  })

  return container.dataset.layout || 'top'
}

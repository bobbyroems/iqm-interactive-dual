/*
 * Foundation piece for the responsive refactor (see responsive-refactor-plan.md,
 * Phase 1). Three.js/canvas modules used to size their cameras and renderers
 * against the fixed 2160 x 3840 design canvas via the now-removed
 * StageScaler. There is no longer a single global scale factor to read: each
 * module's canvas can be any size, and can change size independently of the
 * window (a module reflowing at a breakpoint, a container resizing without a
 * window resize, etc).
 *
 * observeElementSize watches one element with a single shared ResizeObserver
 * and reports its content-box size whenever it changes, so a module's camera
 * aspect / renderer size can be derived from its actual container instead of
 * a design-pixel assumption.
 */

let sharedObserver = null
const callbacksByElement = new Map()

function getSharedObserver() {
  if (sharedObserver) return sharedObserver

  sharedObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const callbacks = callbacksByElement.get(entry.target)
      if (!callbacks) continue

      const box = entry.contentBoxSize?.[0]
      const width = box ? box.inlineSize : entry.contentRect.width
      const height = box ? box.blockSize : entry.contentRect.height

      for (const callback of callbacks) callback({ width, height })
    }
  })

  return sharedObserver
}

/**
 * Calls `onResize` with the element's current content-box size, then again
 * every time that size changes. Returns an unsubscribe function.
 *
 * @param {Element} element
 * @param {(size: { width: number, height: number }) => void} onResize
 */
export function observeElementSize(element, onResize) {
  if (!element || typeof onResize !== 'function') return () => {}

  const observer = getSharedObserver()
  let callbacks = callbacksByElement.get(element)
  if (!callbacks) {
    callbacks = new Set()
    callbacksByElement.set(element, callbacks)
    observer.observe(element)
  }
  callbacks.add(onResize)

  const rect = element.getBoundingClientRect()
  onResize({ width: rect.width, height: rect.height })

  return () => {
    const current = callbacksByElement.get(element)
    if (!current) return
    current.delete(onResize)
    if (current.size === 0) {
      callbacksByElement.delete(element)
      observer.unobserve(element)
    }
  }
}

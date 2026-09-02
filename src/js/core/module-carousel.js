import { advanceCarouselSpring, createCarouselSpring } from './carousel-spring.js'
import { sound } from './kiosk-audio.js'
import { getModuleNavigationGridLayout } from './module-navigation-projection.js'

export function clampCarouselIndex(index, itemCount) {
  if (!Number.isFinite(index) || itemCount <= 0) return 0
  return Math.min(itemCount - 1, Math.max(0, Math.round(index)))
}

export function carouselOffset(index, cardWidth, gap) {
  if (![index, cardWidth, gap].every(Number.isFinite)) return 0
  return Math.max(0, index) * Math.max(0, cardWidth + gap)
}

export function swipeTargetIndex(currentIndex, dragDistance, threshold, itemCount) {
  if (dragDistance <= -Math.abs(threshold)) {
    return clampCarouselIndex(currentIndex + 1, itemCount)
  }
  if (dragDistance >= Math.abs(threshold)) {
    return clampCarouselIndex(currentIndex - 1, itemCount)
  }
  return clampCarouselIndex(currentIndex, itemCount)
}

export function hasHorizontalDragIntent(deltaX, deltaY, threshold = 6) {
  if (![deltaX, deltaY, threshold].every(Number.isFinite)) return false
  const minimumDistance = Math.max(0, threshold)
  return Math.abs(deltaX) >= minimumDistance && Math.abs(deltaX) >= Math.abs(deltaY)
}

export const KIOSK_CARD_MOTION_DURATION = 620

function carouselVisibleIndexes(index, itemCount) {
  const safeIndex = clampCarouselIndex(index, itemCount)
  return [safeIndex - 1, safeIndex, safeIndex + 1]
    .filter(cardIndex => cardIndex >= 0 && cardIndex < itemCount)
}

/**
 * Production motion only ever retains the cards needed to bridge two frames.
 * Adjacent moves share at most two visible cards; longer jumps and wraps use
 * the outgoing and incoming active cards only.
 */
export function boundedCarouselCandidateIndexes(previousIndex, nextIndex, itemCount) {
  if (itemCount <= 0) return []
  const safePreviousIndex = clampCarouselIndex(previousIndex, itemCount)
  const safeNextIndex = clampCarouselIndex(nextIndex, itemCount)
  if (Math.abs(safeNextIndex - safePreviousIndex) <= 1) {
    const nextVisible = new Set(carouselVisibleIndexes(safeNextIndex, itemCount))
    return carouselVisibleIndexes(safePreviousIndex, itemCount)
      .filter(cardIndex => nextVisible.has(cardIndex))
  }
  return [...new Set([safePreviousIndex, safeNextIndex])]
}

function finiteOpacity(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

/**
 * Builds FLIP keyframes in the card's local coordinate space. `left` values
 * come from getBoundingClientRect(), so viewport deltas are divided by the
 * stage scale before being applied to a card inside the scaled kiosk stage.
 */
export function createBoundedCarouselMotionPlan({
  afterCards,
  beforeCards,
  direction,
  nextIndex,
  previousIndex,
  scale = 1,
  step
}) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const safeStep = Number.isFinite(step) && step > 0 ? step : 0
  const beforeByIndex = new Map(beforeCards.map(card => [card.cardIndex, card]))
  const afterByIndex = new Map(afterCards.map(card => [card.cardIndex, card]))
  const directMove = Math.abs(nextIndex - previousIndex) <= 1

  if (directMove) {
    return [...beforeByIndex.values()]
      .filter(before => {
        const after = afterByIndex.get(before.cardIndex)
        return before.visible !== false && after && after.visible !== false
      })
      .map(before => {
        const after = afterByIndex.get(before.cardIndex)
        return {
          cardIndex: before.cardIndex,
          fromOpacity: finiteOpacity(before.opacity, 1),
          fromX: (before.left - after.left) / safeScale,
          retainVisibility: false,
          toOpacity: finiteOpacity(after.opacity, 1),
          toX: 0
        }
      })
      .filter(actor => (
        Math.abs(actor.fromX - actor.toX) > 0.5 ||
        Math.abs(actor.fromOpacity - actor.toOpacity) > 0.01
      ))
  }

  const motionDirection = Math.sign(direction || nextIndex - previousIndex)
  if (!motionDirection || safeStep === 0) return []

  const outgoingBefore = beforeByIndex.get(previousIndex)
  const outgoingAfter = afterByIndex.get(previousIndex)
  const incomingAfter = afterByIndex.get(nextIndex)
  const actors = []

  if (outgoingBefore && outgoingAfter) {
    const fromX = (outgoingBefore.left - outgoingAfter.left) / safeScale
    actors.push({
      cardIndex: previousIndex,
      fromOpacity: finiteOpacity(outgoingBefore.opacity, 1),
      fromX,
      retainVisibility: outgoingAfter.visible === false,
      toOpacity: 0,
      toX: fromX - motionDirection * safeStep
    })
  }

  if (incomingAfter) {
    actors.push({
      cardIndex: nextIndex,
      fromOpacity: Math.min(0.32, finiteOpacity(incomingAfter.opacity, 1)),
      fromX: motionDirection * safeStep,
      retainVisibility: false,
      toOpacity: finiteOpacity(incomingAfter.opacity, 1),
      toX: 0
    })
  }

  return actors
}

export class ModuleCarousel {
  constructor({
    currentLabel,
    nextButton,
    onActivity,
    onOpen,
    pagination,
    previousButton,
    root,
    track,
    viewport
  }) {
    this.currentLabel = currentLabel
    this.nextButton = nextButton
    this.onActivity = onActivity
    this.onOpen = onOpen
    this.pagination = pagination
    this.previousButton = previousButton
    this.root = root
    this.track = track
    this.viewport = viewport

    this.cards = []
    this.currentIndex = 0
    this.drag = null
    this.suppressClick = false
    this.wrapAnimating = false
    this.previewMotion = null
    this.previewMotionFrame = 0
    this.active = false
    this.cardMotion = null
    this.cardMotionToken = 0

    this.handleCardClick = this.handleCardClick.bind(this)
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleNext = this.handleNext.bind(this)
    this.handlePaginationClick = this.handlePaginationClick.bind(this)
    this.handlePointerCancel = this.handlePointerCancel.bind(this)
    this.handlePointerDown = this.handlePointerDown.bind(this)
    this.handlePointerMove = this.handlePointerMove.bind(this)
    this.handlePointerUp = this.handlePointerUp.bind(this)
    this.handlePrevious = this.handlePrevious.bind(this)
    this.handleWheel = this.handleWheel.bind(this)
    this.updatePreviewMotion = this.updatePreviewMotion.bind(this)
    this.lastWheelAt = 0

    this.root.addEventListener('wheel', this.handleWheel, { passive: false })
    this.track.addEventListener('click', this.handleCardClick)
    this.pagination.addEventListener('click', this.handlePaginationClick)
    this.previousButton.addEventListener('click', this.handlePrevious)
    this.nextButton.addEventListener('click', this.handleNext)
    this.root.addEventListener('keydown', this.handleKeyDown)
    this.viewport.addEventListener('pointerdown', this.handlePointerDown)
    this.viewport.addEventListener('pointermove', this.handlePointerMove, { passive: false })
    this.viewport.addEventListener('pointerup', this.handlePointerUp)
    this.viewport.addEventListener('pointercancel', this.handlePointerCancel)
  }

  mount(cards) {
    this.cancelBoundedCardMotion()
    this.cards = [...cards]
    const indicators = this.cards.map((card, index) => {
      const indicator = document.createElement('button')
      indicator.className = 'module-carousel__indicator'
      indicator.type = 'button'
      indicator.dataset.carouselIndex = String(index)
      indicator.setAttribute(
        'aria-label',
        `Show module ${card.dataset.moduleNumber}: ${card.dataset.moduleTitle}`
      )
      indicator.innerHTML = '<span></span>'
      return indicator
    })
    this.pagination.replaceChildren(...indicators)
    this.setIndex(clampCarouselIndex(this.currentIndex, this.cards.length), {
      animate: false
    })
    window.cancelAnimationFrame(this.previewMotionFrame)
    this.previewMotionFrame = 0
    const previewPortal = this.track.querySelector('.module-card__preview-portal')
    this.previewMotion = previewPortal
      ? {
          portal: previewPortal,
          card: previewPortal.closest('.module-card'),
          spring: createCarouselSpring(51),
          previousCenterX: undefined,
          previousFrameAt: undefined
        }
      : null
    this.startPreviewMotion()
    window.requestAnimationFrame(() => this.root.classList.add('is-ready'))
  }

  startPreviewMotion() {
    if (!this.previewMotion) return
    this.previewMotion.previousCenterX = undefined
    this.previewMotion.previousFrameAt = undefined
    this.schedulePreviewMotion()
  }

  schedulePreviewMotion() {
    if (!this.active || !this.previewMotion || this.previewMotionFrame) return
    this.previewMotionFrame = window.requestAnimationFrame(this.updatePreviewMotion)
  }

  stopPreviewMotion() {
    window.cancelAnimationFrame(this.previewMotionFrame)
    this.previewMotionFrame = 0
  }

  /** Only the visible menu is allowed to decode its video or run its motion RAF. */
  setActive(active) {
    this.active = Boolean(active)
    if (this.active) this.startPreviewMotion()
    else {
      this.stopPreviewMotion()
      this.cancelBoundedCardMotion()
    }
    this.updatePreviewVideoPlayback()
  }

  updatePreviewMotion(now) {
    this.previewMotionFrame = 0
    const motion = this.previewMotion
    if (!this.active || !motion) return

    const rect = motion.card.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const deltaSeconds = motion.previousFrameAt === undefined
      ? 0
      : (now - motion.previousFrameAt) / 1000
    let slideVelocity = 0
    if (motion.previousCenterX !== undefined && deltaSeconds > 0 && deltaSeconds < 0.2) {
      const deltaX = centerX - motion.previousCenterX
      if (Math.abs(deltaX) > 0.5 && rect.width > 1) {
        slideVelocity = deltaX / rect.width / deltaSeconds
      }
    }
    motion.previousCenterX = centerX
    motion.previousFrameAt = now

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (rect.width < 2 || reducedMotion) {
      motion.spring.offset = 0
      motion.spring.velocity = 0
    } else {
      const drive = Math.max(-3, Math.min(3, slideVelocity))
      advanceCarouselSpring(motion.spring, drive, Math.min(deltaSeconds || 0.033, 0.066))
      if (Math.abs(motion.spring.offset) < 0.00001 && Math.abs(motion.spring.velocity) < 0.00001) {
        motion.spring.offset = 0
        motion.spring.velocity = 0
      }
    }

    const visual = motion.portal.closest('.module-card__visual')
    const sceneAspect = visual.offsetWidth / Math.max(1, visual.offsetHeight + 280)
    const frustumWidth = getModuleNavigationGridLayout({ aspect: sceneAspect }).frustumWidth
    const offsetX = (motion.spring.offset / frustumWidth) * visual.offsetWidth
    const rotation = motion.spring.offset * 0.4
    motion.portal.style.transform =
      `translate(-50%, -50%) translate3d(${offsetX}px, 0, 0) rotate(${rotation}rad)`

    this.schedulePreviewMotion()
  }

  isKioskRuntime() {
    return document.body?.classList.contains('is-kiosk') === true
  }

  shouldUseBoundedCardMotion(animate) {
    if (!animate || !this.active || !this.isKioskRuntime()) return false
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    return typeof this.cards[0]?.animate === 'function'
  }

  captureCardMotionState(cardIndexes) {
    return cardIndexes.map(cardIndex => {
      const card = this.cards[cardIndex]
      const rect = card.getBoundingClientRect()
      const opacity = Number.parseFloat(window.getComputedStyle(card).opacity)
      return {
        cardIndex,
        left: rect.left,
        opacity: Number.isFinite(opacity) ? opacity : 1,
        visible: !card.classList.contains('is-distant')
      }
    })
  }

  cancelBoundedCardMotion() {
    this.cardMotionToken = (this.cardMotionToken || 0) + 1
    const motion = this.cardMotion
    this.cardMotion = null
    motion?.animations.forEach(animation => animation.cancel())
    motion?.retainedCards.forEach(card => card.classList.remove('is-carousel-transition-card'))
    this.root?.classList.remove('is-card-transitioning')
  }

  finishBoundedCardMotion(token) {
    if (this.cardMotion?.token !== token) return
    const motion = this.cardMotion
    this.cardMotion = null
    motion.animations.forEach(animation => animation.cancel())
    motion.retainedCards.forEach(card => card.classList.remove('is-carousel-transition-card'))
    this.root.classList.remove('is-card-transitioning')
  }

  startBoundedCardMotion({ beforeCards, direction, nextIndex, previousIndex }) {
    const candidateIndexes = boundedCarouselCandidateIndexes(
      previousIndex,
      nextIndex,
      this.cards.length
    )
    const retainedCards = candidateIndexes
      .map(cardIndex => this.cards[cardIndex])
      .filter(card => card.classList.contains('is-distant'))
    retainedCards.forEach(card => card.classList.add('is-carousel-transition-card'))

    const afterCards = this.captureCardMotionState(candidateIndexes)
    const actors = createBoundedCarouselMotionPlan({
      afterCards,
      beforeCards,
      direction,
      nextIndex,
      previousIndex,
      scale: this.stageScale(),
      step: this.cardWidth() + this.trackGap()
    })

    if (actors.length === 0) {
      retainedCards.forEach(card => card.classList.remove('is-carousel-transition-card'))
      return
    }

    const animations = actors.map(actor => this.cards[actor.cardIndex].animate([
      {
        opacity: actor.fromOpacity,
        transform: `translate3d(${actor.fromX}px, 0, 0)`
      },
      {
        opacity: actor.toOpacity,
        transform: `translate3d(${actor.toX}px, 0, 0)`
      }
    ], {
      duration: KIOSK_CARD_MOTION_DURATION,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both'
    }))
    const token = ++this.cardMotionToken
    this.cardMotion = { animations, retainedCards, token }
    this.root.classList.add('is-card-transitioning')
    Promise.allSettled(animations.map(animation => animation.finished))
      .then(() => this.finishBoundedCardMotion(token))
  }

  setIndex(index, {
    animate = true,
    announceActivity = false,
    motionDirection = 0
  } = {}) {
    if (this.cards.length === 0 || this.wrapAnimating) return
    const nextIndex = clampCarouselIndex(index, this.cards.length)
    const previousIndex = this.currentIndex
    const useBoundedMotion = this.shouldUseBoundedCardMotion(animate)
    const beforeCards = useBoundedMotion
      ? this.captureCardMotionState(carouselVisibleIndexes(previousIndex, this.cards.length))
      : []
    this.cancelBoundedCardMotion()
    if (animate && nextIndex !== this.currentIndex) sound.whoosh()
    this.currentIndex = nextIndex
    this.root.classList.toggle('is-jumping', !animate)
    this.track.style.setProperty(
      '--carousel-offset',
      `${carouselOffset(nextIndex, this.cardWidth(), this.trackGap())}px`
    )
    this.track.style.setProperty('--carousel-drag', '0px')
    this.root.dataset.carouselIndex = String(nextIndex)

    this.applyIndexState(nextIndex)
    if (useBoundedMotion) {
      this.startBoundedCardMotion({
        beforeCards,
        direction: Math.sign(motionDirection || nextIndex - previousIndex),
        nextIndex,
        previousIndex
      })
    }
    if (announceActivity) this.onActivity?.()

    if (!animate) {
      window.requestAnimationFrame(() => this.root.classList.remove('is-jumping'))
    }
  }

  applyIndexState(nextIndex) {
    this.cards.forEach((card, cardIndex) => {
      const distance = Math.abs(cardIndex - nextIndex)
      const isActive = cardIndex === nextIndex
      card.classList.toggle('is-active', isActive)
      card.classList.toggle('is-neighbour', distance === 1)
      card.classList.toggle('is-distant', distance > 1)
      card.dataset.carouselPosition = cardIndex < nextIndex
        ? 'before'
        : cardIndex > nextIndex ? 'after' : 'active'
      card.tabIndex = isActive ? 0 : -1
      if (isActive) card.setAttribute('aria-current', 'true')
      else card.removeAttribute('aria-current')
    })
    this.updatePreviewVideoPlayback()

    const indicators = [...this.pagination.querySelectorAll('[data-carousel-index]')]
    indicators.forEach((indicator, indicatorIndex) => {
      const isActive = indicatorIndex === nextIndex
      indicator.classList.toggle('is-active', isActive)
      indicator.setAttribute('aria-pressed', String(isActive))
    })

    /* Navigation wraps, so the arrows never disable. */
    this.previousButton.disabled = false
    this.nextButton.disabled = false
    this.currentLabel.textContent = this.cards[nextIndex].dataset.moduleNumber
  }

  updatePreviewVideoPlayback() {
    this.cards.forEach((card, cardIndex) => {
      const previewVideo = card.querySelector('.module-card__preview-video')
      if (!previewVideo) return
      if (this.active && cardIndex === this.currentIndex) previewVideo.play().catch(() => {})
      else previewVideo.pause()
    })
  }

  cardWidth() {
    return this.cards[0]?.offsetWidth || 1420
  }

  trackGap() {
    const style = window.getComputedStyle(this.track)
    return Number.parseFloat(style.columnGap || style.gap) || 64
  }

  stageScale() {
    if (this.root.offsetWidth <= 0) return 1
    return this.root.getBoundingClientRect().width / this.root.offsetWidth || 1
  }

  moveBy(direction) {
    if (this.wrapAnimating) return
    const count = this.cards.length
    if (count === 0) return
    const target = this.currentIndex + direction
    if (count > 1 && target >= count) this.wrapForward()
    else if (count > 1 && target < 0) this.wrapBackward()
    else this.setIndex(target, { announceActivity: true })
  }

  /* Seamless loop: teleport the wrapping card to the far side of the track,
     then slide a single normal step so it always arrives from the direction
     of travel instead of the track rewinding. */
  wrapForward() {
    if (this.isKioskRuntime()) {
      this.setIndex(0, { announceActivity: true, motionDirection: 1 })
      return
    }
    const count = this.cards.length
    const step = this.cardWidth() + this.trackGap()
    const first = this.cards[0]

    this.root.classList.add('is-jumping')
    this.track.append(first)
    this.track.style.setProperty('--carousel-offset', `${(count - 2) * step}px`)
    this.track.getBoundingClientRect()
    this.root.classList.remove('is-jumping')

    this.wrapAnimating = true
    this.track.style.setProperty('--carousel-offset', `${(count - 1) * step}px`)
    this.applyIndexState(0)
    sound.whoosh()
    this.onActivity?.()
    window.setTimeout(() => {
      this.wrapAnimating = false
      this.track.prepend(first)
      this.currentIndex = 0
      this.setIndex(0, { animate: false })
    }, 790)
  }

  wrapBackward() {
    if (this.isKioskRuntime()) {
      this.setIndex(this.cards.length - 1, { announceActivity: true, motionDirection: -1 })
      return
    }
    const count = this.cards.length
    const step = this.cardWidth() + this.trackGap()
    const last = this.cards[count - 1]

    this.root.classList.add('is-jumping')
    this.track.prepend(last)
    this.track.style.setProperty('--carousel-offset', `${step}px`)
    this.track.getBoundingClientRect()
    this.root.classList.remove('is-jumping')

    this.wrapAnimating = true
    this.track.style.setProperty('--carousel-offset', '0px')
    this.applyIndexState(count - 1)
    sound.whoosh()
    this.onActivity?.()
    window.setTimeout(() => {
      this.wrapAnimating = false
      this.track.append(last)
      this.currentIndex = count - 1
      this.setIndex(count - 1, { animate: false })
    }, 790)
  }

  markVisited(moduleId) {
    const cardIndex = this.cards.findIndex(card => card.dataset.moduleId === moduleId)
    if (cardIndex < 0) return
    this.pagination
      .querySelectorAll('[data-carousel-index]')[cardIndex]
      ?.classList.add('is-visited')
  }

  handlePrevious() {
    this.moveBy(-1)
  }

  handleNext() {
    this.moveBy(1)
  }

  handlePaginationClick(event) {
    const indicator = event.target.closest('[data-carousel-index]')
    if (!indicator) return
    this.setIndex(Number(indicator.dataset.carouselIndex), { announceActivity: true })
  }

  handleCardClick(event) {
    const card = event.target.closest('[data-module-id]')
    if (!card || this.suppressClick) {
      event.preventDefault()
      return
    }
    const cardIndex = this.cards.indexOf(card)
    if (cardIndex !== this.currentIndex) {
      event.preventDefault()
      this.setIndex(cardIndex, { announceActivity: true })
      return
    }
    this.onActivity?.()
    if (event.target.closest('.module-card__footer')) {
      this.onOpen?.(card.dataset.moduleId)
    }
  }

  handleWheel(event) {
    event.preventDefault()
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(delta) < 10) return
    const now = performance.now()
    if (now - this.lastWheelAt < 450) return
    this.lastWheelAt = now
    this.moveBy(delta > 0 ? 1 : -1)
  }

  handleKeyDown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    this.moveBy(event.key === 'ArrowLeft' ? -1 : 1)
  }

  handlePointerDown(event) {
    if (event.button !== 0 || this.cards.length < 2) return
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      designDistance: 0,
      horizontal: false,
      captured: false
    }
    this.suppressClick = false
    this.onActivity?.()
  }

  handlePointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    const deltaX = event.clientX - this.drag.startX
    const deltaY = event.clientY - this.drag.startY
    if (!this.drag.horizontal && Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return
    this.drag.horizontal = hasHorizontalDragIntent(deltaX, deltaY)
    if (!this.drag.horizontal) return

    if (!this.drag.captured) {
      this.viewport.setPointerCapture?.(event.pointerId)
      this.drag.captured = true
      this.root.classList.add('is-dragging')
    }

    event.preventDefault()
    const designDistance = deltaX / this.stageScale()
    const atStart = this.currentIndex === 0 && designDistance > 0
    const atEnd = this.currentIndex === this.cards.length - 1 && designDistance < 0
    this.drag.designDistance = (atStart || atEnd) ? designDistance * 0.22 : designDistance
    this.suppressClick = Math.abs(designDistance) > 28
    this.track.style.setProperty('--carousel-drag', `${this.drag.designDistance}px`)
  }

  finishPointer(event, cancelled = false) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    const distance = this.drag.designDistance
    const dragged = this.suppressClick
    if (this.drag.captured) this.viewport.releasePointerCapture?.(event.pointerId)
    this.drag = null
    this.root.classList.remove('is-dragging')
    this.setIndex(
      cancelled
        ? this.currentIndex
        : swipeTargetIndex(this.currentIndex, distance, 150, this.cards.length),
      { announceActivity: dragged }
    )
    if (dragged) {
      window.setTimeout(() => {
        this.suppressClick = false
      }, 0)
    }
  }

  handlePointerUp(event) {
    this.finishPointer(event)
  }

  handlePointerCancel(event) {
    this.finishPointer(event, true)
  }
}

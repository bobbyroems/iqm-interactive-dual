/*
 * Quantum vs. Classical — three key principles, each a coin sub-game.
 * The sub-menu follows the current Figma "Sub Menu Selection Screen"
 * (node 506:2224);
 * the Superposition and Entanglement games port the client prototypes in
 * ref/3js with the kiosk's quarter model, materials and studio lighting.
 * Interference uses the supplied buoy model; its full experience owns the
 * shader-driven analytic water field while the menu keeps the buoy isolated.
 */

import { assetUrl } from '../../core/asset-url.js'
import { createKioskTooltip } from '../../core/kiosk-tooltip.js'
import { loadCoinAssets } from './coin-assets.js'
import { loadBuoyAssets } from './interference-assets.js'
import { createInterferenceGame } from './interference-game.js'
import { createUpNextBanner } from '../../core/up-next-banner.js'
import { nextPlayableModule } from '../module-registry.js'
import { createMenuScene } from './menu-scene.js'
import { createSuperpositionGame } from './superposition-game.js'
import { createEntanglementGame } from './entanglement-game.js'

const GAMES = Object.freeze({
  superposition: { label: 'Superposition', create: createSuperpositionGame },
  entanglement: { label: 'Entanglement', create: createEntanglementGame },
  interference: { label: 'Interference', create: createInterferenceGame }
})

let preloadPromise = null

/* Start the large menu asset reads while the visitor is still outside this
   module. GPU programs and uploads are warmed later, once the real card
   dimensions exist under the opaque module wipe. */
export function preload() {
  preloadPromise ??= Promise.all([
    loadCoinAssets(),
    loadBuoyAssets(),
    import('three/addons/environments/RoomEnvironment.js')
  ])
    .then(([assets, buoyAssets, { RoomEnvironment }]) => ({
      assets,
      buoyAssets,
      RoomEnvironment
    }))
    .catch(error => {
      preloadPromise = null
      throw error
    })
  return preloadPromise
}

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const backIcon = assetUrl('assets/ui/chevron-right.svg')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')
  const principleIcon = assetUrl('assets/ui/principle-chevron.svg')
  return `
    <section class="qvc" data-qvc-root data-view="menu" aria-labelledby="qvc-title">
      <header class="microsoft-header qvc__header">
        <div class="microsoft-brand qvc__brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo qvc__microsoft">
            <img src="${microsoftLogo}" alt="Microsoft" draggable="false">
          </span>
          <span class="microsoft-brand__divider qvc__brand-rule" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum qvc__brand-quantum">Quantum</span>
        </div>
        <div class="microsoft-header__actions qvc__actions">
          <button class="microsoft-header__action qvc__utility-action qvc__utility-action--back" type="button" data-qvc-action="back">
            <span class="microsoft-header__action-icon microsoft-header__action-icon--back" aria-hidden="true">
              <img src="${backIcon}" alt="" draggable="false">
            </span>
            <span>Back</span>
          </button>
          <button class="microsoft-header__action qvc__utility-action" type="button" data-qvc-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${restartIcon}" alt="" draggable="false">
            </span>
          </button>
          <button class="microsoft-header__action qvc__utility-action" type="button" data-qvc-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${exitIcon}" alt="" draggable="false">
            </span>
          </button>
        </div>
      </header>

      <div class="qvc__experience">
        <h1 class="qvc__sr" id="qvc-title">What makes quantum different?</h1>

        <div class="qvc__menu" data-qvc-menu>
          <div class="qvc-copy qvc__menu-copy">
            <h2>Key quantum principles</h2>
            <!-- Broken where the board breaks it: the block is wide enough to
                 wrap differently on its own. -->
            <p>Classical computers have limits.<br>Key quantum phenomena allow us to solve<br>complex problems in entirely new ways.</p>
          </div>
          <div class="qvc__menu-cards" data-qvc-menu-strip>
            <button class="qvc__menu-card qvc__menu-card--superposition" type="button" data-qvc-game="superposition" aria-label="Step 1 of 3: Superposition" aria-describedby="qvc-menu-instruction">
              <span class="qvc__menu-card-scene" aria-hidden="true">
                <span class="qvc__menu-shadow"></span>
                <span class="qvc__menu-render" data-qvc-card-scene="superposition"></span>
              </span>
              <span class="qvc__principle"><span class="qvc__principle-label">Superposition</span><span class="qvc__principle-icon" aria-hidden="true"><img src="${principleIcon}" alt="" draggable="false"></span></span>
            </button>
            <button class="qvc__menu-card qvc__menu-card--entanglement" type="button" data-qvc-game="entanglement" aria-label="Step 2 of 3: Entanglement" aria-describedby="qvc-menu-instruction">
              <span class="qvc__menu-card-scene" aria-hidden="true">
                <span class="qvc__menu-shadow"></span>
                <span class="qvc__menu-render" data-qvc-card-scene="entanglement"></span>
              </span>
              <span class="qvc__principle"><span class="qvc__principle-label">Entanglement</span><span class="qvc__principle-icon" aria-hidden="true"><img src="${principleIcon}" alt="" draggable="false"></span></span>
            </button>
            <button class="qvc__menu-card qvc__menu-card--interference" type="button" data-qvc-game="interference" aria-label="Step 3 of 3: Interference" aria-describedby="qvc-menu-instruction">
              <span class="qvc__menu-card-scene" aria-hidden="true">
                <span class="qvc__menu-shadow"></span>
                <span class="qvc__menu-render" data-qvc-card-scene="interference"></span>
              </span>
              <span class="qvc__principle"><span class="qvc__principle-label">Interference</span><span class="qvc__principle-icon" aria-hidden="true"><img src="${principleIcon}" alt="" draggable="false"></span></span>
            </button>
            <div class="qvc__sequence" aria-hidden="true">
              <span class="qvc__sequence-step qvc__sequence-step--one">1</span>
              <span class="qvc__sequence-arrow qvc__sequence-arrow--first"></span>
              <span class="qvc__sequence-step qvc__sequence-step--two">2</span>
              <span class="qvc__sequence-arrow qvc__sequence-arrow--second"></span>
              <span class="qvc__sequence-step qvc__sequence-step--three">3</span>
            </div>
          </div>
        </div>

        <div class="qvc__game-host" data-qvc-game-host hidden></div>
        <div class="qvc__transition" data-qvc-transition aria-hidden="true">
          <div class="qvc__transition-content">
            <p class="qvc__transition-title">
              <span data-qvc-transition-action>Opening</span>
              <strong data-qvc-transition-title>Superposition</strong>
            </p>
            <div class="qvc__transition-path">
              <span class="qvc__transition-rail"></span>
              <span class="qvc__transition-step" data-qvc-transition-step="superposition">
                <span class="qvc__transition-index">1</span>
                <span>Superposition</span>
              </span>
              <span class="qvc__transition-step" data-qvc-transition-step="entanglement">
                <span class="qvc__transition-index">2</span>
                <span>Entanglement</span>
              </span>
              <span class="qvc__transition-step" data-qvc-transition-step="interference">
                <span class="qvc__transition-index">3</span>
                <span>Interference</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  `
}

function createAbortError() {
  return new DOMException('Quantum vs. Classical mount was aborted', 'AbortError')
}

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) {
    throw new TypeError('Quantum vs. Classical requires a DOM container')
  }
  const { signal, onActivity, navigate = {}, module } = options
  if (signal?.aborted) throw createAbortError()

  const wrapper = document.createElement('div')
  wrapper.innerHTML = moduleMarkup().trim()
  const root = wrapper.firstElementChild
  container.replaceChildren(root)

  const menuView = root.querySelector('[data-qvc-menu]')
  const menuStrip = root.querySelector('[data-qvc-menu-strip]')
  const gameHost = root.querySelector('[data-qvc-game-host]')
  const transitionAction = root.querySelector('[data-qvc-transition-action]')
  const transitionTitle = root.querySelector('[data-qvc-transition-title]')
  const menuHint = createKioskTooltip({
    className: 'qvc__menu-hint',
    text: 'Tap a principle to explore'
  })
  menuHint.element.id = 'qvc-menu-instruction'
  menuView.append(menuHint.element)
  const listeners = new AbortController()

  let disposed = false
  let menuScene = null
  let gameController = null
  let activeGameId = null
  let transitionId = 0
  const deferredDisposals = new Map()

  /* IQM asked for the three principles to be taken in order, so a card opens
     only once the one before it has been played through. "Played through" is
     the moment a game offers its "Up next" card: that card is shown only after
     the visitor has taken the game all the way to its result, which makes it
     the completion signal already in the build rather than a second one to
     keep in step with it.

     Interference has no card of its own because nothing follows it, which is
     also why it needs no completion hook — it gates nothing. */
  const completedGames = new Set()
  const GAME_PREREQUISITE = Object.freeze({
    entanglement: 'superposition',
    interference: 'entanglement'
  })
  const menuCards = [...menuStrip.querySelectorAll('[data-qvc-game]')]

  /* The band offering the module after this one. It is deliberately separate
     from the "Up next" the games show each other: those move between the three
     principles inside this module, this one leaves it. They never share the
     screen — the games' band belongs to Superposition and Entanglement, and
     this one only appears once Interference, which has no band of its own,
     resolves. */
  const followingModule = module ? nextPlayableModule(module.id) : null
  const upNextBanner = followingModule
    ? createUpNextBanner({
        title: followingModule.title,
        onContinue: () => {
          onActivity?.()
          navigate.module?.(followingModule.id)
        }
      })
    : null
  if (upNextBanner) root.append(upNextBanner.element)

  function isGameUnlocked(gameId) {
    const required = GAME_PREREQUISITE[gameId]
    return !required || completedGames.has(required)
  }

  function applyMenuLocks() {
    for (const card of menuCards) {
      const gameId = card.dataset.qvcGame
      const unlocked = isGameUnlocked(gameId)
      const requiredId = GAME_PREREQUISITE[gameId]
      card.dataset.locked = String(!unlocked)
      card.disabled = !unlocked
      card.setAttribute('aria-disabled', String(!unlocked))
      const step = card.dataset.qvcStep || card.getAttribute('aria-label') || ''
      if (!card.dataset.qvcStep) card.dataset.qvcStep = step
      card.setAttribute('aria-label', unlocked
        ? card.dataset.qvcStep
        : `${card.dataset.qvcStep}, locked until ${GAMES[requiredId]?.label ?? 'the previous principle'} is complete`)
    }
  }

  const { assets, buoyAssets, RoomEnvironment } = await preload()
  if (signal?.aborted) throw createAbortError()

  const sceneContext = {
    assets,
    buoyAssets,
    RoomEnvironment,
    onActivity,
    /* Lets a finished game hand the visitor straight to the next principle via
       its "Up next" banner, instead of routing them back through the menu. */
    openGame: gameId => void openGame(gameId),
    /* A game reports itself finished so the menu can open what follows it. */
    onGameComplete: gameId => {
      if (completedGames.has(gameId)) return
      completedGames.add(gameId)
      applyMenuLocks()
      /* The band offering the next module appears once all three principles are
         done, which is what the board draws on the menu behind it.

         Keyed on the count rather than on Interference finishing. The two mean
         the same thing only because Interference is locked behind the other
         two — say what is actually meant, and the band survives any change to
         that order. */
      if (completedGames.size === Object.keys(GAMES).length) upNextBanner?.offer()
    }
  }

  applyMenuLocks()

  function setView(view) {
    root.dataset.view = view
    menuView.hidden = view !== 'menu'
    menuView.inert = view !== 'menu'
    gameHost.hidden = view !== 'game'
    gameHost.inert = view !== 'game'
  }

  function waitForPaintFrames(count = 2) {
    return new Promise(resolve => {
      let remaining = count
      const commit = () => {
        remaining -= 1
        if (remaining <= 0) resolve()
        else requestAnimationFrame(commit)
      }
      requestAnimationFrame(commit)
    })
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds))
  }

  /* How long the numbered cover stays up, at minimum.
   *
   * It reveals as soon as the incoming game has produced a frame, and the games
   * are preloaded, so on a warm machine it could come and go faster than the
   * step rail finishes travelling — the screen exists to say where the visitor
   * is in the sequence, and it cannot do that if it is gone before the number
   * lands. The rail alone is a 520ms transition on a 60ms delay, so this leaves
   * roughly a second to read it afterwards.
   *
   * This is a floor, not a delay: a slow build still takes as long as it takes,
   * and nothing waits twice. */
  const MIN_COVER_MS = 1600
  let coverShownAt = 0

  function transitionIsCurrent(requestedTransition) {
    return !disposed && requestedTransition === transitionId
  }

  async function coverStage(requestedTransition, {
    targetId = 'menu',
    title = 'Three principles'
  } = {}) {
    root.classList.add('is-transitioning')
    root.setAttribute('aria-busy', 'true')
    root.dataset.transitionTarget = targetId
    transitionAction.textContent = targetId === 'menu' ? 'Returning to' : 'Opening'
    transitionTitle.textContent = title
    root.dataset.transition = 'covering'
    coverShownAt = performance.now()
    /* Let the cover fully composite before doing any renderer construction.
       Otherwise shader compilation can freeze the menu halfway through its
       fade, which is the hitch this transition is intended to hide. */
    await wait(240)
    return transitionIsCurrent(requestedTransition)
  }

  function finishTransition(requestedTransition) {
    if (!transitionIsCurrent(requestedTransition)) return
    root.classList.remove('is-transitioning')
    root.removeAttribute('aria-busy')
    delete root.dataset.transition
    delete root.dataset.transitionTarget
  }

  async function revealStage(requestedTransition) {
    await waitForPaintFrames()
    if (!transitionIsCurrent(requestedTransition)) return false
    const held = performance.now() - coverShownAt
    if (held < MIN_COVER_MS) {
      await wait(MIN_COVER_MS - held)
      if (!transitionIsCurrent(requestedTransition)) return false
    }
    root.dataset.transition = 'revealing'
    await wait(340)
    if (!transitionIsCurrent(requestedTransition)) return false
    finishTransition(requestedTransition)
    return true
  }

  async function waitForGameFrame(requestedTransition) {
    /* Every game marks its canvas after its first successful render. Waiting
       here means the cover never reveals an empty canvas or half-built UI. */
    for (let frame = 0; frame < 60; frame += 1) {
      if (!transitionIsCurrent(requestedTransition)) return false
      if (gameHost.querySelector('.qvc-game__canvas.is-ready')) return true
      await waitForPaintFrames(1)
    }
    return transitionIsCurrent(requestedTransition)
  }

  /* Context loss can briefly paint a detached WebGL canvas white if it occurs
     in the same compositor frame as a view swap. Let the hidden state reach
     the screen first, then release the outgoing renderer on the next frame. */
  function disposeAfterViewSwap(controller) {
    if (!controller || deferredDisposals.has(controller)) return
    const frame = requestAnimationFrame(() => {
      deferredDisposals.delete(controller)
      controller.dispose()
    })
    deferredDisposals.set(controller, frame)
  }

  function flushDeferredDisposals() {
    for (const [controller, frame] of deferredDisposals) {
      cancelAnimationFrame(frame)
      controller.dispose()
    }
    deferredDisposals.clear()
  }

  async function showMenu() {
    if (root.classList.contains('is-transitioning')) return
    const requestedTransition = ++transitionId
    activeGameId = null
    const outgoingGame = gameController
    gameController = null

    if (outgoingGame && !await coverStage(requestedTransition, {
      targetId: 'menu',
      title: 'Three principles'
    })) return
    setView('menu')
    menuScene?.setActive(true)

    if (!menuScene) {
      const nextMenuScene = createMenuScene(menuStrip, sceneContext)
      menuScene = nextMenuScene
      try {
        await nextMenuScene.ready
      } catch (error) {
        if (menuScene === nextMenuScene) menuScene = null
        nextMenuScene.dispose()
        throw error
      }
    } else {
      await menuScene.ready
    }

    if (disposed || requestedTransition !== transitionId || activeGameId !== null) {
      return
    }

    menuScene?.setActive(true)
    disposeAfterViewSwap(outgoingGame)
    if (outgoingGame) await revealStage(requestedTransition)
  }

  async function openGame(gameId) {
    const game = GAMES[gameId]
    if (!game || root.classList.contains('is-transitioning')) return
    /* Reachable from a game's "Up next" as well as the menu, so the order is
       enforced here rather than only on the cards. */
    if (!isGameUnlocked(gameId)) return
    onActivity?.()

    const requestedTransition = ++transitionId
    activeGameId = gameId
    const outgoingGame = gameController
    gameController = null

    if (!await coverStage(requestedTransition, {
      targetId: gameId,
      title: game.label
    })) return
    setView('game')
    /* Keep the three preview renderers, PMREMs, shader programs and texture
       uploads alive for Back. Only their animation loop is suspended. */
    menuScene?.setActive(false)
    const nextController = await game.create(gameHost, sceneContext)
    if (disposed || requestedTransition !== transitionId || activeGameId !== gameId) {
      disposeAfterViewSwap(nextController)
      return
    }
    gameController = nextController
    await waitForGameFrame(requestedTransition)
    if (!transitionIsCurrent(requestedTransition)) return
    disposeAfterViewSwap(outgoingGame)
    await revealStage(requestedTransition)
  }

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-qvc-action]')?.dataset.qvcAction
    if (action) {
      onActivity?.()
      if (action === 'back') void showMenu()
      else if (action === 'restart') {
        if (root.dataset.view === 'game') gameController?.restart()
        else void showMenu()
      } else if (action === 'exit') navigate.menu?.()
      return
    }

    const gameId = event.target.closest('[data-qvc-game]')?.dataset.qvcGame
    if (gameId) void openGame(gameId)
  }, { signal: listeners.signal })

  function dispose() {
    if (disposed) return
    disposed = true
    transitionId += 1
    root.classList.remove('is-transitioning')
    root.removeAttribute('aria-busy')
    delete root.dataset.transition
    delete root.dataset.transitionTarget
    listeners.abort()
    flushDeferredDisposals()
    upNextBanner?.dispose()
    menuScene?.dispose()
    menuScene = null
    gameController?.dispose()
    gameController = null
  }
  signal?.addEventListener('abort', dispose, { once: true })

  await showMenu()
  if (signal?.aborted || disposed) throw createAbortError()
  return dispose
}

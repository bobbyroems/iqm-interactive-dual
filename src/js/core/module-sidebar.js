import { assetUrl } from './asset-url.js'
import { isPlayable, MODULES, nextPlayableModule } from '../modules/module-registry.js'

const ARTWORK = {
  'quantum-vs-classical': ['quantum-vs-classical.png', 526],
  'states-of-matter': ['states-of-matter.png', 362.572],
  'qubit-explorer': ['qubit-explorer.png', 431.809],
  'protecting-information': ['protecting-information.png', 420.206],
  'build-nanowire': ['build-nanowire.png', 471.626],
  'build-majorana-2': ['build-majorana-2.png', 542.234],
  nanoscale: ['nanoscale.png', 461.123]
}

export function createModuleSidebar({
  root = document,
  getActiveModuleId,
  canOpen,
  onActivity,
  onRestart,
  onHome,
  onModule
}) {
  const stage = root.getElementById('kiosk-stage')
  const screen = root.querySelector('[data-screen="module"]')
  const launcher = root.getElementById('module-sidebar-launcher')
  const overlay = root.getElementById('module-sidebar')
  const panel = root.getElementById('module-sidebar-panel')
  const grid = root.getElementById('module-sidebar-grid')
  const closeButton = panel.querySelector('[data-sidebar-action="close"]')
  const tiles = new Map()
  let inertElements = []

  for (const module of MODULES.filter(isPlayable)) {
    const tile = document.createElement('button')
    tile.type = 'button'
    tile.className = 'module-sidebar__tile'
    tile.dataset.sidebarModule = module.id
    const background = document.createElement('img')
    background.className = 'module-sidebar__selected-background'
    background.src = assetUrl('/assets/ui/module-sidebar/selected-background.png')
    background.alt = ''
    tile.append(background)

    const artwork = ARTWORK[module.id]
    if (artwork || module.id === 'quantum-platform') {
      const image = document.createElement('img')
      image.className = 'module-sidebar__art'
      image.src = assetUrl(artwork
        ? `/assets/ui/module-sidebar/${artwork[0]}`
        : '/assets/ui/up-next/quantum-platform.webp')
      image.width = 500
      image.height = artwork ? artwork[1] : 526
      image.alt = ''
      tile.append(image)
    }

    const title = document.createElement('span')
    title.className = 'module-sidebar__title'
    title.innerHTML = module.titleHtml || module.title
    const badge = document.createElement('span')
    badge.className = 'module-sidebar__badge'
    badge.textContent = 'Up next'
    badge.hidden = true
    tile.append(title, badge)
    grid.append(tile)
    tiles.set(module.id, { tile, badge })
  }

  const isOpen = () => !overlay.hidden
  const close = ({ restoreFocus = true } = {}) => {
    if (!isOpen()) return
    overlay.hidden = true
    launcher.setAttribute('aria-expanded', 'false')
    for (const [element, inert] of inertElements) element.inert = inert
    inertElements = []
    if (restoreFocus) launcher.focus({ preventScroll: true })
  }

  const open = () => {
    if (isOpen() || !canOpen()) return
    const activeId = getActiveModuleId()
    const nextId = nextPlayableModule(activeId)?.id
    for (const [id, { tile, badge }] of tiles) {
      if (id === activeId) tile.setAttribute('aria-current', 'true')
      else tile.removeAttribute('aria-current')
      badge.hidden = id !== nextId
    }
    overlay.hidden = false
    launcher.setAttribute('aria-expanded', 'true')
    const backgroundElements = [
      ...[...stage.children].filter(element => element !== screen),
      ...[...screen.children].filter(element => element !== overlay)
    ]
    inertElements = backgroundElements.map(element => [element, element.inert])
    for (const [element] of inertElements) element.inert = true
    grid.scrollTop = 0
    closeButton.focus({ preventScroll: true })
    onActivity()
  }

  launcher.addEventListener('click', open)
  overlay.addEventListener('pointerdown', onActivity)
  overlay.addEventListener('click', event => {
    const action = event.target.closest('[data-sidebar-action]')?.dataset.sidebarAction
    const moduleId = event.target.closest('[data-sidebar-module]')?.dataset.sidebarModule
    if (!action && !moduleId) return
    onActivity()
    close({ restoreFocus: !moduleId && action === 'close' })
    if (action === 'restart') onRestart()
    else if (action === 'home') onHome()
    else if (moduleId && moduleId !== getActiveModuleId()) onModule(moduleId)
    else if (moduleId) launcher.focus({ preventScroll: true })
  })

  // Capture before the app's Escape navigation and any module keyboard handlers.
  root.defaultView.addEventListener('keydown', event => {
    if (!isOpen()) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
      onActivity()
    } else if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button')].filter(button => !button.disabled)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && root.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && root.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }, true)

  return { open, close, isOpen }
}

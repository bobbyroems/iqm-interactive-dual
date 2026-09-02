export function createKioskTooltip({
  ariaHidden = false,
  className = '',
  hidden = false,
  text = ''
} = {}) {
  const element = document.createElement('div')
  element.className = ['kiosk-tooltip', className].filter(Boolean).join(' ')
  element.hidden = hidden
  element.setAttribute('aria-hidden', String(ariaHidden || hidden))

  const copy = document.createElement('p')
  copy.className = 'kiosk-tooltip__text'
  copy.textContent = text
  element.append(copy)

  return Object.freeze({ ariaHidden: Boolean(ariaHidden), copy, element })
}

export function updateKioskTooltip(tooltip, {
  replay = false,
  text = '',
  visible = false
} = {}) {
  if (!tooltip?.element || !tooltip.copy) return

  tooltip.copy.textContent = text
  tooltip.element.classList.remove('is-showing')
  tooltip.element.hidden = !visible
  tooltip.element.setAttribute('aria-hidden', String(tooltip.ariaHidden || !visible))
  if (!visible) return

  if (replay) void tooltip.element.offsetWidth
  tooltip.element.classList.add('is-showing')
}

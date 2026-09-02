const WINDOWS_KIOSK_GRAPHICS_SWITCHES = Object.freeze([
  'disable-direct-composition',
  /* Keep WebGL, video decode and GPU compositing accelerated, but rasterize
     Chromium's very large CSS layers on the CPU. The 4K kiosk otherwise runs
     out of compositor tile memory and briefly presents missing square tiles. */
  'disable-gpu-rasterization'
])

function getGraphicsSwitches({ isShellHosted, platform = process.platform } = {}) {
  if (platform !== 'win32' || !isShellHosted) return []
  return [...WINDOWS_KIOSK_GRAPHICS_SWITCHES]
}

function applyGraphicsPolicy(commandLine, options) {
  const switches = getGraphicsSwitches(options)
  switches.forEach(name => commandLine.appendSwitch(name))
  return switches
}

module.exports = {
  applyGraphicsPolicy,
  getGraphicsSwitches,
  WINDOWS_KIOSK_GRAPHICS_SWITCHES
}

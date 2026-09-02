const LAUNCH_MODES = Object.freeze({
  KIOSK: 'kiosk',
  WINDOWED: 'windowed'
})

function normalizeDefaultLaunchMode(value) {
  return value === LAUNCH_MODES.WINDOWED
    ? LAUNCH_MODES.WINDOWED
    : LAUNCH_MODES.KIOSK
}

function resolveRuntimeMode(
  argv = [],
  defaultLaunchMode = LAUNCH_MODES.KIOSK
) {
  const args = new Set(argv)
  const isDevelopment = args.has('--dev')
  let launchMode = normalizeDefaultLaunchMode(defaultLaunchMode)

  if (isDevelopment) {
    launchMode = LAUNCH_MODES.WINDOWED
  } else if (args.has('--kiosk')) {
    // Kiosk wins if contradictory flags are supplied. This keeps production
    // launchers fail-safe while still allowing an explicit review override.
    launchMode = LAUNCH_MODES.KIOSK
  } else if (args.has('--windowed')) {
    launchMode = LAUNCH_MODES.WINDOWED
  }

  const isWindowed = launchMode === LAUNCH_MODES.WINDOWED
  const isKiosk = !isDevelopment && !isWindowed
  const isShellHosted = isKiosk && args.has('--shell-hosted')

  return {
    allowQuit: isDevelopment || isWindowed || args.has('--allow-quit'),
    isDevelopment,
    isKiosk,
    isShellHosted,
    isWindowed,
    launchMode
  }
}

module.exports = {
  LAUNCH_MODES,
  normalizeDefaultLaunchMode,
  resolveRuntimeMode
}

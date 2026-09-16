const LAUNCH_MODES = Object.freeze({
  KIOSK: 'kiosk',
  WINDOWED: 'windowed'
})

function normalizeDefaultLaunchMode(value) {
  return value === LAUNCH_MODES.WINDOWED
    ? LAUNCH_MODES.WINDOWED
    : LAUNCH_MODES.KIOSK
}

/* The packaged build states how it wants to come up. A production kiosk keeps
   quit behind a flag so an unattended machine cannot be closed out of; a review
   build that opens fullscreen on someone's desk has to hand the exit back, or
   the only way out is Task Manager. */
function normalizePackagedDefaults(defaults) {
  if (typeof defaults === 'string') {
    return { defaultLaunchMode: defaults, defaultAllowQuit: false }
  }
  return {
    defaultLaunchMode: defaults?.defaultLaunchMode,
    defaultAllowQuit: defaults?.defaultAllowQuit === true
  }
}

function resolveRuntimeMode(
  argv = [],
  packagedDefaults = LAUNCH_MODES.KIOSK
) {
  const { defaultLaunchMode, defaultAllowQuit } = normalizePackagedDefaults(packagedDefaults)
  const args = new Set(argv)
  const isSupervised = args.has('--supervised')
  const isDevelopment = !isSupervised && args.has('--dev')
  let launchMode = normalizeDefaultLaunchMode(defaultLaunchMode)

  if (isSupervised) {
    launchMode = LAUNCH_MODES.KIOSK
  } else if (isDevelopment) {
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

  return {
    allowQuit: !isSupervised && (isDevelopment || isWindowed || defaultAllowQuit || args.has('--allow-quit')),
    isSupervised,
    isDevelopment,
    isKiosk,
    isWindowed,
    launchMode
  }
}

module.exports = {
  LAUNCH_MODES,
  normalizeDefaultLaunchMode,
  normalizePackagedDefaults,
  resolveRuntimeMode
}

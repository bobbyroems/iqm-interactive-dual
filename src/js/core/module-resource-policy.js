const WINDOWED_SCREEN_FADE_MS = 400

/**
 * Production navigation is an immediate cut so only one 4K experience owns
 * decoders and graphics contexts at a time. Windowed review keeps the authored
 * crossfade and therefore releases its outgoing module after that fade.
 */
export function moduleUnmountDelay(runtime = {}) {
  return runtime.isKiosk ? 0 : WINDOWED_SCREEN_FADE_MS
}

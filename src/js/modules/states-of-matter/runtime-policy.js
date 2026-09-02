/**
 * The WebGPU volume is useful for visual inspection, but Chromium currently
 * retains its renderer after the module is removed. Production kiosks use the
 * existing procedural steam treatment until that upstream lifecycle is safe.
 */
export function shouldMountVolumetricSteam(options = {}) {
  return !Boolean(options.runtime?.isKiosk)
}

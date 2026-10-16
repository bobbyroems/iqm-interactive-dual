export const PROTECTION_VISUAL_STAGE = Object.freeze({ width: 2160, height: 2600 })

export function fitProtectionVisual(width, height) {
  const scale = Math.min(
    Math.max(width, 1) / PROTECTION_VISUAL_STAGE.width,
    Math.max(height, 1) / PROTECTION_VISUAL_STAGE.height
  )
  return {
    scale,
    left: (width - PROTECTION_VISUAL_STAGE.width * scale) / 2,
    top: (height - PROTECTION_VISUAL_STAGE.height * scale) / 2
  }
}

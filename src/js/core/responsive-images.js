import { assetUrl } from './asset-url.js'

export const BROWSER_IMAGE_WIDTHS = Object.freeze([768, 1500, 2048])
export const RESPONSIVE_IMAGE_PATHS = Object.freeze([
  'assets/modules/build-majorana-2/majorana-intro-hero.png',
  'assets/modules/build-majorana-2/majorana-schematic-backdrop.png',
  'assets/modules/measurement-based/menu-preview.png'
])

export function browserImagePath(path, width) {
  if (!BROWSER_IMAGE_WIDTHS.includes(width)) {
    throw new RangeError(`Unsupported browser image width: ${width}`)
  }
  return path.replace(/\.png$/, `-browser-${width}.webp`)
}

export function imageSources(path, {
  platform = globalThis.window?.kiosk?.platform,
  baseUrl = globalThis.document?.baseURI
} = {}) {
  const normalizedPath = path.replace(/^\/+/, '')
  if (platform || !RESPONSIVE_IMAGE_PATHS.includes(normalizedPath)) {
    return { src: assetUrl(path, baseUrl) }
  }
  return {
    // Set responsive attributes before src when applying them to a live image.
    sizes: 'min(100vw, 56.25vh)',
    srcset: BROWSER_IMAGE_WIDTHS.map(width =>
      `${assetUrl(browserImagePath(normalizedPath, width), baseUrl)} ${width}w`
    ).join(', '),
    src: assetUrl(browserImagePath(normalizedPath, 1500), baseUrl)
  }
}

export function imageSourceAttributes(path, options) {
  return Object.entries(imageSources(path, options))
    .map(([name, value]) => `${name}="${value}"`).join(' ')
}

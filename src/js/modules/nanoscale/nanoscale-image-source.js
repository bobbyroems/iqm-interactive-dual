export const NANOSCALE_IMAGE_SIZES = Object.freeze([1024, 1536, 2048])

export function nanoscaleImageSize({ width, height, devicePixelRatio = 1 }) {
  const longestSide = Math.max(width, height)
  if (longestSide > NANOSCALE_IMAGE_SIZES.at(-1)) return 0
  const target = longestSide * Math.min(devicePixelRatio, 1.5)
  return NANOSCALE_IMAGE_SIZES.find(size => size >= target) ?? NANOSCALE_IMAGE_SIZES.at(-1)
}

export function isNanoscaleRaster(path) {
  return path.startsWith('assets/modules/nanoscale/') && /\.(png|jpe?g|webp)$/.test(path)
}

export function nanoscaleImagePath(path, size = 0) {
  if (!size || !isNanoscaleRaster(path)) return path
  if (!NANOSCALE_IMAGE_SIZES.includes(size)) {
    throw new RangeError(`Unsupported Nanoscale image size: ${size}`)
  }
  return path.replace('assets/modules/nanoscale/', 'assets/modules/nanoscale/responsive/')
    .replace(/\.(png|jpe?g|webp)$/, `-${size}.webp`)
}

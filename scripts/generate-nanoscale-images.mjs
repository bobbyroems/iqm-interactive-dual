import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { NANOSCALE_RUNTIME_IMAGE_PATHS } from '../src/js/modules/nanoscale/nanoscale-assets.js'
import {
  isNanoscaleRaster,
  NANOSCALE_IMAGE_SIZES,
  nanoscaleImagePath
} from '../src/js/modules/nanoscale/nanoscale-image-source.js'

const publicRoot = resolve(import.meta.dirname, '../public')
const paths = NANOSCALE_RUNTIME_IMAGE_PATHS.filter(isNanoscaleRaster)

for (const size of NANOSCALE_IMAGE_SIZES) {
  let bytes = 0
  let pixels = 0
  for (const path of paths) {
    const destination = resolve(publicRoot, nanoscaleImagePath(path, size))
    await mkdir(dirname(destination), { recursive: true })
    const image = await sharp(resolve(publicRoot, path))
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ lossless: true, effort: 6 })
      .toFile(destination)
    bytes += image.size
    pixels += image.width * image.height
  }
  console.log(`${size}px: ${paths.length} images, ${(bytes / 1048576).toFixed(2)} MiB on disk, ${(pixels * 4 / 1048576).toFixed(2)} MiB RGBA`)
}

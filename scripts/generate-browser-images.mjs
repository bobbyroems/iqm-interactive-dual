import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import sharp from 'sharp'
import {
  BROWSER_IMAGE_WIDTHS,
  RESPONSIVE_IMAGE_PATHS,
  browserImagePath
} from '../src/js/core/responsive-images.js'

const publicRoot = resolve(import.meta.dirname, '../public')

for (const path of RESPONSIVE_IMAGE_PATHS) {
  const source = resolve(publicRoot, path)
  const originalBytes = (await stat(source)).size
  for (const width of BROWSER_IMAGE_WIDTHS) {
    const output = await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .keepIccProfile()
      .webp({ quality: 85, effort: 6 })
      .toFile(resolve(publicRoot, browserImagePath(path, width)))
    console.log(
      `${browserImagePath(path, width)}: ${output.width} x ${output.height}, ` +
      `${originalBytes} -> ${output.size} bytes`
    )
  }
}

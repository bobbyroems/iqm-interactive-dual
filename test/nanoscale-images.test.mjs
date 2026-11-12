import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { NANOSCALE_RUNTIME_IMAGE_PATHS } from '../src/js/modules/nanoscale/nanoscale-assets.js'
import { isNanoscaleRaster, nanoscaleImagePath } from '../src/js/modules/nanoscale/nanoscale-image-source.js'
import { fileURLToPath } from 'node:url'

test('generated browser artwork meets decoded-pixel budgets without changing its registered framing', async () => {
  const paths = NANOSCALE_RUNTIME_IMAGE_PATHS.filter(isNanoscaleRaster)
  const metadata = path => sharp(fileURLToPath(new URL(`../public/${path}`, import.meta.url))).metadata()
  for (const [size, budgetMiB] of [[1024, 50], [1536, 100], [2048, 165]]) {
    let pixels = 0
    for (const path of paths) {
      const source = await metadata(path)
      const variant = await metadata(nanoscaleImagePath(path, size))
      const scale = Math.min(1, size / Math.max(source.width, source.height))
      assert.equal(variant.format, 'webp')
      assert(Math.abs(variant.width - source.width * scale) <= 1, `${path}: width changes framing`)
      assert(Math.abs(variant.height - source.height * scale) <= 1, `${path}: height changes framing`)
      pixels += variant.width * variant.height
    }
    assert(pixels * 4 / 1048576 <= budgetMiB, `${size}px artwork exceeds ${budgetMiB} MiB`)
  }
})

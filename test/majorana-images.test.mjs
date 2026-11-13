import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import sharp from 'sharp'

test('Majorana runtime images reduce transfer size without changing visible pixels', async () => {
  for (const name of ['majorana-intro-hero', 'majorana-schematic-backdrop']) {
    const sourcePath = fileURLToPath(new URL(`../ref/majorana-image-masters/${name}.png`, import.meta.url))
    const runtimePath = fileURLToPath(new URL(`../public/assets/modules/build-majorana-2/${name}.webp`, import.meta.url))
    const sourceMetadata = await sharp(sourcePath).metadata()
    const runtimeMetadata = await sharp(runtimePath).metadata()
    assert.equal(runtimeMetadata.format, 'webp')
    assert.equal(runtimeMetadata.width, sourceMetadata.width, `${name}: width`)
    assert.equal(runtimeMetadata.height, sourceMetadata.height, `${name}: height`)
    assert.deepEqual(runtimeMetadata.icc, sourceMetadata.icc, `${name}: color profile`)
    assert((await stat(runtimePath)).size <= (await stat(sourcePath)).size * 0.7,
      `${name}: transfer savings must be at least 30%`)

    const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer()
    const runtime = await sharp(runtimePath).ensureAlpha().raw().toBuffer()
    assert.equal(runtime.length, source.length)
    for (let offset = 0; offset < source.length; offset += 4) {
      assert.equal(runtime[offset + 3], source[offset + 3], `${name}: alpha at pixel ${offset / 4}`)
      // Lossless WebP may discard RGB in fully transparent pixels.
      if (source[offset + 3] === 0) continue
      if (runtime[offset] !== source[offset] ||
          runtime[offset + 1] !== source[offset + 1] ||
          runtime[offset + 2] !== source[offset + 2]) {
        assert.fail(`${name}: visible color changed at pixel ${offset / 4}`)
      }
    }
  }
})

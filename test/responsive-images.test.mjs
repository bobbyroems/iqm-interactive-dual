import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  BROWSER_IMAGE_WIDTHS,
  RESPONSIVE_IMAGE_PATHS,
  browserImagePath,
  imageSources
} from '../src/js/core/responsive-images.js'

test('browser images use only responsive variants, including nested deployments', () => {
  const sources = imageSources(`/${RESPONSIVE_IMAGE_PATHS[0]}`, {
    platform: undefined, baseUrl: 'https://example.test/kiosk/'
  })
  assert.match(sources.src, /^https:\/\/example\.test\/kiosk\/.*-browser-1500\.webp$/)
  assert.equal(sources.srcset.split(', ').length, 3)
  assert.doesNotMatch(sources.srcset, /\.png/)
  assert.equal(sources.sizes, 'min(100vw, 56.25vh)')
})

test('Electron and unrelated images retain their original sources', () => {
  const baseUrl = 'app://kiosk/'
  for (const path of RESPONSIVE_IMAGE_PATHS) {
    assert.deepEqual(imageSources(path, { platform: 'win32', baseUrl }), {
      src: `${baseUrl}${path}`
    })
  }
  assert.deepEqual(imageSources('/assets/ui/microsoft-logo.png', {
    platform: undefined, baseUrl
  }), { src: `${baseUrl}assets/ui/microsoft-logo.png` })
})

test('generated variants retain dimensions and alpha with at least 90% byte savings', async () => {
  for (const path of RESPONSIVE_IMAGE_PATHS) {
    const source = new URL(`../public/${path}`, import.meta.url)
    const original = await sharp(fileURLToPath(source)).metadata()
    const originalBytes = (await stat(source)).size
    for (const width of BROWSER_IMAGE_WIDTHS) {
      const variant = new URL(`../public/${browserImagePath(path, width)}`, import.meta.url)
      const metadata = await sharp(fileURLToPath(variant)).metadata()
      assert.equal(metadata.width, width)
      assert.ok(Math.abs(metadata.height - original.height * width / original.width) <= 1)
      assert.equal(metadata.hasAlpha, original.hasAlpha)
      assert.ok((await stat(variant)).size < originalBytes * 0.1, `${path} at ${width}px exceeds byte budget`)
    }
  }
})

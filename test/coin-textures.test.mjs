import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { decodeBmp24 } from '../scripts/generate-coin-textures.mjs'
import {
  COIN_TEXTURE_PATHS,
  COIN_BUMP_TEXTURE_PATH,
  BROWSER_COIN_TEXTURE_WIDTH,
  coinTexturePath
} from '../src/js/modules/quantum-vs-classical/coin-texture-source.js'

function bmpFixture(topDown) {
  const bytes = Buffer.alloc(62)
  bytes.write('BM')
  bytes.writeUInt32LE(bytes.length, 2)
  bytes.writeUInt32LE(54, 10)
  bytes.writeUInt32LE(40, 14)
  bytes.writeInt32LE(1, 18)
  bytes.writeInt32LE(topDown ? -2 : 2, 22)
  bytes.writeUInt16LE(1, 26)
  bytes.writeUInt16LE(24, 28)
  Buffer.from(topDown ? [0, 0, 255, 0, 255, 0, 0, 0] :
    [255, 0, 0, 0, 0, 0, 255, 0]).copy(bytes, 54)
  return bytes
}

test('BMP decoder preserves RGB pixels, row padding and top-down/bottom-up orientation', () => {
  for (const topDown of [false, true]) {
    const decoded = decodeBmp24(bmpFixture(topDown))
    assert.deepEqual(decoded, {
      data: Buffer.from([255, 0, 0, 0, 0, 255]), width: 1, height: 2, channels: 3
    })
  }
})

test('BMP decoder rejects unsupported encodings and truncated pixel data', () => {
  const unsupported = bmpFixture(false)
  unsupported.writeUInt16LE(32, 28)
  assert.throws(() => decodeBmp24(unsupported), /uncompressed 24-bit BMP/)
  assert.throws(() => decodeBmp24(bmpFixture(false).subarray(0, 61)), /truncated pixel data/)
})

test('browser coin textures use derivatives while Electron retains every original', () => {
  for (const path of COIN_TEXTURE_PATHS) {
    assert.match(coinTexturePath(path), /-browser\.webp$/)
    assert.equal(coinTexturePath(path, 'win32'), path)
  }
})

async function resizedSource(path, bytes) {
  let image
  if (path.endsWith('.bmp')) {
    const { data, ...raw } = decodeBmp24(bytes)
    image = sharp(data, { raw })
  } else {
    image = sharp(bytes)
  }
  return image.resize({ width: BROWSER_COIN_TEXTURE_WIDTH }).raw().toBuffer()
}

test('generated coin textures reduce transfer by 75% while preserving color fidelity and bump pixels', async () => {
  let originalBytes = 0
  let browserBytes = 0
  for (const path of COIN_TEXTURE_PATHS) {
    const original = await readFile(new URL(`../public/${path}`, import.meta.url))
    const browser = await readFile(new URL(`../public/${coinTexturePath(path)}`, import.meta.url))
    originalBytes += original.length
    browserBytes += browser.length
    const metadata = await sharp(browser).metadata()
    assert.equal(metadata.width, BROWSER_COIN_TEXTURE_WIDTH)
    assert.equal(metadata.height, 1014)
    const expected = await resizedSource(path, original)
    const actual = await sharp(browser).raw().toBuffer()
    assert.equal(actual.length, expected.length)
    if (path === COIN_BUMP_TEXTURE_PATH) {
      assert.ok(actual.equals(expected), 'Bump encoding must preserve every resized pixel')
    } else {
      let error = 0
      for (let i = 0; i < actual.length; i++) error += (actual[i] - expected[i]) ** 2
      const psnr = 10 * Math.log10(255 ** 2 / (error / actual.length))
      assert.ok(psnr >= 35, `${path} color PSNR ${psnr.toFixed(2)} dB is below 35 dB`)
    }
  }
  assert.ok(browserBytes < originalBytes * 0.25, 'Browser coin textures exceed download budget')
})

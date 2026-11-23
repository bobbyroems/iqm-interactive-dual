import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
  COIN_TEXTURE_PATHS,
  COIN_BUMP_TEXTURE_PATH,
  BROWSER_COIN_TEXTURE_WIDTH,
  coinTexturePath
} from '../src/js/modules/quantum-vs-classical/coin-texture-source.js'

export function decodeBmp24(bytes) {
  if (bytes.length < 54 || bytes.toString('ascii', 0, 2) !== 'BM' ||
      bytes.readUInt32LE(14) !== 40 || bytes.readUInt16LE(26) !== 1 ||
      bytes.readUInt16LE(28) !== 24 || bytes.readUInt32LE(30) !== 0) {
    throw new Error('Coin texture must be an uncompressed 24-bit BMP with a BITMAPINFOHEADER')
  }
  const width = bytes.readInt32LE(18)
  const signedHeight = bytes.readInt32LE(22)
  const height = Math.abs(signedHeight)
  const pixelOffset = bytes.readUInt32LE(10)
  const stride = Math.ceil(width * 3 / 4) * 4
  if (width <= 0 || height === 0 || pixelOffset < 54 ||
      pixelOffset + stride * height > bytes.length) {
    throw new Error('Coin BMP has invalid dimensions or truncated pixel data')
  }
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const row = signedHeight > 0 ? height - y - 1 : y
    for (let x = 0; x < width; x++) {
      const source = pixelOffset + row * stride + x * 3
      const target = (y * width + x) * 3
      data[target] = bytes[source + 2]
      data[target + 1] = bytes[source + 1]
      data[target + 2] = bytes[source]
    }
  }
  return { data, width, height, channels: 3 }
}

async function main() {
  const publicRoot = resolve(import.meta.dirname, '../public')
  for (const path of COIN_TEXTURE_PATHS) {
    const source = resolve(publicRoot, path)
    const bytes = await readFile(source)
    let image
    if (path.endsWith('.bmp')) {
      const { data, ...raw } = decodeBmp24(bytes)
      image = sharp(data, { raw })
    } else {
      image = sharp(bytes)
    }
    const output = await image
      .resize({ width: BROWSER_COIN_TEXTURE_WIDTH, withoutEnlargement: true })
      .keepIccProfile()
      .webp({ quality: 95, lossless: path === COIN_BUMP_TEXTURE_PATH, effort: 6 })
      .toFile(resolve(publicRoot, coinTexturePath(path)))
    console.log(
      `${coinTexturePath(path)}: ${output.width} x ${output.height}, ` +
      `${(await stat(source)).size} -> ${output.size} bytes`
    )
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}

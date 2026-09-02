import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const OUTPUT_DIRECTORY = resolve(
  import.meta.dirname,
  '../public/assets/modules/states-of-matter/frost'
)

class MemoryCanvasContext {
  constructor(canvas) {
    this.canvas = canvas
  }

  createImageData(width, height) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4)
    }
  }

  putImageData(imageData) {
    this.canvas.imageData = imageData
  }
}

class MemoryCanvas {
  constructor() {
    this.width = 0
    this.height = 0
    this.imageData = null
    this.context = new MemoryCanvasContext(this)
  }

  getContext(type) {
    return type === '2d' ? this.context : null
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6

  const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const stride = width * 4
  const scanlines = Buffer.alloc((stride + 1) * height)
  for (let row = 0; row < height; row += 1) {
    const target = row * (stride + 1)
    scanlines[target] = 0
    pixels.copy(scanlines, target + 1, row * stride, (row + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

async function main() {
  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'canvas') throw new TypeError(`Unsupported generated element: ${tagName}`)
      return new MemoryCanvas()
    }
  }

  const {
    createFrostFilmMap,
    createFrostFineMap,
    createFrostMap,
    createNoiseMap
  } = await import('../src/js/modules/states-of-matter/state-fields.js')

  const assets = [
    ['noise.png', () => createNoiseMap()],
    ['frost-main.png', () => createFrostMap()],
    ['frost-fine.png', () => createFrostFineMap()],
    ['frost-film.png', () => createFrostFilmMap({ beadScale: 0.4, beadCount: 10100 })]
  ]

  await mkdir(OUTPUT_DIRECTORY, { recursive: true })
  for (const [filename, create] of assets) {
    const canvas = create()
    if (!canvas?.imageData) throw new Error(`${filename} did not produce pixel data`)
    const output = resolve(OUTPUT_DIRECTORY, filename)
    const png = encodePng(canvas.imageData)
    await writeFile(output, png)
    console.log(`Generated ${filename}: ${canvas.width}x${canvas.height}, ${png.length} bytes`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

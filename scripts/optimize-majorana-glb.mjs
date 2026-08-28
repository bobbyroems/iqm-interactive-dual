import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const GLB_MAGIC = 0x46546c67

const [inputArgument, outputArgument, maxDimensionArgument = '1024'] = process.argv.slice(2)

if (!inputArgument || !outputArgument) {
  console.error('Usage: node scripts/optimize-majorana-glb.mjs <input.glb> <output.glb> [max-texture-dimension]')
  process.exit(1)
}

const inputPath = resolve(inputArgument)
const outputPath = resolve(outputArgument)
const maxDimension = Number.parseInt(maxDimensionArgument, 10)

if (!Number.isInteger(maxDimension) || maxDimension < 256) {
  throw new TypeError('The maximum texture dimension must be an integer of at least 256.')
}

if (inputPath === outputPath) {
  throw new Error('Input and output must be different files. Replace the source only after validating the output.')
}

function align4(value) {
  return (value + 3) & ~3
}

function parseGlb(file) {
  if (file.readUInt32LE(0) !== GLB_MAGIC || file.readUInt32LE(4) !== 2) {
    throw new Error('Only glTF 2.0 GLB files are supported.')
  }

  let json = null
  let binary = null
  let offset = 12

  while (offset + 8 <= file.length) {
    const chunkLength = file.readUInt32LE(offset)
    const chunkType = file.readUInt32LE(offset + 4)
    const chunk = file.subarray(offset + 8, offset + 8 + chunkLength)

    if (chunkType === JSON_CHUNK) {
      json = JSON.parse(chunk.toString('utf8').replace(/[\u0000\u0020]+$/u, ''))
    } else if (chunkType === BIN_CHUNK) {
      binary = chunk
    }

    offset += 8 + chunkLength
  }

  if (!json || !binary) throw new Error('The GLB must contain one JSON chunk and one BIN chunk.')
  if (json.buffers?.length !== 1) throw new Error('Only a single embedded GLB buffer is supported.')

  return { json, binary }
}

function pngDimensions(bytes) {
  const pngSignature = '89504e470d0a1a0a'
  if (bytes.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('The supplied Majorana optimizer currently expects embedded PNG textures.')
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

function resizePng(input, output) {
  const result = spawnSync('magick', [
    input,
    '-filter',
    'Lanczos',
    '-resize',
    `${maxDimension}x${maxDimension}>`,
    '-strip',
    '-define',
    'png:compression-level=9',
    output
  ], { encoding: 'utf8' })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`ImageMagick failed: ${result.stderr || result.stdout || `exit ${result.status}`}`)
  }
}

function encodeGlb(json, binary) {
  const jsonSource = Buffer.from(JSON.stringify(json))
  const jsonLength = align4(jsonSource.length)
  const jsonChunk = Buffer.alloc(jsonLength, 0x20)
  jsonSource.copy(jsonChunk)

  const binaryLength = align4(binary.length)
  const binaryChunk = Buffer.alloc(binaryLength)
  binary.copy(binaryChunk)

  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length
  const output = Buffer.alloc(totalLength)
  output.writeUInt32LE(GLB_MAGIC, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(totalLength, 8)
  output.writeUInt32LE(jsonChunk.length, 12)
  output.writeUInt32LE(JSON_CHUNK, 16)
  jsonChunk.copy(output, 20)

  const binaryHeaderOffset = 20 + jsonChunk.length
  output.writeUInt32LE(binaryChunk.length, binaryHeaderOffset)
  output.writeUInt32LE(BIN_CHUNK, binaryHeaderOffset + 4)
  binaryChunk.copy(output, binaryHeaderOffset + 8)
  return output
}

const source = readFileSync(inputPath)
const { json, binary } = parseGlb(source)
const imageByBufferView = new Map(
  (json.images || []).map((image, imageIndex) => [image.bufferView, { image, imageIndex }])
)

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'iqm-majorana-glb-'))
const replacementBytes = new Map()
let resizedTextureCount = 0

try {
  for (const [bufferViewIndex, { image, imageIndex }] of imageByBufferView) {
    if (image.mimeType !== 'image/png') {
      throw new Error(`Image ${imageIndex} uses unsupported MIME type ${image.mimeType}.`)
    }

    const bufferView = json.bufferViews[bufferViewIndex]
    const bytes = binary.subarray(
      bufferView.byteOffset || 0,
      (bufferView.byteOffset || 0) + bufferView.byteLength
    )
    const { width, height } = pngDimensions(bytes)

    if (Math.max(width, height) <= maxDimension) {
      replacementBytes.set(bufferViewIndex, bytes)
      continue
    }

    const inputImage = join(temporaryDirectory, `image-${imageIndex}-source.png`)
    const outputImage = join(temporaryDirectory, `image-${imageIndex}-${maxDimension}.png`)
    writeFileSync(inputImage, bytes)
    resizePng(inputImage, outputImage)
    replacementBytes.set(bufferViewIndex, readFileSync(outputImage))
    resizedTextureCount += 1
  }

  const chunks = []
  let binaryOffset = 0

  json.bufferViews.forEach((bufferView, bufferViewIndex) => {
    const alignedOffset = align4(binaryOffset)
    if (alignedOffset > binaryOffset) chunks.push(Buffer.alloc(alignedOffset - binaryOffset))

    const bytes = replacementBytes.get(bufferViewIndex) || binary.subarray(
      bufferView.byteOffset || 0,
      (bufferView.byteOffset || 0) + bufferView.byteLength
    )

    bufferView.byteOffset = alignedOffset
    bufferView.byteLength = bytes.length
    chunks.push(bytes)
    binaryOffset = alignedOffset + bytes.length
  })

  const optimizedBinary = Buffer.concat(chunks)
  json.buffers[0].byteLength = align4(optimizedBinary.length)
  const optimizedGlb = encodeGlb(json, optimizedBinary)

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, optimizedGlb)

  const sourceMiB = statSync(inputPath).size / 1024 / 1024
  const outputMiB = statSync(outputPath).size / 1024 / 1024
  console.log(`Resized ${resizedTextureCount} embedded textures to at most ${maxDimension}px.`)
  console.log(`GLB size: ${sourceMiB.toFixed(1)} MiB -> ${outputMiB.toFixed(1)} MiB.`)
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

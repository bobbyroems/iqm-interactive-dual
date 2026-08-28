import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Accessor, NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'

const [
  ,
  ,
  inputArgument,
  outputArgument,
  splitXArgument = '0.025',
  hHalfXArgument = '0.0485',
  hHalfZArgument = '0.0265'
] = process.argv

if (!inputArgument || !outputArgument) {
  console.error(
    'Usage: node scripts/prepare-protecting-information-glb.mjs <input.glb> <output.glb> ' +
    '[split-x=0.025] [h-half-x=0.0485] [h-half-z=0.0265]'
  )
  process.exit(1)
}

const inputPath = resolve(inputArgument)
const outputPath = resolve(outputArgument)
const splitX = Number(splitXArgument)
const hHalfX = Number(hHalfXArgument)
const hHalfZ = Number(hHalfZArgument)
if (!Number.isFinite(splitX)) throw new TypeError('split-x must be a finite number')
if (!Number.isFinite(hHalfX) || hHalfX <= 0) {
  throw new TypeError('h-half-x must be a positive finite number')
}
if (!Number.isFinite(hHalfZ) || hHalfZ <= 0) {
  throw new TypeError('h-half-z must be a positive finite number')
}
if (!existsSync(inputPath)) throw new Error(`Input model does not exist: ${inputPath}`)

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const cliPath = join(projectRoot, 'node_modules/@gltf-transform/cli/bin/cli.js')
const temporaryPath = `${outputPath}.split.glb`

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const document = await io.read(inputPath)
const root = document.getRoot()
const buffer = root.listBuffers()[0] || document.createBuffer('buffer')

// Runtime materials are rebuilt from semantic node names. Dropping the source
// material graph here also drops its 4K metallic/roughness texture, avoiding an
// otherwise unused ~85 MB GPU upload on the kiosk.
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) primitive.setMaterial(null)
}

function splitGateNode(nodeName) {
  const node = root.listNodes().find(candidate => candidate.getName() === nodeName)
  const sourceMesh = node?.getMesh()
  const primitive = sourceMesh?.listPrimitives()[0]
  const position = primitive?.getAttribute('POSITION')
  const sourceIndices = primitive?.getIndices()?.getArray()
  if (!node || !sourceMesh || !primitive || !position || !sourceIndices) {
    throw new Error(`Expected an indexed ${nodeName} primitive with POSITION data`)
  }

  const h = []
  const rear = []
  const front = []
  const point = [0, 0, 0]
  for (let offset = 0; offset < sourceIndices.length; offset += 3) {
    const a = sourceIndices[offset]
    const b = sourceIndices[offset + 1]
    const c = sourceIndices[offset + 2]
    position.getElement(a, point)
    const ax = point[0]
    const az = point[2]
    position.getElement(b, point)
    const bx = point[0]
    const bz = point[2]
    position.getElement(c, point)
    const cx = point[0]
    const cz = point[2]
    const centroidX = (ax + bx + cx) / 3
    const centroidZ = (az + bz + cz) / 3
    const isH = Math.abs(centroidX) <= hHalfX && Math.abs(centroidZ) <= hHalfZ
    const target = isH ? h : centroidX >= splitX ? rear : front
    target.push(a, b, c)
  }

  const makeMesh = (suffix, indices) => {
    const indexAccessor = document
      .createAccessor(`${nodeName}_${suffix}_INDICES`, buffer)
      .setType(Accessor.Type.SCALAR)
      .setArray(new Uint32Array(indices))
    const splitPrimitive = primitive.clone().setIndices(indexAccessor)
    return document.createMesh(`${nodeName}_${suffix}`).addPrimitive(splitPrimitive)
  }

  const hMesh = makeMesh('H', h)
  const rearMesh = makeMesh('REAR', rear)
  const frontMesh = makeMesh('FRONT', front)
  const parent = node
    .listParents()
    .find(candidate => candidate.propertyType === PropertyType.NODE)
  if (!parent) throw new Error(`${nodeName} must have a parent node`)

  node.setName(`${nodeName}_REAR`).setMesh(rearMesh)
  parent.addChild(document.createNode(`${nodeName}_H`).setMesh(hMesh))
  parent.addChild(document.createNode(`${nodeName}_FRONT`).setMesh(frontMesh))
  sourceMesh.dispose()

  return {
    hTriangles: h.length / 3,
    frontTriangles: front.length / 3,
    rearTriangles: rear.length / 3
  }
}

const upper = splitGateNode('UPPER-GATE')
const lower = splitGateNode('LOWER-GATE')
await io.write(temporaryPath, document)

try {
  const optimize = spawnSync(process.execPath, [
    cliPath,
    'optimize',
    temporaryPath,
    outputPath,
    '--compress', 'meshopt',
    '--meshopt-level', 'high',
    '--flatten', 'false',
    '--join', 'false',
    '--instance', 'false',
    '--palette', 'false',
    '--simplify', 'false',
    '--texture-compress', 'false',
    '--prune', 'true'
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (optimize.status !== 0) {
    throw new Error(`glTF Transform failed:\n${optimize.stderr || optimize.stdout}`)
  }
} finally {
  rmSync(temporaryPath, { force: true })
}

console.log(JSON.stringify({ splitX, hHalfX, hHalfZ, upper, lower, output: outputPath }, null, 2))

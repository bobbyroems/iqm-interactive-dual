/*
 * Verifies that everything Vite emitted into dist/ actually survived packaging.
 *
 * electron-builder appends its own ignore list after every user `files`
 * pattern — it drops *.obj, *.a, *.o, *.mk and friends because they are build
 * artefacts in a C project. Ours are meshes. Nothing warns: the installer just
 * ships without them and the module dies at runtime with "Failed to fetch",
 * which is what a file:// request for a missing file looks like from fetch().
 *
 * The renderer's own asset check (check-media-assets.mjs) runs against dist/
 * and therefore cannot see this — the loss happens later, inside
 * electron-builder. So compare dist/ against the packaged app itself.
 */

import { access, open, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/* asar layout: four little-endian uint32 pickle fields, then the JSON header.
   Only the last size matters to us — the JSON payload length at byte 12. */
async function readAsarHeader(asarPath) {
  const handle = await open(asarPath, 'r')
  try {
    const sizes = Buffer.alloc(16)
    await handle.read(sizes, 0, 16, 0)
    const jsonLength = sizes.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    await handle.read(json, 0, jsonLength, 16)
    return JSON.parse(json.toString('utf8'))
  } finally {
    await handle.close()
  }
}

function collectAsarEntries(node, prefix = '') {
  const entries = new Map()
  for (const [name, meta] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (meta.files) {
      for (const [nested, value] of collectAsarEntries(meta, path)) {
        entries.set(nested, value)
      }
    } else {
      entries.set(path, meta)
    }
  }
  return entries
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => {
    const absolutePath = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(absolutePath) : [absolutePath]
  }))
  return nested.flat()
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * @param resourcesDir the packaged app's `resources` directory
 * @param distDir the dist/ tree the package was built from
 */
export async function validatePackagedAssets(resourcesDir, distDir) {
  const asarPath = join(resourcesDir, 'app.asar')
  const unpackedDir = join(resourcesDir, 'app.asar.unpacked')
  const packaged = collectAsarEntries(await readAsarHeader(asarPath))
  const expected = await collectFiles(resolve(distDir))
  const failures = []

  for (const filename of expected) {
    /* asar paths are posix-separated and rooted at the app directory, so a
       dist-relative path has to be re-prefixed to match. */
    const relativePath = relative(resolve(distDir), filename).split(sep).join('/')
    const entry = packaged.get(`dist/${relativePath}`)

    if (!entry) {
      failures.push(`dist/${relativePath}: missing from app.asar`)
      continue
    }

    /* Unpacked entries are listed in the header but stored on disk beside it;
       an absent file there is just as broken as an absent header entry. */
    if (entry.unpacked && !(await exists(join(unpackedDir, 'dist', relativePath)))) {
      failures.push(`dist/${relativePath}: listed as unpacked but absent from app.asar.unpacked`)
      continue
    }

    const { size } = await stat(filename)
    if (entry.size !== size) {
      failures.push(`dist/${relativePath}: packaged as ${entry.size} bytes, expected ${size}`)
    }
  }

  if (failures.length) {
    throw new Error(
      `Packaged app is missing files that exist in dist/:\n${
        failures.map(failure => `- ${failure}`).join('\n')
      }\n\nelectron-builder silently drops some extensions (obj, a, o, mk, pdb, …).` +
      ' Re-add them with a `files` entry that sets an explicit `from`.'
    )
  }

  return { checked: expected.length, resourcesDir }
}

async function main() {
  const projectRoot = resolve(import.meta.dirname, '..')
  const outDir = process.argv[2] || 'build'
  const resourcesDir = resolve(projectRoot, outDir, 'win-unpacked', 'resources')

  if (!(await exists(join(resourcesDir, 'app.asar')))) {
    console.log(`No packaged app at ${resourcesDir} — skipping packaged asset check.`)
    return
  }

  const result = await validatePackagedAssets(resourcesDir, resolve(projectRoot, 'dist'))
  console.log(`Packaged assets checked: ${result.checked} files present in ${result.resourcesDir}`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

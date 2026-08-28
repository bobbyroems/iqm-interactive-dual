import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json')
const reviewConfig = require('../scripts/electron-builder-review.cjs')

test('production Windows package remains a kiosk NSIS installer', () => {
  assert.equal(packageJson.build.extraMetadata.defaultLaunchMode, 'kiosk')
  assert.deepEqual(packageJson.build.win.target, ['nsis'])
  assert.match(packageJson.scripts['package:win'], /--win nsis --x64/)
})

/* electron-builder's built-in ignore list drops *.obj — it reads the extension
   as a C object file. The pattern is appended after every user pattern in the
   root matcher, so it cannot be negated from there; the defaults are only
   applied to the matcher whose `from` is the app directory. A second matcher
   rooted at dist/ is the one shape that re-adds the meshes. Without it the coin
   mesh vanishes from the installer and Quantum vs. classical dies on launch
   with "Failed to fetch". */
test('packaged files re-add the mesh sources electron-builder strips by default', () => {
  const objMatcher = packageJson.build.files.find(
    entry => typeof entry === 'object' && entry.from === 'dist'
  )

  assert.ok(objMatcher, 'expected a dist-rooted files entry for the .obj meshes')
  assert.equal(objMatcher.to, 'dist')
  assert.deepEqual(objMatcher.filter, ['**/*.obj'])
})

test('every Windows packaging script verifies the packaged assets afterwards', () => {
  for (const script of ['package:win', 'package:win:review', 'package:win:dir']) {
    assert.match(
      packageJson.scripts[`post${script}`],
      /check-packaged-assets\.mjs/,
      `${script} must verify that dist/ survived packaging`
    )
  }
})

test('review Windows package is a distinct portable windowed executable', () => {
  assert.equal(reviewConfig.extraMetadata.defaultLaunchMode, 'windowed')
  assert.notEqual(reviewConfig.appId, packageJson.build.appId)
  assert.notEqual(reviewConfig.productName, packageJson.build.productName)
  assert.equal(reviewConfig.directories.output, 'build/review')
  assert.deepEqual(reviewConfig.win.target, [
    {
      target: 'portable',
      arch: ['x64']
    }
  ])
  assert.match(reviewConfig.portable.artifactName, /Review/)
  assert.equal(reviewConfig.portable.requestExecutionLevel, 'user')
  assert.match(
    packageJson.scripts['package:win:review'],
    /--win portable --x64/
  )
})

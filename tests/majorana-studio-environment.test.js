import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMajoranaStudioEnvironment,
  MAJORANA_STUDIO_ENVIRONMENT
} from '../src/js/modules/build-majorana-2/majorana-environment.js'

function createThreeStub() {
  class Color {
    constructor(value) {
      this.value = value
      this.intensity = 1
    }

    multiplyScalar(value) {
      this.intensity *= value
      return this
    }
  }

  class PlaneGeometry {
    constructor(width, height) {
      this.size = [width, height]
      this.disposed = false
    }

    dispose() {
      this.disposed = true
    }
  }

  class MeshBasicMaterial {
    constructor(options) {
      Object.assign(this, options)
      this.disposed = false
    }

    dispose() {
      this.disposed = true
    }
  }

  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry
      this.material = material
      this.position = {
        fromArray: value => {
          this.positionValue = [...value]
        }
      }
    }

    lookAt(...value) {
      this.lookAtValue = value
    }
  }

  class Scene {
    constructor() {
      this.children = []
      this.background = null
    }

    add(...children) {
      this.children.push(...children)
    }

    clear() {
      this.children.length = 0
    }
  }

  return {
    Color,
    DoubleSide: 'double-side',
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Scene
  }
}

test('Majorana studio environment is deterministic and contains no room geometry', () => {
  assert.ok(Object.isFrozen(MAJORANA_STUDIO_ENVIRONMENT))
  assert.deepEqual(
    MAJORANA_STUDIO_ENVIRONMENT.cards.map(card => card.name),
    [
      'broad right softbox',
      'upper-left cool fill',
      'right gold bounce',
      'lower-left gold bounce',
      'lower warm fill'
    ]
  )
})

test('Majorana studio cards are disposed after PMREM convolution', () => {
  const THREE = createThreeStub()
  const renderTarget = { texture: {} }
  let captured = null
  const pmremGenerator = {
    fromScene(scene, sigma, near, far) {
      captured = {
        cards: [...scene.children],
        scene,
        sigma,
        near,
        far
      }
      return renderTarget
    }
  }

  const result = createMajoranaStudioEnvironment(THREE, pmremGenerator)

  assert.equal(result, renderTarget)
  assert.equal(captured.sigma, MAJORANA_STUDIO_ENVIRONMENT.sigma)
  assert.equal(captured.near, MAJORANA_STUDIO_ENVIRONMENT.near)
  assert.equal(captured.far, MAJORANA_STUDIO_ENVIRONMENT.far)
  assert.equal(captured.scene.children.length, 0)
  assert.ok(captured.cards.every(card => card.geometry.disposed))
  assert.ok(captured.cards.every(card => card.material.disposed))
})

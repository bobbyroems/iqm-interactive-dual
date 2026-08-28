import { assetUrl } from '../../core/asset-url.js'

const BUOY_URL = 'assets/modules/differences/Buoy.glb'
const TARGET_HEIGHT = 1.36
const REQUIRED_PARTS = Object.freeze(['Qubit', 'Frame', 'Flagpole', 'Flag'])

export const BUOY_FLAG_HEIGHT_LIMITS = Object.freeze({ min: 0.72, max: 8.5 })
export const BUOY_SCREEN_EAST_YAW = -Math.PI / 2
export const BUOY_QUBIT_COLORS = Object.freeze({
  source: '#42b9f5',
  candidate: '#ee3b32',
  winner: '#39b874',
  menu: '#5547c9',
  cue: '#2ed7b8'
})

export const BUOY_WASHED_COLORS = Object.freeze({
  emissive: '#16364a',
  flag: '#91a9b8',
  frame: '#a7bac6',
  pole: '#738e9e',
  qubit: '#789dae'
})

export const BUOY_SOURCE_PRESET = Object.freeze({
  qubitColor: BUOY_QUBIT_COLORS.source,
  qubitEmissive: '#0879bd',
  frameColor: '#d6f1ff',
  poleColor: '#8cc9e8',
  flagColor: '#b9e7fb'
})

export const BUOY_IDENTITY_PRESETS = Object.freeze({
  candidate: Object.freeze({
    qubitColor: BUOY_QUBIT_COLORS.candidate,
    qubitEmissive: '#5c1512',
    frameColor: '#ffc0b7',
    poleColor: '#c45b51',
    flagColor: '#ed786b'
  }),
  winner: Object.freeze({
    qubitColor: BUOY_QUBIT_COLORS.winner,
    qubitEmissive: '#135c38',
    frameColor: '#c0ecd1',
    poleColor: '#238d6b',
    flagColor: '#168f58'
  }),
  menu: Object.freeze({
    qubitColor: BUOY_QUBIT_COLORS.menu,
    qubitEmissive: '#21185f',
    frameColor: '#e4e9ff',
    poleColor: '#707aa9',
    flagColor: '#897bef'
  })
})

const BUOY_CUE_PRESET = Object.freeze({
  qubitColor: BUOY_QUBIT_COLORS.cue,
  qubitEmissive: '#13b899',
  frameColor: '#8ce4d2',
  flagColor: '#5bd8c1'
})

const BUOY_MATERIAL_PRESETS = Object.freeze({
  default: Object.freeze({
    frameEnvMapIntensity: 1.45,
    frameMetalness: 0.28,
    frameRoughness: 0.26,
    quietEmissiveIntensity: 0.12
  }),
  menu: Object.freeze({
    frameEnvMapIntensity: 1.35,
    frameMetalness: 0.18,
    frameRoughness: 0.3,
    quietEmissiveIntensity: 0.26
  })
})

let buoyAssetsPromise = null

function findRequiredParts(root) {
  const parts = Object.fromEntries(REQUIRED_PARTS.map(name => [name, root.getObjectByName(name)]))
  const missing = REQUIRED_PARTS.filter(name => !parts[name]?.isMesh)
  if (missing.length) throw new Error(`Buoy GLB is missing: ${missing.join(', ')}`)
  return parts
}

export function calculateBuoyFlagTransform(multiplier, {
  baseFlagY,
  basePoleScaleY,
  poleHeight
}) {
  const requestedMultiplier = Number.isFinite(multiplier) ? multiplier : 1
  const safeMultiplier = Math.max(
    BUOY_FLAG_HEIGHT_LIMITS.min,
    Math.min(BUOY_FLAG_HEIGHT_LIMITS.max, requestedMultiplier)
  )
  return {
    flagY: baseFlagY + (poleHeight * basePoleScaleY * (safeMultiplier - 1)),
    poleScaleY: basePoleScaleY * safeMultiplier
  }
}

function boundsInParentSpace(THREE, part) {
  part.geometry.computeBoundingBox()
  part.updateMatrix()
  return part.geometry.boundingBox.clone().applyMatrix4(part.matrix)
}

/*
 * The two guide lines drawn on every qubit: a solid meridian running pole to pole and
 * a dashed equator around it, both white. They are drawn as thin tori
 * rather than lines because WebGL ignores line width, and at kiosk resolution a
 * one-pixel line disappears on the far buoys and aliases on the near ones.
 *
 * Geometry and materials are built once and shared by every buoy - the qubit is the
 * same mesh on all of them, so there is nothing per-buoy to vary.
 */
export const BUOY_QUBIT_LINE_COLOR = '#ffffff'
const QUBIT_LINE_DASHES = 30
let qubitLineAssets = null

function getQubitLineAssets(THREE, radius) {
  if (qubitLineAssets) return qubitLineAssets
  const lineMaterial = dashes => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(BUOY_QUBIT_LINE_COLOR) },
      uDashes: { value: dashes }
    },
    vertexShader: `
      varying vec2 vQubitLineUv;

      void main() {
        vQubitLineUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uDashes;
      varying vec2 vQubitLineUv;

      void main() {
        /* v says which ring this is - 0 the solid meridian, 1 the dashed equator -
           and u runs around the ring, so cutting u into bands makes the dashes. */
        if (vQubitLineUv.y > 0.5 && fract(vQubitLineUv.x * uDashes) > 0.55) discard;
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    toneMapped: false
  })
  /* Sat just off the surface so the sphere still hides the far half of each ring.
     A torus lies in its own XY plane, which is already the vertical circle; the
     equator is the same ring laid flat. */
  const meridian = new THREE.TorusGeometry(radius * 1.008, radius * 0.021, 6, 128)
  const equator = meridian.clone().rotateX(Math.PI / 2)
  qubitLineAssets = {
    /* Both rings in one geometry, so a buoy spends one draw call on its lines rather
       than two. v carries which ring a vertex belongs to; the shader dashes on it. */
    geometry: mergeQubitLineRings(THREE, meridian, equator),
    material: lineMaterial(QUBIT_LINE_DASHES)
  }
  meridian.dispose()
  equator.dispose()
  return qubitLineAssets
}

function mergeQubitLineRings(THREE, solidRing, dashedRing) {
  const merged = new THREE.BufferGeometry()
  const rings = [
    { geometry: solidRing, band: 0 },
    { geometry: dashedRing, band: 1 }
  ]
  const vertexCount = rings.reduce((total, r) => total + r.geometry.attributes.position.count, 0)
  const indexCount = rings.reduce((total, r) => total + r.geometry.index.count, 0)
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(indexCount)
  let vertexOffset = 0
  let indexOffset = 0
  for (const { geometry, band } of rings) {
    const source = geometry.attributes.position.array
    const sourceUv = geometry.attributes.uv.array
    const count = geometry.attributes.position.count
    positions.set(source, vertexOffset * 3)
    for (let index = 0; index < count; index += 1) {
      uvs[(vertexOffset + index) * 2] = sourceUv[index * 2]
      uvs[((vertexOffset + index) * 2) + 1] = band
    }
    const sourceIndex = geometry.index.array
    for (let index = 0; index < sourceIndex.length; index += 1) {
      indices[indexOffset + index] = sourceIndex[index] + vertexOffset
    }
    vertexOffset += count
    indexOffset += sourceIndex.length
  }
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  merged.computeBoundingSphere()
  return merged
}

/*
 * Each qubit wears its rings at its own angle, so a field of buoys shows the pair from
 * every side rather than reading as one shape stamped twenty-five times. Derived from
 * the buoy's index rather than from Math.random so a buoy keeps its angle across
 * rounds and restarts; the golden angle spreads the yaw evenly however many there are,
 * and the tilts stay small enough that the pair still reads as a meridian and an
 * equator rather than as two arbitrary hoops. Seed 0 keeps the authored upright pose,
 * which is what the selection-screen preview wants.
 */
const QUBIT_LINE_GOLDEN_ANGLE = 2.399963229728653
const QUBIT_LINE_MAX_TILT = 0.33

function orientQubitLines(lines, seed) {
  const index = Math.max(0, Math.floor(Number(seed) || 0))
  if (index === 0) return lines
  lines.rotation.set(
    ((((index * 7) % 13) / 12) - 0.5) * 2 * QUBIT_LINE_MAX_TILT,
    (index * QUBIT_LINE_GOLDEN_ANGLE) % (Math.PI * 2),
    ((((index * 5) % 11) / 10) - 0.5) * 2 * QUBIT_LINE_MAX_TILT
  )
  return lines
}

function createQubitAxisLines(THREE, qubit, seed) {
  qubit.geometry.computeBoundingSphere()
  const { geometry, material } = getQubitLineAssets(
    THREE,
    qubit.geometry.boundingSphere.radius
  )
  const lines = new THREE.Mesh(geometry, material)
  lines.name = 'QubitLines'
  orientQubitLines(lines, seed)
  qubit.add(lines)
  return lines
}

function createQubitCueGlow(THREE, qubit) {
  const layerSpecs = [
    { opacity: 0.32, scale: 1.08 },
    { opacity: 0.23, scale: 1.18 },
    { opacity: 0.15, scale: 1.32 },
    { opacity: 0.09, scale: 1.48 },
    { opacity: 0.05, scale: 1.65 },
    { opacity: 0.025, scale: 1.82 }
  ]
  const glowMaterials = []
  const [innerLayer, ...outerLayers] = layerSpecs

  function createGlowMaterial(layerOpacity) {
    return new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.BackSide,
      toneMapped: false,
      transparent: true,
      uniforms: {
        uColor: { value: new THREE.Color('#8fffe9') },
        uCue: { value: 0 },
        uLayerOpacity: { value: layerOpacity },
        uMotion: { value: 1 },
        uTime: { value: 0 }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDirection;

        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uCue;
        uniform float uLayerOpacity;
        uniform float uMotion;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewDirection;

        void main() {
          vec3 normal = normalize(vNormal);
          float facing = abs(dot(normal, normalize(vViewDirection)));
          float rim = pow(1.0 - clamp(facing, 0.0, 1.0), 1.35);
          float feather = smoothstep(0.0, 0.22, facing);
          float motionTime = uTime * uMotion;
          float pulse = 0.93 + (0.07 * sin(motionTime * 1.7));
          float vapour = 0.84 + (0.16 * sin(
            (normal.x * 8.0) + (normal.y * 11.0) + (motionTime * 0.52)
          ));
          float alpha = uCue * uLayerOpacity * rim * feather * pulse * vapour;
          gl_FragColor = vec4(uColor, alpha);
        }
      `
    })
  }

  const material = createGlowMaterial(innerLayer.opacity)
  glowMaterials.push(material)
  const glow = new THREE.Mesh(qubit.geometry, material)
  glow.name = 'QubitGlow'
  glow.position.copy(qubit.position)
  glow.quaternion.copy(qubit.quaternion)
  glow.scale.copy(qubit.scale).multiplyScalar(innerLayer.scale)
  glow.renderOrder = Math.max(5, qubit.renderOrder + 1)
  outerLayers.forEach(({ opacity, scale }, index) => {
    const layerMaterial = createGlowMaterial(opacity)
    const layer = new THREE.Mesh(qubit.geometry, layerMaterial)
    layer.name = `QubitGlowLayer-${index + 2}`
    layer.scale.setScalar(scale / innerLayer.scale)
    layer.renderOrder = glow.renderOrder + index + 1
    glowMaterials.push(layerMaterial)
    glow.add(layer)
  })
  glow.userData.materials = glowMaterials
  glow.visible = false
  qubit.parent.add(glow)
  return glow
}

export function calculateBuoyFlagAttachmentOffset({ THREE, qubit, flagpole }) {
  if (!qubit?.isMesh || !flagpole?.isMesh || qubit.parent !== flagpole.parent) return 0
  const qubitBounds = boundsInParentSpace(THREE, qubit)
  const poleBounds = boundsInParentSpace(THREE, flagpole)
  return qubitBounds.max.y - poleBounds.min.y
}

export function calculateBuoyQubitMetrics({ THREE, qubit }) {
  if (!qubit?.isMesh) return Object.freeze({ centerY: 0, radius: 0 })
  const bounds = boundsInParentSpace(THREE, qubit)
  const size = bounds.getSize(new THREE.Vector3())
  return Object.freeze({
    centerY: (bounds.min.y + bounds.max.y) * 0.5,
    radius: size.y * 0.5
  })
}

export function loadBuoyAssets() {
  buoyAssetsPromise ??= (async () => {
    const [THREE, { GLTFLoader }] = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js')
    ])
    const gltf = await new GLTFLoader().loadAsync(assetUrl(BUOY_URL))
    const template = gltf.scene
    findRequiredParts(template)

    const bounds = new THREE.Box3().setFromObject(template)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = TARGET_HEIGHT / Math.max(0.0001, size.y)
    template.scale.setScalar(scale)
    template.position.set(-center.x * scale, 0, -center.z * scale)
    template.updateMatrixWorld(true)

    return Object.freeze({ template })
  })().catch(error => {
    buoyAssetsPromise = null
    throw error
  })
  return buoyAssetsPromise
}

export function cloneBuoy({
  THREE,
  template,
  identity: requestedIdentity,
  /* Which buoy this is, so its rings can face a different way from its neighbours.
     Stable across rounds; 0 leaves them upright. */
  qubitLineSeed = 0
}) {
  const root = template.clone(true)
  const materials = new Set()
  const identity = BUOY_IDENTITY_PRESETS[requestedIdentity]
    ? requestedIdentity
    : 'candidate'
  const identityPreset = BUOY_IDENTITY_PRESETS[identity]
  const initialPreset = identity === 'menu' ? identityPreset : BUOY_SOURCE_PRESET
  const materialPreset = identity === 'menu'
    ? BUOY_MATERIAL_PRESETS.menu
    : BUOY_MATERIAL_PRESETS.default

  root.traverse(object => {
    if (!object.isMesh) return
    if (object.name === 'Qubit') {
      object.material = new THREE.MeshPhysicalMaterial({
        clearcoat: 0.78,
        clearcoatRoughness: 0.18,
        color: initialPreset.qubitColor,
        emissive: initialPreset.qubitEmissive,
        emissiveIntensity: materialPreset.quietEmissiveIntensity,
        envMapIntensity: identity === 'menu' ? 1.5 : 1,
        metalness: 0.03,
        roughness: 0.24
      })
    } else {
      object.material = object.material.clone()
      if (object.name === 'Frame') {
        object.material.color.set(initialPreset.frameColor)
        object.material.metalness = materialPreset.frameMetalness
        object.material.roughness = materialPreset.frameRoughness
        object.material.envMapIntensity = materialPreset.frameEnvMapIntensity
      } else if (object.name === 'Flagpole') {
        object.material.color.set(initialPreset.poleColor)
        object.material.metalness = 0.3
        object.material.roughness = 0.3
      } else if (object.name === 'Flag') {
        object.material.color.set(initialPreset.flagColor)
        object.material.forceSinglePass = true
        object.material.roughness = 0.34
        object.material.side = THREE.DoubleSide
      }
      object.material.needsUpdate = true
    }
    materials.add(object.material)
  })

  const parts = findRequiredParts(root)
  parts.QubitLines = createQubitAxisLines(THREE, parts.Qubit, qubitLineSeed)
  parts.QubitGlow = createQubitCueGlow(THREE, parts.Qubit)
  parts.QubitGlow.userData.materials.forEach(material => materials.add(material))
  parts.Flagpole.geometry.computeBoundingBox()
  const poleHeight = parts.Flagpole.geometry.boundingBox.getSize(new THREE.Vector3()).y
  const basePoleScaleY = parts.Flagpole.scale.y
  const basePoleY = parts.Flagpole.position.y
  const baseFlagY = parts.Flag.position.y
  const baseFlagScale = parts.Flag.scale.clone()
  const baseFlagQuaternion = parts.Flag.quaternion.clone()
  const flagAttachmentOffset = calculateBuoyFlagAttachmentOffset({
    THREE,
    qubit: parts.Qubit,
    flagpole: parts.Flagpole
  })
  const qubitMetrics = calculateBuoyQubitMetrics({ THREE, qubit: parts.Qubit })
  const flagYawQuaternion = new THREE.Quaternion()
  const flagYawAxis = new THREE.Vector3(0, 1, 0)
  /* Every field buoy starts from the same blue possibility. Callers can reveal its
     identity progressively, allowing the winning green to accumulate step by step. */
  const outcomeStartPreset = initialPreset
  const outcomeEndPreset = identityPreset
  const outcomeStartColors = {
    qubit: new THREE.Color(outcomeStartPreset.qubitColor),
    emissive: new THREE.Color(outcomeStartPreset.qubitEmissive),
    frame: new THREE.Color(outcomeStartPreset.frameColor),
    pole: new THREE.Color(outcomeStartPreset.poleColor),
    flag: new THREE.Color(outcomeStartPreset.flagColor)
  }
  const outcomeEndColors = {
    qubit: new THREE.Color(outcomeEndPreset.qubitColor),
    emissive: new THREE.Color(outcomeEndPreset.qubitEmissive),
    frame: new THREE.Color(outcomeEndPreset.frameColor),
    pole: new THREE.Color(outcomeEndPreset.poleColor),
    flag: new THREE.Color(outcomeEndPreset.flagColor)
  }
  const outcomeColors = {
    qubit: outcomeEndColors.qubit.clone(),
    emissive: outcomeEndColors.emissive.clone(),
    frame: outcomeEndColors.frame.clone(),
    pole: outcomeEndColors.pole.clone(),
    flag: outcomeEndColors.flag.clone()
  }
  const scratchColors = {
    qubit: new THREE.Color(),
    emissive: new THREE.Color(),
    frame: new THREE.Color(),
    pole: new THREE.Color(),
    flag: new THREE.Color()
  }
  const cueColors = {
    qubit: new THREE.Color(BUOY_CUE_PRESET.qubitColor),
    emissive: new THREE.Color(BUOY_CUE_PRESET.qubitEmissive),
    frame: new THREE.Color(BUOY_CUE_PRESET.frameColor),
    flag: new THREE.Color(BUOY_CUE_PRESET.flagColor)
  }
  const washedColors = {
    qubit: new THREE.Color(BUOY_WASHED_COLORS.qubit),
    emissive: new THREE.Color(BUOY_WASHED_COLORS.emissive),
    frame: new THREE.Color(BUOY_WASHED_COLORS.frame),
    pole: new THREE.Color(BUOY_WASHED_COLORS.pole),
    flag: new THREE.Color(BUOY_WASHED_COLORS.flag)
  }
  let cueAmount = 0
  let flagBaseOffset = 0
  let flagHeight = 1
  let flagScale = 1
  let colorStrength = 1
  let outcomeAmount = 0

  function applyFlagTransform() {
    const transform = calculateBuoyFlagTransform(flagHeight, {
      baseFlagY,
      basePoleScaleY,
      poleHeight
    })
    parts.Flagpole.position.y = basePoleY + flagBaseOffset
    parts.Flagpole.scale.y = transform.poleScaleY
    parts.Flag.position.y = transform.flagY + flagBaseOffset
    parts.Flag.scale.copy(baseFlagScale).multiplyScalar(flagScale)
  }

  function applyAppearance() {
    outcomeColors.qubit.copy(outcomeStartColors.qubit).lerp(
      outcomeEndColors.qubit,
      outcomeAmount
    )
    outcomeColors.emissive.copy(outcomeStartColors.emissive).lerp(
      outcomeEndColors.emissive,
      outcomeAmount
    )
    outcomeColors.frame.copy(outcomeStartColors.frame).lerp(
      outcomeEndColors.frame,
      outcomeAmount
    )
    outcomeColors.pole.copy(outcomeStartColors.pole).lerp(
      outcomeEndColors.pole,
      outcomeAmount
    )
    outcomeColors.flag.copy(outcomeStartColors.flag).lerp(
      outcomeEndColors.flag,
      outcomeAmount
    )

    const washAmount = 1 - colorStrength
    scratchColors.qubit.copy(outcomeColors.qubit).lerp(washedColors.qubit, washAmount)
    scratchColors.emissive.copy(outcomeColors.emissive).lerp(
      washedColors.emissive,
      washAmount
    )
    scratchColors.frame.copy(outcomeColors.frame).lerp(washedColors.frame, washAmount)
    scratchColors.pole.copy(outcomeColors.pole).lerp(washedColors.pole, washAmount)
    scratchColors.flag.copy(outcomeColors.flag).lerp(washedColors.flag, washAmount)
    scratchColors.qubit.lerp(cueColors.qubit, cueAmount)
    scratchColors.emissive.lerp(cueColors.emissive, cueAmount)
    scratchColors.frame.lerp(cueColors.frame, cueAmount * 0.72)
    scratchColors.flag.lerp(cueColors.flag, cueAmount * 0.5)

    parts.Qubit.material.color.copy(scratchColors.qubit)
    parts.Qubit.material.emissive.copy(scratchColors.emissive)
    parts.Qubit.material.emissiveIntensity = materialPreset.quietEmissiveIntensity +
      (cueAmount * (1.15 - materialPreset.quietEmissiveIntensity))
    parts.Frame.material.color.copy(scratchColors.frame)
    parts.Flagpole.material.color.copy(scratchColors.pole)
    parts.Flag.material.color.copy(scratchColors.flag)
  }

  function setCue(amount, {
    animate = true,
    glowAmount = amount,
    time = 0
  } = {}) {
    const requestedAmount = Number.isFinite(amount) ? amount : 0
    cueAmount = Math.max(0, Math.min(1, requestedAmount))
    const requestedGlowAmount = Number.isFinite(glowAmount) ? glowAmount : cueAmount
    const safeGlowAmount = Math.max(0, Math.min(1, requestedGlowAmount))
    for (const material of parts.QubitGlow.userData.materials) {
      material.uniforms.uCue.value = safeGlowAmount
      material.uniforms.uMotion.value = animate ? 1 : 0
      material.uniforms.uTime.value = Number.isFinite(time) ? time : 0
    }
    parts.QubitGlow.visible = safeGlowAmount > 0.001
    applyAppearance()
  }

  return {
    identity,
    qubitMetrics,
    root,
    parts,
    setFlagHeight(multiplier) {
      flagHeight = Number.isFinite(multiplier) ? multiplier : 1
      applyFlagTransform()
    },
    setFlagAttachment(amount) {
      const requestedAmount = Number.isFinite(amount) ? amount : 0
      flagBaseOffset = flagAttachmentOffset * Math.max(0, Math.min(1, requestedAmount))
      applyFlagTransform()
    },
    setFlagScale(multiplier) {
      flagScale = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1
      applyFlagTransform()
    },
    setFlagYaw(yaw) {
      const safeYaw = Number.isFinite(yaw) ? yaw : 0
      flagYawQuaternion.setFromAxisAngle(flagYawAxis, safeYaw)
      parts.Flag.quaternion.copy(baseFlagQuaternion).premultiply(flagYawQuaternion)
    },
    setCue,
    setColorStrength(amount) {
      const requestedAmount = Number.isFinite(amount) ? amount : 0
      colorStrength = Math.max(0, Math.min(1, requestedAmount))
      applyAppearance()
    },
    setOutcome(amount) {
      const requestedAmount = Number.isFinite(amount) ? amount : 0
      outcomeAmount = Math.max(0, Math.min(1, requestedAmount))
      applyAppearance()
    },
    dispose() {
      materials.forEach(material => material.dispose())
    }
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  advanceThermalTime,
  composeParticlePosition,
  THERMAL_MOTION_PROFILE
} from '../src/js/modules/protecting-information/protecting-information-physics.js'
import {
  getProtectionEffectDrives,
  PROTECTION_PARAMETERS
} from '../src/js/modules/protecting-information/protecting-information-state.js'

test('temperature cooling reaches full strength at the target arc', () => {
  const targetStart = PROTECTION_PARAMETERS.temperature.targetArc.startDeg / 360

  assert.equal(getProtectionEffectDrives({ temperature: 0 }).temperature, 0)
  assert.equal(getProtectionEffectDrives({ temperature: targetStart }).temperature, 1)
})

test('untuned particles advance much faster than cooled particles', () => {
  const delta = 0.5
  const agitatedAdvance = advanceThermalTime(0, delta, 0)
  const settledAdvance = advanceThermalTime(0, delta, 1)

  assert.equal(agitatedAdvance, delta * THERMAL_MOTION_PROFILE.agitatedSpeed)
  assert.ok(Math.abs(
    settledAdvance - (delta * THERMAL_MOTION_PROFILE.settledSpeed)
  ) < 1e-12)
  assert.ok(agitatedAdvance > settledAdvance * 3)
})

test('cooled particles retain only a tiny continuous residual drift', () => {
  const baseY = -0.135
  const data = {
    basePosition: new Float32Array([0, baseY, 0]),
    thermal: new Float32Array([0, 1, 0.5, 0.4]),
    voltageDisplacement: new Float32Array(3),
    magneticDisplacement: new Float32Array(3),
    role: new Float32Array([0])
  }
  const motionDistance = position => Math.hypot(
    position.x,
    position.y - baseY,
    position.z
  )
  const agitated = composeParticlePosition(data, 0, {
    thermalTime: 0.4,
    temperatureDrive: 0
  })
  const settled = composeParticlePosition(data, 0, {
    thermalTime: 0.4,
    temperatureDrive: 1
  })

  assert.ok(motionDistance(agitated) > 0.1)
  assert.ok(Math.abs(
    (motionDistance(settled) / motionDistance(agitated)) -
      THERMAL_MOTION_PROFILE.settledAmplitude
  ) < 1e-6)
})

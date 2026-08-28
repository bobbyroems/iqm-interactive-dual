const TARGET_FEATHER_DEGREES = 16
const TEMPERATURE_BACKGROUND_BASELINE = 0.38

function parameter({
  id,
  label,
  shortLabel = label,
  title,
  description,
  prompt,
  startDeg,
  endDeg
}) {
  return Object.freeze({
    id,
    label,
    shortLabel,
    title,
    description,
    prompt,
    targetArc: Object.freeze({
      startDeg,
      endDeg,
      featherDeg: TARGET_FEATHER_DEGREES
    }),
    initialTurn: 0
  })
}

export const PROTECTION_PARAMETERS = Object.freeze({
  temperature: parameter({
    id: 'temperature',
    label: 'Temperature',
    title: 'Freezing temperature',
    description: 'Extreme cold calms thermal noise, slowing chaotic electrons down to a near standstill.',
    prompt: 'Turn dial to chill the device',
    startDeg: 95,
    endDeg: 149
  }),
  voltage: parameter({
    id: 'voltage',
    label: 'Voltage',
    title: 'Tuning voltage',
    description: 'Electric gates push excess electrons away from the center, clearing space along the wire.',
    prompt: 'Turn dial to guide electrons into place',
    startDeg: 175,
    endDeg: 244
  }),
  magnetic: parameter({
    id: 'magnetic',
    label: 'Magnetic Field',
    shortLabel: 'Magnetic\nField',
    title: 'Magnetic field',
    description: 'A precise magnetic field locks the remaining electrons into synchronized Cooper pairs.',
    prompt: 'Turn dial to pair the electrons',
    startDeg: 147,
    endDeg: 216
  })
})

export const PROTECTION_PARAMETER_IDS = Object.freeze(Object.keys(PROTECTION_PARAMETERS))

export const PROTECTION_INTRO_COPY = Object.freeze({
  title: 'Protecting quantum information',
  description: 'To keep qubits stable, this device uses three precise controls to tame chaotic particles.',
  prompt: 'Turn the dials into their green zones to activate the device'
})

export const PROTECTION_SUCCESS_COPY = Object.freeze({
  title: 'Topoconductor activated!',
  description: 'With all three conditions aligned, the device enters a topological phase, shielding quantum information from errors.',
  prompt: ''
})

export function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

export function normalizeDegrees(value) {
  const degrees = Number(value) || 0
  return ((degrees % 360) + 360) % 360
}

function circularDegreeDistance(first, second) {
  const directDistance = Math.abs(normalizeDegrees(first) - normalizeDegrees(second))
  return Math.min(directDistance, 360 - directDistance)
}

function angleIsInsideArc(angle, { startDeg, endDeg }) {
  const normalizedAngle = normalizeDegrees(angle)
  const normalizedStart = normalizeDegrees(startDeg)
  const normalizedEnd = normalizeDegrees(endDeg)
  if (normalizedStart <= normalizedEnd) {
    return normalizedAngle >= normalizedStart && normalizedAngle <= normalizedEnd
  }
  return normalizedAngle >= normalizedStart || normalizedAngle <= normalizedEnd
}

function smoothstep01(value) {
  const normalizedValue = clampUnit(value)
  return normalizedValue * normalizedValue * (3 - (2 * normalizedValue))
}

export function getProtectionParameterQuality(parameterId, value) {
  const parameterConfig = PROTECTION_PARAMETERS[parameterId]
  if (!parameterConfig) return 0

  const angle = clampUnit(value) * 360
  const { targetArc } = parameterConfig
  if (angleIsInsideArc(angle, targetArc)) return 1

  const distanceFromArc = Math.min(
    circularDegreeDistance(angle, targetArc.startDeg),
    circularDegreeDistance(angle, targetArc.endDeg)
  )
  if (distanceFromArc >= targetArc.featherDeg) return 0
  return smoothstep01(1 - (distanceFromArc / targetArc.featherDeg))
}

export function isProtectionParameterTuned(parameterId, value) {
  return getProtectionParameterQuality(parameterId, value) === 1
}

export function getProtectionParameterStatus(parameterId, value) {
  const parameterConfig = PROTECTION_PARAMETERS[parameterId]
  if (!parameterConfig) return 'outside'
  if (isProtectionParameterTuned(parameterId, value)) return 'tuned'
  const angle = clampUnit(value) * 360
  return angle < parameterConfig.targetArc.startDeg ? 'below' : 'above'
}

function targetCenterTurn(parameterId) {
  const { startDeg, endDeg } = PROTECTION_PARAMETERS[parameterId].targetArc
  return ((startDeg + endDeg) / 2) / 360
}

function targetStartTurn(parameterId) {
  return PROTECTION_PARAMETERS[parameterId].targetArc.startDeg / 360
}

export function getProtectionEffectDrives(stateOrValues = {}) {
  const values = stateOrValues?.values || stateOrValues
  const temperature = clampUnit(values.temperature)
  const voltage = clampUnit(values.voltage)
  const magnetic = clampUnit(values.magnetic)
  const temperatureTargetStart = targetStartTurn('temperature')
  const voltageTargetCenter = targetCenterTurn('voltage')
  const magneticTargetCenter = targetCenterTurn('magnetic')
  const voltageTargetStart = targetStartTurn('voltage')
  const magneticTargetStart = targetStartTurn('magnetic')

  return {
    // The temperature dial represents cooling power. Reach the calm particle
    // state as the knob enters its target instead of requiring a full turn.
    temperature: smoothstep01(temperature / temperatureTargetStart),
    voltage: smoothstep01(voltage / voltageTargetStart),
    voltageVisual: Math.pow(voltage / voltageTargetCenter, 1.4),
    magnetic: smoothstep01(magnetic / magneticTargetStart),
    magneticVisual: Math.pow(magnetic / magneticTargetCenter, 1.5)
  }
}

export function getProtectionBackgroundDrives(stateOrValues = {}) {
  const values = stateOrValues?.values || stateOrValues
  const temperature = clampUnit(values.temperature)
  const temperatureReferenceTurn = targetCenterTurn('temperature')
  const temperatureGain = TEMPERATURE_BACKGROUND_BASELINE + (
    (1 - TEMPERATURE_BACKGROUND_BASELINE) * (temperature / temperatureReferenceTurn)
  )

  // The initial blue wash keeps the white copy legible. At the centre of
  // Temperature's green arc the stack still recreates the original treatment,
  // then keeps intensifying above the target rather than flattening.
  return {
    temperatureGain,
    temperatureBaseTopAlpha: clampUnit(0.8 * temperatureGain),
    temperatureBaseMidAlpha: clampUnit(0.24 * temperatureGain),
    temperatureCoolingTopAlpha: clampUnit(0.1296 * temperatureGain),
    temperatureCoolingMidAlpha: clampUnit(0.054 * temperatureGain)
  }
}

export function createProtectingInformationState() {
  return {
    focusedParameter: 'temperature',
    values: Object.fromEntries(
      PROTECTION_PARAMETER_IDS.map(parameterId => [
        parameterId,
        PROTECTION_PARAMETERS[parameterId].initialTurn
      ])
    ),
    completed: false,
    hasEverCompleted: false,
    hasInteracted: false
  }
}

export function getProtectionQualities(state) {
  const qualities = Object.fromEntries(
    PROTECTION_PARAMETER_IDS.map(parameterId => [
      parameterId,
      getProtectionParameterQuality(parameterId, state?.values?.[parameterId])
    ])
  )
  return {
    ...qualities,
    complete: PROTECTION_PARAMETER_IDS.every(parameterId => qualities[parameterId] === 1)
  }
}

export function getProtectionProgress(state) {
  const qualities = getProtectionQualities(state)
  const tuned = Object.fromEntries(
    PROTECTION_PARAMETER_IDS.map(parameterId => [parameterId, qualities[parameterId] === 1])
  )
  const tunedCount = Object.values(tuned).filter(Boolean).length
  return {
    tuned,
    tunedCount,
    complete: qualities.complete,
    qualities
  }
}

export function updateProtectionParameter(state, parameterId, value) {
  if (!PROTECTION_PARAMETERS[parameterId]) return state
  const nextState = {
    ...state,
    focusedParameter: parameterId,
    values: {
      ...state.values,
      [parameterId]: clampUnit(value)
    },
    hasInteracted: true
  }
  const complete = getProtectionQualities(nextState).complete
  nextState.completed = complete
  nextState.hasEverCompleted = Boolean(state.hasEverCompleted || complete)
  return nextState
}

export function focusProtectionParameter(state, parameterId) {
  if (!PROTECTION_PARAMETERS[parameterId] || state.focusedParameter === parameterId) return state
  return {
    ...state,
    focusedParameter: parameterId
  }
}

export function getProtectionContent(state) {
  if (getProtectionQualities(state).complete) return PROTECTION_SUCCESS_COPY
  if (!state?.hasInteracted) return PROTECTION_INTRO_COPY
  const parameterConfig = PROTECTION_PARAMETERS[state.focusedParameter] || PROTECTION_PARAMETERS.temperature
  return {
    title: parameterConfig.title,
    description: parameterConfig.description,
    prompt: parameterConfig.prompt
  }
}

export function valueFromDialPoint(point, bounds) {
  if (!point || !bounds || bounds.width <= 0 || bounds.height <= 0) return 0
  const centerX = bounds.left + (bounds.width / 2)
  const centerY = bounds.top + (bounds.height / 2)
  const clockwiseDegreesFromTwelve = Math.atan2(
    point.x - centerX,
    centerY - point.y
  ) * 180 / Math.PI
  return normalizeDegrees(clockwiseDegreesFromTwelve) / 360
}

export function dialAngleFromValue(value) {
  return clampUnit(value) * 360
}

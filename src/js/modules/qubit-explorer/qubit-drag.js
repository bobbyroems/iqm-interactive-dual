const ASSEMBLY_DISTANCE_SCALE = 4

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function assemblyProgressFromPoint(origin, target, point) {
  const travelX = Number(target?.x) - Number(origin?.x)
  const travelY = Number(target?.y) - Number(origin?.y)
  const travelZ = Number(target?.z) - Number(origin?.z)
  const pointX = Number(point?.x) - Number(origin?.x)
  const pointY = Number(point?.y) - Number(origin?.y)
  const pointZ = Number(point?.z) - Number(origin?.z)
  const travelLengthSquared =
    (travelX * travelX) + (travelY * travelY) + (travelZ * travelZ)

  if (
    !Number.isFinite(travelLengthSquared) ||
    travelLengthSquared <= 0 ||
    ![pointX, pointY, pointZ].every(Number.isFinite)
  ) return 0

  const projected =
    ((pointX * travelX) + (pointY * travelY) + (pointZ * travelZ)) /
    travelLengthSquared
  return clamp(projected, 0, 1)
}

export function assemblyDistanceFromProgress(progress) {
  const numericProgress = Number(progress)
  if (!Number.isFinite(numericProgress)) return ASSEMBLY_DISTANCE_SCALE
  return (1 - clamp(numericProgress, 0, 1)) * ASSEMBLY_DISTANCE_SCALE
}

/*
 * How far along the join the layers stop tracking the pointer one-for-one and
 * start being drawn the rest of the way themselves.
 */
export const ASSEMBLY_SNAP_PROGRESS = 0.55

/**
 * Magnetism for the last stretch of the assembly. Below the snap point the drag
 * is literal; above it the pair closes faster than the finger moves, easing out
 * so the pull strengthens the nearer they get. That acceleration is what reads
 * as a snap rather than as the layers simply arriving.
 */
export function applyAssemblySnap(progress, snapStart = ASSEMBLY_SNAP_PROGRESS) {
  const numericProgress = Number(progress)
  if (!Number.isFinite(numericProgress)) return 0
  const clamped = clamp(numericProgress, 0, 1)
  const start = clamp(Number(snapStart), 0, 0.999)
  if (clamped <= start) return clamped

  const localProgress = (clamped - start) / (1 - start)
  const pulled = 1 - ((1 - localProgress) ** 2)
  return start + ((1 - start) * pulled)
}

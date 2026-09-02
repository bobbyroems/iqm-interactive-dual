/*
 * Current Design V3 separates the five wave sources from the field of possible
 * outcomes. Five of these twenty-five rigs are interactive; the other twenty are
 * deliberately passive, so they can visualise cancellation without inventing waves.
 */

const NORMALIZED_ROWS = Object.freeze([
  Object.freeze({ z: -0.82, xs: Object.freeze([-0.82, -0.4, 0, 0.42, 0.83]) }),
  Object.freeze({ z: -0.55, xs: Object.freeze([-0.96, -0.63, -0.29, 0.28, 0.62, 0.95]) }),
  Object.freeze({ z: -0.23, xs: Object.freeze([-0.82, -0.48, 0, 0.43, 0.83]) }),
  Object.freeze({ z: 0.16, xs: Object.freeze([-0.94, -0.53, -0.12, 0.48, 0.91]) }),
  Object.freeze({ z: 0.54, xs: Object.freeze([-0.65, 0.08, 0.68]) }),
  Object.freeze({ z: 0.92, xs: Object.freeze([0.02]) })
])

const WORLD_SCALE = Object.freeze({ x: 5.2, z: 9 })

/*
 * Every row is wide enough to reach the camera's left and right edges at its own
 * depth: the frustum keeps opening as the field recedes, so rows that stopped at
 * the authored width left two empty wedges of water flanking the outcome field.
 * Column spacing stays proportional to camera distance (~2.8 m at z -11.2, the
 * authored cadence), which keeps the on-screen gaps even from the near flanks to
 * the horizon. The two nearest rows only carry flank columns — the middle of that
 * band belongs to the interaction field.
 */
const BACKGROUND_ROWS = Object.freeze([
  Object.freeze({ z: -6.6, xs: Object.freeze([-6.9, 6.9]) }),
  Object.freeze({ z: -9, xs: Object.freeze([-8.9, -6.4, 6.4, 8.9]) }),
  Object.freeze({ z: -11.2, xs: Object.freeze([-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4]) }),
  Object.freeze({ z: -15.8, xs: Object.freeze([-8.4, -5, -1.7, 1.7, 5, 8.4]) }),
  Object.freeze({ z: -22.5, xs: Object.freeze([-12, -8, -4, 0, 4, 8, 12]) }),
  Object.freeze({ z: -32.5, xs: Object.freeze([-14.4, -9.6, -4.8, 4.8, 9.6, 14.4]) })
])

function stableHeading(index) {
  return (((index * 37) % 17) - 8) * 0.012
}

export const INTERFERENCE_CANDIDATE_LAYOUT = Object.freeze(
  NORMALIZED_ROWS.flatMap((row, rowIndex) => {
    const rowOffset = NORMALIZED_ROWS
      .slice(0, rowIndex)
      .reduce((total, item) => total + item.xs.length, 0)
    return row.xs.map((x, columnIndex) => {
      const index = rowOffset + columnIndex
      return Object.freeze({
        id: `candidate-${String(index + 1).padStart(2, '0')}`,
        x: x * WORLD_SCALE.x,
        z: row.z * WORLD_SCALE.z,
        heading: stableHeading(index)
      })
    })
  })
)

/* The outcome lattice continues past the authored interaction field. Row and buoy
   spacing both open toward the horizon so the reveal stays patterned without turning
   the distance into a dense wall. */
export const INTERFERENCE_BACKGROUND_BUOY_LAYOUT = Object.freeze(
  BACKGROUND_ROWS.flatMap((row, rowIndex) => row.xs.map((x, columnIndex) => {
    const index = BACKGROUND_ROWS
      .slice(0, rowIndex)
      .reduce((total, item) => total + item.xs.length, 0) + columnIndex
    return Object.freeze({
      id: `background-${String(index + 1).padStart(2, '0')}`,
      x,
      z: row.z,
      heading: stableHeading(INTERFERENCE_CANDIDATE_LAYOUT.length + index)
    })
  }))
)

/* Central answer first, then the four guided sources used by the V3 storyboard. */
/* The four secondary positions retain the V3 left/right/foreground/far rhythm while
   giving their 1.68 m harmonics a strong cancellation margin everywhere except the
   central solution. */
export const INTERFERENCE_SOURCE_CANDIDATE_INDICES = Object.freeze([13, 12, 19, 22, 6])

export const INTERFERENCE_SOURCE_LAYOUT = Object.freeze(
  INTERFERENCE_SOURCE_CANDIDATE_INDICES.map((candidateIndex, sourceIndex) => {
    const candidate = INTERFERENCE_CANDIDATE_LAYOUT[candidateIndex]
    return Object.freeze({
      ...candidate,
      id: sourceIndex === 0 ? 'central' : `source-${sourceIndex + 1}`,
      candidateIndex,
      sourceIndex
    })
  })
)

export const INTERFERENCE_WINNER_CANDIDATE_INDEX = INTERFERENCE_SOURCE_CANDIDATE_INDICES[0]

export function sourceIndexForCandidate(candidateIndex) {
  const sourceIndex = INTERFERENCE_SOURCE_CANDIDATE_INDICES.indexOf(candidateIndex)
  return sourceIndex >= 0 ? sourceIndex : null
}

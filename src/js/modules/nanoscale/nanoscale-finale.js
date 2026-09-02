import { NANOSCALE_FINALE_LAYOUT, NANOSCALE_STAGE } from './nanoscale-layout.js'

const FINALE_START = 5
const IMPACT_STOP = 6
const SCALE_STOP = 7

const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

function revealAtViewportEntry(sectionOffset, elementTop, trackY) {
  const currentTop = sectionOffset + elementTop + trackY
  const travel = Math.max(1, NANOSCALE_STAGE.height - elementTop)
  return clamp01((NANOSCALE_STAGE.height - currentTop) / travel)
}

function sectionSample(section, trackY) {
  const heading = revealAtViewportEntry(section.offsetY, section.headingTop, trackY)
  const paragraphReveals = section.paragraphTops.map(top => (
    revealAtViewportEntry(section.offsetY, top, trackY)
  ))
  const paragraphs = paragraphReveals.map((reveal, index) => {
    const nextReveal = paragraphReveals[index + 1] ?? 0
    return reveal * (1 - (0.3 * nextReveal))
  })
  return { heading, paragraphs }
}

/**
 * Pure scroll-linked state for the two authored finale frames. The same progress
 * always produces the same output, regardless of travel direction or release history.
 */
export function sampleNanoscaleFinale(timelineProgress) {
  const progress = Math.min(SCALE_STOP, Math.max(FINALE_START,
    Number.isFinite(timelineProgress) ? timelineProgress : FINALE_START))
  const entryProgress = clamp01(progress - FINALE_START)
  const scrollProgress = clamp01(progress - IMPACT_STOP)
  const trackY = ((1 - entryProgress) * NANOSCALE_STAGE.height) -
    (scrollProgress * NANOSCALE_STAGE.height)
  const [impactLayout, scaleLayout] = NANOSCALE_FINALE_LAYOUT.sections
  const impactBase = sectionSample(impactLayout, trackY)
  const scaleBase = sectionSample(scaleLayout, trackY)
  const impactGroupTop = impactLayout.copy.y + trackY
  const impactExit = progress <= IMPACT_STOP
    ? 1
    : clamp01(impactGroupTop / NANOSCALE_FINALE_LAYOUT.exitFadeDistance)
  const impact = Object.freeze({
    heading: clamp01(impactBase.heading * impactExit),
    paragraphs: Object.freeze(impactBase.paragraphs.map(value => clamp01(value * impactExit))),
    prompt: clamp01(revealAtViewportEntry(impactLayout.offsetY, impactLayout.prompt.y, trackY) * impactExit),
    group: impactExit
  })
  const scale = Object.freeze({
    heading: clamp01(scaleBase.heading),
    paragraphs: Object.freeze(scaleBase.paragraphs.map(clamp01)),
    figure: clamp01(revealAtViewportEntry(scaleLayout.offsetY, scaleLayout.field.y, trackY))
  })
  const impactWeight = impact.heading + impact.paragraphs.reduce((sum, value) => sum + value, 0)
  const scaleWeight = scale.heading + scale.paragraphs.reduce((sum, value) => sum + value, 0)

  return Object.freeze({
    progress,
    entryProgress,
    scrollProgress,
    trackY,
    /* The impact wash is viewport-fixed. It fades in for 5→6 and out for 6→7,
       avoiding a moving gradient edge at the boundary between authored frames. */
    atmosphereOpacity: clamp01(entryProgress * (1 - scrollProgress)),
    impact,
    scale,
    dominantSection: scaleWeight > impactWeight ? 'scale' : 'impact'
  })
}

export function isFreeNanoscaleFinaleGesture({
  startProgress,
  deltaProgress,
  pointerCount = 1,
  reducedMotion = false
}) {
  if (reducedMotion || pointerCount !== 1) return false
  if (startProgress > IMPACT_STOP) return true
  return startProgress === IMPACT_STOP && deltaProgress > 0
}

export function holdNanoscaleFinaleProgress(progress) {
  return Math.min(SCALE_STOP, Math.max(IMPACT_STOP,
    Number.isFinite(progress) ? progress : IMPACT_STOP))
}

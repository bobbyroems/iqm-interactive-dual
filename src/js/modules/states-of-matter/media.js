import { clampFrame, frameToTime } from './timeline.js'
import { waitForMediaReady } from '../../core/media-readiness.js'

export const FALLBACK_DURATION_SECONDS = 12.5

export function drawVideoFrameToCanvas(video, canvas) {
  if (!video || Number(video.readyState) < 2 || !canvas?.getContext) return false

  const width = Math.max(1, Math.round(Number(canvas.width) || 0))
  const height = Math.max(1, Math.round(Number(canvas.height) || 0))
  const context = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!context?.drawImage) return false

  try {
    context.clearRect?.(0, 0, width, height)
    context.drawImage(video, 0, 0, width, height)
    return true
  } catch {
    // Chromium can briefly reject drawImage while a freshly-seeked frame is
    // still being promoted to the compositor. The next committed seek retries.
    return false
  }
}

export function waitForVideoReady(video, options = {}) {
  return waitForMediaReady(video, { label: 'The States of Matter video', ...options })
}

export function createVideoSeekQueue(video, {
  fallbackDurationSeconds = FALLBACK_DURATION_SECONDS,
  onCommit = () => {},
  requestAnimationFrameFn = globalThis.requestAnimationFrame,
  cancelAnimationFrameFn = globalThis.cancelAnimationFrame
} = {}) {
  if (!video?.addEventListener) throw new TypeError('A video-like EventTarget is required.')
  if (typeof requestAnimationFrameFn !== 'function') {
    throw new TypeError('requestAnimationFrame is required for video seeking.')
  }

  let animationFrame = null
  let pendingFrame = null
  let inFlightFrame = null
  let disposed = false

  const getDuration = () => {
    const duration = Number(video.duration)
    return Number.isFinite(duration) && duration > 0 ? duration : fallbackDurationSeconds
  }

  const schedule = () => {
    if (disposed || animationFrame !== null || pendingFrame === null) return
    animationFrame = requestAnimationFrameFn(flush)
  }

  const commit = frame => {
    if (disposed || frame === null) return
    onCommit(clampFrame(frame))
  }

  const flush = () => {
    animationFrame = null
    if (disposed || pendingFrame === null) return
    /* A seek we started is outstanding; onSeeked re-schedules from there. */
    if (inFlightFrame !== null) return
    /* Not our seek — the element is still loading, or something outside the queue
       moved the playhead. Retry next frame rather than dropping the request on the
       floor: nothing else would wake the queue until the visitor moves again. */
    if (video.readyState === 0 || video.seeking) {
      schedule()
      return
    }

    const frame = pendingFrame
    pendingFrame = null
    const targetTime = frameToTime(frame, getDuration())

    if (Math.abs(Number(video.currentTime) - targetTime) < 0.001) {
      commit(frame)
      schedule()
      return
    }

    inFlightFrame = frame
    try {
      video.currentTime = targetTime
    } catch {
      pendingFrame = frame
      inFlightFrame = null
      schedule()
    }
  }

  const onLoadedMetadata = () => schedule()
  const onSeeked = () => {
    const renderedFrame = inFlightFrame
    inFlightFrame = null
    commit(renderedFrame)
    schedule()
  }

  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('seeked', onSeeked)

  return {
    request(frame) {
      if (disposed) return
      pendingFrame = clampFrame(frame)
      schedule()
    },
    dispose() {
      if (disposed) return
      disposed = true
      pendingFrame = null
      inFlightFrame = null
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('seeked', onSeeked)
      if (animationFrame !== null) cancelAnimationFrameFn?.(animationFrame)
      animationFrame = null
    }
  }
}

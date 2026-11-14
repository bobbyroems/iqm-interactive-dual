import { abortError } from './media-lifecycle.js'
import { createLoadDeadline, WEB_LOAD_IDLE_MS, WEB_LOAD_TOTAL_MS } from './load-deadline.js'

export function waitForMediaReady(video, {
  signal,
  timeoutMs = WEB_LOAD_TOTAL_MS,
  idleMs = WEB_LOAD_IDLE_MS,
  onProgress = () => {},
  label = 'The video',
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  if (!video?.addEventListener) throw new TypeError('A video-like EventTarget is required.')
  if (signal?.aborted) return Promise.reject(abortError(signal))
  if (video.error) return Promise.reject(new Error(`${label} could not be decoded (media error ${video.error.code}).`))
  if (video.readyState >= 2) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let settled = false
    let buffered = 0
    let readyState = Number(video.readyState) || 0
    const cleanup = () => {
      deadline.dispose()
      for (const event of ['progress', 'loadedmetadata', 'durationchange']) {
        video.removeEventListener(event, progress)
      }
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('error', error)
      signal?.removeEventListener('abort', abort)
    }
    const finish = failure => {
      if (settled) return
      settled = true
      cleanup()
      if (failure) reject(failure)
      else resolve()
    }
    const progress = () => {
      let nextBuffered = 0
      for (let i = 0; i < (video.buffered?.length || 0); i++) {
        nextBuffered += video.buffered.end(i) - video.buffered.start(i)
      }
      if (nextBuffered > buffered || video.readyState > readyState) {
        buffered = Math.max(buffered, nextBuffered)
        readyState = Math.max(readyState, video.readyState)
        deadline.progress()
        onProgress()
      }
      if (video.readyState >= 2) ready()
    }
    const ready = () => finish()
    const error = () => finish(new Error(`${label} could not be decoded (media error ${video.error?.code || 'unknown'}).`))
    const abort = () => finish(abortError(signal))
    const deadline = createLoadDeadline({
      idleMs: Math.min(idleMs, timeoutMs), totalMs: timeoutMs,
      setTimeoutFn, clearTimeoutFn,
      onTimeout: failure => finish(new DOMException(`${label}: ${failure.message}`, failure.name))
    })
    for (const event of ['progress', 'loadedmetadata', 'durationchange']) {
      video.addEventListener(event, progress)
    }
    video.addEventListener('loadeddata', ready)
    video.addEventListener('error', error)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

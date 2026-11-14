import { taskTimeout } from './abortable-task.js'

export const WEB_LOAD_IDLE_MS = 45_000
export const WEB_LOAD_TOTAL_MS = 180_000

export function createLoadDeadline({
  idleMs = WEB_LOAD_IDLE_MS,
  totalMs = WEB_LOAD_TOTAL_MS,
  onTimeout,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
}) {
  let idleTimer
  let stopped = false
  const dispose = () => {
    stopped = true
    clearTimeoutFn(idleTimer)
    clearTimeoutFn(totalTimer)
  }
  const expire = message => {
    if (stopped) return
    dispose()
    onTimeout(taskTimeout(message))
  }
  const progress = () => {
    if (stopped) return
    clearTimeoutFn(idleTimer)
    idleTimer = setTimeoutFn(() => expire('Loading stopped making progress. Please try again.'), idleMs)
  }
  const totalTimer = setTimeoutFn(
    () => expire('Loading reached its time limit. Please try again.'), totalMs
  )
  progress()
  return { progress, dispose }
}

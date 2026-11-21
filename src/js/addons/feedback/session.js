export class FeedbackSession {
  constructor({ now = () => performance.now() } = {}) {
    this.now = now
    this.reset()
  }

  reset() {
    this.startedAt = null
    this.lastModuleId = null
    this.prompted = false
    this.screen = 'attract'
  }

  visit(screen, { moduleId = null, automatic = true } = {}, preferences) {
    if (screen === 'attract') {
      this.reset()
      return false
    }
    if (this.startedAt === null) this.startedAt = this.now()
    this.screen = screen
    if (moduleId) this.lastModuleId = moduleId
    return screen === 'menu' && automatic && Boolean(this.lastModuleId) &&
      !this.prompted && preferences?.enabled === true &&
      this.now() - this.startedAt >= preferences.delaySeconds * 1000
  }

  markPrompted() {
    this.prompted = true
  }
}

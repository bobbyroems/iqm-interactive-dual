const baseConfig = require('../package.json').build
const reviewConfig = require('./electron-builder-review.cjs')

/* The same portable review build, but it comes up the way the floor does:
   borderless fullscreen on double-click, no flags to remember. Quit stays
   available (Ctrl+Shift+Q, Alt+F4) because a reviewer who cannot close a
   fullscreen window has only Task Manager left.

   It carries its own appId so Windows treats it as a separate application
   from the windowed review build and the two can sit side by side. */
module.exports = {
  ...reviewConfig,
  appId: `${baseConfig.appId}.review.fullscreen`,
  productName: `${baseConfig.productName} Review Fullscreen`,
  directories: {
    ...reviewConfig.directories,
    output: 'build/review-fullscreen'
  },
  extraMetadata: {
    ...reviewConfig.extraMetadata,
    defaultLaunchMode: 'kiosk',
    defaultAllowQuit: true
  },
  portable: {
    ...reviewConfig.portable,
    artifactName: 'IQM-Interactive-Kiosk-Review-Fullscreen-${version}-${arch}.${ext}'
  }
}

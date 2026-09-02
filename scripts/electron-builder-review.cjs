const baseConfig = require('../package.json').build

module.exports = {
  ...baseConfig,
  appId: `${baseConfig.appId}.review`,
  productName: `${baseConfig.productName} Review`,
  directories: {
    ...baseConfig.directories,
    output: 'build/review'
  },
  extraMetadata: {
    ...baseConfig.extraMetadata,
    defaultLaunchMode: 'windowed'
  },
  win: {
    ...baseConfig.win,
    target: [
      {
        target: 'portable',
        arch: ['x64']
      }
    ]
  },
  portable: {
    artifactName: 'IQM-Interactive-Kiosk-Review-${version}-${arch}.${ext}',
    requestExecutionLevel: 'user'
  }
}

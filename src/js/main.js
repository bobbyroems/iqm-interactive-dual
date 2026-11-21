import './attract-image.js'

import('./app.js').then(({ KioskApp }) => {
  const app = new KioskApp(document)
  app.start()
})

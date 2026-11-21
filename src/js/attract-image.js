import { imageSources } from './core/responsive-images.js'

const image = document.querySelector('.attract-chip img')
for (const [name, value] of Object.entries(imageSources(image.dataset.imageSrc))) {
  image.setAttribute(name, value)
}

import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const sourceRoot = resolve(import.meta.dirname, '../ref/majorana-image-masters')
const outputRoot = resolve(import.meta.dirname, '../public/assets/modules/build-majorana-2')

await mkdir(outputRoot, { recursive: true })
for (const name of ['majorana-intro-hero', 'majorana-schematic-backdrop']) {
  const source = resolve(sourceRoot, `${name}.png`)
  const output = await sharp(source)
    .keepIccProfile()
    .webp({ lossless: true, effort: 6 })
    .toFile(resolve(outputRoot, `${name}.webp`))
  const originalBytes = (await stat(source)).size
  console.log(
    `${name}: ${output.width} x ${output.height}, ` +
    `${(originalBytes / 1048576).toFixed(2)} -> ${(output.size / 1048576).toFixed(2)} MiB`
  )
}

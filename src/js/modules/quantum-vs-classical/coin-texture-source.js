const COIN_DIR = 'assets/modules/differences/coins/'

export const COIN_COLOR_TEXTURE_PATHS = Object.freeze([
  `${COIN_DIR}TwentyFive_Cent_Color.bmp`,
  `${COIN_DIR}TwentyFive_Cent_Color01.jpg`,
  `${COIN_DIR}TwentyFive_Cent_Color02.jpg`,
  `${COIN_DIR}TwentyFive_Cent_Color03.jpg`,
  `${COIN_DIR}TwentyFive_Cent_Color04.jpg`
])
export const COIN_BUMP_TEXTURE_PATH = `${COIN_DIR}TwentyFive_Cent_Bump.bmp`
export const COIN_TEXTURE_PATHS = Object.freeze([
  ...COIN_COLOR_TEXTURE_PATHS, COIN_BUMP_TEXTURE_PATH
])
export const BROWSER_COIN_TEXTURE_WIDTH = 2048

export function coinTexturePath(path, platform = globalThis.window?.kiosk?.platform) {
  if (platform || !COIN_TEXTURE_PATHS.includes(path)) return path
  return path.replace(/\.(bmp|jpg)$/, '-browser.webp')
}

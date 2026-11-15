import maplibregl from 'maplibre-gl'
import { groundLight, subsolarPoint } from './sunPosition'

const SIZE = 256
const RAD = Math.PI / 180
const PROTOCOL = 'dayshade'

let registered = false

/** Sine of solar altitude at every pixel of a Web Mercator tile. */
function sunHeights(z: number, x: number, y: number, time: number): Float32Array {
  const [sunLng, sunLat] = subsolarPoint(new Date(time))
  const sinSun = Math.sin(sunLat * RAD)
  const cosSun = Math.cos(sunLat * RAD)
  const tiles = 2 ** z
  const cosHourAngle = new Float32Array(SIZE)
  for (let col = 0; col < SIZE; col++) {
    const lng = ((x + (col + 0.5) / SIZE) / tiles) * 360 - 180
    cosHourAngle[col] = Math.cos((lng - sunLng) * RAD)
  }
  const heights = new Float32Array(SIZE * SIZE)
  for (let row = 0; row < SIZE; row++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (row + 0.5) / SIZE)) / tiles)))
    const a = Math.sin(lat) * sinSun
    const b = Math.cos(lat) * cosSun
    for (let col = 0; col < SIZE; col++) heights[row * SIZE + col] = a + b * cosHourAngle[col]
  }
  return heights
}

/** Soft night dim — leaves ambient satellite visible on the dark side. */
function shadePixels(heights: Float32Array): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let i = 0; i < heights.length; i++) {
    const lit = groundLight(heights[i])
    // Mild terminator — night stays readable without greying the day side.
    const alpha = Math.min(0.48, Math.max(0, 1 - lit) * 0.85)
    pixels[i * 4] = 4
    pixels[i * 4 + 1] = 8
    pixels[i * 4 + 2] = 18
    pixels[i * 4 + 3] = Math.round(255 * alpha)
  }
  return pixels
}

/** Register once: dayshade://shade/{z}/{x}/{y}?t={ms} */
export function ensureDayshadeProtocol() {
  if (registered) return
  registered = true
  try {
    maplibregl.addProtocol(PROTOCOL, async (request) => {
      const match = new RegExp(`^${PROTOCOL}://shade/(\\d+)/(\\d+)/(\\d+)\\?t=(\\d+)$`).exec(request.url)
      if (!match) throw new Error(`Not a dayshade tile: ${request.url}`)
      const z = Number(match[1])
      const x = Number(match[2])
      const y = Number(match[3])
      const time = Number(match[4])
      const pixels = shadePixels(sunHeights(z, x, y, time))
      const image = new ImageData(new Uint8ClampedArray(pixels), SIZE, SIZE)
      return { data: await createImageBitmap(image, { premultiplyAlpha: 'premultiply' }) }
    })
  } catch (err) {
    // Vite HMR re-runs this module while MapLibre still has the protocol registered.
    registered = true
    console.warn('[dayshade] protocol already registered', err)
  }
}

export function dayshadeTiles(timeMs: number): string[] {
  return [`${PROTOCOL}://shade/{z}/{x}/{y}?t=${timeMs}`]
}

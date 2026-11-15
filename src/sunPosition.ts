import type { LightSpecification, SkySpecification } from 'maplibre-gl'

export type LngLat = [lng: number, lat: number]

const RAD = Math.PI / 180
const J2000 = Date.UTC(2000, 0, 1, 12)
const DAY = 86_400_000

const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

/**
 * Point where the Sun is overhead at `date` ([lng, lat] degrees).
 * Astronomical Almanac low-precision solar position (~0.01°).
 */
export function subsolarPoint(date: Date): LngLat {
  const d = (date.getTime() - J2000) / DAY
  const meanAnomaly = (357.529 + 0.98560028 * d) * RAD
  const meanLongitude = 280.459 + 0.98564736 * d
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD
  const obliquity = (23.439 - 0.00000036 * d) * RAD
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  )
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))
  const siderealTime = 280.46061837 + 360.98564736629 * d
  return [wrap(rightAscension / RAD - siderealTime), declination / RAD]
}

export function arc([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const cosine =
    Math.sin(lat1 * RAD) * Math.sin(lat2 * RAD) +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lng2 - lng1) * RAD)
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / RAD
}

export const sunAltitude = (place: LngLat, subsolar: LngLat) => 90 - arc(place, subsolar)

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Ground brightness from space for sine of solar altitude `h`.
 * Night floor (~0.4) keeps the dark side readable (ambient), not pure black.
 */
export const groundLight = (h: number) => {
  const day = h > 0 ? 0.1 + 0.9 * Math.sqrt(h) : 0.1 * smoothstep(Math.sin(-6 * RAD), 0, h)
  return Math.max(0.4, day)
}

/**
 * Style `light` so the globe atmosphere is lit from the subsolar point.
 * With `anchor: "map"`, position is [radial, azimuthal, polar] in Earth-fixed frame.
 */
export function sunLight([lng, lat]: LngLat): LightSpecification {
  const x = -Math.cos(lat * RAD) * Math.sin(lng * RAD)
  const y = -Math.sin(lat * RAD)
  const z = -Math.cos(lat * RAD) * Math.cos(lng * RAD)
  const polar = Math.acos(Math.max(-1, Math.min(1, z))) / RAD
  const azimuthal = Math.atan2(y, x) / RAD - 90
  return {
    anchor: 'map',
    color: '#ffffff',
    intensity: 0.48,
    position: [1.5, azimuthal, polar],
  }
}

type RGB = [number, number, number]

const SKY_STOPS: { altitude: number; sky: RGB; horizon: RGB; fog: RGB }[] = [
  { altitude: -18, sky: [2, 4, 10], horizon: [6, 9, 20], fog: [3, 5, 12] },
  { altitude: -10, sky: [8, 14, 36], horizon: [26, 32, 62], fog: [14, 18, 36] },
  { altitude: -4, sky: [28, 44, 96], horizon: [176, 104, 92], fog: [72, 62, 82] },
  { altitude: 1, sky: [56, 92, 160], horizon: [246, 162, 96], fog: [196, 150, 124] },
  { altitude: 8, sky: [70, 124, 196], horizon: [236, 214, 178], fog: [208, 196, 182] },
  { altitude: 25, sky: [64, 128, 212], horizon: [204, 222, 240], fog: [196, 212, 228] },
]

const mix = (a: RGB, b: RGB, t: number) => {
  const toLinear = (c: number) => (c / 255) ** 2.2
  const toSrgb = (c: number) => Math.round(255 * c ** (1 / 2.2))
  const rgb = a.map((c, i) => toSrgb(toLinear(c) + (toLinear(b[i]) - toLinear(c)) * t))
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

/** Sky colors from solar altitude at the camera look direction. */
export function skyFor(altitude: number): SkySpecification {
  const last = SKY_STOPS.length - 1
  let i = 0
  while (i < last - 1 && altitude > SKY_STOPS[i + 1].altitude) i++
  const a = SKY_STOPS[i]
  const b = SKY_STOPS[i + 1]
  const t = Math.max(0, Math.min(1, (altitude - a.altitude) / (b.altitude - a.altitude || 1)))
  // Bias horizon/fog toward a vivid limb glow so the globe rim reads as atmosphere.
  const horizon = mix(a.horizon, b.horizon, t)
  const fog = mix(
    [Math.min(255, a.fog[0] + 20), Math.min(255, a.fog[1] + 40), Math.min(255, a.fog[2] + 70)],
    [Math.min(255, b.fog[0] + 20), Math.min(255, b.fog[1] + 40), Math.min(255, b.fog[2] + 70)],
    t,
  )
  return {
    'sky-color': mix(a.sky, b.sky, t),
    'horizon-color': horizon,
    'fog-color': fog,
    'fog-ground-blend': 0.35,
    'horizon-fog-blend': 0.75,
    'sky-horizon-blend': 0.55,
    // Strong blue atmosphere when zoomed out; fades as you dive in.
    'atmosphere-blend': [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      1,
      1.5,
      0.95,
      3,
      0.75,
      5,
      0.35,
      7,
      0.08,
      8.5,
      0,
    ],
  }
}

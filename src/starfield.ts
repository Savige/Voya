import { moonRestPose, paintMoonDisc } from './moonOrbit'

export type Star = {
  /** Final resting position */
  x: number
  y: number
  r: number
  a: number
  tint: string
  /** 0–1 delay before this star leaves the burst */
  delay: number
}

export type SolarBody = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'neptune'

export type Planet = {
  x: number
  y: number
  r: number
  body: SolarBody
  delay: number
}

/** Relative visual sizes vs each other (not to scale with Earth on the map). */
const BODY_SIZE: Record<SolarBody, number> = {
  mercury: 0.55,
  venus: 0.72,
  mars: 0.65,
  jupiter: 1.15,
  saturn: 0.82,
  neptune: 0.78,
}

/** Equirectangular maps (NASA-derived via threex.planets). */
const BODY_TEXTURE: Record<SolarBody, string> = {
  mercury: '/planets/mercurymap.jpg',
  venus: '/planets/venusmap.jpg',
  mars: '/planets/marsmap1k.jpg',
  jupiter: '/planets/jupitermap.jpg',
  saturn: '/planets/saturnmap.jpg',
  neptune: '/planets/neptunemap.jpg',
}

const SPRITE_SIZE = 128
const textureImgs: Partial<Record<SolarBody, HTMLImageElement>> = {}
const spriteCache: Partial<Record<SolarBody, HTMLCanvasElement>> = {}
let texturesReady = false
let textureLoadPromise: Promise<boolean> | null = null

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${src}`))
    img.src = src
  })
}

/**
 * Orthographic sphere from an equirectangular map — real surface, not a cartoon.
 * Baked once per body into a sprite.
 */
function bakePlanetSprite(body: SolarBody, map: HTMLImageElement): HTMLCanvasElement {
  const size = SPRITE_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const tw = map.naturalWidth || map.width
  const th = map.naturalHeight || map.height
  // Sample into an offscreen ImageData for correct sphere UVs.
  const tmp = document.createElement('canvas')
  tmp.width = tw
  tmp.height = th
  const tctx = tmp.getContext('2d')!
  tctx.drawImage(map, 0, 0)
  const src = tctx.getImageData(0, 0, tw, th)
  const out = ctx.createImageData(size, size)
  const cx = (size - 1) / 2
  const rot = body === 'mars' ? 0.4 : body === 'jupiter' ? 0.15 : 0.25

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - cx) / cx
      const ny = (py - cx) / cx
      const rr = nx * nx + ny * ny
      if (rr > 1) continue
      const nz = Math.sqrt(1 - rr)
      // Rotate around Y so we don't always show the same longitude.
      const x1 = nx * Math.cos(rot) + nz * Math.sin(rot)
      const z1 = -nx * Math.sin(rot) + nz * Math.cos(rot)
      const lon = Math.atan2(x1, z1)
      const lat = Math.asin(Math.max(-1, Math.min(1, ny)))
      const u = ((lon / Math.PI + 1) * 0.5) % 1
      const v = 0.5 - lat / Math.PI
      const sx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)))
      const sy = Math.min(th - 1, Math.max(0, Math.floor(v * th)))
      const si = (sy * tw + sx) * 4
      const oi = (py * size + px) * 4
      // Soft limb darkening for roundness.
      const limb = 0.55 + 0.45 * nz
      out.data[oi] = Math.min(255, src.data[si] * limb)
      out.data[oi + 1] = Math.min(255, src.data[si + 1] * limb)
      out.data[oi + 2] = Math.min(255, src.data[si + 2] * limb)
      out.data[oi + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

/** Load real planet textures; safe to call multiple times. */
export function preloadPlanetTextures(): Promise<boolean> {
  if (texturesReady) return Promise.resolve(true)
  if (textureLoadPromise) return textureLoadPromise
  textureLoadPromise = (async () => {
    try {
      const bodies = Object.keys(BODY_TEXTURE) as SolarBody[]
      await Promise.all(
        bodies.map(async (body) => {
          const img = await loadImage(BODY_TEXTURE[body])
          textureImgs[body] = img
          spriteCache[body] = bakePlanetSprite(body, img)
        }),
      )
      texturesReady = true
      return true
    } catch (err) {
      console.warn('[starfield] planet textures failed', err)
      texturesReady = false
      return false
    }
  })()
  return textureLoadPromise
}

export function planetTexturesReady() {
  return texturesReady
}

function mulberry(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function buildStarField(width: number, height: number, seed = 42): Star[] {
  const rand = mulberry(seed)
  const area = Math.max(1, width * height)
  const count = Math.min(1400, Math.max(180, Math.round(area / 2200)))
  const stars: Star[] = []
  for (let i = 0; i < count; i++) {
    const roll = rand()
    const tint = roll > 0.92 ? '#c8e0ff' : roll > 0.84 ? '#ffe9c8' : '#ffffff'
    stars.push({
      x: rand() * width,
      y: rand() * height,
      r: 0.35 + rand() * (roll > 0.97 ? 1.6 : 0.9),
      a: 0.22 + rand() * 0.65,
      tint,
      delay: rand() * 0.45,
    })
  }
  return stars
}

/** Real Solar System bodies (no Earth — that's the globe). Quiet page accents. */
export function buildPlanets(width: number, height: number, seed = 99): Planet[] {
  const rand = mulberry(seed)
  const short = Math.min(width, height)
  const roster: SolarBody[] = ['mars', 'jupiter', 'saturn', 'venus', 'neptune', 'mercury']
  const slots = [
    { x: 0.1, y: 0.16 },
    { x: 0.9, y: 0.14 },
    { x: 0.08, y: 0.55 },
    { x: 0.92, y: 0.58 },
    { x: 0.78, y: 0.28 },
    { x: 0.22, y: 0.82 },
  ]
  const planets: Planet[] = []
  for (let i = 0; i < roster.length; i++) {
    const body = roster[i]
    const jitter = () => (rand() - 0.5) * 0.05
    const base = short * (0.01 + rand() * 0.005)
    planets.push({
      x: (slots[i].x + jitter()) * width,
      y: (slots[i].y + jitter()) * height,
      r: base * BODY_SIZE[body],
      body,
      delay: 0.08 + rand() * 0.28,
    })
  }
  return planets
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4)
}

function starLocalProgress(global: number, delay: number) {
  const t = (global - delay * 0.55) / (1 - delay * 0.55)
  return easeOutCubic(Math.max(0, Math.min(1, t)))
}

/** Sky goes near-black → almost-black night blue as the burst settles. */
export function skyColors(lit: number) {
  const t = easeOutQuart(Math.max(0, Math.min(1, lit)))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  const c0 = `rgb(${mix(2, 4)}, ${mix(4, 8)}, ${mix(8, 16)})`
  const c1 = `rgb(${mix(2, 2)}, ${mix(3, 5)}, ${mix(6, 11)})`
  const c2 = `rgb(${mix(1, 1)}, ${mix(2, 3)}, ${mix(4, 7)})`
  return { c0, c1, c2 }
}

function rgba(r: number, g: number, b: number, a: number) {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function paintTerminator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number,
) {
  const shade = ctx.createLinearGradient(x - r * 0.9, y - r * 0.7, x + r * 0.95, y + r * 0.85)
  shade.addColorStop(0, rgba(255, 255, 255, alpha * 0.2))
  shade.addColorStop(0.35, rgba(255, 255, 255, 0))
  shade.addColorStop(0.7, rgba(0, 0, 0, alpha * 0.18))
  shade.addColorStop(1, rgba(0, 0, 0, alpha * 0.42))
  ctx.fillStyle = shade
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

/** Streets globe chrome — soft white / map-blue (matches OSM-ish sheet). */
const STREETS_BODY_TINT: Record<SolarBody, string> = {
  mercury: '#c5d4e0',
  venus: '#e8f0f6',
  mars: '#b9d2e0',
  jupiter: '#d7e4ee',
  saturn: '#eef4f8',
  neptune: '#9ebad0',
}

function paintPlanet(
  ctx: CanvasRenderingContext2D,
  p: Planet,
  x: number,
  y: number,
  scale: number,
  alpha: number,
  streetsMode = false,
) {
  if (alpha < 0.02) return
  const r = Math.max(3, p.r * scale)
  const sprite = spriteCache[p.body]
  if (!sprite) return

  const glowRgb: Record<SolarBody, [number, number, number]> = streetsMode
    ? {
        mercury: [185, 210, 224],
        venus: [230, 240, 248],
        mars: [185, 210, 224],
        jupiter: [200, 220, 235],
        saturn: [235, 242, 248],
        neptune: [158, 186, 208],
      }
    : {
        mercury: [180, 165, 150],
        venus: [230, 195, 120],
        mars: [220, 100, 55],
        jupiter: [230, 180, 120],
        saturn: [240, 205, 140],
        neptune: [80, 140, 240],
      }
  const [gr, gg, gb] = glowRgb[p.body]

  ctx.save()
  ctx.globalAlpha = alpha

  // Tiny body-tinted glow — just a hint at the limb
  const halo = ctx.createRadialGradient(x, y, r * 0.75, x, y, r * 1.35)
  halo.addColorStop(0, rgba(gr, gg, gb, 0))
  halo.addColorStop(0.55, rgba(gr, gg, gb, streetsMode ? 0.1 : 0.06))
  halo.addColorStop(1, rgba(gr, gg, gb, 0))
  ctx.beginPath()
  ctx.fillStyle = halo
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2)
  ctx.fill()

  // Saturn rings (behind)
  if (p.body === 'saturn') {
    paintSaturnRings(ctx, x, y, r, true, streetsMode)
  }

  // Real textured globe
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2)

  if (streetsMode) {
    // Keep luminance from the texture; wash chroma into Streets white/blue.
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.globalCompositeOperation = 'color'
    ctx.fillStyle = STREETS_BODY_TINT[p.body]
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.restore()
  }

  // Gentle terminator for depth (over the photo)
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  paintTerminator(ctx, x, y, r, streetsMode ? 0.7 : 1)
  ctx.restore()

  // Saturn rings (front)
  if (p.body === 'saturn') {
    paintSaturnRings(ctx, x, y, r, false, streetsMode)
  }

  ctx.restore()
}

function paintSaturnRings(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  behind: boolean,
  streetsMode = false,
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.42)
  const a0 = behind ? Math.PI : 0
  const a1 = behind ? Math.PI * 2 : Math.PI
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 1.9, r * 0.42, 0, a0, a1)
  ctx.strokeStyle = streetsMode ? rgba(220, 232, 242, 0.8) : rgba(235, 205, 145, 0.75)
  ctx.lineWidth = Math.max(1.3, r * 0.24)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 1.55, r * 0.34, 0, a0, a1)
  ctx.strokeStyle = streetsMode ? rgba(158, 186, 208, 0.5) : rgba(190, 160, 100, 0.45)
  ctx.lineWidth = Math.max(0.9, r * 0.12)
  ctx.stroke()
  ctx.restore()
}

export type StarfieldPaintOpts = {
  width: number
  height: number
  stars: Star[]
  planets: Planet[]
  /** Burst origin in canvas space (Earth center). */
  ox: number
  oy: number
  /** Approx Earth silhouette radius in canvas px (for Moon orbit / occultation). */
  earthR?: number
  /** 0 = singularity / black, 1 = settled night sky. */
  progress: number
  /** Streets basemap — planets/moon match white–blue map chrome. */
  streetsMode?: boolean
}

/**
 * Soft big-bang: stars + tiny planets fly out from the origin while the sky
 * lifts from black into near-black night. Kept dim — never a bright flash.
 */
export function paintStarfieldFrame(
  ctx: CanvasRenderingContext2D,
  {
    width,
    height,
    stars,
    planets,
    ox,
    oy,
    earthR,
    progress,
    streetsMode = false,
  }: StarfieldPaintOpts,
) {
  const p = Math.max(0, Math.min(1, progress))
  const skyLit = Math.min(1, p * 1.15)
  const { c0, c1, c2 } = skyColors(skyLit)
  const short = Math.min(width, height)
  const earthPx = earthR ?? short * 0.22

  ctx.clearRect(0, 0, width, height)
  const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(width, height) * 0.95)
  g.addColorStop(0, c0)
  g.addColorStop(0.5, c1)
  g.addColorStop(1, c2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)

  // Soft core glow (dim — not a bright flash).
  if (p < 0.85) {
    const glow = (1 - p) * 0.14
    const rg = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.min(width, height) * 0.28)
    rg.addColorStop(0, `rgba(120, 160, 220, ${glow})`)
    rg.addColorStop(0.45, `rgba(60, 90, 150, ${glow * 0.35})`)
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, width, height)
  }

  // Planets after the dimmest star layer would get lost — draw them above most stars.
  const planetDraw: Array<{ planet: Planet; x: number; y: number; scale: number; alpha: number }> = []
  for (const planet of planets) {
    const lp = starLocalProgress(p, planet.delay)
    if (lp <= 0) continue
    planetDraw.push({
      planet,
      x: ox + (planet.x - ox) * lp,
      y: oy + (planet.y - oy) * lp,
      scale: 0.2 + lp * 0.8,
      alpha: Math.min(1, lp * 1.35),
    })
  }

  // Moon bursts with the planets — screen-fixed rest pose (ignores map zoom).
  const moonLp = starLocalProgress(p, 0.06)
  let moonDraw: { x: number; y: number; r: number; phase: number; alpha: number } | null = null
  if (moonLp > 0) {
    const rest = moonRestPose(ox, oy, earthPx, short)
    const mx = ox + (rest.x - ox) * moonLp
    const my = oy + (rest.y - oy) * moonLp
    const dist = Math.hypot(mx - ox, my - oy)
    // Occult while crossing behind Earth's disc.
    if (dist >= earthPx - rest.moonR * 0.2) {
      moonDraw = {
        x: mx,
        y: my,
        r: rest.moonR * (0.2 + moonLp * 0.8),
        phase: rest.phase,
        alpha: Math.min(1, moonLp * 1.35),
      }
    }
  }

  for (const star of stars) {
    const lp = starLocalProgress(p, star.delay)
    if (lp <= 0) continue
    const x = ox + (star.x - ox) * lp
    const y = oy + (star.y - oy) * lp
    // Slight streak early in the burst.
    const streak = (1 - lp) * (1 - lp) * 2.8
    const a = star.a * Math.min(1, lp * 1.4) * (0.55 + skyLit * 0.45)

    if (streak > 0.4) {
      const dx = star.x - ox
      const dy = star.y - oy
      const len = Math.hypot(dx, dy) || 1
      ctx.beginPath()
      ctx.strokeStyle =
        star.tint === '#ffffff'
          ? `rgba(255,255,255,${a * 0.35})`
          : star.tint === '#c8e0ff'
            ? `rgba(200,224,255,${a * 0.35})`
            : `rgba(255,233,200,${a * 0.35})`
      ctx.lineWidth = Math.max(0.4, star.r * 0.6)
      ctx.moveTo(x - (dx / len) * streak * star.r * 4, y - (dy / len) * streak * star.r * 4)
      ctx.lineTo(x, y)
      ctx.stroke()
    }

    if (star.r > 1.05) {
      ctx.beginPath()
      ctx.fillStyle = `rgba(180, 210, 255, ${a * 0.2})`
      ctx.arc(x, y, star.r * 3.2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.fillStyle =
      star.tint === '#ffffff'
        ? `rgba(255,255,255,${a})`
        : star.tint === '#c8e0ff'
          ? `rgba(200,224,255,${a})`
          : `rgba(255,233,200,${a})`
    ctx.arc(x, y, star.r * (0.7 + lp * 0.3), 0, Math.PI * 2)
    ctx.fill()
  }

  for (const d of planetDraw) {
    paintPlanet(ctx, d.planet, d.x, d.y, d.scale, d.alpha, streetsMode)
  }

  if (moonDraw) {
    paintMoonDisc(ctx, moonDraw.x, moonDraw.y, moonDraw.r, moonDraw.phase, moonDraw.alpha, streetsMode)
  }
}

/** Static settled field (resize / idle). */
export function paintStarField(canvas: HTMLCanvasElement, width: number, height: number, stars: Star[]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const planets = buildPlanets(width, height)
  paintStarfieldFrame(ctx, {
    width,
    height,
    stars,
    planets,
    ox: width * 0.5,
    oy: height * 0.45,
    progress: 1,
  })
}

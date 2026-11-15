const MOON_TEX = '/planets/moonmap.jpg'
const SPRITE = 128

/** Mean synodic month (new → new). */
const SYNODIC_DAYS = 29.530588853
/** Mean new moon: 2000-01-06 18:14 UTC. */
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14)

let moonSprite: HTMLCanvasElement | null = null
let moonLoad: Promise<HTMLCanvasElement | null> | null = null
let phasedSprite: HTMLCanvasElement | null = null
let phasedAt = -1

function bakeMoonSprite(map: HTMLImageElement): HTMLCanvasElement {
  const size = SPRITE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const tw = map.naturalWidth || map.width
  const th = map.naturalHeight || map.height
  const tmp = document.createElement('canvas')
  tmp.width = tw
  tmp.height = th
  const tctx = tmp.getContext('2d')!
  tctx.drawImage(map, 0, 0)
  const src = tctx.getImageData(0, 0, tw, th)
  const out = ctx.createImageData(size, size)
  const cx = (size - 1) / 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - cx) / cx
      const ny = (py - cx) / cx
      const rr = nx * nx + ny * ny
      if (rr > 1) continue
      const nz = Math.sqrt(1 - rr)
      const lon = Math.atan2(nx, nz)
      const lat = Math.asin(Math.max(-1, Math.min(1, ny)))
      const u = ((lon / Math.PI + 1) * 0.5) % 1
      const v = 0.5 - lat / Math.PI
      const sx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)))
      const sy = Math.min(th - 1, Math.max(0, Math.floor(v * th)))
      const si = (sy * tw + sx) * 4
      const g = src.data[si]
      const limb = 0.32 + 0.68 * Math.pow(nz, 0.85)
      const oi = (py * size + px) * 4
      const c = Math.min(255, g * limb * 0.95)
      out.data[oi] = c
      out.data[oi + 1] = c
      out.data[oi + 2] = Math.min(255, c * 0.96)
      out.data[oi + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

export function preloadMoonTexture(): Promise<HTMLCanvasElement | null> {
  if (moonSprite) return Promise.resolve(moonSprite)
  if (moonLoad) return moonLoad
  moonLoad = new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      try {
        moonSprite = bakeMoonSprite(img)
        resolve(moonSprite)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = MOON_TEX
  })
  return moonLoad
}

/** Fraction through synodic cycle: 0 = new, 0.5 = full. */
export function lunarPhaseFraction(nowMs = Date.now()): number {
  const days = (nowMs - KNOWN_NEW_MOON_MS) / 86_400_000
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS
  return age / SYNODIC_DAYS
}

/**
 * Apply current phase shading (Northern-hemisphere view).
 * Rebakes when the phase moves ~0.2% (~1.5h).
 */
function spriteForPhase(phase: number): HTMLCanvasElement | null {
  const src = moonSprite
  if (!src) return null
  const key = Math.round(phase * 500)
  if (phasedSprite && phasedAt === key) return phasedSprite

  const size = src.width
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, size, size)
  const cx = (size - 1) / 2
  const alpha = phase * Math.PI * 2
  const sinA = Math.sin(alpha)
  const cosA = Math.cos(alpha)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - cx) / cx
      const ny = (py - cx) / cx
      const rr = nx * nx + ny * ny
      if (rr > 1) continue
      const nz = Math.sqrt(1 - rr)
      const lit = nx * sinA - nz * cosA
      const oi = (py * size + px) * 4
      let shade: number
      if (lit <= 0) {
        shade = 0.04 + 0.03 * Math.max(0, 1 + lit * 4)
      } else {
        const edge = Math.min(1, lit / 0.22)
        shade = 0.07 + 0.93 * (edge * edge * (3 - 2 * edge))
      }
      if (lit > -0.08 && lit < 0.12) {
        shade *= 0.55 + 0.45 * Math.max(0, lit / 0.12)
      }
      img.data[oi] = Math.round(img.data[oi] * shade)
      img.data[oi + 1] = Math.round(img.data[oi + 1] * shade)
      img.data[oi + 2] = Math.round(img.data[oi + 2] * shade)
    }
  }
  ctx.putImageData(img, 0, 0)
  phasedSprite = canvas
  phasedAt = key
  return canvas
}

/** Screen-space resting orbit for the Moon around the Earth origin. */
export function moonRestPose(
  ox: number,
  oy: number,
  earthR: number,
  viewMin: number,
  nowMs = Date.now(),
) {
  const phase = lunarPhaseFraction(nowMs)
  // New moon sunward (left); full opposite (right).
  const angle = phase * Math.PI * 2 + Math.PI
  // 55% closer to Earth than the prior rest distance (shrink limb clearance).
  const farOrbit = Math.max(earthR * 1.85, viewMin * 0.26)
  const orbitR = earthR + (farOrbit - earthR) * 0.45
  const moonR = Math.max(4.5, Math.min(11, viewMin * 0.012))
  return {
    phase,
    moonR,
    x: ox + Math.cos(angle) * orbitR,
    y: oy + Math.sin(angle) * orbitR * 0.88,
  }
}

/** Draw a phased Moon disc at a fixed screen position (zoom-independent). */
export function paintMoonDisc(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  moonR: number,
  phase: number,
  alpha = 1,
  streetsMode = false,
) {
  if (alpha < 0.02 || moonR < 0.5) return

  const illum = (1 - Math.cos(phase * Math.PI * 2)) / 2
  ctx.save()
  ctx.globalAlpha = alpha

  const glowA = 0.04 + illum * 0.1
  const glow = ctx.createRadialGradient(mx, my, moonR * 0.4, mx, my, moonR * 1.9)
  if (streetsMode) {
    glow.addColorStop(0, `rgba(220, 232, 242, ${glowA + 0.04})`)
    glow.addColorStop(0.55, `rgba(185, 210, 224, ${glowA * 0.35})`)
    glow.addColorStop(1, 'rgba(185, 210, 224, 0)')
  } else {
    glow.addColorStop(0, `rgba(200, 205, 210, ${glowA})`)
    glow.addColorStop(0.55, `rgba(170, 180, 190, ${glowA * 0.3})`)
    glow.addColorStop(1, 'rgba(170, 180, 190, 0)')
  }
  ctx.beginPath()
  ctx.fillStyle = glow
  ctx.arc(mx, my, moonR * 1.9, 0, Math.PI * 2)
  ctx.fill()

  const sprite = spriteForPhase(phase)
  if (sprite) {
    ctx.beginPath()
    ctx.arc(mx, my, moonR, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(sprite, mx - moonR, my - moonR, moonR * 2, moonR * 2)
    if (streetsMode) {
      ctx.globalCompositeOperation = 'color'
      ctx.fillStyle = '#d7e4ee'
      ctx.fillRect(mx - moonR, my - moonR, moonR * 2, moonR * 2)
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.32)'
      ctx.fillRect(mx - moonR, my - moonR, moonR * 2, moonR * 2)
      ctx.globalCompositeOperation = 'source-over'
    }
    const limb = ctx.createRadialGradient(mx, my, moonR * 0.45, mx, my, moonR)
    limb.addColorStop(0, 'rgba(0,0,0,0)')
    limb.addColorStop(0.7, 'rgba(0,0,0,0.08)')
    limb.addColorStop(1, streetsMode ? 'rgba(40, 70, 95, 0.38)' : 'rgba(0,0,0,0.42)')
    ctx.fillStyle = limb
    ctx.fillRect(mx - moonR, my - moonR, moonR * 2, moonR * 2)
  } else {
    ctx.beginPath()
    ctx.fillStyle = streetsMode
      ? `rgba(200, 220, 235, ${0.35 + illum * 0.55})`
      : `rgba(160, 165, 170, ${0.25 + illum * 0.65})`
    ctx.arc(mx, my, moonR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

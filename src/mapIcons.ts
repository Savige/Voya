import type { Map as MapLibreMap } from 'maplibre-gl'

function canvasPixels(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  pixelRatio = 2,
): { width: number; height: number; data: Uint8Array } {
  const canvas = document.createElement('canvas')
  canvas.width = size * pixelRatio
  canvas.height = size * pixelRatio
  const ctx = canvas.getContext('2d')
  if (!ctx) return { width: size, height: size, data: new Uint8Array(size * size * 4) }
  ctx.scale(pixelRatio, pixelRatio)
  draw(ctx, size)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(data) }
}

/** Solid white disc — high-contrast badge for plane/car on satellite & streets. */
function drawWhiteDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const r = s * 0.48
  ctx.beginPath()
  ctx.fillStyle = '#ffffff'
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)'
  ctx.lineWidth = Math.max(1, s * 0.04)
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
}

/** Lucide-style plane (24×24 path), upright, nose to the right — black on white. */
function drawPlaneIcon(ctx: CanvasRenderingContext2D, s: number) {
  const cx = s / 2
  const cy = s / 2
  drawWhiteDisc(ctx, cx, cy, s)
  ctx.save()
  ctx.fillStyle = '#0f172a'
  ctx.translate(cx, cy)
  const scale = (s * 0.58) / 24
  ctx.scale(scale, scale)
  ctx.translate(-12, -12)
  const plane = new Path2D(
    'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  )
  ctx.fill(plane)
  ctx.restore()
}

/** Side-profile car facing right — black on white. */
function drawCarIcon(ctx: CanvasRenderingContext2D, s: number) {
  const cx = s / 2
  const cy = s / 2
  drawWhiteDisc(ctx, cx, cy, s)
  ctx.save()
  ctx.translate(cx, cy)
  const u = s / 32

  ctx.fillStyle = '#0f172a'
  ctx.beginPath()
  ctx.moveTo(-11 * u, 3.2 * u)
  ctx.lineTo(-11 * u, 0.4 * u)
  ctx.lineTo(-7.2 * u, 0.4 * u)
  ctx.lineTo(-4.8 * u, -4.2 * u)
  ctx.lineTo(3.2 * u, -4.2 * u)
  ctx.lineTo(6.2 * u, 0.4 * u)
  ctx.lineTo(11 * u, 0.7 * u)
  ctx.lineTo(11.4 * u, 3.2 * u)
  ctx.closePath()
  ctx.fill()

  // Windows as white insets on the body.
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(-6 * u, 0.15 * u)
  ctx.lineTo(-4 * u, -3.1 * u)
  ctx.lineTo(-0.6 * u, -3.1 * u)
  ctx.lineTo(-0.6 * u, 0.15 * u)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0.4 * u, 0.15 * u)
  ctx.lineTo(0.4 * u, -3.1 * u)
  ctx.lineTo(2.8 * u, -3.1 * u)
  ctx.lineTo(5 * u, 0.15 * u)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#0f172a'
  ctx.beginPath()
  ctx.arc(-5.8 * u, 4 * u, 2.3 * u, 0, Math.PI * 2)
  ctx.arc(6.4 * u, 4 * u, 2.3 * u, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(-5.8 * u, 4 * u, 1.05 * u, 0, Math.PI * 2)
  ctx.arc(6.4 * u, 4 * u, 1.05 * u, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Stretchable white pill for destination labels.
 * Coordinates are in image pixels (cssSize × pixelRatio).
 * content = [left, top, right, bottom] text box; stretchX/Y = 9-slice caps.
 */
function labelPillImage(): {
  width: number
  height: number
  data: Uint8Array
  stretchX: Array<[number, number]>
  stretchY: Array<[number, number]>
  content: [number, number, number, number]
  pixelRatio: number
} {
  const pr = 2
  const w = 64
  const h = 32
  const canvas = document.createElement('canvas')
  canvas.width = w * pr
  canvas.height = h * pr
  const ctx = canvas.getContext('2d')!
  ctx.scale(pr, pr)
  ctx.fillStyle = '#ffffff'
  const r = 10
  ctx.beginPath()
  ctx.moveTo(0.5 + r, 0.5)
  ctx.arcTo(w - 0.5, 0.5, w - 0.5, h - 0.5, r)
  ctx.arcTo(w - 0.5, h - 0.5, 0.5, h - 0.5, r)
  ctx.arcTo(0.5, h - 0.5, 0.5, 0.5, r)
  ctx.arcTo(0.5, 0.5, w - 0.5, 0.5, r)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)'
  ctx.lineWidth = 1
  ctx.stroke()
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  // Image is 128×64 at pr=2. Cap corners at 20px; text content inset ~10px.
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8Array(data),
    stretchX: [[20, 108]],
    stretchY: [[16, 48]],
    content: [14, 10, 114, 54],
    pixelRatio: pr,
  }
}

/** Dark blue badge behind IATA codes. */
function iataBadgeImage(): {
  width: number
  height: number
  data: Uint8Array
  stretchX: Array<[number, number]>
  stretchY: Array<[number, number]>
  content: [number, number, number, number]
  pixelRatio: number
} {
  const pr = 2
  const w = 44
  const h = 24
  const canvas = document.createElement('canvas')
  canvas.width = w * pr
  canvas.height = h * pr
  const ctx = canvas.getContext('2d')!
  ctx.scale(pr, pr)
  ctx.fillStyle = '#1e3a5f'
  const r = 7
  ctx.beginPath()
  ctx.moveTo(0.5 + r, 0.5)
  ctx.arcTo(w - 0.5, 0.5, w - 0.5, h - 0.5, r)
  ctx.arcTo(w - 0.5, h - 0.5, 0.5, h - 0.5, r)
  ctx.arcTo(0.5, h - 0.5, 0.5, 0.5, r)
  ctx.arcTo(0.5, 0.5, w - 0.5, 0.5, r)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 1
  ctx.stroke()
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8Array(data),
    stretchX: [[14, 74]],
    stretchY: [[10, 38]],
    content: [8, 4, 80, 44],
    pixelRatio: pr,
  }
}

export function ensureMapImages(map: MapLibreMap) {
  for (const id of ['wp-plane', 'wp-car', 'wp-label-pill', 'wp-iata-badge'] as const) {
    if (map.hasImage(id)) map.removeImage(id)
  }
  // White-disc badges; TripMap scales to match numbered pin diameter.
  map.addImage('wp-plane', canvasPixels(40, drawPlaneIcon), { pixelRatio: 2 })
  map.addImage('wp-car', canvasPixels(40, drawCarIcon), { pixelRatio: 2 })

  const pill = labelPillImage()
  map.addImage(
    'wp-label-pill',
    { width: pill.width, height: pill.height, data: pill.data },
    {
      pixelRatio: pill.pixelRatio,
      stretchX: pill.stretchX,
      stretchY: pill.stretchY,
      content: pill.content,
    },
  )
  const badge = iataBadgeImage()
  map.addImage(
    'wp-iata-badge',
    { width: badge.width, height: badge.height, data: badge.data },
    {
      pixelRatio: badge.pixelRatio,
      stretchX: badge.stretchX,
      stretchY: badge.stretchY,
      content: badge.content,
    },
  )
}

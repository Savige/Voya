import { useEffect, useRef, type RefObject } from 'react'
import { preloadMoonTexture } from './moonOrbit'
import {
  buildPlanets,
  buildStarField,
  paintStarfieldFrame,
  preloadPlanetTextures,
  type Planet,
  type Star,
} from './starfield'

type Props = {
  /** When true, run the soft big-bang bloom from Earth into the page sheet. */
  active: boolean
  /** Map shell — bloom origin. */
  originRef: RefObject<HTMLElement | null>
  /**
   * Sticky trip tabs. Stars fill from mid-nav downward (bottom half of the tabs
   * band) so the top half can keep the hero — never paint into the hero above.
   */
  navRef: RefObject<HTMLElement | null>
  /** Fired as the sky lifts black → near-black night (0–1). */
  onSkyLit?: (lit: number) => void
  /** Streets basemap — planets/moon use white–blue map chrome colours. */
  streetsMode?: boolean
}

const BURST_MS = 3200
/** Short pause after the sheet pins — pin is instant, so this can stay brief. */
const BURST_DELAY_MS = 180
/** Trip recenter starts this long after the burst begins (bloom keeps running). */
const RECENTER_AFTER_MS = 1500

/**
 * Soft big-bang starfield: stars + tiny planets burst from behind Earth,
 * sky lifts from black into near-black night, then holds as the page sheet background.
 */
export function PageStarfield({ active, originRef, navRef, onSkyLit, streetsMode = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const starsRef = useRef<Star[]>([])
  const planetsRef = useRef<Planet[]>([])
  const progressRef = useRef(0)
  const rafRef = useRef(0)
  const sizeRef = useRef({ w: 1, h: 1, top: 0 })
  const streetsRef = useRef(streetsMode)
  streetsRef.current = streetsMode
  const onSkyLitRef = useRef(onSkyLit)
  onSkyLitRef.current = onSkyLit

  const navTop = () => {
    const nav = navRef.current
    if (!nav) return 0
    const r = nav.getBoundingClientRect()
    // Align with MapSheetUnderlay — stars begin at the nav’s horizontal midline.
    return Math.max(0, Math.floor(r.top + r.height * 0.5))
  }

  const originInCanvas = () => {
    const { top } = sizeRef.current
    const el = originRef.current
    if (!el) {
      return {
        ox: sizeRef.current.w * 0.5,
        oy: sizeRef.current.h * 0.45,
        r0: 48,
      }
    }
    const rect = el.getBoundingClientRect()
    return {
      ox: rect.left + rect.width / 2,
      oy: rect.top + rect.height / 2 - top,
      r0: Math.max(40, Math.min(rect.width, rect.height) * 0.42),
    }
  }

  const layoutCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const top = navTop()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight - top)
    const resized = sizeRef.current.w !== w || sizeRef.current.h !== h
    sizeRef.current = { w, h, top }
    canvas.style.top = `${top}px`
    canvas.style.left = '0'
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (resized || starsRef.current.length === 0) {
      starsRef.current = buildStarField(w, h, 42)
      planetsRef.current = buildPlanets(w, h, 99)
    }
    return ctx
  }

  const paint = (progress: number) => {
    const ctx = layoutCanvas()
    if (!ctx) return
    const { w, h } = sizeRef.current
    const { ox, oy, r0 } = originInCanvas()
    paintStarfieldFrame(ctx, {
      width: w,
      height: h,
      stars: starsRef.current,
      planets: planetsRef.current,
      ox,
      oy,
      earthR: r0,
      progress,
      streetsMode: streetsRef.current,
    })
    // Expand reveal with the burst so it reads as matter flying outward.
    const maxR = Math.hypot(w, h) * 1.25
    const radius = r0 * 0.08 + (maxR - r0 * 0.08) * Math.min(1, progress * 1.05)
    canvasRef.current!.style.clipPath = `circle(${radius}px at ${ox}px ${oy}px)`
  }

  const reportSkyLit = (elapsedMs: number) => {
    onSkyLitRef.current?.(Math.min(1, elapsedMs / RECENTER_AFTER_MS))
  }

  useEffect(() => {
    const onResize = () => paint(progressRef.current)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, { passive: true })
    const ro = new ResizeObserver(onResize)
    if (navRef.current) ro.observe(navRef.current)
    void Promise.all([preloadPlanetTextures(), preloadMoonTexture()]).then(() => {
      paint(progressRef.current)
    })
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRef, originRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    cancelAnimationFrame(rafRef.current)

    if (!active) {
      progressRef.current = 0
      canvas.style.opacity = '0'
      canvas.style.clipPath = 'circle(0px at 50% 50%)'
      onSkyLitRef.current?.(0)
      return
    }

    canvas.style.opacity = '1'

    let cancelled = false
    let delayTimer = 0

    void Promise.all([preloadPlanetTextures(), preloadMoonTexture()]).finally(() => {
      if (cancelled) return
      const idleOrbit = () => {
        if (cancelled) return
        paint(1)
        reportSkyLit(RECENTER_AFTER_MS)
        // Keep Moon on the real synodic track after the burst settles.
        rafRef.current = requestAnimationFrame(idleOrbit)
      }
      if (reduced) {
        progressRef.current = 1
        reportSkyLit(RECENTER_AFTER_MS)
        idleOrbit()
        return
      }
      progressRef.current = 0
      paint(0)
      reportSkyLit(0)
      delayTimer = window.setTimeout(() => {
        if (cancelled) return
        const t0 = performance.now()
        const tick = (now: number) => {
          if (cancelled) return
          const elapsed = now - t0
          const t = Math.min(1, elapsed / BURST_MS)
          const eased = 1 - Math.pow(1 - t, 3.2)
          progressRef.current = eased
          paint(eased)
          reportSkyLit(elapsed)
          if (t < 1) rafRef.current = requestAnimationFrame(tick)
          else idleOrbit()
        }
        rafRef.current = requestAnimationFrame(tick)
      }, BURST_DELAY_MS)
    })

    return () => {
      cancelled = true
      window.clearTimeout(delayTimer)
      cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, originRef, navRef])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed z-[20]"
      aria-hidden
      style={{
        opacity: 0,
        clipPath: 'circle(0px at 50% 50%)',
        willChange: 'clip-path',
      }}
    />
  )
}

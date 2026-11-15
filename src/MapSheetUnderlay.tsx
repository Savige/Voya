import { useEffect, useRef, type RefObject } from 'react'

type Props = {
  active: boolean
  /** Sticky trip nav — underlay starts at mid-nav (hero above, stars below). */
  navRef: RefObject<HTMLElement | null>
  /** 0 = near-black sheet, 1 = almost-black night blue under the stars. */
  skyLit?: number
}

/**
 * Solid night sheet under the starfield. Lifts from black → near-black blue with the burst
 * so the mountain hero never flashes through, and the settled sky matches the stars.
 * Starts at mid-nav so the sticky tabs keep hero on the top half and stars on the bottom.
 */
export function MapSheetUnderlay({ active, navRef, skyLit = 0 }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const layout = () => {
      if (!active) return
      const nav = navRef.current
      if (!nav) {
        el.style.top = '0px'
        return
      }
      const r = nav.getBoundingClientRect()
      // Mid-nav: top half stays over the hero; night sheet + stars own the bottom half.
      const top = Math.max(0, Math.floor(r.top + r.height * 0.5))
      el.style.top = `${top}px`
    }

    layout()
    window.addEventListener('resize', layout)
    window.addEventListener('scroll', layout, { passive: true })
    const ro = new ResizeObserver(layout)
    if (navRef.current) ro.observe(navRef.current)
    return () => {
      window.removeEventListener('resize', layout)
      window.removeEventListener('scroll', layout)
      ro.disconnect()
    }
  }, [active, navRef])

  if (!active) return null

  const t = Math.max(0, Math.min(1, skyLit))
  // black → near-black blue (matches starfield skyColors mid stop)
  const r = Math.round(10 + (2 - 10) * t)
  const g = Math.round(10 + (5 - 10) * t)
  const b = Math.round(10 + (11 - 10) * t)

  return (
    <div
      ref={elRef}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[19]"
      aria-hidden
      style={{ top: 0, backgroundColor: `rgb(${r}, ${g}, ${b})` }}
    />
  )
}

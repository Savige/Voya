/**
 * DOM nodes for Google Maps AdvancedMarkerElement content (no React).
 * Icons align with lucide-react strokes (MIT / ISC).
 */

import type { MapMarkerKind } from './mapItinerary'

export type { MapMarkerKind }

const NS = 'http://www.w3.org/2000/svg'

function appendPath(svg: SVGSVGElement, d: string) {
  const path = document.createElementNS(NS, 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
}

function appendCircle(svg: SVGSVGElement, cx: string, cy: string, r: string) {
  const circle = document.createElementNS(NS, 'circle')
  circle.setAttribute('cx', cx)
  circle.setAttribute('cy', cy)
  circle.setAttribute('r', r)
  svg.appendChild(circle)
}

function createIconSvg(kind: MapMarkerKind): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'white')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')

  if (kind === 'stay') {
    appendPath(svg, 'M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8')
    appendPath(svg, 'M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4')
    appendPath(svg, 'M12 4v6')
    appendPath(svg, 'M2 18h20')
  } else if (kind === 'flight') {
    appendPath(
      svg,
      'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
    )
  } else if (kind === 'rental') {
    appendPath(
      svg,
      'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2',
    )
    appendPath(svg, 'M9 17h6')
    appendCircle(svg, '7', '17', '2')
    appendCircle(svg, '17', '17', '2')
  } else if (kind === 'restaurant') {
    appendPath(svg, 'm16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8')
    appendPath(svg, 'M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7')
    appendPath(svg, 'm2.1 21.8 6.4-6.3')
    appendPath(svg, 'm19 5-7 7')
  } else if (kind === 'activity') {
    appendCircle(svg, '12', '12', '10')
    appendPath(svg, 'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z')
  } else {
    appendPath(svg, 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0')
    appendCircle(svg, '12', '10', '3')
  }

  return svg
}

/** Pin circle + icon for map markers. */
export function createMapMarkerContent(kind: MapMarkerKind): HTMLElement {
  const wrap = document.createElement('div')
  const color =
    kind === 'stay'
      ? 'bg-blue-600'
      : kind === 'flight'
        ? 'bg-violet-600'
        : kind === 'rental'
          ? 'bg-indigo-600'
          : kind === 'restaurant'
            ? 'bg-amber-600'
            : kind === 'activity'
              ? 'bg-rose-500'
              : 'bg-emerald-600'
  // Stops (activities) use a smaller pin so destinations stay primary on the map.
  wrap.className =
    kind === 'activity'
      ? `h-4 w-4 rounded-full ${color} text-white flex items-center justify-center shadow ring-2 ring-white/90`
      : `h-7 w-7 rounded-full ${color} text-white flex items-center justify-center shadow`
  const icon = createIconSvg(kind)
  if (kind === 'activity') {
    icon.setAttribute('width', '10')
    icon.setAttribute('height', '10')
  }
  wrap.appendChild(icon)
  return wrap
}

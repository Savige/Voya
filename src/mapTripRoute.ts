import { getAirportByIata } from './data/airportLookup'
import type { FlightBooking, Stay } from './tripTypes'

export type LngLat = { lat: number; lon: number }

export type TripRouteMarker = {
  id: string
  lat: number
  lon: number
  /** Numbered itinerary stop (1-based). Empty for external airports / POIs. */
  index: number | null
  /** Primary label: city name for stops, IATA for external airports. */
  label: string
  /** Under-airport city name (external airports only). */
  cityLabel?: string
  kind: 'stop' | 'airport'
}

export type TripRouteLeg = {
  id: string
  kind: 'flight' | 'drive'
  from: LngLat
  to: LngLat
}

export type TripRoute = {
  markers: TripRouteMarker[]
  legs: TripRouteLeg[]
}

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const la1 = a.lat * RAD
  const la2 = b.lat * RAD
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Soft match for flight↔stay gap scoring (hub catchment). Not for pin placement. */
export const AIRPORT_CATCHMENT_KM = 120
/** Stay is "at" this airport — suppress duplicate IATA badge / allow airport fallback pin. */
export const AIRPORT_AT_STAY_KM = 28

export function stayMatchesAirport(stay: Stay, iata?: string, maxKm = AIRPORT_CATCHMENT_KM): boolean {
  const code = (iata ?? '').trim().toUpperCase()
  if (!code) return false
  const ap = getAirportByIata(code)
  if (!ap) return false
  const loc = (stay.location ?? '').toLowerCase()
  if (loc && (loc.includes(ap.city.toLowerCase()) || loc.includes(code.toLowerCase()))) return true
  if (
    typeof stay.lat === 'number' &&
    typeof stay.lon === 'number' &&
    typeof ap.lat === 'number' &&
    typeof ap.lon === 'number'
  ) {
    return haversineKm({ lat: stay.lat, lon: stay.lon }, { lat: ap.lat, lon: ap.lon }) <= maxKm
  }
  return false
}

/** True when the stay is the airport city itself (not merely in the catchment). */
export function stayIsAtAirport(stay: Stay, iata?: string): boolean {
  const code = (iata ?? '').trim().toUpperCase()
  if (!code) return false
  const ap = getAirportByIata(code)
  if (!ap) return false
  const loc = (stay.location ?? '').toLowerCase()
  const city = ap.city.toLowerCase()
  if (loc && (loc.includes(code.toLowerCase()) || (city && loc.includes(city)))) return true
  if (
    typeof stay.lat === 'number' &&
    typeof stay.lon === 'number' &&
    typeof ap.lat === 'number' &&
    typeof ap.lon === 'number'
  ) {
    return haversineKm({ lat: stay.lat, lon: stay.lon }, { lat: ap.lat, lon: ap.lon }) <= AIRPORT_AT_STAY_KM
  }
  return false
}

function stayCoords(stay: Stay): LngLat | null {
  if (typeof stay.lat === 'number' && typeof stay.lon === 'number') {
    return { lat: stay.lat, lon: stay.lon }
  }
  return null
}

function sortStays(stays: Stay[]): Stay[] {
  return [...stays].sort((a, b) => {
    const byDate = (a.startDate || '').localeCompare(b.startDate || '')
    if (byDate !== 0) return byDate
    return a.createdAt - b.createdAt
  })
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

type Gap = { key: string; from: Stay | null; to: Stay | null }

function buildGaps(stays: Stay[]): Gap[] {
  if (stays.length === 0) return []
  const gaps: Gap[] = []
  for (let i = 0; i < stays.length; i++) {
    gaps.push({
      key: `before:${stays[i].id}`,
      from: i === 0 ? null : stays[i - 1],
      to: stays[i],
    })
  }
  gaps.push({
    key: `after:${stays[stays.length - 1].id}`,
    from: stays[stays.length - 1],
    to: null,
  })
  return gaps
}

function scoreFlightForGap(f: FlightBooking, gap: Gap): number {
  if (!f.departDate) return -1
  let score = 0
  if (gap.from && stayMatchesAirport(gap.from, f.fromIata)) score += 4
  if (gap.to && stayMatchesAirport(gap.to, f.toIata)) score += 4
  if (gap.from && gap.to) {
    const start = addDaysIso(gap.from.endDate, -1)
    const end = addDaysIso(gap.to.startDate, 1)
    if (f.departDate >= start && f.departDate <= end) score += 2
  } else if (!gap.from && gap.to) {
    if (f.departDate <= addDaysIso(gap.to.startDate, 1)) score += 2
  } else if (gap.from && !gap.to) {
    if (f.departDate >= addDaysIso(gap.from.endDate, -1)) score += 2
  }
  return score
}

function assignFlightsToGaps(stays: Stay[], flights: FlightBooking[]): Map<string, FlightBooking[]> {
  const gaps = buildGaps(stays)
  const out = new Map<string, FlightBooking[]>()
  for (const g of gaps) out.set(g.key, [])

  const sorted = [...flights]
    .filter((f) => Boolean(f.confirmation?.trim()) && Boolean(f.departDate))
    .sort((a, b) => (a.departDate + a.departTime).localeCompare(b.departDate + b.departTime))

  for (const f of sorted) {
    let best: Gap | null = null
    let bestScore = 0
    for (const g of gaps) {
      const s = scoreFlightForGap(f, g)
      if (s > bestScore) {
        bestScore = s
        best = g
      }
    }
    // Only bind flights that actually match a gap. Dumping weak matches into
    // gaps[0] was wiping road-drive legs and replacing them with great-circles.
    if (best && bestScore >= 2) out.get(best.key)!.push(f)
  }
  return out
}

/**
 * Numbered stop pins use the stay's own coordinates.
 *
 * Never snap geocoded stays onto a flight airport: a 120km hub catchment
 * (Queenstown, Denver, Milan, …) would collapse every nearby overnight onto
 * one lat/lon, stacking pins and hiding labels. Airport coords are only a
 * fallback when the stay has no lat/lon yet.
 */
function pinCoordForStay(stay: Stay, flights: FlightBooking[]): LngLat | null {
  const own = stayCoords(stay)
  if (own) return own

  const inbound = flights.find((f) => stayMatchesAirport(stay, f.toIata))
  if (inbound?.toIata) {
    const ap = airportPoint(inbound.toIata)
    if (ap) return { lat: ap.lat, lon: ap.lon }
  }
  const outbound = flights.find((f) => stayMatchesAirport(stay, f.fromIata))
  if (outbound?.fromIata) {
    const ap = airportPoint(outbound.fromIata)
    if (ap) return { lat: ap.lat, lon: ap.lon }
  }
  return null
}

function airportPoint(iata: string): { iata: string; city: string; lat: number; lon: number } | null {
  const code = iata.trim().toUpperCase()
  if (!code) return null
  const ap = getAirportByIata(code)
  if (!ap || typeof ap.lat !== 'number' || typeof ap.lon !== 'number') return null
  return { iata: code, city: ap.city, lat: ap.lat, lon: ap.lon }
}

function iataMatchesAnyStay(iata: string, stays: Stay[]): boolean {
  // Only hide the IATA badge when a stay pin already sits at that airport.
  // Catchment matches (Wanaka ↔ ZQN) must still show the airport endpoint.
  return stays.some((s) => stayIsAtAirport(s, iata))
}

/** Nudge markers that share the same point so stacked geocodes stay readable. */
function separateCoincidentStopMarkers(markers: TripRouteMarker[]): void {
  const stops = markers.filter((m) => m.kind === 'stop')
  const groups = new Map<string, TripRouteMarker[]>()
  for (const m of stops) {
    const key = `${m.lat.toFixed(5)},${m.lon.toFixed(5)}`
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // ~350m ring — visible when zoomed into a city, negligible at country scale.
    const radiusDeg = 0.0035
    group.forEach((m, i) => {
      const angle = (2 * Math.PI * i) / group.length - Math.PI / 2
      m.lat = m.lat + radiusDeg * Math.cos(angle)
      m.lon = m.lon + radiusDeg * Math.sin(angle) / Math.max(0.2, Math.cos(m.lat * RAD))
    })
  }
}

/**
 * Trip itinerary geometry: numbered stays at stay coords, external IATA badges
 * when no stay sits at that airport, flight legs between airports, drive legs
 * between consecutive stays.
 */
export function buildTripRoute(stays: Stay[], flights: FlightBooking[]): TripRoute {
  const ordered = sortStays(stays)
  const byGap = assignFlightsToGaps(ordered, flights)
  const markers: TripRouteMarker[] = []
  const legs: TripRouteLeg[] = []
  const markerIds = new Set<string>()

  const pushMarker = (m: TripRouteMarker) => {
    if (markerIds.has(m.id)) return
    markerIds.add(m.id)
    markers.push(m)
  }

  const stopNodes: Array<{ stay: Stay; marker: TripRouteMarker }> = []
  ordered.forEach((stay, i) => {
    const coord = pinCoordForStay(stay, flights) ?? stayCoords(stay)
    if (!coord) return
    const marker: TripRouteMarker = {
      id: `stop:${stay.id}`,
      lat: coord.lat,
      lon: coord.lon,
      index: i + 1,
      label: (stay.location || 'Stop').trim() || 'Stop',
      kind: 'stop',
    }
    pushMarker(marker)
    stopNodes.push({ stay, marker })
  })
  // After pins are placed (and no longer airport-snapped), spread true duplicates.
  separateCoincidentStopMarkers(markers)

  const assignedFlightIds = new Set<string>()
  const pushFlightLeg = (f: FlightBooking) => {
    const fromAp = f.fromIata ? airportPoint(f.fromIata) : null
    const toAp = f.toIata ? airportPoint(f.toIata) : null
    if (!fromAp || !toAp) return
    if (!iataMatchesAnyStay(fromAp.iata, ordered)) {
      pushMarker({
        id: `airport:${fromAp.iata}`,
        lat: fromAp.lat,
        lon: fromAp.lon,
        index: null,
        label: fromAp.iata,
        cityLabel: fromAp.city,
        kind: 'airport',
      })
    }
    if (!iataMatchesAnyStay(toAp.iata, ordered)) {
      pushMarker({
        id: `airport:${toAp.iata}`,
        lat: toAp.lat,
        lon: toAp.lon,
        index: null,
        label: toAp.iata,
        cityLabel: toAp.city,
        kind: 'airport',
      })
    }
    legs.push({
      id: `flight:${f.id}`,
      kind: 'flight',
      from: { lat: fromAp.lat, lon: fromAp.lon },
      to: { lat: toAp.lat, lon: toAp.lon },
    })
    assignedFlightIds.add(f.id)
  }

  const gaps = buildGaps(ordered)
  for (const gap of gaps) {
    const gapFlights = byGap.get(gap.key) ?? []
    for (const f of gapFlights) pushFlightLeg(f)

    // Drive between consecutive stays when no flight covers the gap.
    if (gap.from && gap.to && gapFlights.length === 0) {
      const a = stopNodes.find((n) => n.stay.id === gap.from!.id)?.marker
      const b = stopNodes.find((n) => n.stay.id === gap.to!.id)?.marker
      if (a && b && haversineKm(a, b) >= 2) {
        legs.push({
          id: `drive:${gap.from.id}:${gap.to.id}`,
          kind: 'drive',
          from: { lat: a.lat, lon: a.lon },
          to: { lat: b.lat, lon: b.lon },
        })
      }
    }
  }

  // Unassigned flights still get a great-circle (do not suppress road drives).
  for (const f of flights) {
    if (assignedFlightIds.has(f.id)) continue
    if (!f.fromIata || !f.toIata) continue
    pushFlightLeg(f)
  }

  return { markers, legs }
}

/** Spherical great-circle polyline (flight arcs). */
export function greatCircleLine(
  from: LngLat,
  to: LngLat,
  steps = 48,
): Array<[number, number]> {
  const lat1 = from.lat * RAD
  const lon1 = from.lon * RAD
  const lat2 = to.lat * RAD
  const lon2 = to.lon * RAD
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    )
  if (!Number.isFinite(d) || d < 1e-9) {
    return [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ]
  }
  const out: Array<[number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y))
    const lon = Math.atan2(y, x)
    out.push([lon * DEG, lat * DEG])
  }
  return out
}

const roadCache = new Map<string, Array<[number, number]>>()
/** In-flight dedupe so styleEpoch remounts don't stampede OSRM / cache failures. */
const roadInflight = new Map<string, Promise<Array<[number, number]>>>()

function roadCacheKey(from: LngLat, to: LngLat): string {
  return `${from.lon.toFixed(4)},${from.lat.toFixed(4)};${to.lon.toFixed(4)},${to.lat.toFixed(4)}`
}

function straightLine(from: LngLat, to: LngLat): Array<[number, number]> {
  return [
    [from.lon, from.lat],
    [to.lon, to.lat],
  ]
}

function osrmPath(from: LngLat, to: LngLat): string {
  return (
    `/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson`
  )
}

async function parseOsrmResponse(res: Response): Promise<Array<[number, number]> | null> {
  if (!res.ok) return null
  const json = (await res.json()) as {
    code?: string
    routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>
  }
  if (json.code && json.code !== 'Ok') return null
  const coords = json.routes?.[0]?.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  return coords
}

async function fetchRoadLineOnce(from: LngLat, to: LngLat): Promise<Array<[number, number]> | null> {
  const path = osrmPath(from, to)
  // Prefer same-origin proxy (Vite / container nginx); fall back to public OSRM.
  try {
    const proxied = await fetch(`/osrm${path}`)
    const fromProxy = await parseOsrmResponse(proxied)
    if (fromProxy) return fromProxy
  } catch {
    /* try absolute */
  }
  try {
    const direct = await fetch(`https://router.project-osrm.org${path}`)
    return await parseOsrmResponse(direct)
  } catch {
    return null
  }
}

/** OSRM driving geometry (falls back to straight line; failures are not cached). */
export async function fetchRoadLine(from: LngLat, to: LngLat): Promise<Array<[number, number]>> {
  const key = roadCacheKey(from, to)
  const cached = roadCache.get(key)
  if (cached) return cached

  const straight = straightLine(from, to)
  // Skip remote routing for tiny hops.
  if (haversineKm(from, to) < 3) {
    roadCache.set(key, straight)
    return straight
  }

  const existing = roadInflight.get(key)
  if (existing) return existing

  const pending = (async () => {
    try {
      let coords = await fetchRoadLineOnce(from, to)
      if (!coords) {
        // One retry — public OSRM is flaky under remount storms.
        await new Promise((r) => setTimeout(r, 350))
        coords = await fetchRoadLineOnce(from, to)
      }
      if (!coords) return straight
      roadCache.set(key, coords)
      return coords
    } catch {
      // Do not cache failures — next paint can retry for real roads.
      return straight
    } finally {
      roadInflight.delete(key)
    }
  })()

  roadInflight.set(key, pending)
  return pending
}

export type LegGeometries = {
  flight: Array<[number, number]>[]
  drive: Array<[number, number]>[]
}

function legsFingerprint(legs: TripRouteLeg[]): string {
  return legs
    .map(
      (l) =>
        `${l.kind}:${l.from.lon.toFixed(4)},${l.from.lat.toFixed(4)}>${l.to.lon.toFixed(4)},${l.to.lat.toFixed(4)}`,
    )
    .join('|')
}

/** Last successful geometries — used so remounts don't flash straight placeholders. */
const geometryByLegs = new Map<string, LegGeometries>()

export function peekLegGeometries(legs: TripRouteLeg[]): LegGeometries | null {
  return geometryByLegs.get(legsFingerprint(legs)) ?? null
}

export async function buildLegGeometries(legs: TripRouteLeg[]): Promise<LegGeometries> {
  const fp = legsFingerprint(legs)
  const flight: Array<[number, number]>[] = []
  const driveLegs = legs.filter((l) => l.kind === 'drive')
  for (const leg of legs) {
    if (leg.kind === 'flight') flight.push(greatCircleLine(leg.from, leg.to))
  }
  const drive = await Promise.all(driveLegs.map((l) => fetchRoadLine(l.from, l.to)))
  const result = { flight, drive }
  geometryByLegs.set(fp, result)
  return result
}

/** Point ~halfway along a polyline + bearing (degrees) for mode icons. */
export function midpointAlongLine(
  coords: Array<[number, number]>,
): { coord: [number, number]; bearing: number } | null {
  if (coords.length < 2) return null
  let total = 0
  const segLens: number[] = []
  for (let i = 1; i < coords.length; i++) {
    const a = { lon: coords[i - 1][0], lat: coords[i - 1][1] }
    const b = { lon: coords[i][0], lat: coords[i][1] }
    const len = haversineKm(a, b)
    segLens.push(len)
    total += len
  }
  if (total < 1e-6) {
    return { coord: coords[0], bearing: 0 }
  }
  let remain = total / 2
  for (let i = 0; i < segLens.length; i++) {
    if (remain > segLens[i] && i < segLens.length - 1) {
      remain -= segLens[i]
      continue
    }
    const a = coords[i]
    const b = coords[i + 1]
    const t = segLens[i] < 1e-9 ? 0 : remain / segLens[i]
    const lon = a[0] + (b[0] - a[0]) * t
    const lat = a[1] + (b[1] - a[1]) * t
    const bearing =
      (Math.atan2((b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), b[1] - a[1]) *
        180) /
        Math.PI
    return { coord: [lon, lat], bearing }
  }
  return { coord: coords[coords.length - 1], bearing: 0 }
}

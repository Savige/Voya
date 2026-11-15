import { getAirportByIata } from './data/airportLookup'
import type {
  CarBooking,
  FlightBooking,
  RestaurantBooking,
  Stay,
  StayActivity,
  VisitPlace,
} from './tripTypes'

/** Filter toggles on the Map tab — must match UI. */
export type MapCategory = 'accommodation' | 'place' | 'flight' | 'rental' | 'dining' | 'activity'

export const MAP_CATEGORIES: MapCategory[] = [
  'accommodation',
  'place',
  'flight',
  'rental',
  'dining',
  'activity',
]

export const MAP_CATEGORY_LABELS: Record<MapCategory, string> = {
  accommodation: 'Accommodation',
  place: 'Places to visit',
  flight: 'Flights',
  rental: 'Rental cars',
  dining: 'Dining',
  activity: 'Stops',
}

/** Short map legend text (client-facing). */
export const MAP_LEGEND_LABELS: Record<MapCategory, string> = {
  accommodation: 'Your stays',
  place: 'Places you saved',
  flight: 'Flight airports',
  rental: 'Car pickup and drop-off',
  dining: 'Restaurant bookings',
  activity: 'Places of interest',
}

/** Visual marker variant for DOM marker content. */
export type MapMarkerKind = 'stay' | 'place' | 'flight' | 'rental' | 'restaurant' | 'activity'

export type MapPoint = {
  key: string
  label: string
  markerKind: MapMarkerKind
  category: MapCategory
  addressHint?: string
  lat?: number
  lon?: number
  startDate?: string
  endDate?: string
}

export const defaultMapCategoryVisibility = (): Record<MapCategory, boolean> =>
  ({
    accommodation: true,
    place: false,
    flight: true,
    rental: true,
    dining: true,
    activity: true,
  }) as Record<MapCategory, boolean>

function parseIsoDate(iso?: string): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function parseTimeToMinutes(time: string): number | null {
  const t = time.trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

function tsFromIso(iso?: string, fallback = 0) {
  return parseIsoDate(iso)?.getTime() ?? fallback
}

function dayStartTs(iso?: string, fallback = 0) {
  return parseIsoDate(iso)?.getTime() ?? fallback
}

function dayEndTs(iso?: string, fallback = 0) {
  const d = parseIsoDate(iso)
  if (!d) return fallback
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function pointTs(iso?: string, time?: string, fallback = 0) {
  const d = parseIsoDate(iso)
  if (!d) return fallback
  const mins = parseTimeToMinutes(time ?? '')
  if (mins !== null) d.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
  return d.getTime()
}

function activityGeocodeQuery(a: StayActivity, country: string): string {
  const pl = (a.placeLabel ?? '').trim()
  if (pl) return pl
  const n = (a.notes ?? '').trim()
  if (n) return n
  const name = (a.name ?? '').trim()
  if (name) return country ? `${name} ${country}` : name
  return ''
}

export function buildMapPointsFromTrip(
  stays: Stay[],
  visitPlaces: VisitPlace[],
  flights: FlightBooking[],
  rentalCars: CarBooking[],
  restaurants: RestaurantBooking[],
  country: string,
): MapPoint[] {
  const out: MapPoint[] = []
  const cc = country.trim()

  for (const s of stays) {
    out.push({
      key: `stay:${s.id}`,
      label: s.location,
      markerKind: 'stay',
      category: 'accommodation',
      addressHint:
        s.accommodations?.find((a) => a.confirmationRef.trim())?.address ||
        s.accommodations?.[0]?.address ||
        s.location,
      startDate: s.startDate,
      endDate: s.endDate,
      lat: s.lat,
      lon: s.lon,
    })
  }

  for (const p of visitPlaces) {
    out.push({
      key: `place:${p.id}`,
      label: p.label,
      markerKind: 'place',
      category: 'place',
      lat: p.lat,
      lon: p.lon,
    })
  }

  for (const f of flights) {
    if (!f.confirmation.trim()) continue
    const fromA = f.fromIata ? getAirportByIata(f.fromIata) : undefined
    const toA = f.toIata ? getAirportByIata(f.toIata) : undefined
    if (fromA) {
      out.push({
        key: `flight:${f.id}:from`,
        label: `${f.fromIata} · ${fromA.city} (dep)`,
        markerKind: 'flight',
        category: 'flight',
        addressHint: `${fromA.name} ${fromA.city} ${fromA.country}`,
        lat: fromA.lat,
        lon: fromA.lon,
      })
    }
    if (toA) {
      out.push({
        key: `flight:${f.id}:to`,
        label: `${f.toIata} · ${toA.city} (arr)`,
        markerKind: 'flight',
        category: 'flight',
        addressHint: `${toA.name} ${toA.city} ${toA.country}`,
        lat: toA.lat,
        lon: toA.lon,
      })
    }
  }

  for (const c of rentalCars) {
    if (!c.confirmation.trim()) continue
    const pick = (c.pickupLocation ?? '').trim()
    if (pick) {
      out.push({
        key: `rental:${c.id}:pickup`,
        label: `Pickup · ${c.company}`,
        markerKind: 'rental',
        category: 'rental',
        addressHint: cc ? `${pick} ${cc}` : pick,
        lat: c.pickupLat,
        lon: c.pickupLon,
      })
    }
    const drop = (c.dropoffLocation ?? '').trim()
    if (drop) {
      out.push({
        key: `rental:${c.id}:dropoff`,
        label: `Dropoff · ${c.company}`,
        markerKind: 'rental',
        category: 'rental',
        addressHint: cc ? `${drop} ${cc}` : drop,
        lat: c.dropoffLat,
        lon: c.dropoffLon,
      })
    }
  }

  for (const r of restaurants) {
    if (!r.confirmation.trim()) continue
    const name = (r.name ?? '').trim()
    if (!name) continue
    out.push({
      key: `restaurant:${r.id}`,
      label: name,
      markerKind: 'restaurant',
      category: 'dining',
      addressHint: cc ? `${name} ${cc}` : name,
      lat: r.lat,
      lon: r.lon,
    })
  }

  for (const s of stays) {
    for (const a of s.activities ?? []) {
      const q = activityGeocodeQuery(a, cc)
      if (!q.trim()) continue
      out.push({
        key: `activity:${s.id}:${a.id}`,
        label: a.name || q,
        markerKind: 'activity',
        category: 'activity',
        addressHint: cc ? `${q} ${cc}` : q,
        lat: a.lat,
        lon: a.lon,
      })
    }
  }

  return out
}

type RouteEvent = { ts: number; key: string; category: MapCategory }

/** Tie-break when timestamps match: accommodation, then flight dep before arr, then key. */
function routeEventSortIndex(c: MapCategory): number {
  if (c === 'accommodation') return 0
  if (c === 'flight') return 1
  return 99
}

/**
 * Chronological keys for the trip route polyline (geodesic segments).
 * Only **accommodation** and **flight** stops — activities, visit places, rentals, and dining stay as markers only.
 */
export function buildRouteEvents(
  stays: Stay[],
  _visitPlaces: VisitPlace[],
  flights: FlightBooking[],
  _rentalCars: CarBooking[],
  _restaurants: RestaurantBooking[],
  _country: string,
  visibility: Record<MapCategory, boolean>,
): RouteEvent[] {
  const events: RouteEvent[] = []

  const pushIf = (category: MapCategory, ts: number, key: string) => {
    if (!visibility[category]) return
    if (!Number.isFinite(ts)) return
    events.push({ ts, key, category })
  }

  for (const s of stays) {
    const primary =
      s.accommodations?.find((a) => a.confirmationRef.trim()) || s.accommodations?.[0] || null
    const cinT = (primary?.checkInTime ?? '').trim()
    const hasCin = cinT.length > 0 && parseTimeToMinutes(cinT) !== null
    const start = (primary?.checkIn || s.startDate || '').trim()
    const ts =
      start && hasCin ? pointTs(start, cinT, s.createdAt) : tsFromIso(start || s.startDate, s.createdAt)
    pushIf('accommodation', ts, `stay:${s.id}`)
  }

  for (const f of flights) {
    if (!f.confirmation.trim()) continue
    const depT = (f.departTime ?? '').trim()
    const arrT = (f.arriveTime ?? '').trim()
    const arrDate = (f.arriveDate || f.departDate || '').trim()
    const depTs =
      f.departDate && depT && parseTimeToMinutes(depT) !== null
        ? pointTs(f.departDate, depT, f.createdAt)
        : dayStartTs(f.departDate, f.createdAt)
    const arrTs =
      arrDate && arrT && parseTimeToMinutes(arrT) !== null
        ? pointTs(arrDate, arrT, f.createdAt)
        : arrDate
          ? dayEndTs(arrDate, f.createdAt)
          : depTs
    const fromA = f.fromIata ? getAirportByIata(f.fromIata) : undefined
    const toA = f.toIata ? getAirportByIata(f.toIata) : undefined
    if (fromA) pushIf('flight', depTs, `flight:${f.id}:from`)
    if (toA) pushIf('flight', arrTs, `flight:${f.id}:to`)
  }

  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts
    const ca = routeEventSortIndex(a.category)
    const cb = routeEventSortIndex(b.category)
    if (ca !== cb) return ca - cb
    return a.key.localeCompare(b.key)
  })

  return events
}

/** Remove consecutive duplicate coordinates (same lat/lng). */
export function dedupePath(points: Array<{ lat: number; lng: number }>, eps = 1e-5): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.lat - p.lat) < eps &&
      Math.abs(last.lng - p.lng) < eps
    ) {
      continue
    }
    out.push(p)
  }
  return out
}

export type RouteEventLite = { ts: number; key: string }

/** Map route keys to coordinates in order, dropping consecutive duplicate positions. */
export function buildRoutePointsWithTs(
  events: RouteEventLite[],
  coordByKey: Map<string, { lat: number; lng: number }>,
): Array<{ lat: number; lng: number; ts: number }> {
  const out: Array<{ lat: number; lng: number; ts: number }> = []
  for (const e of events) {
    const c = coordByKey.get(e.key)
    if (!c) continue
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.lat - c.lat) < 1e-5 &&
      Math.abs(last.lng - c.lng) < 1e-5
    ) {
      continue
    }
    out.push({ lat: c.lat, lng: c.lng, ts: e.ts })
  }
  return out
}

/**
 * First calendar day of the “return” leg for styling: earliest non-empty flight `returnDate`,
 * otherwise trip `endDate`. If none, no split (entire route is solid outbound).
 */
export function resolveReturnThresholdTs(
  flights: FlightBooking[],
  tripEndDate: string | undefined,
): number | null {
  const fromDates: number[] = []
  for (const f of flights) {
    const rd = (f.returnDate ?? '').trim()
    if (rd && parseIsoDate(rd)) fromDates.push(dayStartTs(rd, 0))
  }
  if (fromDates.length > 0) return Math.min(...fromDates)

  const end = (tripEndDate ?? '').trim()
  if (end && parseIsoDate(end)) return dayStartTs(end, 0)
  return null
}

/**
 * Split path into outbound (before return day) and return (from that day on).
 * The last outbound point is repeated as the first return point so the two polylines meet.
 */
export function splitOutboundReturnPath(
  points: Array<{ lat: number; lng: number; ts: number }>,
  thresholdTs: number | null,
): { outbound: Array<{ lat: number; lng: number }>; ret: Array<{ lat: number; lng: number }> } {
  if (thresholdTs === null || points.length === 0) {
    return {
      outbound: points.map(({ lat, lng }) => ({ lat, lng })),
      ret: [],
    }
  }
  const k = points.findIndex((p) => p.ts >= thresholdTs)
  if (k === -1) {
    return { outbound: points.map(({ lat, lng }) => ({ lat, lng })), ret: [] }
  }
  if (k === 0) {
    return { outbound: [], ret: points.map(({ lat, lng }) => ({ lat, lng })) }
  }
  const outbound = points.slice(0, k).map(({ lat, lng }) => ({ lat, lng }))
  const ret = points.slice(k - 1).map(({ lat, lng }) => ({ lat, lng }))
  return { outbound, ret }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import {
  BedDouble,
  Car,
  ChevronRight,
  Flag,
  GripVertical,
  Home,
  MapPin,
  Minus,
  MoreHorizontal,
  Plane,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { getAirportByIata } from './data/airportLookup'
import { fetchLocationPhoto, peekLocationPhotoCache } from './locationPhotos'
import { fetchDrivingStats, haversineKm as mapHaversineKm } from './mapTripRoute'
import { usePlaceSuggestions } from './placesHooks'
import type { PlaceSuggestion } from './placesTypes'
import type { CarBooking, FlightBooking, Stay } from './tripTypes'
import {
  stayConfirmedAccommodations,
  stayHasAccommodation,
  stayLodgingCoverage,
} from './tripTypes'

const STAY_AVATAR_OPTS = { pick: 'best' as const, thumbWidth: 256, purpose: 'avatar' as const }

function stayPhotoQuery(location: string, tripCountry?: string): string {
  const place = location.trim()
  if (!place) return ''
  const country = (tripCountry || '').trim()
  if (!country) return place
  if (place.toLowerCase().includes(country.toLowerCase())) return place
  return `${place}, ${country}`
}

function StayLocationAvatar({
  location,
  tripCountry,
  index,
}: {
  location: string
  tripCountry?: string
  index: number
}) {
  const query = stayPhotoQuery(location, tripCountry)
  const initial = (location.trim()[0] || '?').toUpperCase()
  const [url, setUrl] = useState<string | null>(() =>
    query ? peekLocationPhotoCache(query, STAY_AVATAR_OPTS) : null,
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!query) {
      setUrl(null)
      setFailed(false)
      return
    }
    let cancelled = false
    setFailed(false)
    const cached = peekLocationPhotoCache(query, STAY_AVATAR_OPTS)
    if (cached) setUrl(cached)
    fetchLocationPhoto(query, STAY_AVATAR_OPTS).then((next) => {
      if (cancelled) return
      setUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [query])

  const showPhoto = Boolean(url) && !failed

  return (
    <div className="relative shrink-0">
      <div className="relative flex h-14 w-14 overflow-hidden rounded-full bg-gradient-to-br from-sky-800 to-indigo-800 text-lg font-bold text-white shadow-inner ring-2 ring-neutral-950">
        {showPhoto ? (
          <img
            src={url!}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">{initial}</span>
        )}
      </div>
      <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
        {index + 1}
      </span>
    </div>
  )
}

const parseIsoDate = (iso?: string) => {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const toIsoDate = (d?: Date | null) => {
  if (!d) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const addDaysIso = (iso: string, days: number) => {
  const d = parseIsoDate(iso)
  if (!d) return iso
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

/** Signed whole-day delta from `fromIso` to `toIso` (negative if to is earlier). */
const dayDiffIso = (fromIso: string, toIso: string) => {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  if (!from || !to) return 0
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

/** Inclusive nights between check-in and check-out. */
export const nightsBetween = (startIso?: string, endIso?: string) => {
  const start = parseIsoDate(startIso)
  const end = parseIsoDate(endIso)
  if (!start || !end) return 0
  const ms = end.getTime() - start.getTime()
  if (ms <= 0) return 0
  return Math.round(ms / 86400000)
}

const sortStays = (stays: Stay[]) =>
  [...stays].sort((a, b) => {
    const byDate = (a.startDate || '').localeCompare(b.startDate || '')
    if (byDate !== 0) return byDate
    return a.createdAt - b.createdAt
  })

/** Next 1-night window after the last stop (or trip start). */
export function nextAvailableStayWindow(
  stays: Stay[],
  tripStart?: string,
  tripEnd?: string,
): { startDate: string; endDate: string } | null {
  if (!tripStart || !tripEnd || tripEnd <= tripStart) return null
  const ordered = sortStays(stays)
  let start = tripStart
  if (ordered.length > 0) {
    const last = ordered[ordered.length - 1]
    if (last.endDate) start = last.endDate
  }
  if (start >= tripEnd) {
    start = addDaysIso(tripEnd, -1)
    if (start < tripStart) start = tripStart
  }
  let end = addDaysIso(start, 1)
  if (end > tripEnd) end = tripEnd
  if (end <= start) return null
  return { startDate: start, endDate: end }
}

export type StayDatePatch = { id: string; startDate: string; endDate: string }

/**
 * Insert a 1-night stop at a timeline plus position.
 * - `beforeStayId`: place on the boundary day (trip start / previous end), shift that stay + later by +1 day
 * - omit / undefined: append after the last stop (no shift)
 */
export function planDestinationInsert(
  stays: Stay[],
  tripStart?: string,
  tripEnd?: string,
  beforeStayId?: string,
): { window: { startDate: string; endDate: string }; shifts: StayDatePatch[] } | null {
  if (!tripStart || !tripEnd || tripEnd <= tripStart) return null
  const ordered = sortStays(stays)

  if (!beforeStayId) {
    const window = nextAvailableStayWindow(ordered, tripStart, tripEnd)
    if (!window) return null
    return { window, shifts: [] }
  }

  const idx = ordered.findIndex((s) => s.id === beforeStayId)
  if (idx < 0) return null
  const target = ordered[idx]
  const prev = idx > 0 ? ordered[idx - 1] : null
  const start = prev?.endDate || tripStart || target.startDate
  if (!start) return null
  const end = addDaysIso(start, 1)
  if (end > tripEnd) return null

  const shifts: StayDatePatch[] = []
  for (let j = idx; j < ordered.length; j++) {
    const s = ordered[j]
    if (!s.startDate || !s.endDate) continue
    const nextStart = addDaysIso(s.startDate, 1)
    const nextEnd = addDaysIso(s.endDate, 1)
    if (nextEnd > tripEnd) return null
    if (tripStart && nextStart < tripStart) return null
    shifts.push({ id: s.id, startDate: nextStart, endDate: nextEnd })
  }

  return { window: { startDate: start, endDate: end }, shifts }
}

/**
 * Change nights on one stop; later stops shift by the same day delta.
 * Returns null when the change isn't possible within trip bounds.
 */
export function planNightAdjust(
  stays: Stay[],
  stayId: string,
  delta: number,
  tripStartDate?: string,
  tripEndDate?: string,
): StayDatePatch[] | null {
  const ordered = sortStays(stays)
  const idx = ordered.findIndex((s) => s.id === stayId)
  if (idx < 0) return null
  const stay = ordered[idx]
  if (!stay.startDate || !stay.endDate) return null
  const current = nightsBetween(stay.startDate, stay.endDate)
  const nextNights = Math.max(1, current + delta)
  let nextEnd = addDaysIso(stay.startDate, nextNights)
  if (nextEnd <= stay.startDate) nextEnd = addDaysIso(stay.startDate, 1)
  let shift = dayDiffIso(stay.endDate, nextEnd)

  if (shift > 0 && tripEndDate) {
    let maxShift = dayDiffIso(stay.endDate, tripEndDate)
    for (let j = idx + 1; j < ordered.length; j++) {
      const s = ordered[j]
      if (!s.endDate) continue
      maxShift = Math.min(maxShift, dayDiffIso(s.endDate, tripEndDate))
    }
    maxShift = Math.max(0, maxShift)
    if (shift > maxShift) {
      shift = maxShift
      nextEnd = addDaysIso(stay.endDate, shift)
    }
  }

  if (shift < 0 && tripStartDate) {
    let minShift = shift
    for (let j = idx + 1; j < ordered.length; j++) {
      const s = ordered[j]
      if (!s.startDate) continue
      minShift = Math.max(minShift, dayDiffIso(s.startDate, tripStartDate))
    }
    if (shift < minShift) {
      shift = minShift
      nextEnd = addDaysIso(stay.endDate, shift)
    }
  }

  if (nextEnd <= stay.startDate) return null
  if (shift === 0 && nextEnd === stay.endDate) return null

  const patches: StayDatePatch[] = [{ id: stay.id, startDate: stay.startDate, endDate: nextEnd }]
  for (let j = idx + 1; j < ordered.length; j++) {
    const s = ordered[j]
    if (!s.startDate || !s.endDate) continue
    patches.push({
      id: s.id,
      startDate: addDaysIso(s.startDate, shift),
      endDate: addDaysIso(s.endDate, shift),
    })
  }

  // Final bound check — never emit patches App would silently reject.
  for (const p of patches) {
    if (!p.startDate || !p.endDate || p.endDate <= p.startDate) return null
    if (tripStartDate && p.startDate < tripStartDate) return null
    if (tripEndDate && p.endDate > tripEndDate) return null
  }
  return patches
}

/**
 * Delete a stop and pull later stops earlier by its night count (closes the gap).
 */
export function planDestinationDelete(
  stays: Stay[],
  stayId: string,
  tripStart?: string,
): { removeId: string; shifts: StayDatePatch[] } | null {
  const ordered = sortStays(stays)
  const idx = ordered.findIndex((s) => s.id === stayId)
  if (idx < 0) return null
  const removed = ordered[idx]
  const nights = nightsBetween(removed.startDate, removed.endDate)
  const shifts: StayDatePatch[] = []
  if (nights > 0) {
    for (let j = idx + 1; j < ordered.length; j++) {
      const s = ordered[j]
      if (!s.startDate || !s.endDate) continue
      let nextStart = addDaysIso(s.startDate, -nights)
      let nextEnd = addDaysIso(s.endDate, -nights)
      if (tripStart && nextStart < tripStart) {
        const clamp = dayDiffIso(nextStart, tripStart)
        nextStart = addDaysIso(nextStart, clamp)
        nextEnd = addDaysIso(nextEnd, clamp)
      }
      if (nextEnd <= nextStart) nextEnd = addDaysIso(nextStart, 1)
      shifts.push({ id: s.id, startDate: nextStart, endDate: nextEnd })
    }
  }
  return { removeId: stayId, shifts }
}

const formatShortRange = (startIso?: string, endIso?: string) => {
  const start = parseIsoDate(startIso)
  const end = parseIsoDate(endIso)
  if (!start && !end) return 'Dates not set'
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '')
  if (start && end) {
    if (
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate()
    ) {
      return fmt(start)
    }
    const left = start
      .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
      .replace(',', '')
    const right = end
      .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
      .replace(',', '')
    return `${left} - ${right}`
  }
  return fmt((start ?? end)!)
}

const formatTripHeaderRange = (startIso?: string, endIso?: string) => {
  const start = parseIsoDate(startIso)
  const end = parseIsoDate(endIso)
  if (!start || !end) return 'Set trip dates'
  const a = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const b = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${a} - ${b}`
}

const formatStartLabel = (iso?: string) => {
  const d = parseIsoDate(iso)
  if (!d) return 'Set a start date'
  return d
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/,/g, '')
}

const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

const formatDriveDurationMin = (totalMin: number) => {
  const min = Math.max(1, Math.round(totalMin))
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h <= 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const stayCoords = (stay: Stay): { lat: number; lon: number } | null => {
  if (typeof stay.lat === 'number' && typeof stay.lon === 'number') return { lat: stay.lat, lon: stay.lon }
  return null
}

const flightIncomplete = (f: FlightBooking) =>
  !f.confirmation.trim() || !f.departDate || !f.fromIata || !f.toIata

const flightLabel = (f: FlightBooking) => {
  const num = (f.flightNumber || '').trim().replace(/\s+/g, '').toUpperCase()
  const airlineName = f.airline.trim()
  // Full designator already (NZ248 / U2123) — letter-containing IATA only.
  if (/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/i.test(num)) return num
  if (num && /^\d{1,4}[A-Z]?$/i.test(num)) {
    const fromName = airlineName.match(/\b([A-Z][A-Z0-9]|[0-9][A-Z])\b/i)
    if (fromName) return `${fromName[1].toUpperCase()}${num}`
  }
  if (/\b(?:[A-Z][A-Z0-9]|[0-9][A-Z])\s?\d{1,4}[A-Z]?\b/i.test(airlineName)) {
    return airlineName.replace(/\s+/g, '').toUpperCase()
  }
  const conf = f.confirmation.trim().replace(/\s+/g, '').toUpperCase()
  if (/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/i.test(conf)) return conf
  if (f.fromIata && f.toIata) return `${f.fromIata}→${f.toIata}`
  return airlineName || f.route || 'Flight'
}

const stayMatchesAirport = (stay: Stay, iata: string) => {
  const code = iata.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return false
  const ap = getAirportByIata(code)
  const loc = (stay.location || '').toLowerCase()
  if (loc.includes(code.toLowerCase())) return true
  if (ap?.city && loc.includes(ap.city.toLowerCase())) return true
  if (
    ap &&
    typeof stay.lat === 'number' &&
    typeof stay.lon === 'number' &&
    typeof ap.lat === 'number' &&
    typeof ap.lon === 'number'
  ) {
    return haversineKm({ lat: stay.lat, lon: stay.lon }, { lat: ap.lat, lon: ap.lon }) <= 120
  }
  return false
}

type TransportLeg =
  | { kind: 'flight'; flight: FlightBooking }
  | {
      kind: 'drive'
      from: { lat: number; lon: number }
      to: { lat: number; lon: number }
      car?: CarBooking
    }
  | { kind: 'empty' }

type RouteGap = {
  key: string
  from: Stay | null
  to: Stay | null
}

function scoreFlightForGap(f: FlightBooking, gap: RouteGap): number {
  if (!f.departDate) return -1
  let score = 0
  if (gap.from && stayMatchesAirport(gap.from, f.fromIata)) score += 4
  if (gap.to && stayMatchesAirport(gap.to, f.toIata)) score += 4

  if (gap.from && gap.to) {
    const start = addDaysIso(gap.from.endDate, -1)
    const end = addDaysIso(gap.to.startDate, 1)
    if (f.departDate >= start && f.departDate <= end) score += 2
  } else if (!gap.from && gap.to) {
    // Inbound to first stop (or only stop)
    if (f.departDate <= addDaysIso(gap.to.startDate, 1)) score += 2
  } else if (gap.from && !gap.to) {
    if (f.departDate >= addDaysIso(gap.from.endDate, -1)) score += 2
  }

  return score
}

/**
 * Timeline gaps keyed to the + row they sit on:
 * - before:<stayId> — inbound to that stop (from previous stop or trip start)
 * - after:<lastId> — outbound after the last stop (shown on the end + row)
 */
function buildRouteGaps(stays: Stay[]): RouteGap[] {
  if (stays.length === 0) return [{ key: 'empty', from: null, to: null }]
  const gaps: RouteGap[] = []
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

/** Assign each flight to at most one timeline gap (best airport + date fit). */
function assignFlightsToGaps(stays: Stay[], flights: FlightBooking[]): Map<string, FlightBooking[]> {
  const gaps = buildRouteGaps(stays)
  const out = new Map<string, FlightBooking[]>()
  for (const g of gaps) out.set(g.key, [])

  const sorted = [...flights]
    .filter((f) => Boolean(f.departDate))
    .sort((a, b) => (a.departDate + a.departTime).localeCompare(b.departDate + b.departTime))

  for (const f of sorted) {
    let best: RouteGap | null = null
    let bestScore = 0
    for (const g of gaps) {
      const s = scoreFlightForGap(f, g)
      if (s > bestScore) {
        bestScore = s
        best = g
      }
    }
    if (best && bestScore >= 2) {
      out.get(best.key)!.push(f)
      continue
    }
    // Park unmatched flights on a terminal gap only — never a mid-route drive gap.
    const terminal =
      gaps.find((g) => !g.from && g.to) || gaps.find((g) => g.from && !g.to) || null
    if (terminal) out.get(terminal.key)!.push(f)
  }
  return out
}

function pickDriveBetween(
  from: Stay,
  to: Stay,
  cars: CarBooking[],
): Extract<TransportLeg, { kind: 'drive' }> | null {
  const windowStart = from.endDate
  const windowEnd = to.startDate
  const overlappingCars = cars.filter((c) => {
    if (!c.pickupDate || !c.dropoffDate) return false
    if (!windowStart || !windowEnd) return false
    return c.pickupDate <= windowEnd && c.dropoffDate >= windowStart
  })

  const fromPos = stayCoords(from)
  const toPos = stayCoords(to)
  if (fromPos && toPos) {
    const km = Math.round(haversineKm(fromPos, toPos))
    if (km >= 15) {
      return {
        kind: 'drive',
        from: fromPos,
        to: toPos,
        car: overlappingCars[0],
      }
    }
  } else if (overlappingCars[0]) {
    // No coords — still surface the rental chip without a distance estimate.
    return {
      kind: 'drive',
      from: { lat: 0, lon: 0 },
      to: { lat: 0, lon: 0 },
      car: overlappingCars[0],
    }
  }
  return null
}

type PlusMenuKey = 'empty' | 'end' | `before:${string}`

function TimelineFlightChip({
  flight,
  onOpen,
}: {
  flight: FlightBooking
  onOpen?: (flightId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(flight.id)}
      className="inline-flex items-center gap-2 rounded-full border border-slate-500 bg-neutral-950 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-neutral-900"
    >
      <Plane size={15} className="text-sky-300" aria-hidden />
      {flightLabel(flight)}
      {flightIncomplete(flight) ? (
        <TriangleAlert size={14} className="text-amber-300" aria-label="Incomplete booking" />
      ) : null}
    </button>
  )
}

function googleMapsDrivingUrl(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): string {
  const origin = `${from.lat},${from.lon}`
  const destination = `${to.lat},${to.lon}`
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`
}

function TimelineDriveChip({
  leg,
}: {
  leg: Extract<TransportLeg, { kind: 'drive' }>
}) {
  const hasCoords =
    Number.isFinite(leg.from.lat) &&
    Number.isFinite(leg.from.lon) &&
    Number.isFinite(leg.to.lat) &&
    Number.isFinite(leg.to.lon) &&
    !(leg.from.lat === 0 && leg.from.lon === 0 && leg.to.lat === 0 && leg.to.lon === 0)
  const fallbackKm = hasCoords ? Math.round(mapHaversineKm(leg.from, leg.to)) : 0
  const [label, setLabel] = useState(
    hasCoords ? `${fallbackKm}km · …` : leg.car?.company || 'Drive',
  )

  useEffect(() => {
    if (!hasCoords) return
    let alive = true
    void fetchDrivingStats(leg.from, leg.to).then((stats) => {
      if (!alive) return
      if (!stats) {
        // OSRM unavailable — keep crow-flies distance, mark time as approximate.
        setLabel(`${fallbackKm}km • ~${formatDriveDurationMin((fallbackKm / 70) * 60)}`)
        return
      }
      setLabel(`${stats.distanceKm}km • ${formatDriveDurationMin(stats.durationMin)}`)
    })
    return () => {
      alive = false
    }
  }, [hasCoords, leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon, fallbackKm])

  const className =
    'inline-flex items-center gap-2 rounded-full border border-slate-500 bg-neutral-950 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-neutral-900'

  if (!hasCoords) {
    return (
      <span className={className} title="Driving leg">
        <Car size={15} className="text-emerald-300" aria-hidden />
        {label}
      </span>
    )
  }

  return (
    <a
      href={googleMapsDrivingUrl(leg.from, leg.to)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open driving directions in Google Maps"
      className={className}
    >
      <Car size={15} className="text-emerald-300" aria-hidden />
      {label}
    </a>
  )
}

function parseSuggestionParts(sug: PlaceSuggestion) {
  const parts = sug.label
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const name = (sug.name || parts[0] || sug.label).trim()
  const country = (sug.country || (parts.length > 1 ? parts[parts.length - 1] : '') || '').trim()
  const region =
    (sug.region ||
      (parts.length > 2 ? parts.slice(1, -1).join(', ') : parts.length === 2 ? '' : '') ||
      ''
    ).trim()
  return { name, country, region, countryCode: (sug.countryCode || '').trim().toLowerCase() }
}

function CountryFlag({ countryCode, country }: { countryCode?: string; country?: string }) {
  const cc = (countryCode || '').toLowerCase()
  if (/^[a-z]{2}$/.test(cc)) {
    return (
      <span className="relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-slate-600 bg-neutral-800 shadow-inner">
        <img
          src={`https://flagcdn.com/w80/${cc}.png`}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      </span>
    )
  }
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-neutral-800 text-sm"
      title={country || undefined}
      aria-hidden
    >
      🌍
    </span>
  )
}

function InlineDestinationPrompt({
  tripCountry,
  onCancel,
  onPick,
}: {
  tripCountry?: string
  onCancel: () => void
  onPick: (input: { location: string; lat?: number; lon?: number }) => void
}) {
  const [query, setQuery] = useState('')
  const [showIdeas, setShowIdeas] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const searchQuery = query.trim().length >= 2 ? query : showIdeas ? tripCountry || '' : ''
  const placeSearch = usePlaceSuggestions(searchQuery)
  const suggestions = placeSearch.suggestions.slice(0, 8)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setHighlightIndex(0)
  }, [searchQuery, suggestions.length])

  const commit = (raw: string, sug?: PlaceSuggestion) => {
    const parts = sug ? parseSuggestionParts(sug) : null
    const placeName = (parts?.name || raw.trim()).trim()
    if (!placeName) return
    onPick({
      location: placeName,
      lat: typeof sug?.lat === 'number' ? sug.lat : undefined,
      lon: typeof sug?.lon === 'number' ? sug.lon : undefined,
    })
  }

  return (
    <div className="relative mb-3 flex gap-3 sm:gap-4">
      <div className="h-10 w-10 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 rounded-2xl border border-slate-500 bg-neutral-950 p-3 shadow-md sm:p-4">
        {placeSearch.autocompleteError ? (
          <p className="mb-2 text-xs text-rose-400">{placeSearch.autocompleteError}</p>
        ) : null}

        {suggestions.length > 0 ? (
          <ul
            className="mb-3 max-h-64 overflow-y-auto rounded-2xl border border-slate-500 bg-neutral-900 py-1 shadow-lg"
            role="listbox"
            aria-label="Destination suggestions"
          >
            {suggestions.map((sug, index) => {
              const { name, country, region, countryCode } = parseSuggestionParts(sug)
              const active = index === highlightIndex
              return (
                <li key={sug.key} role="option" aria-selected={active}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-sky-800 ring-1 ring-inset ring-sky-400'
                        : 'hover:bg-neutral-800'
                    }`}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => commit(sug.label, sug)}
                  >
                    <CountryFlag countryCode={countryCode} country={country} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-white">
                        {name}
                      </span>
                      {(country || region) ? (
                        <span className="mt-0.5 block truncate text-sm text-slate-200">
                          {country ? <span className="font-medium text-slate-100">{country}</span> : null}
                          {country && region ? <span className="text-slate-400"> · </span> : null}
                          {region ? <span className="text-slate-300">{region}</span> : null}
                        </span>
                      ) : (
                        <span className="mt-0.5 block truncate text-sm text-slate-300">{sug.label}</span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const picked = suggestions[highlightIndex]
            if (picked) commit(picked.label, picked)
            else commit(query)
          }}
        >
          <label className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-500"
              aria-hidden
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setShowIdeas(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  if (suggestions.length === 0) return
                  setHighlightIndex((i) => (i + 1) % suggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (suggestions.length === 0) return
                  setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  if (query) setQuery('')
                  else onCancel()
                }
              }}
              placeholder="Destinations or coordinates"
              className="w-full rounded-full border-2 border-sky-500 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-sky-400 dark:bg-neutral-900 dark:text-white dark:placeholder:text-slate-500"
              autoComplete="off"
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-autocomplete="list"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setShowIdeas(false)
                  inputRef.current?.focus()
                }}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-neutral-700 dark:text-slate-200"
                aria-label="Clear search"
              >
                <X size={14} aria-hidden />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 px-2 py-2 text-sm font-semibold text-sky-500 hover:text-sky-400"
          >
            Cancel
          </button>
        </form>

        <div className="my-3 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-600" />
          <span className="text-xs text-slate-400">or</span>
          <div className="h-px flex-1 bg-slate-600" />
        </div>

        <button
          type="button"
          onClick={() => {
            setShowIdeas(true)
            if (query.trim().length < 2 && tripCountry) setQuery(tripCountry)
          }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
        >
          <Sparkles size={16} aria-hidden />
          Get suggestions
        </button>
      </div>
    </div>
  )
}

function TimelinePlusMenu({
  open,
  onToggle,
  onAddDestination,
  onAddFlight,
  menuKey,
}: {
  open: boolean
  onToggle: () => void
  onAddDestination: () => void
  onAddFlight: () => void
  menuKey: PlusMenuKey
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = rootRef.current
      const target = event.target as Node | null
      if (!node || !target) return
      if (!node.contains(target)) onToggle()
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('touchstart', onPointerDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('touchstart', onPointerDown)
    }
  }, [open, onToggle])

  return (
    <div ref={rootRef} className="relative z-20 flex h-10 w-10 shrink-0 items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-500 bg-neutral-950 text-slate-200 shadow-sm hover:bg-neutral-800"
        title="Add"
        aria-label="Add destination or flight"
        aria-expanded={open}
        data-plus-menu={menuKey}
      >
        <Plus size={16} aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-12 top-1/2 z-30 w-52 -translate-y-1/2 overflow-hidden rounded-2xl border border-slate-500 bg-neutral-950 py-1 shadow-xl sm:left-14">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium text-neutral-100 hover:bg-neutral-800"
            onClick={() => {
              onToggle()
              onAddDestination()
            }}
          >
            <MapPin size={16} className="text-sky-300" aria-hidden />
            Add a destination
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium text-neutral-100 hover:bg-neutral-800"
            onClick={() => {
              onToggle()
              onAddFlight()
            }}
          >
            <Plane size={16} className="text-slate-200" aria-hidden />
            Add a flight
          </button>
        </div>
      ) : null}
    </div>
  )
}

type TripRoutePlannerProps = {
  tripStartDate?: string
  tripEndDate?: string
  tripCountry?: string
  stays: Stay[]
  flights: FlightBooking[]
  rentalCars: CarBooking[]
  readOnly?: boolean
  /** Bump to force-open the inline destination prompt (e.g. from Itinerary). */
  openDestinationPromptToken?: number
  onOpenStay: (stayId: string) => void
  onCreateDestination: (input: {
    location: string
    lat?: number
    lon?: number
    /** Insert before this stay (timeline plus); omit to append at end. */
    beforeStayId?: string
  }) => void
  onAddAccommodation: (stayId: string, lodgingId?: string | 'new') => void
  onDeleteStay: (stayId: string) => void
  onAddFlight: () => void
  onOpenCar: (carId?: string) => void
  onUpdateStayDates: (patches: Array<{ id: string; startDate: string; endDate: string }>) => void
  /** Preferred nights +/- — App applies from latest trip state (avoids stale jumps). */
  onAdjustStayNights?: (stayId: string, delta: number) => void
  onOpenFlight?: (flightId: string) => void
}

export function TripRoutePlanner({
  tripStartDate,
  tripEndDate,
  tripCountry,
  stays,
  flights,
  rentalCars,
  readOnly,
  openDestinationPromptToken = 0,
  onOpenStay,
  onCreateDestination,
  onAddAccommodation,
  onDeleteStay,
  onAddFlight,
  onOpenCar,
  onUpdateStayDates,
  onAdjustStayNights,
  onOpenFlight,
}: TripRoutePlannerProps) {
  const [menuStayId, setMenuStayId] = useState<string | null>(null)
  const [plusMenuKey, setPlusMenuKey] = useState<PlusMenuKey | null>(null)
  const [datesStayId, setDatesStayId] = useState<string | null>(null)
  const [destinationPromptKey, setDestinationPromptKey] = useState<PlusMenuKey | null>(null)
  const datesPopoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!openDestinationPromptToken || readOnly) return
    setPlusMenuKey(null)
    setMenuStayId(null)
    setDatesStayId(null)
    setDestinationPromptKey(stays.length === 0 ? 'empty' : 'end')
  }, [openDestinationPromptToken, readOnly, stays.length])

  const orderedStays = useMemo(
    () =>
      [...stays].sort((a, b) => {
        const byDate = (a.startDate || '').localeCompare(b.startDate || '')
        if (byDate !== 0) return byDate
        return a.createdAt - b.createdAt
      }),
    [stays],
  )

  const flightsByGap = useMemo(
    () => assignFlightsToGaps(orderedStays, flights),
    [orderedStays, flights],
  )

  const outboundFlights = useMemo(() => {
    const last = orderedStays[orderedStays.length - 1]
    if (!last) return [] as FlightBooking[]
    return flightsByGap.get(`after:${last.id}`) || []
  }, [orderedStays, flightsByGap])

  const tripNights = nightsBetween(tripStartDate, tripEndDate)
  const plannedNights = orderedStays.reduce((sum, s) => sum + nightsBetween(s.startDate, s.endDate), 0)
  const progress = tripNights > 0 ? Math.min(1, plannedNights / tripNights) : 0
  const progressDeg = Math.round(progress * 360)

  const datesStay = datesStayId ? orderedStays.find((s) => s.id === datesStayId) : null
  const [draftRange, setDraftRange] = useState<DateRange | undefined>()

  useEffect(() => {
    if (!datesStay) {
      setDraftRange(undefined)
      return
    }
    setDraftRange({
      from: parseIsoDate(datesStay.startDate) ?? undefined,
      to: parseIsoDate(datesStay.endDate) ?? undefined,
    })
  }, [datesStay?.id, datesStay?.startDate, datesStay?.endDate])

  useEffect(() => {
    if (!datesStayId) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = datesPopoverRef.current
      const target = event.target as Node | null
      if (!node || !target) return
      if (!node.contains(target)) setDatesStayId(null)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('touchstart', onPointerDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('touchstart', onPointerDown)
    }
  }, [datesStayId])

  const canAdjustNights = (stay: Stay, delta: number) =>
    Boolean(planNightAdjust(orderedStays, stay.id, delta, tripStartDate, tripEndDate))

  const adjustNights = (stay: Stay, delta: number) => {
    if (readOnly) return
    if (onAdjustStayNights) {
      onAdjustStayNights(stay.id, delta)
      return
    }
    const patches = planNightAdjust(orderedStays, stay.id, delta, tripStartDate, tripEndDate)
    if (!patches) return
    onUpdateStayDates(patches)
  }

  const saveDraftDates = () => {
    if (!datesStay || !draftRange?.from || !draftRange?.to) return
    const start = toIsoDate(draftRange.from)
    const end = toIsoDate(draftRange.to)
    if (!start || !end || end <= start) return
    if (tripStartDate && start < tripStartDate) return
    if (tripEndDate && end > tripEndDate) return
    onUpdateStayDates([{ id: datesStay.id, startDate: start, endDate: end }])
    setDatesStayId(null)
  }

  const togglePlus = (key: PlusMenuKey) => {
    setMenuStayId(null)
    setDatesStayId(null)
    setPlusMenuKey((cur) => (cur === key ? null : key))
  }

  const openDestinationPrompt = (key: PlusMenuKey) => {
    setPlusMenuKey(null)
    setMenuStayId(null)
    setDatesStayId(null)
    setDestinationPromptKey(key)
  }

  const closeDestinationPrompt = () => setDestinationPromptKey(null)

  const handleCreateDestination = (input: { location: string; lat?: number; lon?: number }) => {
    const beforeStayId =
      destinationPromptKey?.startsWith('before:')
        ? destinationPromptKey.slice('before:'.length)
        : undefined
    onCreateDestination({ ...input, beforeStayId })
    setDestinationPromptKey(null)
  }

  const tripFrom = parseIsoDate(tripStartDate) ?? undefined
  const tripTo = parseIsoDate(tripEndDate) ?? undefined

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-500 bg-neutral-900 shadow-lg">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-2 pt-5 sm:px-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Build your route</p>
          <h2 className="font-serif text-2xl font-bold text-white">
            {formatTripHeaderRange(tripStartDate, tripEndDate)}
          </h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-500 bg-neutral-950 px-2.5 py-1.5 shadow-sm">
          <span
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(#22c55e ${progressDeg}deg, #64748b ${progressDeg}deg)`,
            }}
            aria-hidden
          >
            <span className="h-5 w-5 rounded-full bg-neutral-950" />
          </span>
          <span className="pr-1 text-sm font-semibold text-neutral-100">
            {plannedNights}/{tripNights || '—'} nights planned
          </span>
        </div>
      </div>

      <div className="relative px-4 pb-8 pt-4 sm:px-6">
        <div
          className="pointer-events-none absolute bottom-8 left-[2.15rem] top-6 w-px border-l border-dashed border-slate-500 sm:left-[2.65rem]"
          aria-hidden
        />

        <div className="relative mb-4 flex gap-3 sm:gap-4">
          <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-md">
            <Home size={18} aria-hidden />
          </div>
          <div className="min-w-0 pt-1">
            <p className="text-base font-bold text-white">Trip starts</p>
            <p className="text-sm text-slate-300">{formatStartLabel(tripStartDate)}</p>
          </div>
        </div>

        {orderedStays.length === 0 && !readOnly ? (
          <>
            {destinationPromptKey !== 'empty' ? (
              <div className="relative mb-4 flex items-center gap-3 sm:gap-4">
                <TimelinePlusMenu
                  menuKey="empty"
                  open={plusMenuKey === 'empty'}
                  onToggle={() => togglePlus('empty')}
                  onAddDestination={() => openDestinationPrompt('empty')}
                  onAddFlight={onAddFlight}
                />
                <p className="text-sm text-slate-300">Add a destination or flight to start the route.</p>
              </div>
            ) : null}
            {destinationPromptKey === 'empty' ? (
              <InlineDestinationPrompt
                tripCountry={tripCountry}
                onCancel={closeDestinationPrompt}
                onPick={handleCreateDestination}
              />
            ) : null}
          </>
        ) : null}

        {orderedStays.map((stay, index) => {
          const nights = nightsBetween(stay.startDate, stay.endDate)
          const prev = index > 0 ? orderedStays[index - 1] : null
          // Transport chips for this + row: inbound to this stop (from trip start or previous stop).
          const beforeFlights = flightsByGap.get(`before:${stay.id}`) || []
          // Drive sits on the same + row; never alongside a flight for the same gap.
          const driveIntoStay =
            prev && beforeFlights.length === 0 ? pickDriveBetween(prev, stay, rentalCars) : null
          const hasGapChips = beforeFlights.length > 0 || Boolean(driveIntoStay)
          const lodgings = stayConfirmedAccommodations(stay)
          const hasLodging = stayHasAccommodation(stay)
          const coverage = stayLodgingCoverage(stay)
          const lodgingGap =
            hasLodging && !coverage.fullyCovered
              ? coverage.uncoveredNights.length === 1
                ? `No accommodation for 1 night`
                : `No accommodation for ${coverage.uncoveredNights.length} nights`
              : !hasLodging && coverage.totalNights > 0
                ? 'No accommodation for this stay'
                : ''
          const beforeKey: PlusMenuKey = `before:${stay.id}`
          const datesOpen = datesStayId === stay.id
          const showPlusRow = !readOnly && destinationPromptKey !== beforeKey
          const showChipsOnlyRow = (readOnly || destinationPromptKey === beforeKey) && hasGapChips

          const gapChips = (
            <>
              {beforeFlights.map((flight) => (
                <TimelineFlightChip key={flight.id} flight={flight} onOpen={onOpenFlight} />
              ))}
              {driveIntoStay ? <TimelineDriveChip leg={driveIntoStay} /> : null}
            </>
          )

          return (
            <div key={stay.id} className="relative">
              {showPlusRow ? (
                <div className="relative mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
                  <TimelinePlusMenu
                    menuKey={beforeKey}
                    open={plusMenuKey === beforeKey}
                    onToggle={() => togglePlus(beforeKey)}
                    onAddDestination={() => openDestinationPrompt(beforeKey)}
                    onAddFlight={onAddFlight}
                  />
                  {gapChips}
                </div>
              ) : null}
              {showChipsOnlyRow ? (
                <div className="relative mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
                  <div className="h-10 w-10 shrink-0" aria-hidden />
                  {gapChips}
                </div>
              ) : null}
              {!readOnly && destinationPromptKey === beforeKey ? (
                <InlineDestinationPrompt
                  tripCountry={tripCountry}
                  onCancel={closeDestinationPrompt}
                  onPick={handleCreateDestination}
                />
              ) : null}

              <div className="relative mb-3 flex gap-3 sm:gap-4">
                <div className="relative z-10 mt-6 hidden w-5 shrink-0 text-slate-400 sm:block" aria-hidden>
                  <GripVertical size={18} />
                </div>
                <div className="min-w-0 flex-1 rounded-2xl border border-slate-500 bg-neutral-950 p-3 shadow-md sm:p-4">
                  <div className="flex items-start gap-3">
                    <StayLocationAvatar
                      location={stay.location}
                      tripCountry={tripCountry}
                      index={index}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenStay(stay.id)}
                          className="group inline-flex min-w-0 max-w-full items-center gap-1 text-left"
                        >
                          <span className="truncate font-serif text-xl font-bold text-white group-hover:underline">
                            {stay.location || 'Untitled destination'}
                          </span>
                          <ChevronRight size={18} className="shrink-0 text-slate-300" aria-hidden />
                        </button>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {lodgingGap ? (
                            <span
                              className="inline-flex max-w-[11rem] items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold leading-tight text-amber-200 sm:max-w-none sm:px-2.5 sm:text-xs"
                              title={
                                coverage.partialCoverage
                                  ? `Covered ${coverage.coveredNights} of ${coverage.totalNights} nights`
                                  : lodgingGap
                              }
                            >
                              <TriangleAlert size={12} className="shrink-0" aria-hidden />
                              <span className="truncate">{lodgingGap}</span>
                            </span>
                          ) : null}
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              disabled={readOnly}
                              onClick={() => {
                                setPlusMenuKey(null)
                                setDatesStayId(null)
                                setMenuStayId((id) => (id === stay.id ? null : stay.id))
                              }}
                              className="rounded-lg p-1.5 text-slate-300 hover:bg-neutral-800 hover:text-white disabled:opacity-50"
                              aria-label="Place options"
                            >
                              <MoreHorizontal size={18} aria-hidden />
                            </button>
                            {menuStayId === stay.id ? (
                              <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-500 bg-neutral-900 py-1 shadow-lg">
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm text-neutral-100 hover:bg-neutral-800"
                                  onClick={() => {
                                    setMenuStayId(null)
                                    onOpenStay(stay.id)
                                  }}
                                >
                                  Edit destination
                                </button>
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm text-neutral-100 hover:bg-neutral-800"
                                  onClick={() => {
                                    setMenuStayId(null)
                                    onAddAccommodation(stay.id, 'new')
                                  }}
                                >
                                  {hasLodging ? 'Add another accommodation' : 'Add accommodation'}
                                </button>
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-neutral-800"
                                  onClick={() => {
                                    setMenuStayId(null)
                                    onDeleteStay(stay.id)
                                  }}
                                >
                                  Delete destination
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="relative mt-0.5">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => {
                            setMenuStayId(null)
                            setPlusMenuKey(null)
                            setDatesStayId((id) => (id === stay.id ? null : stay.id))
                          }}
                          className="text-left text-sm text-slate-300 underline-offset-2 hover:text-white hover:underline disabled:no-underline disabled:opacity-60"
                        >
                          {formatShortRange(stay.startDate, stay.endDate)}
                        </button>
                        {datesOpen ? (
                          <div
                            ref={datesPopoverRef}
                            className="absolute left-0 z-40 mt-2 w-[min(100vw-2rem,22rem)] rounded-2xl border border-slate-500 bg-neutral-900 p-3 shadow-2xl"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-white">{stay.location || 'Place'}</p>
                                <p className="text-xs text-slate-400">
                                  {nightsBetween(
                                    toIsoDate(draftRange?.from) || stay.startDate,
                                    toIsoDate(draftRange?.to) || stay.endDate,
                                  )}{' '}
                                  night
                                  {nightsBetween(
                                    toIsoDate(draftRange?.from) || stay.startDate,
                                    toIsoDate(draftRange?.to) || stay.endDate,
                                  ) === 1
                                    ? ''
                                    : 's'}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setDatesStayId(null)}
                                className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-neutral-800"
                              >
                                Close
                              </button>
                            </div>
                            <DayPicker
                              mode="range"
                              selected={draftRange}
                              defaultMonth={draftRange?.from ?? parseIsoDate(stay.startDate) ?? tripFrom ?? new Date()}
                              captionLayout="dropdown-years"
                              navLayout="around"
                              numberOfMonths={1}
                              disabled={[
                                ...(tripFrom ? [{ before: tripFrom }] : []),
                                ...(tripTo ? [{ after: tripTo }] : []),
                              ]}
                              onDayClick={(day, modifiers) => {
                                if (modifiers.disabled) return
                                if (draftRange?.from && draftRange?.to && draftRange.from.getTime() !== draftRange.to.getTime()) {
                                  setDraftRange({ from: day, to: undefined })
                                }
                              }}
                              onSelect={(nextRange) => {
                                if (nextRange?.from && nextRange?.to && nextRange.from.getTime() === nextRange.to.getTime()) {
                                  setDraftRange({ from: nextRange.from, to: undefined })
                                  return
                                }
                                setDraftRange(nextRange)
                              }}
                              classNames={{
                                root: 'rdp-modern mx-auto',
                                month_caption: 'rdp-caption',
                                day: 'rdp-day',
                                day_button: 'rdp-day-button',
                                selected: 'rdp-selected',
                                range_start: 'rdp-range-start',
                                range_middle: 'rdp-range-middle',
                                range_end: 'rdp-range-end',
                                chevron: 'rdp-chevron',
                              }}
                            />
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setDraftRange({
                                    from: parseIsoDate(stay.startDate) ?? undefined,
                                    to: parseIsoDate(stay.endDate) ?? undefined,
                                  })
                                }}
                                className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                              >
                                Revert
                              </button>
                              <button
                                type="button"
                                onClick={saveDraftDates}
                                disabled={!draftRange?.from || !draftRange?.to}
                                className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {lodgings.map((lodging) => {
                          const label = (lodging.name || lodging.confirmationRef || 'Accommodation').trim()
                          const range =
                            lodging.checkIn && lodging.checkOut
                              ? `${formatShortRange(lodging.checkIn, lodging.checkOut)}`
                              : ''
                          return readOnly ? (
                            <p key={lodging.id} className="text-xs text-slate-400">
                              {label}
                              {range ? ` · ${range}` : ''}
                            </p>
                          ) : (
                            <button
                              key={lodging.id}
                              type="button"
                              onClick={() => onAddAccommodation(stay.id, lodging.id)}
                              className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-slate-500 bg-neutral-900 px-2.5 text-xs font-semibold text-slate-200 hover:bg-neutral-800"
                              title={range || label}
                            >
                              <BedDouble size={13} className="shrink-0 text-emerald-300" aria-hidden />
                              <span className="truncate">{label}</span>
                              {range ? (
                                <span className="shrink-0 font-medium text-slate-400">{range}</span>
                              ) : null}
                            </button>
                          )
                        })}
                        {!readOnly ? (
                          <button
                            type="button"
                            onClick={() => onAddAccommodation(stay.id, 'new')}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-slate-500 px-2.5 text-xs font-semibold text-slate-300 hover:bg-neutral-900"
                          >
                            <BedDouble size={13} aria-hidden />
                            {hasLodging ? 'Add another' : 'Add accommodation'}
                          </button>
                        ) : null}

                        <div className="inline-flex h-8 items-center gap-0.5 rounded-full border border-slate-500 bg-neutral-900 pl-0.5 pr-1">
                          <button
                            type="button"
                            disabled={readOnly || nights <= 1 || !canAdjustNights(stay, -1)}
                            onClick={() => adjustNights(stay, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-200 hover:bg-neutral-800 disabled:opacity-50"
                            aria-label="Fewer nights"
                          >
                            <Minus size={14} aria-hidden />
                          </button>
                          <span className="min-w-[4.25rem] text-center text-xs font-semibold text-neutral-100">
                            {nights} night{nights === 1 ? '' : 's'}
                          </span>
                          <button
                            type="button"
                            disabled={readOnly || !canAdjustNights(stay, 1)}
                            onClick={() => adjustNights(stay, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-200 hover:bg-neutral-800 disabled:opacity-50"
                            aria-label="More nights"
                          >
                            <Plus size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )
        })}

        {readOnly && outboundFlights.length > 0 ? (
          <div className="relative mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="h-10 w-10 shrink-0" aria-hidden />
            {outboundFlights.map((flight) => (
              <TimelineFlightChip key={flight.id} flight={flight} onOpen={onOpenFlight} />
            ))}
          </div>
        ) : null}

        {orderedStays.length > 0 && !readOnly ? (
          <>
            {destinationPromptKey !== 'end' ? (
              <div className="relative mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
                <TimelinePlusMenu
                  menuKey="end"
                  open={plusMenuKey === 'end'}
                  onToggle={() => togglePlus('end')}
                  onAddDestination={() => openDestinationPrompt('end')}
                  onAddFlight={onAddFlight}
                />
                {outboundFlights.map((flight) => (
                  <TimelineFlightChip key={flight.id} flight={flight} onOpen={onOpenFlight} />
                ))}
                <span className="text-sm font-semibold text-slate-300">Add to route</span>
              </div>
            ) : null}
            {destinationPromptKey === 'end' && outboundFlights.length > 0 ? (
              <div className="relative mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="h-10 w-10 shrink-0" aria-hidden />
                {outboundFlights.map((flight) => (
                  <TimelineFlightChip key={flight.id} flight={flight} onOpen={onOpenFlight} />
                ))}
              </div>
            ) : null}
            {destinationPromptKey === 'end' ? (
              <InlineDestinationPrompt
                tripCountry={tripCountry}
                onCancel={closeDestinationPrompt}
                onPick={handleCreateDestination}
              />
            ) : null}
          </>
        ) : null}

        <div className="relative flex gap-3 sm:gap-4">
          <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-500 bg-neutral-800 text-slate-200">
            <Flag size={16} aria-hidden />
          </div>
          <div className="min-w-0 pt-1">
            <p className="text-base font-bold text-white">Trip finishes</p>
            <p className="text-sm text-slate-300">{formatStartLabel(tripEndDate)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

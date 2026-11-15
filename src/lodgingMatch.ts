import type { ParsedBookingFields } from './bookingEmailTypes'
import type { Stay, Trip } from './tripTypes'

function datesOverlap(a0: string, a1: string, b0: string, b1: string): boolean {
  if (!a0 || !b0) return false
  const ae = a1 || a0
  const be = b1 || b0
  return a0 < be && b0 < ae
}

function isoDayDiff(start: string, end: string): number {
  if (!start || !end || end <= start) return 0
  const [ys, ms, ds] = start.split('-').map(Number)
  const [ye, me, de] = end.split('-').map(Number)
  if (!ys || !ms || !ds || !ye || !me || !de) return 0
  const a = Date.UTC(ys, ms - 1, ds)
  const b = Date.UTC(ye, me - 1, de)
  return Math.max(0, Math.round((b - a) / 86400000))
}

function overlapNights(a0: string, a1: string, b0: string, b1: string): number {
  if (!a0 || !b0) return 0
  const ae = a1 || a0
  const be = b1 || b0
  const start = a0 > b0 ? a0 : b0
  const end = ae < be ? ae : be
  return isoDayDiff(start, end)
}

function locationMatchBonus(stayLocation: string, ...hints: Array<string | undefined>): number {
  const loc = stayLocation.trim().toLowerCase()
  if (!loc) return 0
  const blob = hints
    .map((h) => String(h || '').toLowerCase())
    .filter(Boolean)
    .join(' | ')
  if (!blob) return 0
  if (blob.includes(loc)) return 12
  // Token overlap: "Franz Josef" vs "Franz Josef / Waiau"
  const tokens = loc.split(/[^a-z0-9]+/).filter((t) => t.length > 2)
  if (!tokens.length) return 0
  const hits = tokens.filter((t) => blob.includes(t)).length
  if (hits === tokens.length) return 10
  if (hits > 0) return 4
  return 0
}

/** Prefer the stay with the most overlapping nights, then name/address match. */
export function findStayForAccommodation(
  trip: Trip,
  parsed: Pick<ParsedBookingFields, 'checkIn' | 'checkOut' | 'name' | 'address' | 'location'>,
): Stay | null {
  const checkIn = (parsed.checkIn || '').trim()
  const checkOut = (parsed.checkOut || '').trim() || checkIn
  if (!checkIn) return null
  const scored = (trip.stays || [])
    .map((s) => {
      const nights = overlapNights(s.startDate || '', s.endDate || '', checkIn, checkOut)
      const overlaps = datesOverlap(s.startDate || '', s.endDate || '', checkIn, checkOut)
      if (nights <= 0 && !overlaps) return null
      const score =
        Math.max(nights, overlaps ? 1 : 0) +
        locationMatchBonus(s.location, parsed.name, parsed.address, parsed.location)
      return { stay: s, score, nights }
    })
    .filter((x): x is { stay: Stay; score: number; nights: number } => Boolean(x && x.score > 0))
    .sort((a, b) => b.score - a.score || b.nights - a.nights)
  if (!scored.length) return null
  // Exact check-in match still wins ties.
  const exact = scored.find((x) => x.stay.startDate === checkIn)
  if (exact && exact.score >= scored[0].score) return exact.stay
  return scored[0].stay
}

import { getAirportByIata } from './data/airportLookup'
import type { AirportRecord } from './data/airports'

/** Well-known IATA → IANA overrides (DST-aware via Intl). */
const TZ_BY_IATA: Record<string, string> = {
  SYD: 'Australia/Sydney',
  MEL: 'Australia/Melbourne',
  BNE: 'Australia/Brisbane',
  OOL: 'Australia/Brisbane',
  CNS: 'Australia/Brisbane',
  PER: 'Australia/Perth',
  ADL: 'Australia/Adelaide',
  DRW: 'Australia/Darwin',
  HBA: 'Australia/Hobart',
  CBR: 'Australia/Sydney',
  AKL: 'Pacific/Auckland',
  WLG: 'Pacific/Auckland',
  CHC: 'Pacific/Auckland',
  ZQN: 'Pacific/Auckland',
  DUD: 'Pacific/Auckland',
  NRT: 'Asia/Tokyo',
  HND: 'Asia/Tokyo',
  KIX: 'Asia/Tokyo',
  SIN: 'Asia/Singapore',
  HKG: 'Asia/Hong_Kong',
  BKK: 'Asia/Bangkok',
  LAX: 'America/Los_Angeles',
  SFO: 'America/Los_Angeles',
  JFK: 'America/New_York',
  EWR: 'America/New_York',
  LHR: 'Europe/London',
  LGW: 'Europe/London',
  CDG: 'Europe/Paris',
  DXB: 'Asia/Dubai',
  SJO: 'America/Costa_Rica',
}

const TZ_BY_COUNTRY: Record<string, string> = {
  NZ: 'Pacific/Auckland',
  FJ: 'Pacific/Fiji',
  SG: 'Asia/Singapore',
  HK: 'Asia/Hong_Kong',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh',
  ID: 'Asia/Jakarta',
  MY: 'Asia/Kuala_Lumpur',
  PH: 'Asia/Manila',
  IN: 'Asia/Kolkata',
  AE: 'Asia/Dubai',
  QA: 'Asia/Qatar',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  NL: 'Europe/Amsterdam',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  PT: 'Europe/Lisbon',
  US: 'America/New_York',
  CA: 'America/Toronto',
  MX: 'America/Mexico_City',
  CR: 'America/Costa_Rica',
  BR: 'America/Sao_Paulo',
  CL: 'America/Santiago',
  AR: 'America/Argentina/Buenos_Aires',
  ZA: 'Africa/Johannesburg',
}

const addDaysIso = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Resolve an IANA timezone for an airport (best-effort). */
export function tzForAirport(a: AirportRecord | undefined | null): string | null {
  if (!a) return null
  if (TZ_BY_IATA[a.iata]) return TZ_BY_IATA[a.iata]
  if (a.country === 'AU' && typeof a.lon === 'number') {
    if (a.lon < 129) return 'Australia/Perth'
    if (a.lon < 137.5) return 'Australia/Darwin'
    if (a.lon < 141) return 'Australia/Adelaide'
    if (typeof a.lat === 'number' && a.lat > -29 && a.lon > 140) return 'Australia/Brisbane'
    if (typeof a.lat === 'number' && a.lat < -40) return 'Australia/Hobart'
    return 'Australia/Sydney'
  }
  if (a.country && TZ_BY_COUNTRY[a.country]) return TZ_BY_COUNTRY[a.country]
  return null
}

export function tzForIata(iata: string): string | null {
  return tzForAirport(getAirportByIata(iata))
}

/**
 * Convert a local civil date+HH:mm in `timeZone` to a UTC epoch ms.
 * Uses Intl offset probing (no extra deps).
 */
export function localWallTimeToUtcMs(dateIso: string, timeHm: string, timeZone: string): number | null {
  const tm = timeHm.trim()
  if (!/^\d{2}:\d{2}/.test(tm) || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null
  const [hh, mm] = tm.slice(0, 5).split(':').map(Number)
  const [y, mo, d] = dateIso.split('-').map(Number)
  // Initial guess: treat as UTC, then correct by the zone's offset at that instant.
  let utc = Date.UTC(y, mo - 1, d, hh, mm, 0)
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utc))
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    const desired = Date.UTC(y, mo - 1, d, hh, mm, 0)
    const diff = asIfUtc - desired
    if (Math.abs(diff) < 1000) break
    utc -= diff
  }
  return utc
}

/**
 * Pick arrive calendar date so local arrive time at `toIata` falls after departure
 * with a plausible airborne duration (accounts for TZ / date-line).
 */
export function inferArriveDate(params: {
  fromIata: string
  toIata: string
  departDate: string
  departTime: string
  arriveTime: string
  preferDate?: string
}): string {
  const { fromIata, toIata, departDate, departTime, arriveTime, preferDate } = params
  if (!departDate || !departTime || !arriveTime) return preferDate || departDate

  const fromTz = tzForIata(fromIata)
  const toTz = tzForIata(toIata)

  // Without TZ info: classic same-day vs next-day from clock times alone.
  if (!fromTz || !toTz) {
    if (preferDate) return preferDate
    return arriveTime < departTime ? addDaysIso(departDate, 1) : departDate
  }

  const depUtc = localWallTimeToUtcMs(departDate, departTime, fromTz)
  if (depUtc == null) return preferDate || departDate

  const candidates = [0, 1, 2, -1].map((offset) => addDaysIso(departDate, offset))
  let best = preferDate || departDate
  let bestScore = Number.POSITIVE_INFINITY

  for (const cand of candidates) {
    const arrUtc = localWallTimeToUtcMs(cand, arriveTime, toTz)
    if (arrUtc == null) continue
    const durMin = (arrUtc - depUtc) / 60000
    // Plausible commercial flight: 30 min – 24 h
    if (durMin < 30 || durMin > 24 * 60) continue
    // Prefer durations closer to 1–14 h; slight preference for preferDate match
    const preferBoost = preferDate && cand === preferDate ? -30 : 0
    const score = Math.abs(durMin - 180) + preferBoost
    if (score < bestScore) {
      bestScore = score
      best = cand
    }
  }

  // If nothing plausible, fall back to clock compare / prefer
  if (bestScore === Number.POSITIVE_INFINITY) {
    if (preferDate) return preferDate
    return arriveTime < departTime ? addDaysIso(departDate, 1) : departDate
  }
  return best
}

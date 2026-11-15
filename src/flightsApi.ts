import { getPocketBase, isPocketBaseConfigured, pocketBaseApiUrl } from './pocketbaseClient'

export type FlightLookupResult = {
  airline: string
  airlineIata: string
  flightNumber: string
  fromIata: string
  toIata: string
  fromLabel: string
  toLabel: string
  departDate: string
  departTime: string
  arriveDate: string
  arriveTime: string
  departTerminal: string
  arriveTerminal: string
  durationMin: number | null
  distanceKm: number | null
  attribution: string
}

async function authHeaders(): Promise<HeadersInit> {
  const pb = getPocketBase()
  const token = pb.authStore.token
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = token
  return headers
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  if (!text) return `${fallback} (${res.status})`
  try {
    const json = JSON.parse(text) as { message?: string }
    if (json?.message && typeof json.message === 'string') return json.message
  } catch {
    /* raw */
  }
  return text.length > 180 ? `${fallback} (${res.status})` : text
}

/** Lookup schedule via PocketBase → AeroDataBox. */
export async function lookupFlight(params: {
  airlineIata: string
  airlineIcao?: string
  flightNumber: string
  date: string
}): Promise<{ flight: FlightLookupResult | null; message?: string }> {
  if (!isPocketBaseConfigured()) {
    throw new Error('PocketBase is not configured.')
  }
  const res = await fetch(pocketBaseApiUrl('/api/waypoint/flights/lookup'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Flight lookup failed'))
  }
  return (await res.json()) as { flight: FlightLookupResult | null; message?: string }
}

import { getPocketBase, isPocketBaseConfigured, pocketBaseApiUrl } from './pocketbaseClient'
import type { GeocodeResult, PlaceSuggestion } from './placesTypes'

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
    const json = JSON.parse(text) as { message?: string; status?: number }
    if (json?.message && typeof json.message === 'string') {
      if (res.status === 401) return 'Sign in required to search places.'
      return json.message
    }
  } catch {
    /* raw text */
  }
  return text.length > 180 ? `${fallback} (${res.status})` : text
}

export async function searchPlaces(query: string, limit = 9): Promise<PlaceSuggestion[]> {
  if (!isPocketBaseConfigured()) return []
  const q = query.trim()
  if (q.length < 2) return []
  const res = await fetch(pocketBaseApiUrl('/api/waypoint/search'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ query: q, limit }),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Search failed'))
  }
  const data = (await res.json()) as { suggestions?: PlaceSuggestion[] }
  return Array.isArray(data.suggestions) ? data.suggestions : []
}

export async function geocodeQuery(query: string): Promise<GeocodeResult | null> {
  if (!isPocketBaseConfigured()) return null
  const q = query.trim()
  if (!q) return null
  const res = await fetch(pocketBaseApiUrl('/api/waypoint/geocode'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ query: q }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { result?: GeocodeResult | null }
  return data.result ?? null
}

export async function loadRecommendations(cacheKey: string): Promise<{
  suggestions: PlaceSuggestion[]
  fetchedAt: string | null
  source: string | null
}> {
  if (!isPocketBaseConfigured()) return { suggestions: [], fetchedAt: null, source: null }
  const url = new URL(pocketBaseApiUrl('/api/waypoint/recommendations'))
  url.searchParams.set('key', cacheKey)
  const res = await fetch(url.toString(), { headers: await authHeaders() })
  if (res.status === 404) return { suggestions: [], fetchedAt: null, source: null }
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Recommendations load failed'))
  }
  const data = (await res.json()) as {
    suggestions?: PlaceSuggestion[]
    fetchedAt?: string | null
    source?: string | null
  }
  return {
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    fetchedAt: data.fetchedAt ?? null,
    source: data.source ?? null,
  }
}

export async function refreshRecommendations(params: {
  cacheKey: string
  seeds: string[]
  country?: string
}): Promise<{ suggestions: PlaceSuggestion[]; fetchedAt: string; source: string }> {
  if (!isPocketBaseConfigured()) {
    throw new Error('PocketBase is not configured.')
  }
  const res = await fetch(pocketBaseApiUrl('/api/waypoint/recommendations/refresh'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Refresh failed'))
  }
  return (await res.json()) as {
    suggestions: PlaceSuggestion[]
    fetchedAt: string
    source: string
  }
}

export function recommendationsCacheKey(tripId: string, seeds: string[], country: string): string {
  const seedPart = seeds
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6)
    .join('|')
  return `recs:v1:${tripId}:${(country || '').trim().toLowerCase()}:${seedPart}`
}

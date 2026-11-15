import { useCallback, useEffect, useMemo, useState } from 'react'
import { isPocketBaseConfigured } from './pocketbaseClient'
import {
  loadRecommendations,
  recommendationsCacheKey,
  refreshRecommendations,
  searchPlaces,
} from './placesApi'
import type { PlaceSuggestion } from './placesTypes'

const FALLBACK_DESTINATIONS = [
  'New York',
  'New Orleans',
  'New Zealand',
  'Nepal',
  'Netherlands',
  'Nairobi',
  'London',
  'Tokyo',
  'Sydney',
]

function getCountrySuggestionsFromIntl(): string[] {
  try {
    const supportedValuesOf = (Intl as any).supportedValuesOf as ((type: string) => string[]) | undefined
    if (!supportedValuesOf) return []
    const regions = supportedValuesOf('region')
    const display = new Intl.DisplayNames(['en'], { type: 'region' })
    return regions
      .map((code) => display.of(code))
      .filter((x): x is string => Boolean(x))
  } catch {
    return []
  }
}

/** Destination typeahead: PocketBase/Nominatim when configured, else local fallbacks. */
export function useDestinationSuggestions(query: string) {
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[]>([])
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null)

  const allFallbackSuggestions = useMemo(() => {
    const countries = getCountrySuggestionsFromIntl()
    return Array.from(new Set([...FALLBACK_DESTINATIONS, ...countries]))
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q || q.length < 2) {
      setRemoteSuggestions([])
      setAutocompleteError(null)
      return
    }
    if (!isPocketBaseConfigured()) {
      setRemoteSuggestions([])
      setAutocompleteError(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setAutocompleteError(null)
        const places = await searchPlaces(q, 9)
        if (controller.signal.aborted) return
        setRemoteSuggestions(places.map((p) => p.label).filter(Boolean))
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return
        setRemoteSuggestions([])
        setAutocompleteError(err instanceof Error ? err.message : 'Autocomplete unavailable')
      }
    }, 280)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    // Remote Nominatim labels are already matched server-side — don't over-filter
    // (e.g. "東京都, 日本" for "tokyo"). Fallbacks still use prefix matching.
    if (remoteSuggestions.length > 0) {
      return remoteSuggestions.slice(0, 9)
    }
    return allFallbackSuggestions
      .filter((name) => {
        const lower = name.toLowerCase()
        if (lower.startsWith(q)) return true
        if (lower.includes(q)) return true
        return lower.split(/[\s,]+/).some((part) => part.startsWith(q))
      })
      .slice(0, 9)
  }, [query, remoteSuggestions, allFallbackSuggestions])

  return { suggestions, autocompleteError }
}

export type PlaceSuggestionsNear = {
  nearLat?: number
  nearLon?: number
  country?: string
  countryCode?: string
}

export function usePlaceSuggestions(query: string, near?: PlaceSuggestionsNear) {
  const [remoteSuggestions, setRemoteSuggestions] = useState<PlaceSuggestion[]>([])
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null)
  const nearLat = near?.nearLat
  const nearLon = near?.nearLon
  const country = near?.country
  const countryCode = near?.countryCode

  useEffect(() => {
    const q = query.trim()
    if (!q || q.length < 2) {
      setRemoteSuggestions([])
      setAutocompleteError(null)
      return
    }
    if (!isPocketBaseConfigured()) {
      setRemoteSuggestions([])
      setAutocompleteError(null)
      return
    }
    const controller = new AbortController()
    // Clear stale errors immediately so typing/backspacing can recover.
    setAutocompleteError(null)
    const timer = window.setTimeout(async () => {
      try {
        const places = await searchPlaces(q, {
          limit: 9,
          signal: controller.signal,
          ...(typeof nearLat === 'number' && typeof nearLon === 'number'
            ? { nearLat, nearLon }
            : {}),
          ...(country ? { country } : {}),
          ...(countryCode ? { countryCode } : {}),
        })
        if (controller.signal.aborted) return
        setRemoteSuggestions(places)
        setAutocompleteError(null)
      } catch (err) {
        if (controller.signal.aborted || (err as any)?.name === 'AbortError') return
        // Keep prior suggestions visible; only surface the error.
        setAutocompleteError(err instanceof Error ? err.message : 'Search unavailable')
      }
    }, 220)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, nearLat, nearLon, country, countryCode])

  return { suggestions: remoteSuggestions, autocompleteError }
}

/** Cache-first recommendations — never auto-refreshes external APIs. */
export function useCachedRecommendations(tripId: string | null | undefined, seeds: string[], country: string) {
  const [recommendations, setRecommendations] = useState<PlaceSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)

  const cacheKey = useMemo(() => {
    if (!tripId) return ''
    return recommendationsCacheKey(tripId, seeds, country)
  }, [tripId, seeds.join('|'), country])

  useEffect(() => {
    if (!tripId || !cacheKey || !isPocketBaseConfigured()) {
      setRecommendations([])
      setFetchedAt(null)
      setSource(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadRecommendations(cacheKey)
      .then((r) => {
        if (cancelled) return
        setRecommendations(r.suggestions)
        setFetchedAt(r.fetchedAt)
        setSource(r.source)
      })
      .catch((err) => {
        if (cancelled) return
        setRecommendations([])
        setError(err instanceof Error ? err.message : 'Failed to load recommendations')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cacheKey, tripId])

  const refresh = useCallback(async () => {
    if (!tripId || !cacheKey) return
    if (!isPocketBaseConfigured()) {
      setError('PocketBase is not configured.')
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      const r = await refreshRecommendations({
        cacheKey,
        seeds: seeds.length > 0 ? seeds : [country].filter(Boolean),
        country,
      })
      setRecommendations(r.suggestions)
      setFetchedAt(r.fetchedAt)
      setSource(r.source)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }, [cacheKey, country, seeds, tripId])

  return {
    recommendations,
    loading,
    refreshing,
    error,
    fetchedAt,
    source,
    refresh,
    cacheKey,
  }
}

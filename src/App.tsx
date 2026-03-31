import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { BedDouble, Calendar, Car, ChevronDown, ChevronUp, Compass, DollarSign, ExternalLink, Info, Map as MapIcon, MapPin, Moon, Plane, Search, Sun, UtensilsCrossed, X } from 'lucide-react'
import { DayPicker, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'

type MustDo = {
  id: string
  text: string
  done: boolean
  createdAt: number
}

type PackListItem = {
  id: string
  text: string
  category: string
  done: boolean
  createdAt: number
}

type VisitPlace = {
  id: string
  label: string
  lat?: number
  lon?: number
  cost?: string
  createdAt: number
}

type Stay = {
  id: string
  location: string
  address: string
  startDate: string
  endDate: string
  /** Free-text price value, e.g. "$420 total" or "120/night". */
  price: string
  /** Paste a link from your booking confirmation email (opens in a new tab). */
  bookingUrl: string
  /** Optional confirmation / reservation number from the email. */
  confirmationRef: string
  activities: StayActivity[]
  createdAt: number
}

type StayActivity = {
  id: string
  date: string
  name: string
  time: string
  cost: string
  notes: string
  photoUrl?: string
  googleMapsUri?: string
  placeLabel?: string
  category?: string
  primaryType?: string
  types?: string[]
  createdAt: number
}

type CarBooking = {
  id: string
  company: string
  pickupLocation: string
  dropoffLocation: string
  pickupDate: string
  dropoffDate: string
  confirmation: string
  price: string
  createdAt: number
}

type FlightBooking = {
  id: string
  route: string
  departDate: string
  returnDate: string
  confirmation: string
  price: string
  createdAt: number
}

type RestaurantBooking = {
  id: string
  name: string
  reservationDate: string
  confirmation: string
  cost: string
  notes: string
  createdAt: number
}

type AccommodationBooking = {
  id: string
  name: string
  checkIn: string
  checkOut: string
  confirmation: string
  createdAt: number
}

type TripBookings = {
  rentalCars: CarBooking[]
  flights: FlightBooking[]
  restaurants: RestaurantBooking[]
  accommodations: AccommodationBooking[]
}

type Trip = {
  id: string
  country: string
  startDate: string
  endDate: string
  createdAt: number
  mustDos: MustDo[]
  packList: PackListItem[]
  visitPlaces: VisitPlace[]
  stays: Stay[]
  bookings: TripBookings
}

type TripsState = {
  trips: Trip[]
  selectedTripId: string | null
}

const STORAGE_KEY = 'trips:v1'
const THEME_KEY = 'itinerary:theme'
const PACK_LIST_CATEGORIES = ['Clothes', 'Documents', 'Tech', 'Toiletries', 'Other'] as const
const FALLBACK_DESTINATIONS = ['New York', 'New Orleans', 'New Zealand', 'Nepal', 'Netherlands', 'Nairobi', 'London', 'Tokyo', 'Sydney']
const DEFAULT_HERO_IMAGE = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1200&auto=format&fit=crop'
/** Pick randomly from this many top-scored Commons results so the hero varies each load. */
const HERO_RANDOM_POOL = 12
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() ?? ''

function getCountrySuggestionsFromIntl(): string[] {
  try {
    const supportedValuesOf = (Intl as any).supportedValuesOf as ((type: string) => string[]) | undefined
    if (!supportedValuesOf) return []

    const regionCodes = supportedValuesOf('region')
    const display = new Intl.DisplayNames(undefined, { type: 'region' })

    return regionCodes
      .map((code) => display.of(code))
      .filter((name): name is string => typeof name === 'string' && name.length > 0 && !/^[A-Z]{2}$/.test(name))
  } catch {
    return []
  }
}

function useDestinationSuggestions(query: string) {
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
    if (!GOOGLE_MAPS_API_KEY) {
      setRemoteSuggestions([])
      setAutocompleteError('Google Maps API key missing (set VITE_GOOGLE_MAPS_API_KEY).')
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setAutocompleteError(null)
        const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'suggestions.placePrediction.text.text',
          },
          body: JSON.stringify({
            input: q,
            languageCode: 'en',
          }),
        })
        if (!res.ok) throw new Error(`Autocomplete request failed (${res.status})`)
        const data = (await res.json()) as any
        const suggestions = Array.from(
          new Set(
            (Array.isArray(data?.suggestions) ? data.suggestions : [])
              .map((s: any) => String(s?.placePrediction?.text?.text ?? '').trim())
              .filter(Boolean),
          ),
        ).slice(0, 9) as string[]
        setRemoteSuggestions(suggestions)
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return
        setRemoteSuggestions([])
        setAutocompleteError(err instanceof Error ? err.message : 'Autocomplete unavailable')
      }
    }, 220)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const source = remoteSuggestions.length > 0 ? remoteSuggestions : allFallbackSuggestions
    return source
      .filter((name) => {
        const lower = name.toLowerCase()
        if (lower.startsWith(q)) return true
        return lower.split(/\s+/).some((part) => part.startsWith(q))
      })
      .slice(0, 9)
  }, [query, remoteSuggestions, allFallbackSuggestions])

  return { suggestions, autocompleteError }
}

type PlaceSuggestion = {
  key: string
  label: string
  lat?: number
  lon?: number
  googleMapsUri?: string
  photoUrl?: string
  seedLabel?: string
  category?: string
  primaryType?: string
  types?: string[]
}

const googlePlacePhotoUrl = (name?: string) => {
  if (!name) return ''
  return `https://places.googleapis.com/v1/${name}/media?maxHeightPx=240&maxWidthPx=360&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`
}

function usePlaceSuggestions(query: string) {
  const [remoteSuggestions, setRemoteSuggestions] = useState<PlaceSuggestion[]>([])
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q || q.length < 2) {
      setRemoteSuggestions([])
      setAutocompleteError(null)
      return
    }
    if (!GOOGLE_MAPS_API_KEY) {
      setRemoteSuggestions([])
      setAutocompleteError('Google Maps API key missing (set VITE_GOOGLE_MAPS_API_KEY).')
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setAutocompleteError(null)
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.photos,places.primaryType,places.types',
          },
          body: JSON.stringify({
            textQuery: q,
            languageCode: 'en',
            maxResultCount: 9,
          }),
        })
        if (!res.ok) throw new Error(`Place search failed (${res.status})`)
        const data = (await res.json()) as any
        const places = (Array.isArray(data?.places) ? data.places : []).map((p: any) => {
          const label = [String(p?.displayName?.text ?? '').trim(), String(p?.formattedAddress ?? '').trim()].filter(Boolean).join(', ')
          return {
            key: String(p?.id ?? label),
            label,
            lat: Number(p?.location?.latitude),
            lon: Number(p?.location?.longitude),
            googleMapsUri: String(p?.googleMapsUri ?? ''),
            photoUrl: googlePlacePhotoUrl(p?.photos?.[0]?.name),
            primaryType: String(p?.primaryType ?? '').trim() || undefined,
            types: Array.isArray(p?.types) ? p.types.map((x: any) => String(x)).filter(Boolean) : undefined,
          } satisfies PlaceSuggestion
        })
        setRemoteSuggestions(places.filter((x: PlaceSuggestion) => x.label).slice(0, 9))
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return
        setRemoteSuggestions([])
        setAutocompleteError(err instanceof Error ? err.message : 'Search unavailable')
      }
    }, 220)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  return { suggestions: remoteSuggestions, autocompleteError }
}

function useRecommendedPlaces(seedLocations: string[], countryHint?: string) {
  const [recommendations, setRecommendations] = useState<PlaceSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const normalizeSeedForQuery = (raw: string) => {
      const t = raw.trim().replace(/\s+/g, ' ')
      if (!t) return ''
      const parts = t.split(',').map((p) => p.trim()).filter(Boolean)
      return parts.length >= 2 ? parts.slice(-2).join(', ') : t
    }
    const normalizedSeeds = Array.from(new Set(seedLocations.map(normalizeSeedForQuery).filter(Boolean)))
    const countryNorm = (countryHint ?? '').trim().toLowerCase()
    const countryAbbrev = countryNorm === 'new zealand' ? 'nz' : ''
    const isCountryMatch = (label: string) => {
      if (!countryNorm) return true
      const lower = label.toLowerCase()
      return lower.includes(countryNorm) || (countryAbbrev ? lower.includes(`, ${countryAbbrev}`) : false)
    }
    if (normalizedSeeds.length === 0) {
      setRecommendations([])
      setLoading(false)
      setError(null)
      return
    }
    if (!GOOGLE_MAPS_API_KEY) {
      setRecommendations([])
      setLoading(false)
      setError('Google Maps API key missing (set VITE_GOOGLE_MAPS_API_KEY).')
      return
    }

    const controller = new AbortController()
    const queryTemplates = [
      (seed: string) => `best hikes in ${seed}`,
      (seed: string) => `walking tours in ${seed}`,
      (seed: string) => `restaurants in ${seed}`,
      (seed: string) => `best experiences in ${seed}`,
      (seed: string) => `top tourist activities in ${seed}`,
      (seed: string) => `spa and wellness in ${seed}`,
      (seed: string) => `quiet relaxation spots in ${seed}`,
      (seed: string) => `onsen and hot springs in ${seed}`,
      (seed: string) => `tea houses and calm cafes in ${seed}`,
    ]
    const seeds = normalizedSeeds.slice(0, 6)
    const queryPlans = seeds.flatMap((seed, seedIndex) =>
      queryTemplates.map((template, templateIndex) => ({
        seed,
        seedIndex,
        templateIndex,
        query: template(seed),
      })),
    )

    const run = async () => {
      try {
        setLoading(true)
        setError(null)
        const settled = await Promise.allSettled(
          queryPlans.map(async (plan) => {
            const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
                'X-Goog-FieldMask':
                  'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.photos,places.primaryType,places.types',
              },
              body: JSON.stringify({
                textQuery: countryHint ? `${plan.query} in ${countryHint}` : plan.query,
                languageCode: 'en',
                maxResultCount: 4,
              }),
            })
            if (!res.ok) throw new Error(`Recommendations failed (${res.status})`)
            const data = (await res.json()) as any
            const items = (Array.isArray(data?.places) ? data.places : []).map((p: any) => {
              const label = [String(p?.displayName?.text ?? '').trim(), String(p?.formattedAddress ?? '').trim()].filter(Boolean).join(', ')
              return {
                key: String(p?.id ?? label),
                label,
                lat: Number(p?.location?.latitude),
                lon: Number(p?.location?.longitude),
                googleMapsUri: String(p?.googleMapsUri ?? ''),
                photoUrl: googlePlacePhotoUrl(p?.photos?.[0]?.name),
                seedLabel: plan.seed,
                primaryType: String(p?.primaryType ?? '').trim() || undefined,
                types: Array.isArray(p?.types) ? p.types.map((x: any) => String(x)).filter(Boolean) : undefined,
              } satisfies PlaceSuggestion
            })
            return { ...plan, items }
          }),
        )

        const bySeed = new Map<number, PlaceSuggestion[]>()
        const seen = new Set<string>()
        for (const result of settled) {
          if (result.status !== 'fulfilled') continue
          const { seedIndex, items } = result.value
          const bucket = bySeed.get(seedIndex) ?? []
          for (const item of items) {
            const key = item.label.toLowerCase()
            if (!item.label || seen.has(key) || !isCountryMatch(item.label)) continue
            seen.add(key)
            bucket.push(item)
          }
          bySeed.set(seedIndex, bucket)
        }

        // Interleave per-seed results so all itinerary areas are represented.
        const balanced: PlaceSuggestion[] = []
        const perSeedCap = 3
        let round = 0
        while (balanced.length < 20) {
          let addedThisRound = false
          for (let seedIndex = 0; seedIndex < seeds.length; seedIndex++) {
            const bucket = bySeed.get(seedIndex) ?? []
            if (round >= bucket.length) continue
            const alreadyFromSeed = balanced.filter((x) => bucket.some((b) => b.key === x.key)).length
            if (alreadyFromSeed >= perSeedCap) continue
            balanced.push(bucket[round])
            addedThisRound = true
            if (balanced.length >= 20) break
          }
          if (!addedThisRound) break
          round += 1
        }

        if (balanced.length > 0) {
          setRecommendations(balanced)
          return
        }

        const seenFallback = new Set<string>()
        const all: PlaceSuggestion[] = []
        for (const result of settled) {
          if (result.status !== 'fulfilled') continue
          for (const item of result.value.items) {
            const key = item.label.toLowerCase()
            if (!item.label || seenFallback.has(key) || !isCountryMatch(item.label)) continue
            seenFallback.add(key)
            all.push(item)
            if (all.length >= 20) break
          }
          if (all.length >= 20) break
        }
        setRecommendations(all)
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return
        setRecommendations([])
        setError(err instanceof Error ? err.message : 'Recommendations unavailable')
      } finally {
        setLoading(false)
      }
    }
    run()
    return () => controller.abort()
  }, [countryHint, seedLocations.join('|')])

  return { recommendations, loading, error }
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()))

const recommendationCategoryFromText = (text: string) => {
  const t = text.toLowerCase()
  if (/\b(restaurant|diner|grill|sushi|ramen|eatery|bistro|steakhouse|streat|kai)\b/.test(t)) return 'Restaurant'
  if (/\b(spa|wellness|relax|massage|onsen|hot spring|hot tub|hot tubs|thermal|sauna|calm|retreat)\b/.test(t)) return 'Relaxation'
  if (/\b(adventure|adventures|zipline|rafting|climb|kayak|surf|snorkel|tour|tours|glow worm|glow-worm)\b/.test(t)) return 'Experiences/Adventure'
  if (/\b(hike|hiking|trail|track|walk|trek|summit|pathway|boardwalk|route)\b/.test(t)) return 'Hike/Walk'
  if (/\b(hotel|hostel|resort|inn|apartment|accommodation)\b/.test(t)) return 'Accommodation'
  if (/\b(museum|gallery|temple|shrine|culture|historic)\b/.test(t)) return 'Museum/Culture'
  if (/\b(shopping|market|mall|boutique)\b/.test(t)) return 'Shopping'
  if (/\b(cafe|coffee|bakery|tea)\b/.test(t)) return 'Cafe'
  if (/\b(bar|club|nightlife|pub|cocktail)\b/.test(t)) return 'Nightlife'
  if (/\b(tower|viewpoint|landmark|plaza|square)\b/.test(t)) return 'Landmark'
  return 'Other'
}

const categoryFromGoogleTypes = (primaryType?: string, types?: string[]) => {
  const ordered = [String(primaryType ?? '').trim(), ...(types ?? []).map((t) => String(t).trim())]
    .filter(Boolean)
    .map((t) => t.toLowerCase())
  if (ordered.length === 0) return undefined

  const has = (...keys: string[]) => keys.some((k) => ordered.includes(k))
  if (has('restaurant', 'food', 'meal_takeaway', 'meal_delivery')) return 'Restaurant'
  if (has('spa', 'sauna', 'wellness_center', 'hot_spring', 'bath')) return 'Relaxation'
  if (has('tourist_attraction', 'tour_agency', 'travel_agency', 'adventure_sports_center', 'amusement_center')) return 'Experiences/Adventure'
  if (has('hiking_area', 'trail_head', 'park', 'campground')) return 'Hike/Walk'
  return undefined
}

const resolveRecommendationCategory = (existingCategory: string | undefined, text: string, primaryType?: string, types?: string[]) => {
  const fromGoogleTypes = categoryFromGoogleTypes(primaryType, types)
  const inferred = fromGoogleTypes || recommendationCategoryFromText(text)
  const existing = (existingCategory ?? '').trim()
  if (inferred !== 'Other') return inferred
  if (!existing || existing.toLowerCase() === 'other') return 'Other'
  return existing
}

const placeGoogleUrl = (place: Pick<PlaceSuggestion, 'googleMapsUri' | 'label'>) =>
  place.googleMapsUri?.trim() || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.label)}`

const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

function normalizeBookingUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('mailto:')) return t
  return `https://${t}`
}

function parseAmount(raw?: string): number {
  if (!raw) return 0
  const t = raw.trim().toLowerCase()
  if (!t) return 0
  const cleaned = t.replace(/,/g, '')
  const match = cleaned.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function enumerateStayDays(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!start || !end) return []
  const days: string[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  while (cur.getTime() < endMs) {
    days.push(toIsoDate(cur))
    cur.setDate(cur.getDate() + 1)
  }
  if (days.length === 0) {
    days.push(toIsoDate(start))
  }
  return days
}

/** First segment before a comma — better for "Paris, France" style location labels. */
function primaryPlaceQuery(location: string): string {
  const t = location.trim()
  if (!t) return ''
  const first = t.split(',')[0]?.trim() ?? t
  return first.length >= 2 ? first : t
}

const HERO_TITLE_NOISE = [
  'diagram',
  'schematic',
  'chart',
  'graph',
  'svg',
  'logo',
  'icon',
  'flag',
  'coat of arms',
  'currency',
  'stamp',
  'coin',
  'banknote',
  'passport',
  'poster',
  'flyer',
  'screenshot',
  'election',
  'signature',
  'sheet music',
  'map of',
  'map showing',
  'locator map',
  'route map',
  'topographic',
  'emblem',
  'seal',
  'insignia',
  'badge',
  'portrait of',
  'self-portrait',
  'document',
  'license',
  'cover page',
  'coat of arm',
]

const HERO_PLACE_HINTS = [
  'panorama',
  'panoramic',
  'aerial',
  'harbor',
  'harbour',
  'waterfront',
  'downtown',
  'bridge',
  'view of',
  'view from',
  'bay',
  'coast',
  'plaza',
  'square',
  'architecture',
  'sunset',
  'sunrise',
  'night view',
  'city view',
  'nature',
  'landscape',
  'travel',
]

function scoreHeroCandidate(titleNorm: string, primaryNorm: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    if (primaryNorm.length < 3) return -1
    if (!titleNorm.includes(primaryNorm)) return -1
    let score = 16
    for (const hint of HERO_PLACE_HINTS) {
      if (titleNorm.includes(hint)) score += 2
    }
    return score
  }

  let score = 0

  if (primaryNorm.length >= 3 && titleNorm.includes(primaryNorm)) {
    score += 18
  }

  const matched = queryTokens.filter((token) => titleNorm.includes(token)).length
  if (matched === 0) return -1
  score += matched * 4

  if (queryTokens.length >= 2 && matched < 2) {
    score -= 6
  }

  for (const hint of HERO_PLACE_HINTS) {
    if (titleNorm.includes(hint)) score += 2
  }

  return score
}

async function fetchLocationHeroImage(location: string): Promise<string | null> {
  const q = location.trim()
  if (!q) return null

  const primary = primaryPlaceQuery(q)
  const primaryNorm = primary.toLowerCase().replace(/_/g, ' ')
  const rawTokens = primary
    .toLowerCase()
    .split(/[\s,.-]+/)
    .filter(Boolean)
  let queryTokens =
    rawTokens.length === 1 && rawTokens[0].length >= 3
      ? rawTokens
      : rawTokens.filter((t) => t.length >= 3)

  if (queryTokens.length === 0) {
    const fromFull = q.toLowerCase().split(/[\s,.-]+/).filter((t) => t.length >= 4)
    if (fromFull.length) queryTokens = fromFull
    else if (primaryNorm.length >= 3) queryTokens = [primaryNorm]
  }

  // Place + scenic / travel terms (panorama, nature, landscape, travel weighted by scoring).
  const searches = [
    `${primary} panorama`,
    `${primary} panoramic`,
    `${primary} nature`,
    `${primary} landscape`,
    `${primary} travel`,
    `${primary} aerial`,
    `${primary} city`,
    primary,
    `${primary} harbor`,
    `${primary} waterfront`,
  ]

  const fetchCandidates = async (search: string) => {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: search,
      gsrnamespace: '6', // File namespace on Commons
      gsrlimit: '30',
      prop: 'imageinfo',
      iiprop: 'url|size',
      format: 'json',
      origin: '*',
    })

    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`)
    if (!res.ok) return []
    const data = (await res.json()) as any
    const pages = data?.query?.pages ? (Object.values(data.query.pages) as any[]) : []

    return pages
      .map((p) => {
        const info = p?.imageinfo?.[0]
        const url = info?.url
        const width = Number(info?.width ?? 0)
        const height = Number(info?.height ?? 0)
        const titleRaw = String(p?.title ?? '')
        const titleNorm = titleRaw.toLowerCase().replace(/_/g, ' ')
        if (typeof url !== 'string' || !url) return null
        if (width < 1200 || height < 700) return null // avoid low-res results

        for (const noise of HERO_TITLE_NOISE) {
          if (titleNorm.includes(noise)) return null
        }

        const relevance = scoreHeroCandidate(titleNorm, primaryNorm, queryTokens)
        if (relevance < 0) return null

        let score = relevance

        // Prefer higher resolution and landscape orientation for hero images.
        if (width >= 3000) score += 4
        else if (width >= 2200) score += 3
        else if (width >= 1600) score += 2
        else score -= 2

        const ratio = width / Math.max(1, height)
        if (ratio >= 1.2) score += 2
        if (ratio < 1) score -= 2

        return { url, score, width, height }
      })
      .filter((x): x is { url: string; score: number; width: number; height: number } => Boolean(x))
  }

  try {
    const allCandidates: { url: string; score: number; width: number; height: number }[] = []
    for (const search of searches) {
      const candidates = await fetchCandidates(search)
      allCandidates.push(...candidates)
      if (allCandidates.length >= 24) break
    }

    if (allCandidates.length === 0) return null
    const deduped = allCandidates
      .sort((a, b) => b.score - a.score)
      .filter((c, idx, arr) => arr.findIndex((x) => x.url === c.url) === idx)
    const pool = deduped.slice(0, Math.max(1, Math.min(HERO_RANDOM_POOL, deduped.length)))
    return pool[Math.floor(Math.random() * pool.length)]?.url ?? null
  } catch {
    return null
  }
}

function loadTripsState(): TripsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { trips: [], selectedTripId: null }
    const parsed = JSON.parse(raw) as any
    const tripsRaw = parsed?.trips
    const selectedTripIdRaw = parsed?.selectedTripId

    const trips: Trip[] = Array.isArray(tripsRaw)
      ? tripsRaw
          .map((t: any) => ({
            id: String(t.id ?? ''),
            country: String(t.country ?? '').trim(),
            startDate: String(t.startDate ?? ''),
            endDate: String(t.endDate ?? ''),
            createdAt: Number(t.createdAt ?? Date.now()),
            mustDos: Array.isArray(t.mustDos)
              ? t.mustDos
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    text: String(x.text ?? ''),
                    done: Boolean(x.done),
                    createdAt: Number(x.createdAt ?? Date.now()),
                  }))
                  .filter((x: MustDo) => x.id && x.text.trim().length > 0)
              : [],
            packList: Array.isArray(t.packList)
              ? t.packList
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    text: String(x.text ?? '').trim(),
                    category: String(x.category ?? 'Other').trim() || 'Other',
                    done: Boolean(x.done),
                    createdAt: Number(x.createdAt ?? Date.now()),
                  }))
                  .filter((x: PackListItem) => x.id && x.text.length > 0)
              : [],
            visitPlaces: Array.isArray(t.visitPlaces)
              ? t.visitPlaces
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    label: String(x.label ?? '').trim(),
                    lat: typeof x.lat === 'number' ? x.lat : undefined,
                    lon: typeof x.lon === 'number' ? x.lon : undefined,
                    cost: String(x.cost ?? '').trim(),
                    createdAt: Number(x.createdAt ?? Date.now()),
                  }))
                  .filter((x: VisitPlace) => x.id && x.label.length > 0)
              : [],
            stays: Array.isArray(t.stays)
              ? t.stays
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    location: String(x.location ?? '').trim(),
                    address: String(x.address ?? '').trim(),
                    startDate: String(x.startDate ?? ''),
                    endDate: String(x.endDate ?? ''),
                    price: String(x.price ?? '').trim(),
                    bookingUrl: String(x.bookingUrl ?? '').trim(),
                    confirmationRef: String(x.confirmationRef ?? '').trim(),
                    activities: Array.isArray(x.activities)
                      ? x.activities
                          .map((a: any) => ({
                            id: String(a.id ?? ''),
                            date: String(a.date ?? ''),
                            name: String(a.name ?? '').trim(),
                            time: String(a.time ?? ''),
                            cost: String(a.cost ?? '').trim(),
                            notes: String(a.notes ?? '').trim(),
                            photoUrl: String(a.photoUrl ?? '').trim() || undefined,
                            googleMapsUri: String(a.googleMapsUri ?? '').trim() || undefined,
                            placeLabel: String(a.placeLabel ?? '').trim() || undefined,
                            category: String(a.category ?? '').trim() || undefined,
                            primaryType: String(a.primaryType ?? '').trim() || undefined,
                            types: Array.isArray(a.types) ? a.types.map((x: any) => String(x)).filter(Boolean) : undefined,
                            createdAt: Number(a.createdAt ?? Date.now()),
                          }))
                          .filter((a: StayActivity) => a.id && a.name && a.date)
                      : [],
                    createdAt: Number(x.createdAt ?? Date.now()),
                  }))
                  .filter((x: Stay) => x.id && x.location.length > 0 && x.startDate && x.endDate)
              : [],
            bookings: {
              rentalCars: Array.isArray(t?.bookings?.rentalCars)
                ? t.bookings.rentalCars
                    .map((x: any) => ({
                      id: String(x.id ?? ''),
                      company: String(x.company ?? '').trim(),
                      pickupLocation: String(x.pickupLocation ?? '').trim(),
                      dropoffLocation: String(x.dropoffLocation ?? '').trim(),
                      pickupDate: String(x.pickupDate ?? ''),
                      dropoffDate: String(x.dropoffDate ?? ''),
                      confirmation: String(x.confirmation ?? '').trim(),
                      price: String(x.price ?? '').trim(),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }))
                    .filter((x: CarBooking) => x.id && x.company.length > 0)
                : [],
              flights: Array.isArray(t?.bookings?.flights)
                ? t.bookings.flights
                    .map((x: any) => ({
                      id: String(x.id ?? ''),
                      route: String(x.route ?? '').trim(),
                      departDate: String(x.departDate ?? ''),
                      returnDate: String(x.returnDate ?? ''),
                      confirmation: String(x.confirmation ?? '').trim(),
                      price: String(x.price ?? '').trim(),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }))
                    .filter((x: FlightBooking) => x.id && x.route.length > 0)
                : [],
              restaurants: Array.isArray(t?.bookings?.restaurants)
                ? t.bookings.restaurants
                    .map((x: any) => ({
                      id: String(x.id ?? ''),
                      name: String(x.name ?? '').trim(),
                      reservationDate: String(x.reservationDate ?? ''),
                      confirmation: String(x.confirmation ?? '').trim(),
                      cost: String(x.cost ?? '').trim(),
                      notes: String(x.notes ?? '').trim(),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }))
                    .filter((x: RestaurantBooking) => x.id && x.name.length > 0)
                : [],
              accommodations: Array.isArray(t?.bookings?.accommodations)
                ? t.bookings.accommodations
                    .map((x: any) => ({
                      id: String(x.id ?? ''),
                      name: String(x.name ?? '').trim(),
                      checkIn: String(x.checkIn ?? ''),
                      checkOut: String(x.checkOut ?? ''),
                      confirmation: String(x.confirmation ?? '').trim(),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }))
                    .filter((x: AccommodationBooking) => x.id && x.name.length > 0)
                : [],
            },
          }))
          .filter((t: Trip) => t.id && t.country.length > 0)
      : []

    const selectedTripId =
      typeof selectedTripIdRaw === 'string' && trips.some((t) => t.id === selectedTripIdRaw) ? selectedTripIdRaw : trips[0]?.id ?? null

    return { trips, selectedTripId }
  } catch {
    return { trips: [], selectedTripId: null }
  }
}

function saveTripsState(state: TripsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

type Tab = 'planner' | 'itinerary' | 'budget' | 'map' | 'tips'
type View = 'home' | 'dashboard'
type BookingTab = 'rentalCar' | 'flight' | 'restaurant' | 'accommodation'

type MapPoint = {
  key: string
  label: string
  kind: 'stay' | 'place'
  addressHint?: string
  lat?: number
  lon?: number
  startDate?: string
  endDate?: string
}

const toIsoDate = (d?: Date) => {
  if (!d) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const startOfToday = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

const parseIsoDate = (iso?: string) => {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const formatDateRangeLabel = (startDate?: string, endDate?: string) => {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)

  const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short' })

  if (start && end) {
    const startMonth = monthFmt.format(start)
    const endMonth = monthFmt.format(end)
    const startDay = start.getDate()
    const endDay = end.getDate()

    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return `${startMonth} ${startDay} - ${endDay}`
    }
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}`
  }

  if (start) return `${monthFmt.format(start)} ${start.getDate()} - ...`
  if (end) return `... - ${monthFmt.format(end)} ${end.getDate()}`
  return 'Dates not set'
}

const formatDateRangeWithYear = (startDate?: string, endDate?: string) => {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!start && !end) return ''
  if (start && !end) return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (!start && end) return end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const startMonth = start!.toLocaleDateString('en-US', { month: 'short' })
  const endMonth = end!.toLocaleDateString('en-US', { month: 'short' })
  const startDay = start!.getDate()
  const endDay = end!.getDate()
  const startYear = start!.getFullYear()
  const endYear = end!.getFullYear()

  if (startYear === endYear) {
    if (start!.getMonth() === end!.getMonth()) {
      return `${startMonth} ${startDay} - ${endDay}, ${startYear}`
    }
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${startYear}`
  }

  return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`
}

const formatSingleDateLabel = (iso?: string) => {
  const date = parseIsoDate(iso)
  if (!date) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

type PeakSeasonInfo = {
  peakLabel: string
  isPeakMonth: boolean
}

const normalizePeakSeasonDestination = (raw: string) => {
  return raw
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
}

const monthLabel = (m: number) => new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(Date.UTC(2020, m, 1)))

const peakMonthLabelFromList = (months: number[]) => {
  const unique = Array.from(new Set(months)).sort((a, b) => a - b)
  if (unique.length === 0) return ''
  if (unique.length === 1) return monthLabel(unique[0])
  const contiguous = unique.every((m, i) => i === 0 || m === unique[i - 1] + 1)
  if (contiguous) return `${monthLabel(unique[0])}-${monthLabel(unique[unique.length - 1])}`
  return unique.slice(0, 4).map(monthLabel).join(', ')
}

const LOCAL_PEAK_DB: Array<{ aliases: string[]; peakMonths: number[] }> = [
  { aliases: ['new zealand', 'australia', 'south africa', 'argentina', 'chile', 'uruguay'], peakMonths: [11, 0, 1] },
  { aliases: ['japan', 'korea', 'china'], peakMonths: [2, 3, 4] },
  { aliases: ['thailand', 'vietnam', 'cambodia', 'laos', 'malaysia', 'singapore', 'indonesia', 'philippines'], peakMonths: [10, 11, 0, 1, 2] },
  { aliases: ['india', 'nepal', 'bhutan', 'sri lanka'], peakMonths: [9, 10, 11, 0, 1, 2] },
  { aliases: ['uae', 'qatar', 'oman', 'saudi arabia', 'jordan', 'israel', 'egypt', 'morocco'], peakMonths: [10, 11, 0, 1, 2, 3] },
  { aliases: ['spain', 'portugal', 'italy', 'france', 'greece', 'croatia', 'turkey'], peakMonths: [4, 5, 8, 9] },
  { aliases: ['uk', 'united kingdom', 'ireland', 'germany', 'netherlands', 'belgium', 'switzerland', 'austria', 'czech republic', 'hungary', 'poland'], peakMonths: [4, 5, 6, 8, 9] },
  { aliases: ['iceland', 'norway', 'sweden', 'finland', 'denmark'], peakMonths: [5, 6, 7] },
  { aliases: ['united states', 'usa', 'canada'], peakMonths: [4, 5, 8, 9] },
  { aliases: ['mexico', 'costa rica', 'panama', 'guatemala', 'colombia', 'peru', 'ecuador', 'brazil'], peakMonths: [11, 0, 1, 2, 3] },
]

const getPeakSeasonInfoFromLocalDb = (destination: string, monthDate: Date): PeakSeasonInfo | null => {
  const normalized = normalizePeakSeasonDestination(destination)
  if (!normalized) return null
  const hit = LOCAL_PEAK_DB.find((entry) =>
    entry.aliases.some((alias) => {
      const a = normalizePeakSeasonDestination(alias)
      return normalized.includes(a) || a.includes(normalized)
    }),
  )
  if (!hit) return null
  return {
    peakLabel: peakMonthLabelFromList(hit.peakMonths),
    isPeakMonth: hit.peakMonths.includes(monthDate.getMonth()),
  }
}

function DateRangeDropdown({
  startDate,
  endDate,
  onChange,
  disabled,
  placeholder,
  initialMonthIso,
  className = '',
}: {
  startDate: string
  endDate: string
  onChange: (start: string, end: string) => void
  disabled?: boolean
  placeholder?: string
  initialMonthIso?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState<DateRange | undefined>(() => ({
    from: parseIsoDate(startDate) ?? undefined,
    to: parseIsoDate(endDate) ?? undefined,
  }))

  useEffect(() => {
    setRange({
      from: parseIsoDate(startDate) ?? undefined,
      to: parseIsoDate(endDate) ?? undefined,
    })
  }, [startDate, endDate])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = rootRef.current
      const target = event.target as Node | null
      if (!node || !target) return
      if (!node.contains(target)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('touchstart', onPointerDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  const initialMonth = parseIsoDate(initialMonthIso)

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="w-full text-left px-3 py-2 rounded-xl border border-neutral-200 bg-white disabled:bg-neutral-50 text-sm"
      >
        {startDate || endDate ? formatDateRangeLabel(startDate, endDate) : (placeholder ?? 'Select start and end dates')}
      </button>
      {open ? (
        <div className="absolute left-0 mt-2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl z-20">
          <div className="flex flex-col md:flex-row md:items-start md:gap-4">
            <DayPicker
              mode="range"
              selected={range}
              defaultMonth={range?.from ?? parseIsoDate(startDate) ?? initialMonth ?? new Date()}
              captionLayout="dropdown-years"
              navLayout="after"
              fromYear={new Date().getFullYear()}
              toYear={new Date().getFullYear() + 10}
              startMonth={startOfToday()}
              fixedWeeks
              showOutsideDays
              disabled={{ before: startOfToday() }}
              onDayClick={(day, modifiers) => {
                if (modifiers.disabled) return
                if (range?.from && range?.to && range.from.getTime() !== range.to.getTime()) {
                  const next = { from: day, to: undefined }
                  setRange(next)
                  onChange(toIsoDate(next.from), '')
                }
              }}
              onSelect={(nextRange) => {
                if (nextRange?.from && nextRange?.to && nextRange.from.getTime() === nextRange.to.getTime()) {
                  const next = { from: nextRange.from, to: undefined }
                  setRange(next)
                  onChange(toIsoDate(next.from), '')
                  return
                }
                setRange(nextRange)
                onChange(toIsoDate(nextRange?.from), toIsoDate(nextRange?.to))
              }}
              classNames={{
                root: 'rdp-modern mx-auto md:mx-0',
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
            <div className="mt-3 md:mt-2 md:min-w-[150px]">
              <div className="text-xs text-neutral-600">
                Dates selected: {startDate || endDate ? formatDateRangeLabel(startDate, endDate) : 'None'}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DateSingleDropdown({
  date,
  onChange,
  disabled,
  placeholder,
  initialMonthIso,
  className = '',
}: {
  date: string
  onChange: (next: string) => void
  disabled?: boolean
  placeholder?: string
  initialMonthIso?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = parseIsoDate(date) ?? undefined
  const initialMonth = parseIsoDate(initialMonthIso)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = rootRef.current
      const target = event.target as Node | null
      if (!node || !target) return
      if (!node.contains(target)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('touchstart', onPointerDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="w-full text-left px-3 py-2 rounded-xl border border-neutral-200 bg-white disabled:bg-neutral-50 text-sm"
      >
        {date ? formatSingleDateLabel(date) : (placeholder || 'Select a date')}
      </button>
      {open ? (
        <div className="absolute left-0 mt-2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl z-20">
          <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected ?? initialMonth ?? new Date()}
            captionLayout="dropdown-years"
            navLayout="after"
            fromYear={new Date().getFullYear()}
            toYear={new Date().getFullYear() + 10}
            startMonth={startOfToday()}
            fixedWeeks
            showOutsideDays
            disabled={{ before: startOfToday() }}
            onSelect={(day) => {
              onChange(toIsoDate(day))
            }}
            classNames={{
              root: 'rdp-modern mx-auto',
              month_caption: 'rdp-caption',
              day: 'rdp-day',
              day_button: 'rdp-day-button',
              selected: 'rdp-selected',
              chevron: 'rdp-chevron',
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  })
  const [view, setView] = useState<View>('home')
  const [activeTab, setActiveTab] = useState<Tab>('planner')
  const [expandedTripPanel, setExpandedTripPanel] = useState(true)
  const [selectedTimelineDate, setSelectedTimelineDate] = useState('')

  const [state, setState] = useState<TripsState>(() => loadTripsState())
  const [placeSearchInput, setPlaceSearchInput] = useState('')
  const [showPlaceSuggestions, setShowPlaceSuggestions] = useState(false)
  const [placeSuggestionIndex, setPlaceSuggestionIndex] = useState(-1)
  const [mustDoInput, setMustDoInput] = useState('')
  const [packListTextInput, setPackListTextInput] = useState('')
  const [packListCategoryInput, setPackListCategoryInput] = useState<string>(PACK_LIST_CATEGORIES[0])
  const [showHomeSuggestions, setShowHomeSuggestions] = useState(false)
  const [homeSuggestionIndex, setHomeSuggestionIndex] = useState(-1)
  const [showAddTripModal, setShowAddTripModal] = useState(false)
  const [newTripDestination, setNewTripDestination] = useState('')
  const [newTripStartDate, setNewTripStartDate] = useState('')
  const [newTripEndDate, setNewTripEndDate] = useState('')
  const [newTripRange, setNewTripRange] = useState<DateRange | undefined>()
  const [tripStartDateInput, setTripStartDateInput] = useState('')
  const [tripEndDateInput, setTripEndDateInput] = useState('')
  const [tripDateError, setTripDateError] = useState<string | null>(null)
  const [stayLocationInput, setStayLocationInput] = useState('')
  const [stayAddressInput, setStayAddressInput] = useState('')
  const [stayStartDate, setStayStartDate] = useState('')
  const [stayEndDate, setStayEndDate] = useState('')
  const [stayPriceInput, setStayPriceInput] = useState('')
  const [stayBookingUrlInput, setStayBookingUrlInput] = useState('')
  const [stayConfirmationRefInput, setStayConfirmationRefInput] = useState('')
  const [stayError, setStayError] = useState<string | null>(null)
  const [bookingsTab, setBookingsTab] = useState<BookingTab>('rentalCar')
  const [editingBooking, setEditingBooking] = useState<{ tab: BookingTab; id: string } | null>(null)
  const [editCarDraft, setEditCarDraft] = useState<CarBooking | null>(null)
  const [editFlightDraft, setEditFlightDraft] = useState<FlightBooking | null>(null)
  const [editRestaurantDraft, setEditRestaurantDraft] = useState<RestaurantBooking | null>(null)
  const [carCompanyInput, setCarCompanyInput] = useState('')
  const [carPickupLocationInput, setCarPickupLocationInput] = useState('')
  const [carDropoffLocationInput, setCarDropoffLocationInput] = useState('')
  const [carPickupInput, setCarPickupInput] = useState('')
  const [carDropoffInput, setCarDropoffInput] = useState('')
  const [carConfirmationInput, setCarConfirmationInput] = useState('')
  const [carPriceInput, setCarPriceInput] = useState('')
  const [flightRouteInput, setFlightRouteInput] = useState('')
  const [flightDepartInput, setFlightDepartInput] = useState('')
  const [flightConfirmationInput, setFlightConfirmationInput] = useState('')
  const [flightPriceInput, setFlightPriceInput] = useState('')
  const [flightQuickInput, setFlightQuickInput] = useState('')
  const [restaurantNameInput, setRestaurantNameInput] = useState('')
  const [restaurantDateInput, setRestaurantDateInput] = useState('')
  const [restaurantConfirmationInput, setRestaurantConfirmationInput] = useState('')
  const [restaurantCostInput, setRestaurantCostInput] = useState('')
  const [restaurantNotesInput, setRestaurantNotesInput] = useState('')
  const [dismissedRecommendationKeys, setDismissedRecommendationKeys] = useState<string[]>([])
  const [activityDrafts, setActivityDrafts] = useState<Record<string, { name: string; time: string; cost: string; notes: string }>>({})
  const [activityPlaceSearchInput, setActivityPlaceSearchInput] = useState('')
  const [draftPlaceMeta, setDraftPlaceMeta] = useState<Record<string, PlaceSuggestion>>({})
  const [activityMetaById, setActivityMetaById] = useState<Record<string, PlaceSuggestion>>({})
  const [selectedDayAnchorCoords, setSelectedDayAnchorCoords] = useState<Array<{ lat: number; lon: number }>>([])
  const [selectedDayRadiusPartial, setSelectedDayRadiusPartial] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [confettiBursts, setConfettiBursts] = useState<Array<{ id: string; x: number; y: number }>>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [mapApiLoaded, setMapApiLoaded] = useState(false)
  const [mapApiError, setMapApiError] = useState<string | null>(null)
  const [resolvedPointCoords, setResolvedPointCoords] = useState<Record<string, { lat: number; lon: number }>>({})
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)
  const mapMarkersRef = useRef<any[]>([])
  const mapPolylineRef = useRef<any>(null)
  /** Session-only hero; refetched when opening the dashboard so places are not stuck on one saved photo. */
  const [dashboardHeroUrl, setDashboardHeroUrl] = useState<string | null>(null)
  const [peakSeasonInfo, setPeakSeasonInfo] = useState<PeakSeasonInfo | null>(null)

  useEffect(() => saveTripsState(state), [state])
  useEffect(() => {
    localStorage.setItem(THEME_KEY, isDarkMode ? 'dark' : 'light')
  }, [isDarkMode])

  const selectedTrip = useMemo(() => {
    if (!state.selectedTripId) return null
    return state.trips.find((t) => t.id === state.selectedTripId) ?? null
  }, [state.selectedTripId, state.trips])

  const mustDos = selectedTrip?.mustDos ?? []
  const packList = selectedTrip?.packList ?? []
  const visitPlaces = selectedTrip?.visitPlaces ?? []
  const stays = useMemo(() => [...(selectedTrip?.stays ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)), [selectedTrip?.stays])
  const bookings = selectedTrip?.bookings ?? { rentalCars: [], flights: [], restaurants: [], accommodations: [] }
  const remaining = useMemo(() => mustDos.filter((m) => !m.done).length, [mustDos])
  const packedCount = useMemo(() => packList.filter((x) => x.done).length, [packList])
  const packListGroups = useMemo(() => {
    const groups = new Map<string, PackListItem[]>()
    for (const item of packList) {
      const key = item.category.trim() || 'Other'
      const list = groups.get(key) ?? []
      list.push(item)
      groups.set(key, list)
    }

    return [...groups.entries()]
      .sort(([a], [b]) => {
        const ai = PACK_LIST_CATEGORIES.findIndex((x) => x.toLowerCase() === a.toLowerCase())
        const bi = PACK_LIST_CATEGORIES.findIndex((x) => x.toLowerCase() === b.toLowerCase())
        if (ai === -1 && bi === -1) return a.localeCompare(b)
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
      .map(([category, items]) => [category, [...items].sort((a, b) => a.createdAt - b.createdAt)] as const)
  }, [packList])
  const allStayActivities = useMemo(() => stays.flatMap((s) => s.activities ?? []), [stays])
  const budgetTotals = useMemo(() => {
    const vehicle = bookings.rentalCars.reduce((sum, b) => sum + parseAmount(b.price), 0)
    const flights = bookings.flights.reduce((sum, b) => sum + parseAmount(b.price), 0)
    const accommodation = stays.reduce((sum, s) => sum + parseAmount(s.price), 0)
    const food = bookings.restaurants.reduce((sum, b) => sum + parseAmount(b.cost), 0)
    const activities =
      visitPlaces.reduce((sum, p) => sum + parseAmount(p.cost), 0) +
      allStayActivities.reduce((sum, a) => sum + parseAmount(a.cost), 0)
    const total = vehicle + flights + accommodation + activities + food
    return { vehicle, flights, accommodation, activities, food, total }
  }, [allStayActivities, bookings.flights, bookings.rentalCars, bookings.restaurants, stays, visitPlaces])

  const tripsSorted = useMemo(() => [...state.trips].sort((a, b) => b.createdAt - a.createdAt), [state.trips])
  const timelineDays = useMemo(() => {
    if (!selectedTrip?.startDate || !selectedTrip?.endDate) return []
    return enumerateStayDays(selectedTrip.startDate, selectedTrip.endDate)
  }, [selectedTrip?.endDate, selectedTrip?.startDate])
  const activitiesByDay = useMemo(() => {
    const map = new Map<string, { stayId: string; stayLocation: string; activity: StayActivity }[]>()
    for (const s of stays) {
      for (const a of s.activities ?? []) {
        const list = map.get(a.date) ?? []
        list.push({ stayId: s.id, stayLocation: s.location, activity: a })
        map.set(a.date, list)
      }
    }
    for (const [k, list] of map) {
      list.sort((x, y) => (x.activity.time || '99:99').localeCompare(y.activity.time || '99:99'))
      map.set(k, list)
    }
    return map
  }, [stays])
  const staysByDay = useMemo(() => {
    const map = new Map<string, Stay[]>()
    for (const day of timelineDays) {
      map.set(day, stays.filter((s) => s.startDate <= day && day < s.endDate))
    }
    return map
  }, [stays, timelineDays])
  const placeSearch = usePlaceSuggestions(placeSearchInput)
  const normalizeRecommendationLabel = (label: string) => label.split(',')[0]?.trim().toLowerCase() || label.trim().toLowerCase()
  const plannedActivityNames = useMemo(() => new Set(stays.flatMap((s) => (s.activities ?? []).map((a) => a.name.trim().toLowerCase())).filter(Boolean)), [stays])
  const recommendationSeeds = useMemo(() => {
    if (!selectedTrip) return []
    const seedList: string[] = []
    for (const s of stays) {
      const addr = s.address.trim()
      const loc = s.location.trim()
      if (addr) seedList.push(addr)
      if (loc) seedList.push(loc)
    }
    return seedList.length > 0 ? seedList : [selectedTrip.country]
  }, [selectedTrip, stays])
  const recommendedPlaces = useRecommendedPlaces(recommendationSeeds, selectedTrip?.country)
  const visibleRecommendations = useMemo(() => {
    return recommendedPlaces.recommendations
      .filter((r) => !dismissedRecommendationKeys.includes(r.key))
      .filter((r) => !plannedActivityNames.has(normalizeRecommendationLabel(r.label)))
      .slice(0, 8)
  }, [dismissedRecommendationKeys, plannedActivityNames, recommendedPlaces.recommendations])
  const selectedDayPrimaryStay = useMemo(() => {
    if (!selectedTimelineDate) return null
    return (staysByDay.get(selectedTimelineDate) ?? [])[0] ?? null
  }, [selectedTimelineDate, staysByDay])
  const selectedDayNumber = useMemo(() => {
    if (!selectedTimelineDate) return null
    const idx = timelineDays.indexOf(selectedTimelineDate)
    return idx >= 0 ? idx + 1 : null
  }, [selectedTimelineDate, timelineDays])
  const selectedDayActivities = useMemo(() => activitiesByDay.get(selectedTimelineDate) ?? [], [activitiesByDay, selectedTimelineDate])
  const selectedDayRecommendationSeeds = useMemo(() => {
    if (!selectedTrip || !selectedTimelineDate) return []
    const staySeeds: string[] = []
    const activitySeeds: string[] = []
    const stay = selectedDayPrimaryStay
    if (stay?.address?.trim()) staySeeds.push(stay.address.trim())
    if (stay?.location?.trim()) staySeeds.push(stay.location.trim())
    for (const item of selectedDayActivities.slice(0, 4)) {
      const t = item.activity.name.trim()
      if (!t) continue
      activitySeeds.push(t)
      activitySeeds.push(`${t} near ${stay?.location || selectedTrip.country}`)
    }
    if (staySeeds.length === 0 && activitySeeds.length === 0) staySeeds.push(selectedTrip.country)

    // Interleave stay and activity sources so recommendation queries are mixed.
    const mixed: string[] = []
    const stayUnique = Array.from(new Set(staySeeds)).slice(0, 4)
    const activityUnique = Array.from(new Set(activitySeeds)).slice(0, 6)
    const rounds = Math.max(stayUnique.length, activityUnique.length)
    for (let i = 0; i < rounds; i++) {
      if (stayUnique[i]) mixed.push(stayUnique[i])
      if (activityUnique[i]) mixed.push(activityUnique[i])
    }
    return mixed.slice(0, 8)
  }, [selectedDayActivities, selectedDayPrimaryStay, selectedTimelineDate, selectedTrip])
  const selectedDayRecommendations = useRecommendedPlaces(selectedDayRecommendationSeeds, selectedTrip?.country)
  const dayRecommendationRadius = useMemo(() => {
    const base = selectedDayRecommendations.recommendations
      .filter((rec) => !dismissedRecommendationKeys.includes(rec.key))
      .filter((rec) => !plannedActivityNames.has(normalizeRecommendationLabel(rec.label)))

    const within10km = base.filter((rec) => {
      if (selectedDayAnchorCoords.length === 0) return true
      if (typeof rec.lat !== 'number' || typeof rec.lon !== 'number') return selectedDayRadiusPartial
      return selectedDayAnchorCoords.some((anchor) => haversineKm(anchor, { lat: rec.lat!, lon: rec.lon! }) <= 10)
    })

    const within20km = base.filter((rec) => {
      if (selectedDayAnchorCoords.length === 0) return true
      if (typeof rec.lat !== 'number' || typeof rec.lon !== 'number') return selectedDayRadiusPartial
      return selectedDayAnchorCoords.some((anchor) => haversineKm(anchor, { lat: rec.lat!, lon: rec.lon! }) <= 20)
    })

    const isUsing20kmFallback = within10km.length < 4 && within20km.length > within10km.length
    const selected = (isUsing20kmFallback ? within20km : within10km)
      .slice(0, 4)
      .map((rec) => ({ ...rec, category: resolveRecommendationCategory(rec.category, rec.label, rec.primaryType, rec.types) }))

    return { selected, isUsing20kmFallback, within10Count: within10km.length }
  }, [dismissedRecommendationKeys, plannedActivityNames, selectedDayAnchorCoords, selectedDayRadiusPartial, selectedDayRecommendations.recommendations])
  const visibleSelectedDayRecommendations = dayRecommendationRadius.selected
  const activityPlaceSearch = usePlaceSuggestions(activityPlaceSearchInput)
  const homeSearch = useDestinationSuggestions(newTripDestination)
  const mapPoints = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = []
    for (const s of stays) {
      out.push({
        key: `stay:${s.id}`,
        label: s.location,
        kind: 'stay',
        addressHint: s.address || s.location,
        startDate: s.startDate,
        endDate: s.endDate,
      })
    }
    for (const p of visitPlaces) {
      out.push({
        key: `place:${p.id}`,
        label: p.label,
        kind: 'place',
        lat: p.lat,
        lon: p.lon,
      })
    }
    return out
  }, [stays, visitPlaces])
  const todayIso = useMemo(() => toIsoDate(startOfToday()), [])
  const currentStay = useMemo(
    () => stays.find((s) => s.startDate && s.endDate && s.startDate <= todayIso && todayIso < s.endDate) ?? null,
    [stays, todayIso],
  )
  const overallTripProgressPct = useMemo(() => {
    if (!selectedTrip?.startDate || !selectedTrip.endDate) return null
    const start = parseIsoDate(selectedTrip.startDate)
    const end = parseIsoDate(selectedTrip.endDate)
    if (!start || !end || end < start) return null
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
    const elapsedDays = Math.round((startOfToday().getTime() - start.getTime()) / 86400000) + 1
    const clamped = Math.min(totalDays, Math.max(0, elapsedDays))
    return Math.round((clamped / totalDays) * 100)
  }, [selectedTrip?.endDate, selectedTrip?.startDate])
  const showSideGoalsRail = activeTab === 'planner'

  useEffect(() => {
    setPlaceSuggestionIndex(-1)
  }, [placeSearchInput, showPlaceSuggestions])

  useEffect(() => {
    setHomeSuggestionIndex(-1)
  }, [newTripDestination, showHomeSuggestions])

  useEffect(() => {
    cancelBookingEdit()
    if (bookingsTab !== 'accommodation') {
      setStayError(null)
    }
  }, [bookingsTab])

  useEffect(() => {
    setTripStartDateInput(selectedTrip?.startDate ?? '')
    setTripEndDateInput(selectedTrip?.endDate ?? '')
    setTripDateError(null)
  }, [selectedTrip?.id, selectedTrip?.startDate, selectedTrip?.endDate])

  useEffect(() => {
    setDismissedRecommendationKeys([])
  }, [selectedTrip?.id, recommendationSeeds.join('|')])

  useEffect(() => {
    if (!selectedTrip?.id) {
      setSelectedTimelineDate('')
      return
    }
    const first = timelineDays[0] ?? ''
    if (!first) {
      setSelectedTimelineDate('')
      return
    }
    setSelectedTimelineDate((prev) => (prev && timelineDays.includes(prev) ? prev : first))
  }, [selectedTrip?.id, timelineDays])

  useEffect(() => {
    setActivityDrafts({})
  }, [selectedTrip?.id])

  useEffect(() => {
    const stay = selectedDayPrimaryStay
    const country = selectedTrip?.country?.trim()
    if (!selectedTimelineDate || (!stay && selectedDayActivities.length === 0)) {
      setSelectedDayAnchorCoords([])
      setSelectedDayRadiusPartial(false)
      return
    }
    if (!GOOGLE_MAPS_API_KEY) {
      setSelectedDayAnchorCoords([])
      setSelectedDayRadiusPartial(true)
      return
    }

    const queries: string[] = []
    if (stay?.address?.trim()) queries.push(stay.address.trim())
    if (stay?.location?.trim()) queries.push(stay.location.trim())
    for (const a of selectedDayActivities.slice(0, 5)) {
      const label = (a.activity.placeLabel || a.activity.name || '').trim()
      if (label) queries.push(label)
    }
    const uniqueQueries = Array.from(new Set(queries.filter(Boolean)))
    if (uniqueQueries.length === 0) {
      setSelectedDayAnchorCoords([])
      setSelectedDayRadiusPartial(false)
      return
    }

    const controller = new AbortController()
    const run = async () => {
      let unresolved = 0
      const coords: Array<{ lat: number; lon: number }> = []
      await Promise.all(
        uniqueQueries.map(async (q) => {
          try {
            const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
                'X-Goog-FieldMask': 'places.location',
              },
              body: JSON.stringify({
                textQuery: country ? `${q} ${country}` : q,
                languageCode: 'en',
                maxResultCount: 1,
              }),
            })
            if (!res.ok) throw new Error(`Anchor resolve failed (${res.status})`)
            const data = (await res.json()) as any
            const loc = data?.places?.[0]?.location
            if (typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number') {
              coords.push({ lat: loc.latitude, lon: loc.longitude })
            } else {
              unresolved += 1
            }
          } catch {
            unresolved += 1
          }
        }),
      )

      if (controller.signal.aborted) return
      const dedup = Array.from(new Map(coords.map((c) => [`${c.lat.toFixed(5)}:${c.lon.toFixed(5)}`, c])).values())
      setSelectedDayAnchorCoords(dedup)
      setSelectedDayRadiusPartial(unresolved > 0 || dedup.length === 0)
    }
    run()
    return () => controller.abort()
  }, [selectedDayActivities, selectedDayPrimaryStay, selectedTimelineDate, selectedTrip?.country])

  useEffect(() => {
    const destination = newTripDestination.trim()
    if (!destination) {
      setPeakSeasonInfo(null)
      return
    }
    const indicatorMonthDate = newTripRange?.from ?? parseIsoDate(newTripStartDate) ?? new Date()
    setPeakSeasonInfo(getPeakSeasonInfoFromLocalDb(destination, indicatorMonthDate))
  }, [newTripDestination, newTripRange?.from, newTripStartDate])

  useEffect(() => {
    if (activeTab !== 'map') return
    if (!GOOGLE_MAPS_API_KEY) {
      setMapApiError('Google Maps API key missing (set VITE_GOOGLE_MAPS_API_KEY).')
      return
    }
    if (!GOOGLE_MAPS_MAP_ID) {
      setMapApiError('Google Maps Map ID missing (set VITE_GOOGLE_MAPS_MAP_ID).')
      return
    }
    const w = window as any
    if (w.google?.maps) {
      setMapApiLoaded(true)
      setMapApiError(null)
      return
    }
    const existing = document.getElementById('google-maps-js-sdk') as HTMLScriptElement | null
    if (existing) {
      const onLoad = () => setMapApiLoaded(true)
      existing.addEventListener('load', onLoad, { once: true })
      return () => existing.removeEventListener('load', onLoad)
    }
    const script = document.createElement('script')
    script.id = 'google-maps-js-sdk'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=marker&loading=async`
    script.async = true
    script.defer = true
    script.onload = () => {
      setMapApiLoaded(true)
      setMapApiError(null)
    }
    script.onerror = () => setMapApiError('Unable to load Google Maps JS SDK.')
    document.head.appendChild(script)
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'map' || !selectedTrip) return
    if (!GOOGLE_MAPS_API_KEY) return
    const unresolved = mapPoints.filter((p) => !(typeof p.lat === 'number' && typeof p.lon === 'number') && !resolvedPointCoords[p.key])
    if (unresolved.length === 0) return
    let cancelled = false
    const resolveMissing = async () => {
      const updates: Record<string, { lat: number; lon: number }> = {}
      for (const p of unresolved) {
        const query = [p.label, p.addressHint, selectedTrip.country].filter(Boolean).join(', ')
        try {
          const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
              'X-Goog-FieldMask': 'places.location',
            },
            body: JSON.stringify({
              textQuery: query,
              languageCode: 'en',
              maxResultCount: 1,
            }),
          })
          if (!res.ok) continue
          const data = (await res.json()) as any
          const loc = data?.places?.[0]?.location
          if (typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number') {
            updates[p.key] = { lat: loc.latitude, lon: loc.longitude }
          }
        } catch {
          // Ignore individual geocode failures; map still renders available points.
        }
      }
      if (cancelled || Object.keys(updates).length === 0) return
      setResolvedPointCoords((prev) => ({ ...prev, ...updates }))
    }
    void resolveMissing()
    return () => {
      cancelled = true
    }
  }, [activeTab, mapPoints, resolvedPointCoords, selectedTrip, stays, visitPlaces])

  useEffect(() => {
    if (activeTab !== 'map' || !mapApiLoaded || !mapContainerRef.current) return
    const w = window as any
    const g = w.google
    if (!g?.maps) return
    if (!GOOGLE_MAPS_MAP_ID) {
      setMapApiError('Google Maps Map ID missing (set VITE_GOOGLE_MAPS_MAP_ID).')
      return
    }
    const AdvancedMarker = g.maps?.marker?.AdvancedMarkerElement as
      | (new (opts: any) => any)
      | undefined
    if (!AdvancedMarker) {
      setMapApiError('Google Maps marker library not available yet. Please refresh the page.')
      return
    }

    const resolved = mapPoints
      .map((p) => {
        if (typeof p.lat === 'number' && typeof p.lon === 'number') return { ...p, lat: p.lat, lon: p.lon }
        const fallback = resolvedPointCoords[p.key]
        if (fallback) return { ...p, lat: fallback.lat, lon: fallback.lon }
        return null
      })
      .filter((p): p is MapPoint & { lat: number; lon: number } => Boolean(p))

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new g.maps.Map(mapContainerRef.current, {
        center: resolved[0] ? { lat: resolved[0].lat, lng: resolved[0].lon } : { lat: 0, lng: 0 },
        zoom: resolved.length > 0 ? 6 : 2,
        mapId: GOOGLE_MAPS_MAP_ID,
        mapTypeControl: false,
        streetViewControl: false,
      })
    }
    const map = mapInstanceRef.current

    for (const m of mapMarkersRef.current) {
      if (m && 'map' in m) (m as any).map = null
      else if (m && typeof (m as any).setMap === 'function') (m as any).setMap(null)
    }
    mapMarkersRef.current = []

    const bounds = new g.maps.LatLngBounds()
    for (const p of resolved) {
      const markerContent = document.createElement('div')
      markerContent.className =
        p.kind === 'stay'
          ? 'h-7 w-7 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shadow'
          : 'h-7 w-7 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center shadow'
      markerContent.textContent = p.kind === 'stay' ? 'S' : 'P'
      const marker = new AdvancedMarker({
        map,
        position: { lat: p.lat, lng: p.lon } as any,
        title: p.label,
        content: markerContent,
      })
      mapMarkersRef.current.push(marker)
      bounds.extend({ lat: p.lat, lng: p.lon })
    }

    if (mapPolylineRef.current) {
      mapPolylineRef.current.setMap(null)
      mapPolylineRef.current = null
    }
    const stayPath = stays
      .map((s) => {
        const key = `stay:${s.id}`
        const point = resolved.find((r) => r.key === key)
        return point ? { lat: point.lat, lng: point.lon } : null
      })
      .filter((x): x is { lat: number; lng: number } => Boolean(x))
    if (stayPath.length >= 2) {
      mapPolylineRef.current = new g.maps.Polyline({
        map,
        path: stayPath,
        geodesic: true,
        strokeColor: '#2563eb',
        strokeOpacity: 0.85,
        strokeWeight: 4,
      })
    }

    if (resolved.length > 1) {
      map.fitBounds(bounds, 50)
    } else if (resolved[0]) {
      map.setCenter({ lat: resolved[0].lat, lng: resolved[0].lon })
      map.setZoom(10)
    }
  }, [activeTab, mapApiLoaded, mapPoints, resolvedPointCoords, stays])

  const createTrip = (country: string, startDate = '', endDate = '') => {
    const c = country.trim()
    if (!c) return
    const trip: Trip = {
      id: uid(),
      country: c,
      startDate,
      endDate,
      createdAt: Date.now(),
      mustDos: [],
      packList: [],
      visitPlaces: [],
      stays: [],
      bookings: { rentalCars: [], flights: [], restaurants: [], accommodations: [] },
    }
    setState((prev) => ({ trips: [trip, ...prev.trips], selectedTripId: trip.id }))
    setMustDoInput('')
  }

  const addPackListItem = () => {
    if (!state.selectedTripId) return
    const text = packListTextInput.trim()
    if (!text) return
    const category = packListCategoryInput.trim() || 'Other'
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) =>
        t.id !== prev.selectedTripId
          ? t
          : {
              ...t,
              packList: [...t.packList, { id: uid(), text, category, done: false, createdAt: Date.now() }],
            },
      ),
    }))
    setPackListTextInput('')
  }

  const togglePackListItem = (itemId: string) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) =>
        t.id !== prev.selectedTripId
          ? t
          : {
              ...t,
              packList: t.packList.map((x) => (x.id === itemId ? { ...x, done: !x.done } : x)),
            },
      ),
    }))
  }

  const deletePackListItem = (itemId: string) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) =>
        t.id !== prev.selectedTripId
          ? t
          : {
              ...t,
              packList: t.packList.filter((x) => x.id !== itemId),
            },
      ),
    }))
  }

  const autofillFlightFromText = () => {
    const text = flightQuickInput.trim()
    if (!text) return
    const routeMatch = text.match(/([A-Za-z]{3}\s*(?:->|to|-)\s*[A-Za-z]{3})/)
    const confMatch = text.match(/(?:confirmation|booking|pnr)\s*[:#]?\s*([A-Z0-9-]{5,})/i)
    const priceMatch = text.match(/([$€£]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:usd|eur|gbp))/i)
    if (routeMatch && !flightRouteInput) setFlightRouteInput(routeMatch[1].replace(/\s+/g, ' '))
    if (confMatch && !flightConfirmationInput) setFlightConfirmationInput(confMatch[1])
    if (priceMatch && !flightPriceInput) setFlightPriceInput(priceMatch[1])
  }

  const addBooking = () => {
    if (!state.selectedTripId) return
    setBookingError(null)
    if (bookingsTab === 'rentalCar') {
      const company = carCompanyInput.trim()
      if (!company) return setBookingError('Car company is required.')
      setState((prev) => ({
        ...prev,
        trips: prev.trips.map((t) =>
          t.id === prev.selectedTripId
            ? {
                ...t,
                bookings: {
                  ...t.bookings,
                  rentalCars: [
                    ...t.bookings.rentalCars,
                    {
                      id: uid(),
                      company,
                      pickupLocation: carPickupLocationInput.trim(),
                      dropoffLocation: carDropoffLocationInput.trim(),
                      pickupDate: carPickupInput,
                      dropoffDate: carDropoffInput,
                      confirmation: carConfirmationInput.trim(),
                      price: carPriceInput.trim(),
                      createdAt: Date.now(),
                    },
                  ],
                },
              }
            : t,
        ),
      }))
      setCarCompanyInput('')
      setCarPickupLocationInput('')
      setCarDropoffLocationInput('')
      setCarPickupInput('')
      setCarDropoffInput('')
      setCarConfirmationInput('')
      setCarPriceInput('')
      return
    }
    if (bookingsTab === 'flight') {
      const route = flightRouteInput.trim()
      if (!route) return setBookingError('Flight route is required.')
      setState((prev) => ({
        ...prev,
        trips: prev.trips.map((t) =>
          t.id === prev.selectedTripId
            ? {
                ...t,
                bookings: {
                  ...t.bookings,
                  flights: [
                    ...t.bookings.flights,
                    {
                      id: uid(),
                      route,
                      departDate: flightDepartInput,
                      returnDate: '',
                      confirmation: flightConfirmationInput.trim(),
                      price: flightPriceInput.trim(),
                      createdAt: Date.now(),
                    },
                  ],
                },
              }
            : t,
        ),
      }))
      setFlightRouteInput('')
      setFlightDepartInput('')
      setFlightConfirmationInput('')
      setFlightPriceInput('')
      setFlightQuickInput('')
      return
    }
    if (bookingsTab === 'restaurant') {
      const name = restaurantNameInput.trim()
      if (!name) return setBookingError('Restaurant name is required.')
      setState((prev) => ({
        ...prev,
        trips: prev.trips.map((t) =>
          t.id === prev.selectedTripId
            ? {
                ...t,
                bookings: {
                  ...t.bookings,
                  restaurants: [
                    ...t.bookings.restaurants,
                    {
                      id: uid(),
                      name,
                      reservationDate: restaurantDateInput,
                      confirmation: restaurantConfirmationInput.trim(),
                      cost: restaurantCostInput.trim(),
                      notes: restaurantNotesInput.trim(),
                      createdAt: Date.now(),
                    },
                  ],
                },
              }
            : t,
        ),
      }))
      setRestaurantNameInput('')
      setRestaurantDateInput('')
      setRestaurantConfirmationInput('')
      setRestaurantCostInput('')
      setRestaurantNotesInput('')
      return
    }
    setBookingError('Accommodation details are managed in the Trip stays card.')
  }

  const removeBooking = (tab: BookingTab, id: string) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) => {
        if (t.id !== prev.selectedTripId) return t
        if (tab === 'rentalCar') return { ...t, bookings: { ...t.bookings, rentalCars: t.bookings.rentalCars.filter((x) => x.id !== id) } }
        if (tab === 'flight') return { ...t, bookings: { ...t.bookings, flights: t.bookings.flights.filter((x) => x.id !== id) } }
        if (tab === 'restaurant') return { ...t, bookings: { ...t.bookings, restaurants: t.bookings.restaurants.filter((x) => x.id !== id) } }
        return { ...t, bookings: { ...t.bookings, accommodations: t.bookings.accommodations.filter((x) => x.id !== id) } }
      }),
    }))
  }

  const updateBooking = (tab: BookingTab, id: string, updater: (booking: any) => any) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) => {
        if (t.id !== prev.selectedTripId) return t
        if (tab === 'rentalCar') {
          return { ...t, bookings: { ...t.bookings, rentalCars: t.bookings.rentalCars.map((x) => (x.id === id ? updater(x) : x)) } }
        }
        if (tab === 'flight') {
          return { ...t, bookings: { ...t.bookings, flights: t.bookings.flights.map((x) => (x.id === id ? updater(x) : x)) } }
        }
        if (tab === 'restaurant') {
          return { ...t, bookings: { ...t.bookings, restaurants: t.bookings.restaurants.map((x) => (x.id === id ? updater(x) : x)) } }
        }
        return { ...t, bookings: { ...t.bookings, accommodations: t.bookings.accommodations.map((x) => (x.id === id ? updater(x) : x)) } }
      }),
    }))
  }

  const addVisitPlace = (label: string, coords?: { lat: number; lon: number }) => {
    const t = label.trim()
    if (!t || !state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => {
        if (trip.id !== prev.selectedTripId) return trip
        if (trip.visitPlaces.some((p) => p.label.toLowerCase() === t.toLowerCase())) return trip
        const place: VisitPlace = {
          id: uid(),
          label: t,
          cost: '',
          createdAt: Date.now(),
          ...(coords ? { lat: coords.lat, lon: coords.lon } : {}),
        }
        return { ...trip, visitPlaces: [...trip.visitPlaces, place] }
      }),
    }))
    setPlaceSearchInput('')
    setShowPlaceSuggestions(false)
  }

  const removeVisitPlace = (placeId: string) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id === prev.selectedTripId ? { ...trip, visitPlaces: trip.visitPlaces.filter((p) => p.id !== placeId) } : trip,
      ),
    }))
  }

  const updateVisitPlaceCost = (placeId: string, cost: string) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id === prev.selectedTripId
          ? {
              ...trip,
              visitPlaces: trip.visitPlaces.map((p) => (p.id === placeId ? { ...p, cost } : p)),
            }
          : trip,
      ),
    }))
  }

  const addRecommendedActivity = (rec: PlaceSuggestion) => {
    const recName = rec.label.split(',')[0]?.trim() || rec.label.trim()
    if (plannedActivityNames.has(recName.toLowerCase())) return
    addVisitPlace(
      rec.label,
      typeof rec.lat === 'number' && typeof rec.lon === 'number' ? { lat: rec.lat, lon: rec.lon } : undefined,
    )
    if (!state.selectedTripId || !selectedTrip) return
    const ranked = stays.map((s) => {
      const base = (rec.seedLabel ?? '').toLowerCase()
      const address = s.address.toLowerCase()
      const loc = s.location.toLowerCase()
      let score = 0
      if (base && (address.includes(base) || loc.includes(base))) score += 3
      if (rec.label.toLowerCase().includes(loc)) score += 1
      return { stay: s, score }
    })
    ranked.sort((a, b) => b.score - a.score)
    const best = ranked[0]
    const candidateDays = best ? enumerateStayDays(best.stay.startDate, best.stay.endDate) : []

    let targetStayId = best?.stay.id ?? stays[0]?.id ?? ''
    let targetDate = candidateDays[0] ?? enumerateStayDays(stays[0]?.startDate ?? '', stays[0]?.endDate ?? '')[0] ?? ''
    if (!targetStayId || !targetDate) return
    const createdId = uid()
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => {
        if (trip.id !== prev.selectedTripId) return trip
        return {
          ...trip,
          stays: trip.stays.map((s) =>
            s.id === targetStayId
              ? {
                  ...s,
                  activities: [
                    ...(s.activities ?? []),
                    {
                      id: createdId,
                      date: targetDate,
                      name: rec.label,
                      time: '',
                      cost: '',
                      notes: '',
                      photoUrl: rec.photoUrl,
                      googleMapsUri: placeGoogleUrl(rec),
                      placeLabel: rec.label,
                      category: resolveRecommendationCategory(rec.category, rec.label, rec.primaryType, rec.types),
                      primaryType: rec.primaryType,
                      types: rec.types,
                      createdAt: Date.now(),
                    },
                  ],
                }
              : s,
          ),
        }
      }),
    }))
    setActivityMetaById((prev) => ({
      ...prev,
      [createdId]: {
        ...rec,
        googleMapsUri: placeGoogleUrl(rec),
        category: resolveRecommendationCategory(rec.category, rec.label, rec.primaryType, rec.types),
      },
    }))
  }

  const addRecommendationToSelectedDay = (rec: PlaceSuggestion) => {
    if (!state.selectedTripId || !selectedTimelineDate) return
    const targetStay = selectedDayPrimaryStay
    if (!targetStay) return
    const recName = rec.label.split(',')[0]?.trim() || rec.label.trim()
    if (!recName) return
    const addressHint = rec.label.includes(',') ? rec.label.split(',').slice(1).join(',').trim() : ''
    const createdId = uid()

    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => {
        if (trip.id !== prev.selectedTripId) return trip
        const duplicateExists = trip.stays.some((s) =>
          (s.activities ?? []).some((a) => a.date === selectedTimelineDate && a.name.trim().toLowerCase() === recName.toLowerCase()),
        )
        if (duplicateExists) return trip

        return {
          ...trip,
          stays: trip.stays.map((s) =>
            s.id !== targetStay.id
              ? s
              : {
                  ...s,
                  activities: [
                    ...(s.activities ?? []),
                    {
                      id: createdId,
                      date: selectedTimelineDate,
                      name: recName,
                      time: '',
                      cost: '',
                      notes: addressHint || rec.label,
                      photoUrl: rec.photoUrl,
                      googleMapsUri: placeGoogleUrl(rec),
                      placeLabel: rec.label,
                      category: resolveRecommendationCategory(rec.category, rec.label, rec.primaryType, rec.types),
                      primaryType: rec.primaryType,
                      types: rec.types,
                      createdAt: Date.now(),
                    },
                  ],
                },
          ),
        }
      }),
    }))
    setActivityMetaById((prev) => ({
      ...prev,
      [createdId]: {
        ...rec,
        category: resolveRecommendationCategory(rec.category, rec.label, rec.primaryType, rec.types),
        googleMapsUri: placeGoogleUrl(rec),
      },
    }))
  }

  const launchConfetti = (event?: ChangeEvent<HTMLInputElement>) => {
    const mouse = event?.nativeEvent instanceof MouseEvent ? event.nativeEvent : null
    const x = mouse?.clientX ?? 160
    const y = mouse?.clientY ?? 140
    const id = uid()
    setConfettiBursts((prev) => [...prev, { id, x, y }])
    window.setTimeout(() => {
      setConfettiBursts((prev) => prev.filter((b) => b.id !== id))
    }, 1200)
  }

  const playSideGoalChime = () => {
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) return
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContextCtor()
      const ctx = audioCtxRef.current
      if (!ctx) return
      if (ctx.state === 'suspended') void ctx.resume()

      const t0 = ctx.currentTime
      const notes = [523.25, 659.25] // C5 then E5
      const durations = [0.11, 0.14]

      // Shared envelope so it doesn't click.
      for (let i = 0; i < notes.length; i++) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(notes[i], t0 + i * 0.12)
        const start = t0 + i * 0.12
        const stop = start + durations[i]

        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.05, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, stop)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(start)
        osc.stop(stop)
      }
    } catch {
      // Ignore audio failures (e.g. browser policy).
    }
  }

  const saveTripDates = () => {
    if (!selectedTrip || !state.selectedTripId) return
    if (!tripStartDateInput || !tripEndDateInput) {
      setTripDateError('Please set both trip start and end dates.')
      return
    }
    if (tripEndDateInput < tripStartDateInput) {
      setTripDateError('Trip end date cannot be before trip start date.')
      return
    }

    const violatingStay = (selectedTrip.stays ?? []).find(
      (s) => s.startDate < tripStartDateInput || s.endDate > tripEndDateInput,
    )
    if (violatingStay) {
      setTripDateError(`Stay "${violatingStay.location}" is outside the selected trip dates.`)
      return
    }

    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id === prev.selectedTripId ? { ...trip, startDate: tripStartDateInput, endDate: tripEndDateInput } : trip,
      ),
    }))
    setTripDateError(null)
  }

  const addStay = () => {
    if (!state.selectedTripId || !selectedTrip) return
    const location = stayLocationInput.trim()
    if (!location || !stayStartDate || !stayEndDate) {
      setStayError('Please enter location, check-in, and check-out dates.')
      return
    }
    if (stayEndDate < stayStartDate) {
      setStayError('Check-out date cannot be before check-in.')
      return
    }
    if (selectedTrip.startDate && stayStartDate < selectedTrip.startDate) {
      setStayError(`Stay starts before trip starts (${selectedTrip.startDate}).`)
      return
    }
    if (selectedTrip.endDate && stayEndDate > selectedTrip.endDate) {
      setStayError(`Stay ends after trip ends (${selectedTrip.endDate}).`)
      return
    }

    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id === prev.selectedTripId
          ? {
              ...trip,
              stays: [
                ...trip.stays,
                {
                  id: uid(),
                  location,
                  address: stayAddressInput.trim(),
                  startDate: stayStartDate,
                  endDate: stayEndDate,
                  price: stayPriceInput.trim(),
                  bookingUrl: stayBookingUrlInput.trim() ? normalizeBookingUrl(stayBookingUrlInput) : '',
                  confirmationRef: stayConfirmationRefInput.trim(),
                  activities: [],
                  createdAt: Date.now(),
                },
              ],
            }
          : trip,
      ),
    }))
    setStayError(null)
    setStayLocationInput('')
    setStayAddressInput('')
    setStayStartDate('')
    setStayEndDate('')
    setStayPriceInput('')
    setStayBookingUrlInput('')
    setStayConfirmationRefInput('')
  }

  const addStayActivity = (stayId: string, date: string) => {
    if (!state.selectedTripId) return
    const draftKey = `${stayId}|${date}`
    const draft = activityDrafts[draftKey]
    const name = (draft?.name ?? '').trim()
    if (!name) return
    const createdId = uid()
    const selectedMeta = draftPlaceMeta[draftKey]
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => {
        if (trip.id !== prev.selectedTripId) return trip
        return {
          ...trip,
          stays: trip.stays.map((s) =>
            s.id === stayId
              ? {
                  ...s,
                  activities: [
                    ...(s.activities ?? []),
                    {
                      id: createdId,
                      date,
                      name,
                      time: draft?.time ?? '',
                      cost: draft?.cost ?? '',
                      notes: draft?.notes ?? '',
                      photoUrl: selectedMeta?.photoUrl,
                      googleMapsUri: selectedMeta ? placeGoogleUrl(selectedMeta) : undefined,
                      placeLabel: selectedMeta?.label,
                      category: selectedMeta ? resolveRecommendationCategory(selectedMeta.category, selectedMeta.label, selectedMeta.primaryType, selectedMeta.types) : undefined,
                      primaryType: selectedMeta?.primaryType,
                      types: selectedMeta?.types,
                      createdAt: Date.now(),
                    },
                  ],
                }
              : s,
          ),
        }
      }),
    }))
    setActivityDrafts((prev) => ({ ...prev, [draftKey]: { name: '', time: '', cost: '', notes: '' } }))
    setActivityPlaceSearchInput('')
    if (selectedMeta) {
      setActivityMetaById((prev) => ({
        ...prev,
        [createdId]: {
          ...selectedMeta,
          googleMapsUri: placeGoogleUrl(selectedMeta),
          category: resolveRecommendationCategory(selectedMeta.category, selectedMeta.label, selectedMeta.primaryType, selectedMeta.types),
        },
      }))
      setDraftPlaceMeta((prev) => {
        const next = { ...prev }
        delete next[draftKey]
        return next
      })
    }
  }

  const updateStayActivity = (stayId: string, activityId: string, patch: Partial<StayActivity>) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => {
        if (trip.id !== prev.selectedTripId) return trip
        return {
          ...trip,
          stays: trip.stays.map((s) =>
            s.id === stayId ? { ...s, activities: (s.activities ?? []).map((a) => (a.id === activityId ? { ...a, ...patch } : a)) } : s,
          ),
        }
      }),
    }))
  }

  const removeStayActivity = (stayId: string, activityId: string) => {
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => {
        if (trip.id !== prev.selectedTripId) return trip
        return {
          ...trip,
          stays: trip.stays.map((s) => (s.id === stayId ? { ...s, activities: (s.activities ?? []).filter((a) => a.id !== activityId) } : s)),
        }
      }),
    }))
  }

  const cancelBookingEdit = () => {
    setEditingBooking(null)
    setEditCarDraft(null)
    setEditFlightDraft(null)
    setEditRestaurantDraft(null)
    setBookingError(null)
  }

  const saveBookingEdit = () => {
    if (!editingBooking) return
    setBookingError(null)
    if (editingBooking.tab === 'rentalCar' && editCarDraft) {
      const company = editCarDraft.company.trim()
      if (!company) return setBookingError('Car company is required.')
      updateBooking('rentalCar', editingBooking.id, (x: CarBooking) => ({ ...x, ...editCarDraft, company }))
      cancelBookingEdit()
      return
    }
    if (editingBooking.tab === 'flight' && editFlightDraft) {
      const route = editFlightDraft.route.trim()
      if (!route) return setBookingError('Flight route is required.')
      updateBooking('flight', editingBooking.id, (x: FlightBooking) => ({ ...x, ...editFlightDraft, route, returnDate: '' }))
      cancelBookingEdit()
      return
    }
    if (editingBooking.tab === 'restaurant' && editRestaurantDraft) {
      const name = editRestaurantDraft.name.trim()
      if (!name) return setBookingError('Restaurant name is required.')
      updateBooking('restaurant', editingBooking.id, (x: RestaurantBooking) => ({ ...x, ...editRestaurantDraft, name }))
      cancelBookingEdit()
    }
  }

  useEffect(() => {
    if (view !== 'dashboard' || !selectedTrip) {
      setDashboardHeroUrl(null)
      return
    }
    setDashboardHeroUrl(null)
    let cancelled = false
    fetchLocationHeroImage(selectedTrip.country).then((url) => {
      if (cancelled) return
      setDashboardHeroUrl(url)
    })

    return () => {
      cancelled = true
    }
  }, [view, selectedTrip?.id, selectedTrip?.country])

  const addMustDo = (text: string) => {
    const t = text.trim()
    if (!t) return
    if (!state.selectedTripId) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => {
        if (trip.id !== prev.selectedTripId) return trip
        return { ...trip, mustDos: [{ id: uid(), text: t, done: false, createdAt: Date.now() }, ...trip.mustDos] }
      }),
    }))
    setMustDoInput('')
  }

  if (view === 'home') {
    return (
      <div className={`min-h-screen bg-gradient-to-b from-sky-50 via-white to-neutral-100 text-neutral-900 font-sans ${isDarkMode ? 'dark' : ''}`}>
        <button
          type="button"
          onClick={() => setIsDarkMode((v) => !v)}
          className="fixed top-4 right-4 z-50 inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 bg-white/90 backdrop-blur text-sm font-medium shadow-sm hover:bg-neutral-50"
          aria-label="Toggle dark mode"
        >
          {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          {isDarkMode ? 'Light' : 'Dark'}
        </button>
        <div className="max-w-5xl mx-auto px-4 py-14">
          <header className="text-center">
            <h1 className="text-4xl md:text-5xl font-serif font-bold">Trip Planner</h1>
            <p className="mt-3 text-neutral-600">Start by creating a trip, then continue in the dashboard.</p>
          </header>

          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => {
                setNewTripDestination('')
                setNewTripStartDate('')
                setNewTripEndDate('')
                setNewTripRange(undefined)
                setShowAddTripModal(true)
              }}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-500 hover:to-indigo-500 shadow-lg"
            >
              Add New Trip
            </button>
          </div>

          <section className="mt-10">
            <h2 className="text-xl font-semibold">Your Trips</h2>
            {tripsSorted.length === 0 ? (
              <p className="mt-3 text-neutral-500">No trips yet. Create your first one.</p>
            ) : (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {tripsSorted.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => {
                      setState((prev) => ({ ...prev, selectedTripId: trip.id }))
                      setView('dashboard')
                    }}
                    className="text-left bg-white border border-neutral-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="font-semibold text-lg">{trip.country}</div>
                    <div className="text-sm text-neutral-600 mt-1">{formatDateRangeLabel(trip.startDate, trip.endDate)}</div>
                    <div className="text-xs text-neutral-500 mt-2">{trip.mustDos.length} side goals</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {showAddTripModal ? (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
            <div className="w-[min(100%,26rem)] bg-white rounded-2xl shadow-2xl p-6">
              <h3 className="text-xl font-semibold">Add New Trip</h3>
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  const destination = newTripDestination.trim()
                  if (!destination) return
                  const todayIso = toIsoDate(startOfToday())
                  if (newTripStartDate && newTripStartDate < todayIso) return
                  if (newTripEndDate && newTripEndDate < todayIso) return
                  createTrip(destination, newTripStartDate, newTripEndDate)
                  setNewTripDestination('')
                  setNewTripStartDate('')
                  setNewTripEndDate('')
                  setNewTripRange(undefined)
                  setShowHomeSuggestions(false)
                  setShowAddTripModal(false)
                  setView('dashboard')
                  setActiveTab('planner')
                }}
              >
                <div className="relative">
                  <label className="block text-sm font-medium mb-1">Destination</label>
                  <input
                    value={newTripDestination}
                    onChange={(e) => {
                      setNewTripDestination(e.target.value)
                      setShowHomeSuggestions(true)
                    }}
                    onFocus={() => setShowHomeSuggestions(true)}
                          onKeyDown={(e) => {
                            const items = homeSearch.suggestions
                            if (!showHomeSuggestions || items.length === 0) return

                            if (e.key === 'ArrowDown') {
                              e.preventDefault()
                              setHomeSuggestionIndex((prev) => (prev + 1) % items.length)
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault()
                              setHomeSuggestionIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1))
                            } else if (e.key === 'Enter') {
                              if (homeSuggestionIndex >= 0 && homeSuggestionIndex < items.length) {
                                e.preventDefault()
                                setNewTripDestination(items[homeSuggestionIndex])
                                setShowHomeSuggestions(false)
                              }
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              setShowHomeSuggestions(false)
                            }
                          }}
                    onBlur={() => {
                      setTimeout(() => setShowHomeSuggestions(false), 100)
                    }}
                    placeholder="e.g. New Zealand"
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                  {showHomeSuggestions && homeSearch.suggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-xl shadow-xl z-20 overflow-hidden">
                      {homeSearch.suggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setNewTripDestination(name)
                            setShowHomeSuggestions(false)
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm ${
                            homeSearch.suggestions[homeSuggestionIndex] === name ? 'bg-blue-100' : 'hover:bg-blue-50'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Travel dates</label>
                  <div className="w-full rounded-2xl border border-neutral-200 p-3 bg-neutral-50/70">
                    <DayPicker
                      mode="range"
                      selected={newTripRange}
                      defaultMonth={newTripRange?.from ?? new Date()}
                      captionLayout="dropdown-years"
                      navLayout="after"
                      fromYear={new Date().getFullYear()}
                      toYear={new Date().getFullYear() + 10}
                      startMonth={startOfToday()}
                      fixedWeeks
                      showOutsideDays
                      disabled={{ before: startOfToday() }}
                      onDayClick={(day, modifiers) => {
                        if (modifiers.disabled) return
                        // If a multi-day range already exists, clicking any day starts a fresh range.
                        // Keep single-day selections expandable to an end date in another month.
                        if (
                          newTripRange?.from &&
                          newTripRange?.to &&
                          newTripRange.from.getTime() !== newTripRange.to.getTime()
                        ) {
                          const next = { from: day, to: undefined }
                          setNewTripRange(next)
                          setNewTripStartDate(toIsoDate(next.from))
                          setNewTripEndDate('')
                        }
                      }}
                      onSelect={(range) => {
                        setNewTripRange(range)
                        setNewTripStartDate(toIsoDate(range?.from))
                        setNewTripEndDate(toIsoDate(range?.to))
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
                  </div>
                  <div className="mt-2 text-center">
                    {newTripDestination.trim() ? (
                      peakSeasonInfo ? (
                        <span
                          className={`inline-flex items-center peak-season-indicator ${
                            peakSeasonInfo.isPeakMonth ? 'peak-season-indicator--peak' : 'peak-season-indicator--offpeak'
                          }`}
                        >
                          {peakSeasonInfo.isPeakMonth ? `Peak season this month (${peakSeasonInfo.peakLabel})` : `Peak season: ${peakSeasonInfo.peakLabel}`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center peak-season-indicator peak-season-indicator--unknown">Peak season info unavailable</span>
                      )
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs text-neutral-600 text-center">
                    {newTripStartDate || newTripEndDate ? formatDateRangeLabel(newTripStartDate, newTripEndDate) : 'Select your start and end dates.'}
                  </div>
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddTripModal(false)}
                    className="px-4 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold">
                    Create Trip
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`min-h-screen bg-gradient-to-b from-sky-50 via-white to-neutral-100 text-neutral-900 font-sans ${isDarkMode ? 'dark' : ''}`}>
      <button
        type="button"
        onClick={() => setIsDarkMode((v) => !v)}
        className="fixed top-4 right-4 z-50 inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 bg-white/90 backdrop-blur text-sm font-medium shadow-sm hover:bg-neutral-50"
        aria-label="Toggle dark mode"
      >
        {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
        {isDarkMode ? 'Light' : 'Dark'}
      </button>
      {/* Hero */}
      <div className="relative h-[46vh] w-full overflow-hidden">
        <img
          src={dashboardHeroUrl || DEFAULT_HERO_IMAGE}
          className="w-full h-full object-cover"
          alt="Hero"
        />
        <div className={`absolute inset-y-0 right-0 ${showSideGoalsRail ? 'left-[320px]' : 'left-0'} bg-gradient-to-b from-black/50 via-black/35 to-black/60 flex flex-col items-center justify-center text-white px-4 text-center`}>
          <h1 className="text-4xl md:text-6xl font-serif font-bold mb-4 drop-shadow-md">
            {selectedTrip ? `Trip to: ${selectedTrip.country}` : 'Trip Planner'}
          </h1>
          <p className="text-lg md:text-xl max-w-2xl opacity-95">Country to trip workflow with beautiful, focused planning</p>
          <div className="mt-6 flex gap-3 flex-wrap justify-center text-sm font-medium">
            <span className="bg-white/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/30 shadow-lg">
              {selectedTrip ? `Current: ${selectedTrip.country}` : 'No trip selected'}
            </span>
            <span className="bg-white/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/30 shadow-lg">
              {selectedTrip?.startDate || selectedTrip?.endDate
                ? formatDateRangeWithYear(selectedTrip?.startDate, selectedTrip?.endDate)
                : `Side goals remaining: ${remaining}`}
            </span>
          </div>
        </div>
      </div>

      <div className={showSideGoalsRail ? 'pl-[320px]' : ''}>
        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4 -mt-10 relative z-10">
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-2xl p-2.5 flex border border-white/70">
          <button
            onClick={() => setActiveTab('planner')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
              activeTab === 'planner' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Calendar size={18} />
            <span className="font-semibold text-xs sm:text-base">Planner</span>
          </button>
          <button
            onClick={() => setActiveTab('itinerary')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
              activeTab === 'itinerary' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Calendar size={18} />
            <span className="font-semibold text-xs sm:text-base">Itinerary</span>
          </button>
          <button
            onClick={() => setActiveTab('budget')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
              activeTab === 'budget' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <DollarSign size={18} />
            <span className="font-semibold text-xs sm:text-base">Budget</span>
          </button>
          <button
            onClick={() => setActiveTab('tips')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
              activeTab === 'tips' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Compass size={18} />
            <span className="font-semibold text-xs sm:text-base">Tips</span>
          </button>
          <button
            onClick={() => setActiveTab('map')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
              activeTab === 'map' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <MapIcon size={18} />
            <span className="font-semibold text-xs sm:text-base">Map</span>
          </button>
        </div>
      </div>

        {showSideGoalsRail ? (
        <aside className="fixed left-0 top-0 h-full w-[320px] z-40 bg-white border-r border-neutral-200 shadow-2xl p-5 overflow-auto">
          <div>
            <h3 className="text-xl font-serif font-bold">Side Goals</h3>
            <p className="text-xs text-neutral-500">Fun extras you would love to achieve.</p>
          </div>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addMustDo(mustDoInput)
          }}
        >
          <input
            value={mustDoInput}
            onChange={(e) => setMustDoInput(e.target.value)}
            disabled={!selectedTrip}
            placeholder={selectedTrip ? `Cool goal for ${selectedTrip.country}...` : 'Select a trip first...'}
            className="flex-1 px-3 py-2 rounded-xl border border-neutral-200 text-sm"
          />
          <button type="submit" disabled={!selectedTrip} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
            Add
          </button>
        </form>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-neutral-500">{remaining} remaining</p>
          <button
            type="button"
            disabled={!selectedTrip || mustDos.length === 0}
            onClick={() => {
              if (!selectedTrip) return
              if (!confirm(`Clear side goals for "${selectedTrip.country}"?`)) return
              setState((prev) => ({
                ...prev,
                trips: prev.trips.map((t) => (t.id === prev.selectedTripId ? { ...t, mustDos: [] } : t)),
              }))
            }}
            className="text-xs px-2 py-1 rounded-lg border border-neutral-200 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {mustDos.length === 0 ? (
            <p className="text-sm text-neutral-500">{selectedTrip ? 'No side goals yet.' : 'Select a trip first.'}</p>
          ) : (
            mustDos.map((m) => (
              <MustDoRow
                key={m.id}
                item={m}
                onToggle={(event) => {
                  const completing = !m.done
                  if (!state.selectedTripId) return
                  setState((prev) => ({
                    ...prev,
                    trips: prev.trips.map((t) => (t.id !== prev.selectedTripId ? t : { ...t, mustDos: t.mustDos.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)) })),
                  }))
                  if (completing) {
                    playSideGoalChime()
                    launchConfetti(event)
                  }
                }}
                onDelete={() => {
                  if (!state.selectedTripId) return
                  setState((prev) => ({
                    ...prev,
                    trips: prev.trips.map((t) => (t.id !== prev.selectedTripId ? t : { ...t, mustDos: t.mustDos.filter((x) => x.id !== m.id) })),
                  }))
                }}
                onEdit={(nextText) => {
                  if (!state.selectedTripId) return
                  setState((prev) => ({
                    ...prev,
                    trips: prev.trips.map((t) => (t.id !== prev.selectedTripId ? t : { ...t, mustDos: t.mustDos.map((x) => (x.id === m.id ? { ...x, text: nextText } : x)) })),
                  }))
                }}
              />
            ))
          )}
        </div>
        </aside>
        ) : null}

        <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="mb-5 flex justify-end">
          <button
            type="button"
            onClick={() => setView('home')}
            className="px-4 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 shadow-sm"
          >
            Back to Home
          </button>
        </div>
        {activeTab === 'planner' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Bookings */}
            <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 p-7">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-2xl font-serif font-bold">Bookings</h2>
                  <p className="text-neutral-500 text-sm">Track your trip reservations in one place.</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setBookingsTab('rentalCar')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium ${bookingsTab === 'rentalCar' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Rental Car
                </button>
                <button
                  type="button"
                  onClick={() => setBookingsTab('flight')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium ${bookingsTab === 'flight' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Flight
                </button>
                <button
                  type="button"
                  onClick={() => setBookingsTab('restaurant')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium ${bookingsTab === 'restaurant' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Restaurant
                </button>
                <button
                  type="button"
                  onClick={() => setBookingsTab('accommodation')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium ${bookingsTab === 'accommodation' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Accommodation
                </button>
              </div>

              <div className="mt-4">
                {bookingsTab === 'rentalCar' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input value={carCompanyInput} onChange={(e) => setCarCompanyInput(e.target.value)} disabled={!selectedTrip} placeholder="Company" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <input value={carPickupLocationInput} onChange={(e) => setCarPickupLocationInput(e.target.value)} disabled={!selectedTrip} placeholder="Pickup location" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <input value={carDropoffLocationInput} onChange={(e) => setCarDropoffLocationInput(e.target.value)} disabled={!selectedTrip} placeholder="Dropoff location" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <DateRangeDropdown
                        startDate={carPickupInput}
                        endDate={carDropoffInput}
                        onChange={(start, end) => {
                          setCarPickupInput(start)
                          setCarDropoffInput(end)
                        }}
                        disabled={!selectedTrip}
                        placeholder="Pickup and dropoff dates"
                        initialMonthIso={selectedTrip?.startDate}
                        className="sm:col-span-2"
                      />
                      <input value={carPriceInput} onChange={(e) => setCarPriceInput(e.target.value)} disabled={!selectedTrip} placeholder="Price" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <input value={carConfirmationInput} onChange={(e) => setCarConfirmationInput(e.target.value)} disabled={!selectedTrip} placeholder="Confirmation #" className="px-3 py-2 rounded-xl border border-neutral-200 sm:col-span-3" />
                    </div>
                    <ul className="mt-3 space-y-2">
                      {bookings.rentalCars.map((b) => (
                        <li key={b.id} className="px-3 py-2 rounded-xl border border-neutral-200">
                          {editingBooking?.tab === 'rentalCar' && editingBooking.id === b.id && editCarDraft ? (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input value={editCarDraft.company} onChange={(e) => setEditCarDraft((prev) => (prev ? { ...prev, company: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <input value={editCarDraft.pickupLocation} onChange={(e) => setEditCarDraft((prev) => (prev ? { ...prev, pickupLocation: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <input value={editCarDraft.dropoffLocation} onChange={(e) => setEditCarDraft((prev) => (prev ? { ...prev, dropoffLocation: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <DateRangeDropdown
                                startDate={editCarDraft.pickupDate}
                                endDate={editCarDraft.dropoffDate}
                                onChange={(start, end) => setEditCarDraft((prev) => (prev ? { ...prev, pickupDate: start, dropoffDate: end } : prev))}
                                placeholder="Pickup and dropoff dates"
                                initialMonthIso={selectedTrip?.startDate}
                                className="sm:col-span-2"
                              />
                              <input value={editCarDraft.price} onChange={(e) => setEditCarDraft((prev) => (prev ? { ...prev, price: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <input value={editCarDraft.confirmation} onChange={(e) => setEditCarDraft((prev) => (prev ? { ...prev, confirmation: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200 sm:col-span-3" />
                              <div className="sm:col-span-3 flex gap-2">
                                <button type="button" onClick={saveBookingEdit} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">Save</button>
                                <button type="button" onClick={cancelBookingEdit} className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm">
                                {b.company}
                                {(b.pickupLocation || b.dropoffLocation) ? ` | ${b.pickupLocation || 'Pickup'} -> ${b.dropoffLocation || 'Dropoff'}` : ''}
                                {b.pickupDate || b.dropoffDate ? ` (${formatDateRangeLabel(b.pickupDate, b.dropoffDate)})` : ''}
                                {b.price ? ` | ${b.price}` : ''}
                                {b.confirmation ? ` | ${b.confirmation}` : ''}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingBooking({ tab: 'rentalCar', id: b.id })
                                    setEditCarDraft({ ...b })
                                    setBookingError(null)
                                  }}
                                  className="text-xs text-blue-700 hover:text-blue-900"
                                >
                                  Edit
                                </button>
                                <button type="button" onClick={() => removeBooking('rentalCar', b.id)} className="text-xs text-neutral-600 hover:text-neutral-900">Remove</button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {bookingsTab === 'flight' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input value={flightRouteInput} onChange={(e) => setFlightRouteInput(e.target.value)} disabled={!selectedTrip} placeholder="Route (e.g. NYC -> LAX)" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <DateSingleDropdown
                        date={flightDepartInput}
                        onChange={setFlightDepartInput}
                        disabled={!selectedTrip}
                        placeholder="Departure date"
                        initialMonthIso={selectedTrip?.startDate}
                      />
                      <input value={flightConfirmationInput} onChange={(e) => setFlightConfirmationInput(e.target.value)} disabled={!selectedTrip} placeholder="Confirmation #" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <input value={flightPriceInput} onChange={(e) => setFlightPriceInput(e.target.value)} disabled={!selectedTrip} placeholder="Price" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <input value={flightQuickInput} onChange={(e) => setFlightQuickInput(e.target.value)} disabled={!selectedTrip} placeholder="Paste flight details to autofill price/confirmation/route" className="px-3 py-2 rounded-xl border border-neutral-200 sm:col-span-4" />
                    </div>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={autofillFlightFromText}
                        disabled={!selectedTrip || !flightQuickInput.trim()}
                        className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Autofill from pasted text
                      </button>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {bookings.flights.map((b) => (
                        <li key={b.id} className="px-3 py-2 rounded-xl border border-neutral-200">
                          {editingBooking?.tab === 'flight' && editingBooking.id === b.id && editFlightDraft ? (
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                              <input value={editFlightDraft.route} onChange={(e) => setEditFlightDraft((prev) => (prev ? { ...prev, route: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <DateSingleDropdown
                                date={editFlightDraft.departDate}
                                onChange={(next) => setEditFlightDraft((prev) => (prev ? { ...prev, departDate: next, returnDate: '' } : prev))}
                                placeholder="Departure date"
                                initialMonthIso={selectedTrip?.startDate}
                              />
                              <input value={editFlightDraft.confirmation} onChange={(e) => setEditFlightDraft((prev) => (prev ? { ...prev, confirmation: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <input value={editFlightDraft.price} onChange={(e) => setEditFlightDraft((prev) => (prev ? { ...prev, price: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <div className="sm:col-span-4 flex gap-2">
                                <button type="button" onClick={saveBookingEdit} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">Save</button>
                                <button type="button" onClick={cancelBookingEdit} className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm">{b.route} {b.departDate ? `(${formatSingleDateLabel(b.departDate)})` : ''} {b.price ? `| ${b.price}` : ''} {b.confirmation ? `| ${b.confirmation}` : ''}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingBooking({ tab: 'flight', id: b.id })
                                    setEditFlightDraft({ ...b })
                                    setBookingError(null)
                                  }}
                                  className="text-xs text-blue-700 hover:text-blue-900"
                                >
                                  Edit
                                </button>
                                <button type="button" onClick={() => removeBooking('flight', b.id)} className="text-xs text-neutral-600 hover:text-neutral-900">Remove</button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {bookingsTab === 'restaurant' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input value={restaurantNameInput} onChange={(e) => setRestaurantNameInput(e.target.value)} disabled={!selectedTrip} placeholder="Restaurant" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <DateSingleDropdown date={restaurantDateInput} onChange={setRestaurantDateInput} disabled={!selectedTrip} placeholder="Booking date" initialMonthIso={selectedTrip?.startDate} />
                      <input value={restaurantConfirmationInput} onChange={(e) => setRestaurantConfirmationInput(e.target.value)} disabled={!selectedTrip} placeholder="Booking #" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <input value={restaurantCostInput} onChange={(e) => setRestaurantCostInput(e.target.value)} disabled={!selectedTrip} placeholder="Cost" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      <input value={restaurantNotesInput} onChange={(e) => setRestaurantNotesInput(e.target.value)} disabled={!selectedTrip} placeholder="Notes" className="px-3 py-2 rounded-xl border border-neutral-200 sm:col-span-4" />
                    </div>
                    <ul className="mt-3 space-y-2">
                      {bookings.restaurants.map((b) => (
                        <li key={b.id} className="px-3 py-2 rounded-xl border border-neutral-200">
                          {editingBooking?.tab === 'restaurant' && editingBooking.id === b.id && editRestaurantDraft ? (
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                              <input value={editRestaurantDraft.name} onChange={(e) => setEditRestaurantDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <DateSingleDropdown
                                date={editRestaurantDraft.reservationDate}
                                onChange={(next) => setEditRestaurantDraft((prev) => (prev ? { ...prev, reservationDate: next } : prev))}
                                placeholder="Booking date"
                                initialMonthIso={selectedTrip?.startDate}
                              />
                              <input value={editRestaurantDraft.confirmation} onChange={(e) => setEditRestaurantDraft((prev) => (prev ? { ...prev, confirmation: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <input value={editRestaurantDraft.cost} onChange={(e) => setEditRestaurantDraft((prev) => (prev ? { ...prev, cost: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200" />
                              <input value={editRestaurantDraft.notes} onChange={(e) => setEditRestaurantDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))} className="px-3 py-2 rounded-xl border border-neutral-200 sm:col-span-4" />
                              <div className="sm:col-span-4 flex gap-2">
                                <button type="button" onClick={saveBookingEdit} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">Save</button>
                                <button type="button" onClick={cancelBookingEdit} className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm">{b.name} {b.reservationDate ? `(${formatSingleDateLabel(b.reservationDate)})` : ''} {b.cost ? `| ${b.cost}` : ''} {b.confirmation ? `| ${b.confirmation}` : ''} {b.notes ? `| ${b.notes}` : ''}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingBooking({ tab: 'restaurant', id: b.id })
                                    setEditRestaurantDraft({ ...b })
                                    setBookingError(null)
                                  }}
                                  className="text-xs text-blue-700 hover:text-blue-900"
                                >
                                  Edit
                                </button>
                                <button type="button" onClick={() => removeBooking('restaurant', b.id)} className="text-xs text-neutral-600 hover:text-neutral-900">Remove</button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {bookingsTab === 'accommodation' && (
                  <>
                    <p className="text-sm text-neutral-600">Add/edit accommodation details here. Entries are reflected in the Trip stays section.</p>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
                      <input
                        value={stayLocationInput}
                        onChange={(e) => setStayLocationInput(e.target.value)}
                        disabled={!selectedTrip}
                        placeholder={selectedTrip ? 'Stay location (hotel/city)' : 'Select a trip first'}
                        className="md:col-span-2 px-3 py-2 rounded-xl border border-neutral-200"
                      />
                      <input
                        value={stayAddressInput}
                        onChange={(e) => setStayAddressInput(e.target.value)}
                        disabled={!selectedTrip}
                        placeholder="Accommodation address"
                        className="md:col-span-2 px-3 py-2 rounded-xl border border-neutral-200"
                      />
                      <DateRangeDropdown
                        startDate={stayStartDate}
                        endDate={stayEndDate}
                        onChange={(start, end) => {
                          setStayStartDate(start)
                          setStayEndDate(end)
                        }}
                        disabled={!selectedTrip}
                        placeholder="Select check-in and check-out dates."
                        initialMonthIso={selectedTrip?.startDate}
                        className="md:col-span-2"
                      />
                      <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 self-start">
                        <input value={stayPriceInput} onChange={(e) => setStayPriceInput(e.target.value)} disabled={!selectedTrip} placeholder="Price" className="px-3 py-2 rounded-xl border border-neutral-200" />
                        <input value={stayConfirmationRefInput} onChange={(e) => setStayConfirmationRefInput(e.target.value)} disabled={!selectedTrip} placeholder="Confirmation #" className="px-3 py-2 rounded-xl border border-neutral-200" />
                      </div>
                      <input value={stayBookingUrlInput} onChange={(e) => setStayBookingUrlInput(e.target.value)} disabled={!selectedTrip} placeholder="Booking link" className="md:col-span-4 px-3 py-2 rounded-xl border border-neutral-200" />
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={addStay}
                        disabled={!selectedTrip}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold disabled:opacity-50"
                      >
                        Add stay
                      </button>
                      {selectedTrip?.startDate || selectedTrip?.endDate ? (
                        <p className="text-xs text-neutral-500">Trip window: {formatDateRangeWithYear(selectedTrip?.startDate, selectedTrip?.endDate)}</p>
                      ) : null}
                    </div>
                    {stayError ? <p className="mt-2 text-xs text-rose-700">{stayError}</p> : null}
                  </>
                )}
              </div>

              {bookingsTab !== 'accommodation' ? (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={addBooking}
                    disabled={!selectedTrip}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold disabled:opacity-50"
                  >
                    Add booking
                  </button>
                  {bookingError ? <p className="text-xs text-rose-700">{bookingError}</p> : null}
                </div>
              ) : null}
            </div>

            {/* Places to visit */}
            <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedTripPanel((v) => !v)}
                className="w-full flex items-center justify-between px-7 py-5 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MapPin className="text-blue-600" size={18} />
                  <div className="text-left">
                    <div className="font-bold">Places to visit</div>
                    <div className="text-xs text-neutral-500">Search by name or address</div>
                  </div>
                </div>
                {expandedTripPanel ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {expandedTripPanel && (
                <div className="px-7 pb-7">
                  <div className="flex flex-col sm:flex-row gap-3 mb-6 items-start sm:items-center">
                    <div className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-neutral-200 bg-neutral-50 text-sm text-neutral-700 shadow-sm">
                      {selectedTrip ? `Current trip: ${selectedTrip.country}` : 'No trip selected'}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedTrip}
                      onClick={() => {
                        if (!selectedTrip) return
                        if (!confirm(`Delete trip "${selectedTrip.country}"?`)) return
                        setState((prev) => {
                          const trips = prev.trips.filter((t) => t.id !== selectedTrip.id)
                          return { trips, selectedTripId: trips[0]?.id ?? null }
                        })
                      }}
                      className="px-4 py-3 rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:hover:bg-transparent shrink-0"
                    >
                      Delete trip
                    </button>
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-medium text-neutral-700 mb-2">Trip dates</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <DateRangeDropdown
                        startDate={tripStartDateInput}
                        endDate={tripEndDateInput}
                        onChange={(start, end) => {
                          setTripStartDateInput(start)
                          setTripEndDateInput(end)
                        }}
                        disabled={!selectedTrip}
                        placeholder="Select trip dates"
                        initialMonthIso={selectedTrip?.startDate}
                        className="sm:col-span-2"
                      />
                      <button
                        type="button"
                        onClick={saveTripDates}
                        disabled={!selectedTrip}
                        className="px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-500 hover:to-indigo-500 transition-colors disabled:opacity-50 shadow-sm"
                      >
                        Save dates
                      </button>
                    </div>
                    {tripDateError ? <p className="mt-2 text-xs text-rose-700">{tripDateError}</p> : null}
                  </div>

                  <div className="relative">
                    <label className="block text-sm font-medium text-neutral-700 mb-2">Add a place</label>
                    <div className="flex gap-2 flex-col sm:flex-row">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={18} />
                        <input
                          value={placeSearchInput}
                          onChange={(e) => {
                            setPlaceSearchInput(e.target.value)
                            setShowPlaceSuggestions(true)
                          }}
                          onFocus={() => setShowPlaceSuggestions(true)}
                          onKeyDown={(e) => {
                            const items = placeSearch.suggestions
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              setShowPlaceSuggestions(false)
                              return
                            }
                            if (!selectedTrip) return

                            if (showPlaceSuggestions && items.length > 0) {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setPlaceSuggestionIndex((prev) => (prev + 1) % items.length)
                                return
                              }
                              if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setPlaceSuggestionIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1))
                                return
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const pick =
                                  placeSuggestionIndex >= 0 && placeSuggestionIndex < items.length
                                    ? items[placeSuggestionIndex]
                                    : null
                                if (pick) {
                                  addVisitPlace(
                                    pick.label,
                                    typeof pick.lat === 'number' && typeof pick.lon === 'number'
                                      ? { lat: pick.lat, lon: pick.lon }
                                      : undefined,
                                  )
                                }
                                else if (placeSearchInput.trim()) addVisitPlace(placeSearchInput.trim())
                                return
                              }
                            }

                            if (e.key === 'Enter' && placeSearchInput.trim()) {
                              e.preventDefault()
                              addVisitPlace(placeSearchInput.trim())
                            }
                          }}
                          onBlur={() => {
                            setTimeout(() => setShowPlaceSuggestions(false), 150)
                          }}
                          disabled={!selectedTrip}
                          placeholder={selectedTrip ? 'Search address or place name…' : 'Select a trip first'}
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 shadow-sm disabled:bg-neutral-50 disabled:text-neutral-400"
                        />

                        {showPlaceSuggestions && selectedTrip && placeSearch.suggestions.length > 0 ? (
                          <div className="absolute left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-xl shadow-xl z-20 overflow-hidden max-h-60 overflow-y-auto">
                            {placeSearch.suggestions.map((sug, idx) => (
                              <button
                                key={sug.key}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  addVisitPlace(
                                    sug.label,
                                    typeof sug.lat === 'number' && typeof sug.lon === 'number'
                                      ? { lat: sug.lat, lon: sug.lon }
                                      : undefined,
                                  )
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm ${
                                  idx === placeSuggestionIndex ? 'bg-blue-100' : 'hover:bg-blue-50'
                                }`}
                              >
                                {sug.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={!selectedTrip || !placeSearchInput.trim()}
                        onClick={() => addVisitPlace(placeSearchInput.trim())}
                        className="px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-500 hover:to-indigo-500 transition-colors shadow-sm disabled:opacity-50 sm:self-end"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {placeSearch.autocompleteError ? (
                    <p className="mt-2 text-xs text-rose-700">Search error: {placeSearch.autocompleteError}</p>
                  ) : null}

                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-neutral-800">Recommended places</h3>
                    <p className="text-xs text-neutral-500 mb-3">
                      {selectedTrip
                        ? stays.length > 0 || allStayActivities.length > 0
                          ? `Based on accommodation and ${allStayActivities.length > 0 ? 'planned activities' : 'trip context'}.`
                          : 'Based on your trip destination.'
                        : 'Select a trip to see recommendations.'}
                    </p>
                    {!selectedTrip ? null : recommendedPlaces.loading ? (
                      <p className="text-sm text-neutral-500">Loading recommendations...</p>
                    ) : recommendedPlaces.error ? (
                      <p className="text-xs text-rose-700">{recommendedPlaces.error}</p>
                    ) : visibleRecommendations.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {visibleRecommendations.map((rec) => {
                          const googleUrl =
                            rec.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.label)}`
                          const imageUrl = rec.photoUrl || DEFAULT_HERO_IMAGE
                          return (
                            <div
                              key={rec.key}
                              className="text-left px-3 py-3 rounded-xl border border-neutral-200 bg-white hover:bg-blue-50/50 transition-colors"
                            >
                              <div className="flex gap-3 items-start">
                                <img
                                  src={imageUrl}
                                  alt=""
                                  loading="lazy"
                                  className="w-[92px] h-[58px] rounded-lg object-cover border border-neutral-200 shrink-0 bg-neutral-100"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-neutral-800 font-medium break-words">{rec.label}</div>
                                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                                    <button
                                      type="button"
                                      onClick={() => addRecommendedActivity(rec)}
                                      className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-xs hover:from-blue-500 hover:to-indigo-500 transition-colors shadow-sm"
                                    >
                                      Add
                                    </button>
                                    <a
                                      href={googleUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                                    >
                                      <ExternalLink size={12} />
                                      Google
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => setDismissedRecommendationKeys((prev) => (prev.includes(rec.key) ? prev : [...prev, rec.key]))}
                                      className="p-1 rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
                                      aria-label={`Dismiss recommendation ${rec.label}`}
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500">No recommendations found yet.</p>
                    )}
                  </div>

                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-neutral-800 mb-3">Saved for this trip</h3>
                    {selectedTrip && visitPlaces.length > 0 ? (
                      <ul className="space-y-2">
                        {visitPlaces.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-start gap-3 px-4 py-3 rounded-xl border border-neutral-100 bg-neutral-50/80"
                          >
                            <MapPin className="text-blue-600 shrink-0 mt-0.5" size={16} />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-neutral-800 block break-words">{p.label}</span>
                              <input
                                value={p.cost ?? ''}
                                onChange={(e) => updateVisitPlaceCost(p.id, e.target.value)}
                                disabled={!selectedTrip}
                                placeholder="Activity cost (optional)"
                                className="mt-2 w-full sm:w-56 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeVisitPlace(p.id)}
                              className="p-1 rounded-lg text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
                              aria-label={`Remove ${p.label}`}
                            >
                              <X size={18} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-neutral-500">
                        {selectedTrip ? 'No places yet.' : 'Select a trip to add places.'}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl flex gap-3">
                    <Info className="text-emerald-600 shrink-0" size={18} />
                    <p className="text-sm text-emerald-800">
                      Trips, places, and side goals are saved locally in your browser. Refresh-safe.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 p-7">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-2xl font-serif font-bold">Pack List</h2>
                  <p className="text-neutral-500 text-sm">Group what to bring by category and track packing progress.</p>
                </div>
                <span className="px-3 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold">
                  {packedCount} / {packList.length} packed
                </span>
              </div>

              <form
                className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  addPackListItem()
                }}
              >
                <input
                  value={packListTextInput}
                  onChange={(e) => setPackListTextInput(e.target.value)}
                  disabled={!selectedTrip}
                  placeholder={selectedTrip ? 'Add item (e.g. Passport, Charger, Jacket)' : 'Select a trip first'}
                  className="px-3 py-2 rounded-xl border border-neutral-200"
                />
                <input
                  value={packListCategoryInput}
                  onChange={(e) => setPackListCategoryInput(e.target.value)}
                  disabled={!selectedTrip}
                  list="pack-list-categories"
                  placeholder="Category"
                  className="px-3 py-2 rounded-xl border border-neutral-200"
                />
                <datalist id="pack-list-categories">
                  {PACK_LIST_CATEGORIES.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                <button type="submit" disabled={!selectedTrip} className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold disabled:opacity-50">
                  Add
                </button>
              </form>

              {packList.length === 0 ? (
                <p className="mt-5 text-sm text-neutral-500">{selectedTrip ? 'No items yet. Add your first packing item above.' : 'Select a trip to build a pack list.'}</p>
              ) : (
                <div className="mt-5 space-y-4">
                  {packListGroups.map(([category, items]) => (
                    <section key={category} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-neutral-800">{category}</h3>
                        <span className="text-xs text-neutral-500">
                          {items.filter((x) => x.done).length} / {items.length}
                        </span>
                      </div>
                      <ul className="space-y-2">
                        {items.map((item) => (
                          <li key={item.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
                            <input
                              type="checkbox"
                              checked={item.done}
                              onChange={() => togglePackListItem(item.id)}
                              className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className={`flex-1 text-sm ${item.done ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>{item.text}</span>
                            <button type="button" onClick={() => deletePackListItem(item.id)} className="text-xs text-neutral-600 hover:text-neutral-900">
                              Delete
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'itinerary' && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 p-7">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-2xl font-serif font-bold">Itinerary</h2>
                  <p className="text-neutral-500 text-sm">Day-by-day planner with a visual timeline and quick context cards.</p>
                </div>
              </div>

              {selectedTrip && timelineDays.length > 0 ? (
                <div className="mt-5 space-y-5">
                  <div className="itinerary-rail">
                    {timelineDays.map((day, index) => {
                      const label = formatSingleDateLabel(day)
                      const parts = label.split(' ')
                      const dayNum = parts[1] ?? label
                      const dayActivities = activitiesByDay.get(day) ?? []
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setSelectedTimelineDate(day)}
                          className={`itinerary-day-chip ${selectedTimelineDate === day ? 'is-active' : ''}`}
                        >
                          <span className="itinerary-day-chip-label">Day {index + 1}</span>
                          <span className="itinerary-day-chip-date">{dayNum}</span>
                          <span className="itinerary-day-chip-dot">{dayActivities.length > 0 ? '•' : ''}</span>
                        </button>
                      )
                    })}
                  </div>

                  {(() => {
                    const activeStays = staysByDay.get(selectedTimelineDate) ?? []
                    const anchorStay = activeStays[0]
                    const selectedActivities = activitiesByDay.get(selectedTimelineDate) ?? []
                    const highlightedActivity = selectedActivities[0]?.activity

                    return (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="itinerary-summary-card">
                          <div className="itinerary-summary-map">
                            <div className="itinerary-summary-pulse" />
                          </div>
                          <div className="itinerary-summary-footer">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{anchorStay?.location || 'No stay selected'}</p>
                              <p className="text-xs text-neutral-500 truncate">{anchorStay?.address || 'Add an accommodation address to unlock route tips.'}</p>
                            </div>
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(anchorStay?.address || anchorStay?.location || '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="itinerary-summary-link"
                            >
                              <ExternalLink size={12} />
                              Directions
                            </a>
                          </div>
                        </div>

                        <div className="itinerary-highlight-card">
                          <span className="itinerary-highlight-pill">Active now</span>
                          <h3 className="mt-3 text-2xl font-semibold">{highlightedActivity?.name || 'No activity yet'}</h3>
                          <p className="mt-1 text-sm text-neutral-500">{highlightedActivity?.notes || formatSingleDateLabel(selectedTimelineDate)}</p>
                          <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
                            <span>{highlightedActivity?.time || 'No time set'}</span>
                            <span>{selectedActivities.length} activities</span>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="itinerary-timeline-shell">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">
                        {selectedDayNumber ? `Day ${selectedDayNumber}: ${formatSingleDateLabel(selectedTimelineDate)}` : `Day: ${formatSingleDateLabel(selectedTimelineDate)}`}
                      </h3>
                      <span className="text-xs text-neutral-500">{(activitiesByDay.get(selectedTimelineDate) ?? []).length} activities</span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {(activitiesByDay.get(selectedTimelineDate) ?? []).map(({ stayId, activity: a }) => (
                        <div key={a.id} className="itinerary-activity-row-wrap">
                          <div className="itinerary-activity-lane-dot" />
                          <div className="itinerary-activity-row">
                            {(a.photoUrl || activityMetaById[a.id]?.photoUrl) ? (
                              <img src={a.photoUrl || activityMetaById[a.id]?.photoUrl} alt={a.name} className="itinerary-activity-photo-square" />
                            ) : (
                              <div className="itinerary-activity-photo-square itinerary-activity-photo-square--placeholder" />
                            )}
                            <div className="itinerary-activity-main">
                              <div className="flex items-start gap-2">
                                <input type="time" value={a.time} onChange={(e) => updateStayActivity(stayId, a.id, { time: e.target.value })} className="px-2 py-1 rounded border border-neutral-200 text-xs w-[92px]" />
                                <input value={a.name} onChange={(e) => updateStayActivity(stayId, a.id, { name: e.target.value })} className="flex-1 px-2 py-1 rounded border border-neutral-200 text-xs" />
                                <input value={a.cost} onChange={(e) => updateStayActivity(stayId, a.id, { cost: e.target.value })} placeholder="Cost" className="px-2 py-1 rounded border border-neutral-200 text-xs w-[88px]" />
                                <button type="button" onClick={() => removeStayActivity(stayId, a.id)} className="p-1 rounded text-neutral-500 hover:bg-neutral-100"><X size={14} /></button>
                              </div>
                              <input value={a.notes} onChange={(e) => updateStayActivity(stayId, a.id, { notes: e.target.value })} placeholder="Notes" className="mt-1 w-full px-2 py-1 rounded border border-neutral-200 text-xs" />
                              {(a.category || activityMetaById[a.id]?.category) ? (
                                <span className="itinerary-rec-category mt-1 w-fit">{a.category || activityMetaById[a.id]?.category}</span>
                              ) : null}
                              {(a.googleMapsUri || activityMetaById[a.id]?.googleMapsUri) ? (
                                <a href={a.googleMapsUri || activityMetaById[a.id]?.googleMapsUri} target="_blank" rel="noopener noreferrer" className="itinerary-google-link">
                                  <ExternalLink size={12} />
                                  Google
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                      {(activitiesByDay.get(selectedTimelineDate) ?? []).length === 0 ? <p className="text-xs text-neutral-500">No activities for this day yet.</p> : null}
                    </div>

                    <div className="itinerary-day-recommendations">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-semibold">Recommended for this day</p>
                        <p className="text-xs text-neutral-500">
                          Based on {selectedDayPrimaryStay?.location || 'accommodation'} and {selectedDayActivities.length > 0 ? `${selectedDayActivities.length} activities` : 'selected day activity context'}
                        </p>
                      </div>
                      {selectedDayAnchorCoords.length > 0 && !dayRecommendationRadius.isUsing20kmFallback ? (
                        <p className="mt-1 text-[11px] text-neutral-500">Filtered to within 10km of today’s itinerary anchors.</p>
                      ) : null}
                      {dayRecommendationRadius.isUsing20kmFallback ? (
                        <p className="mt-1 text-[11px] text-neutral-500">Nearby options were limited, increasing search radius to 20km for additional recommendations.</p>
                      ) : null}
                      {selectedDayRadiusPartial ? (
                        <p className="mt-1 text-[11px] text-amber-600">Distance filter is partially applied because some places could not be geo-resolved.</p>
                      ) : null}
                      {!selectedDayPrimaryStay ? (
                        <p className="mt-2 text-xs text-neutral-500">Add accommodation for this day to get stronger recommendations.</p>
                      ) : selectedDayRecommendations.loading ? (
                        <p className="mt-2 text-xs text-neutral-500">Loading recommendations...</p>
                      ) : selectedDayRecommendations.error ? (
                        <p className="mt-2 text-xs text-rose-700">{selectedDayRecommendations.error}</p>
                      ) : visibleSelectedDayRecommendations.length > 0 ? (
                        <ul className="mt-2 space-y-2">
                          {visibleSelectedDayRecommendations.map((rec) => (
                            <li key={`day-rec-${rec.key}`} className="itinerary-rec-row">
                              {rec.photoUrl ? <img src={rec.photoUrl} alt={rec.label} className="itinerary-rec-photo" /> : <div className="itinerary-rec-photo itinerary-rec-photo--placeholder" />}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium truncate">{rec.label.split(',')[0] || rec.label}</p>
                                  <span className="itinerary-rec-category">{rec.category || 'Other'}</span>
                                </div>
                                <p className="text-xs text-neutral-500 truncate">{rec.label.split(',').slice(1).join(',').trim() || rec.seedLabel || 'Nearby pick'}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDismissedRecommendationKeys((prev) => (prev.includes(rec.key) ? prev : [...prev, rec.key]))}
                                  className="itinerary-rec-dismiss"
                                  aria-label={`Dismiss ${rec.label}`}
                                  title="Dismiss recommendation"
                                >
                                  <X size={12} />
                                </button>
                                <a href={placeGoogleUrl(rec)} target="_blank" rel="noopener noreferrer" className="itinerary-google-link"><ExternalLink size={12} />Google</a>
                                <button type="button" onClick={() => addRecommendationToSelectedDay(rec)} className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">
                                  Add to Day
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-neutral-500">No recommendations found for this day yet.</p>
                      )}
                    </div>

                    {(() => {
                      const activeStays = staysByDay.get(selectedTimelineDate) ?? []
                      const targetStay = activeStays[0]
                      const draftKey = `${targetStay?.id ?? 'none'}|${selectedTimelineDate}`
                      const draft = activityDrafts[draftKey] ?? { name: '', time: '', cost: '', notes: '' }
                      if (!targetStay) return <p className="mt-4 text-xs text-neutral-500">No accommodation for this day.</p>
                      return (
                        <div className="mt-4">
                          <div className="space-y-2">
                            <input
                              value={activityPlaceSearchInput}
                              onChange={(e) => setActivityPlaceSearchInput(e.target.value)}
                              placeholder="Search activity by name or address"
                              className="w-full px-2 py-1.5 rounded border border-neutral-200 text-xs"
                            />
                            {activityPlaceSearchInput.trim().length >= 2 ? (
                              <div className="itinerary-search-results">
                                {activityPlaceSearch.autocompleteError ? (
                                  <p className="text-xs text-rose-700">{activityPlaceSearch.autocompleteError}</p>
                                ) : activityPlaceSearch.suggestions.slice(0, 5).map((place) => (
                                  <button
                                    key={`activity-place-${place.key}`}
                                    type="button"
                                    onClick={() => {
                                      const placeName = place.label.split(',')[0]?.trim() || place.label
                                      const placeAddress = place.label.split(',').slice(1).join(',').trim()
                                      setActivityDrafts((prev) => ({
                                        ...prev,
                                        [draftKey]: {
                                          ...draft,
                                          name: placeName || draft.name,
                                          notes: placeAddress || draft.notes,
                                        },
                                      }))
                                      setDraftPlaceMeta((prev) => ({
                                        ...prev,
                                        [draftKey]: {
                                          ...place,
                                          googleMapsUri: placeGoogleUrl(place),
                                          category: resolveRecommendationCategory(place.category, place.label, place.primaryType, place.types),
                                        },
                                      }))
                                      setActivityPlaceSearchInput('')
                                    }}
                                    className="itinerary-search-item"
                                  >
                                    {place.label}
                                  </button>
                                ))
                                }
                              </div>
                            ) : null}
                          </div>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_90px_90px_auto] gap-2">
                          <input value={draft.name} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, name: e.target.value } }))} placeholder={`Add activity for ${targetStay.location}`} className="px-2 py-1.5 rounded border border-neutral-200 text-xs" />
                          <input type="time" value={draft.time} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, time: e.target.value } }))} className="px-2 py-1.5 rounded border border-neutral-200 text-xs" />
                          <input value={draft.cost} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, cost: e.target.value } }))} placeholder="Cost" className="px-2 py-1.5 rounded border border-neutral-200 text-xs" />
                          <button type="button" onClick={() => addStayActivity(targetStay.id, selectedTimelineDate)} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold">Add</button>
                          <input value={draft.notes} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, notes: e.target.value } }))} placeholder="Notes" className="md:col-span-4 px-2 py-1.5 rounded border border-neutral-200 text-xs" />
                          {draftPlaceMeta[draftKey] ? (
                            <div className="md:col-span-4 flex items-center gap-2 text-xs text-neutral-500">
                              {draftPlaceMeta[draftKey].photoUrl ? <img src={draftPlaceMeta[draftKey].photoUrl} alt={draftPlaceMeta[draftKey].label} className="itinerary-inline-thumb" /> : null}
                              <span className="truncate">Selected place: {draftPlaceMeta[draftKey].label}</span>
                              <a href={placeGoogleUrl(draftPlaceMeta[draftKey])} target="_blank" rel="noopener noreferrer" className="itinerary-google-link"><ExternalLink size={12} />Google</a>
                            </div>
                          ) : null}
                        </div>
                        </div>
                      )
                    })()}
                  </div>

                  {stayError ? <p className="text-xs text-rose-700">{stayError}</p> : null}
                </div>
              ) : (
                <p className="mt-6 text-sm text-neutral-500">
                  {selectedTrip ? 'Set trip dates and add stays to build your day-by-day timeline.' : 'Select a trip to plan your timeline.'}
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'budget' && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-white rounded-3xl shadow-lg p-8 border border-neutral-100">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-3xl font-serif font-bold">Budget</h2>
                  <p className="text-neutral-500 mt-2">
                    {selectedTrip
                      ? `Live totals for ${selectedTrip.country}.`
                      : 'Select a trip to view categorized budget totals.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 pl-4 pr-3 py-3 sm:min-w-[250px] w-fit">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Estimated Budget</p>
                  <p className="text-4xl font-bold text-indigo-900 mt-1 leading-none">{formatMoney(budgetTotals.total)}</p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-sky-100 text-sky-700 inline-flex items-center justify-center shrink-0">
                      <Car size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Vehicle</p>
                  </div>
                  <p className="text-xl font-bold text-neutral-900">{formatMoney(budgetTotals.vehicle)}</p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-violet-100 text-violet-700 inline-flex items-center justify-center shrink-0">
                      <Plane size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Flights</p>
                  </div>
                  <p className="text-xl font-bold text-neutral-900">{formatMoney(budgetTotals.flights)}</p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 inline-flex items-center justify-center shrink-0">
                      <BedDouble size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Accommodation</p>
                  </div>
                  <p className="text-xl font-bold text-neutral-900">{formatMoney(budgetTotals.accommodation)}</p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-amber-100 text-amber-700 inline-flex items-center justify-center shrink-0">
                      <Compass size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Activities</p>
                  </div>
                  <p className="text-xl font-bold text-neutral-900">{formatMoney(budgetTotals.activities)}</p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-rose-100 text-rose-700 inline-flex items-center justify-center shrink-0">
                      <UtensilsCrossed size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Food</p>
                  </div>
                  <p className="text-xl font-bold text-neutral-900">{formatMoney(budgetTotals.food)}</p>
                </div>
              </div>

              <div className="mt-5 text-xs text-neutral-500">
                Uses prices from rental car bookings, flight bookings, accommodation entries, restaurant bookings, and activity costs from places to visit.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-white rounded-3xl shadow-lg p-7 border border-neutral-100">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-2xl font-serif font-bold">Map</h2>
                  <p className="text-neutral-500 text-sm">
                    {selectedTrip ? `Explore key locations and travel flow for ${selectedTrip.country}.` : 'Select a trip to see map details.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold">
                    Overall progress: {overallTripProgressPct !== null ? `${overallTripProgressPct}%` : 'N/A'}
                  </span>
                  <span className="px-3 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold">
                    {currentStay ? `Current stay: ${currentStay.location}` : 'No active stay today'}
                  </span>
                </div>
              </div>

              {mapApiError ? <p className="mt-3 text-xs text-rose-700">{mapApiError}</p> : null}

              <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-2 h-[430px]">
                {!selectedTrip ? (
                  <div className="h-full flex items-center justify-center text-sm text-neutral-500">Select a trip to load map locations.</div>
                ) : (
                  <div ref={mapContainerRef} className="h-full w-full rounded-xl overflow-hidden" />
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold">Stay route order</p>
                  <ol className="mt-2 space-y-1 text-sm text-neutral-700 list-decimal list-inside">
                    {stays.length === 0 ? <li className="text-neutral-500">No stays added yet.</li> : null}
                    {stays.map((s) => (
                      <li key={s.id}>
                        {s.location} {s.startDate || s.endDate ? `(${formatDateRangeLabel(s.startDate, s.endDate)})` : ''}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold">Key locations</p>
                  <ul className="mt-2 space-y-1 text-sm text-neutral-700">
                    {mapPoints.length === 0 ? <li className="text-neutral-500">No map locations available.</li> : null}
                    {mapPoints.slice(0, 12).map((p) => (
                      <li key={p.key}>
                        <span className="font-medium">{p.kind === 'stay' ? 'Stay' : 'Place'}:</span> {p.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tips' && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-white rounded-3xl shadow-lg p-8 border border-neutral-100">
              <h2 className="text-3xl font-serif font-bold">Tips</h2>
              <p className="text-neutral-500 mt-2">Coming next. This area can host packing, timing, and safety notes.</p>
            </div>
          </div>
        )}
        </main>
      </div>

      <div className="pointer-events-none fixed inset-0 z-[120]">
        {confettiBursts.map((burst) => (
          <div key={burst.id} className="confetti-burst" style={{ left: `${burst.x}px`, top: `${burst.y}px` }}>
            {Array.from({ length: 20 }).map((_, idx) => {
              const angle = (Math.PI * 2 * idx) / 20
              const distance = 40 + (idx % 5) * 14
              const dx = Math.cos(angle) * distance
              const dy = Math.sin(angle) * distance - 48
              const hue = (idx * 37) % 360
              const style = {
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                '--hue': `${hue}`,
                '--delay': `${(idx % 6) * 0.02}s`,
              } as CSSProperties
              return <span key={idx} className="confetti-piece" style={style} />
            })}
          </div>
        ))}
      </div>

      <footer className="bg-neutral-900 text-white/50 py-10 px-4 text-center text-sm mt-10">
        <p className="mb-2">Trip planner baseline UI</p>
        <p>Local-first • Saved in your browser</p>
      </footer>
    </div>
  )
}

function MustDoRow({
  item,
  onToggle,
  onDelete,
  onEdit,
}: {
  item: MustDo
  onToggle: (event: ChangeEvent<HTMLInputElement>) => void
  onDelete: () => void
  onEdit: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  useEffect(() => setDraft(item.text), [item.text])

  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-neutral-100 hover:bg-gradient-to-r hover:from-blue-50/70 hover:to-indigo-50/60 transition-colors shadow-sm">
      <div className="flex items-start gap-3 flex-1">
        <input type="checkbox" checked={item.done} onChange={onToggle} className="mt-1 h-4 w-4" />
        <div className="flex-1">
          {editing ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const t = draft.trim()
                if (!t) return
                onEdit(t)
                setEditing(false)
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <button type="submit" className="px-3 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-500 hover:to-indigo-500">
                Save
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50"
                onClick={() => {
                  setDraft(item.text)
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className={`text-sm leading-relaxed ${item.done ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>{item.text}</div>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-sm shadow-sm">
            Edit
          </button>
          <button type="button" onClick={onDelete} className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-rose-50 text-sm shadow-sm">
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

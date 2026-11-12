import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type TransitionEvent,
} from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import {
  BedDouble,
  Briefcase,
  Calendar,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  DollarSign,
  Ellipsis,
  ExternalLink,
  Info,
  Luggage,
  Map as MapIcon,
  MapPin,
  Moon,
  Plane,
  ShoppingBag,
  TriangleAlert,
  Search,
  Sun,
  UtensilsCrossed,
  X,
  Lock,
  LogIn,
  LogOut,
  Mail,
  User,
  History,
  CircleSlash,
  Trash2,
  Users,
  Copy,
  Link2,
  Pencil,
} from 'lucide-react'
import { DayPicker, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import { AirportCombobox } from './AirportCombobox'
import type { AirportRecord } from './data/airports'
import { formatAirportOptionLabel, getAirportByIata } from './data/airportLookup'
import { mapAuthError } from './authErrors'
import {
  clearAuthSession,
  loadAuthSession,
  loginUser,
  migrateLegacyTripsIfNeeded,
  normalizeEmail,
  registerUser,
  tripsStorageKey,
  type AuthSession,
} from './auth'
import { PASSWORD_RULES_SUMMARY, validateRegistrationPassword } from './passwordPolicy'
import { DEV_BYPASS_SESSION, isDevAuthBypass } from './devAuth'
import { getPocketBase, isSupabaseConfigured } from './pocketbaseClient'
import {
  acceptSharedItinerary,
  authSessionFromPocketBaseUser,
  createSharedItinerary,
  fetchMergedTripsState,
  fetchSharedItineraryMembers,
  fetchSharedItineraryMeta,
  revokeSharedItineraryEntire,
  revokeSharedItineraryMember,
  type SharedMemberListItem,
  updateSharedItineraryDefaultPermission,
  updateSharedMemberRole,
  upsertProfileDisplayName,
  upsertSharedItineraryTrip,
  upsertUserTrips,
} from './tripsRemote'
import { geocodeQuery } from './placesApi'
import { useCachedRecommendations, useDestinationSuggestions, usePlaceSuggestions } from './placesHooks'
import type { PlaceSuggestion } from './placesTypes'
import { TripMap } from './TripMap'
import {
  buildFlightRouteDisplay,
  loadTripsState,
  parseSingleTripFromUnknown,
  saveTripsState,
  tripsStateForPersonalSave,
} from './tripStorage'
import {
  EMPTY_TRIP_BOOKINGS,
  type CarBooking,
  type FlightBooking,
  type PackListItem,
  type RestaurantBooking,
  type Stay,
  type StayActivity,
  type Trip,
  type TripBookings,
  type TripsState,
  type VisitPlace,
  isTripReadOnly,
  stripSharingFromTrip,
} from './tripTypes'
import {
  BRAND_DASHBOARD_SUBTITLE,
  BRAND_FOOTER_TAGLINE,
  BRAND_HOME_HEADLINE,
  BRAND_HOME_KICKER,
  BRAND_HOME_SUBTEXT,
  BRAND_NAME,
  formatDocumentTitle,
} from './brand'
import { BrandLogo } from './BrandLogo'
import { ConfirmDialog } from './ConfirmDialog'
import { formatMoneyAmount, loadDisplayCurrency } from './currency'
import {
  buildMapPointsFromTrip,
  defaultMapCategoryVisibility,
  MAP_CATEGORY_LABELS,
  MAP_CATEGORIES,
  MAP_LEGEND_LABELS,
  type MapCategory,
  type MapMarkerKind,
} from './mapItinerary'

const MAP_LEGEND_ICON: Record<MapCategory, typeof BedDouble> = {
  accommodation: BedDouble,
  place: MapPin,
  flight: Plane,
  rental: Car,
  dining: UtensilsCrossed,
  activity: Compass,
}

const THEME_KEY = 'itinerary:theme'
const PACK_LIST_CATEGORIES = ['Clothes', 'Documents', 'Tech', 'Toiletries', 'Other'] as const
const DEFAULT_HERO_IMAGE = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1200&auto=format&fit=crop'
/** Pick randomly from this many top-scored Commons results so the hero varies each load. */
const HERO_RANDOM_POOL = 12
const APP_BUILD = import.meta.env.VITE_APP_BUILD ?? '—'

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


/** Calendar day grid: full day (midnight–midnight). Desktop shows CAL_VISIBLE_HOURS rows; narrow mobile shows CAL_MOBILE_VISIBLE_HOURS; scroll for the rest. */
const CAL_START_HOUR = 0
const CAL_END_HOUR = 24
const CAL_PX_PER_HOUR = 66
const CAL_SNAP_MINUTES = 15
const CAL_EVENT_DURATION_MIN = 60
const CAL_GRID_RANGE_MIN = (CAL_END_HOUR - CAL_START_HOUR) * 60
const CAL_VISIBLE_HOURS = 12
const CAL_MOBILE_VISIBLE_HOURS = 6
const CAL_VIEWPORT_HEIGHT_PX = CAL_VISIBLE_HOURS * CAL_PX_PER_HOUR
const CAL_MOBILE_VIEWPORT_HEIGHT_PX = CAL_MOBILE_VISIBLE_HOURS * CAL_PX_PER_HOUR
/** After week change / reset, show a daytime band first (scrollTop aligns with 6am). */
const CAL_DEFAULT_SCROLL_TOP_PX = 6 * CAL_PX_PER_HOUR
const CAL_MOBILE_MAX_WIDTH_MEDIA = '(max-width: 639px)'

function useCalMobileNarrowViewport(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {}
      const mq = window.matchMedia(CAL_MOBILE_MAX_WIDTH_MEDIA)
      mq.addEventListener('change', onStoreChange)
      return () => mq.removeEventListener('change', onStoreChange)
    },
    () => (typeof window !== 'undefined' ? window.matchMedia(CAL_MOBILE_MAX_WIDTH_MEDIA).matches : false),
    () => false,
  )
}

/** Duration of the horizontal slide when edge-nudging the visible calendar week while dragging. */
const CAL_EDGE_SLIDE_MS = 260
/** Edge nudge while dragging advances the calendar by this many trip days (matches toolbar week step). */
const CAL_EDGE_SHIFT_DAYS = 7

/** Autoscroll while dragging near calendar viewport edges (narrow = mobile: slower / less jumpy). */
const CAL_EDGE_SCROLL_MARGIN_DESKTOP = 56
const CAL_EDGE_SCROLL_STEP_DESKTOP = 4
const CAL_EDGE_SCROLL_MARGIN_MOBILE = 44
const CAL_EDGE_SCROLL_STEP_MOBILE = 2
const CAL_EDGE_H_MARGIN_DESKTOP = 52
const CAL_EDGE_H_MARGIN_MOBILE = 44
const CAL_EDGE_WEEK_COOLDOWN_MS_DESKTOP = 380
const CAL_EDGE_WEEK_COOLDOWN_MS_MOBILE = 780
/** Hold before calendar item drag activates; movement beyond tolerance first cancels (e.g. scroll). */
const CAL_DRAG_ACTIVATION_DELAY_MS = 220
const CAL_DRAG_ACTIVATION_TOLERANCE_PX = 10
/** Narrow layout: horizontal swipe changes week (same as toolbar arrows). */
const CAL_MOBILE_WEEK_SWIPE_MIN_PX = 56
const CAL_MOBILE_WEEK_SWIPE_DOMINANCE = 1.35
const CAL_MOBILE_WEEK_SWIPE_MAX_MS = 900

const snapCalendarMinutes = (m: number) => Math.round(m / CAL_SNAP_MINUTES) * CAL_SNAP_MINUTES

const parseTimeToMinutes = (time: string): number | null => {
  const t = time.trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null
  if (h === 24 && min === 0) return 24 * 60
  if (h > 23) return null
  return h * 60 + min
}

/** Normalize to HH:mm for calendar / activity time fields (handles optional seconds from inputs). */
const normalizeHhMmTime = (raw: string): string => {
  const t = raw.trim()
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return t
  const hRaw = parseInt(m[1], 10)
  const minRaw = parseInt(m[2], 10)
  if (hRaw === 24 && minRaw === 0) return '24:00'
  const h = Math.min(23, Math.max(0, hRaw))
  const min = Math.min(59, Math.max(0, minRaw))
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const parseLegacyFlightRoute = (route: string): { from?: string; to?: string } => {
  const m = route.trim().match(/\b([A-Za-z]{3})\s*(?:→|->|to|-|—|–)\s*([A-Za-z]{3})\b/i)
  if (!m) return {}
  return { from: m[1].toUpperCase(), to: m[2].toUpperCase() }
}

const formatMinutesToTime = (total: number): string => {
  const lo = 0
  const hi = 24 * 60
  const clamped = Math.max(lo, Math.min(hi, snapCalendarMinutes(total)))
  if (clamped >= 24 * 60) return '24:00'
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** On-grid labels only: wall clock without 15-minute snap (see formatMinutesToTime for snapped storage/UI). */
const formatMinutesToClockExact = (total: number): string => {
  const lo = 0
  const hi = 24 * 60
  const clamped = Math.max(lo, Math.min(hi, Math.round(total)))
  if (clamped >= 24 * 60) return '24:00'
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function hashStringToUint32(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

/** Deterministic vertical slot for activities with no parseable time until the user sets one. */
function untimedLayoutMinutes(activityId: string, dayIso: string): number {
  const h = hashStringToUint32(`${dayIso}|${activityId}`)
  const maxStart = 24 * 60 - CAL_EVENT_DURATION_MIN
  const span = Math.max(CAL_SNAP_MINUTES, maxStart)
  const raw = h % span
  return snapCalendarMinutes(Math.min(maxStart, raw))
}

function effectiveActivityStartMinutes(activity: StayActivity, dayIso: string): number {
  const parsed = parseTimeToMinutes(activity.time)
  if (parsed !== null) return parsed
  return untimedLayoutMinutes(activity.id, dayIso)
}

function effectiveActivityEndMinutes(activity: StayActivity, dayIso: string): number {
  const start = effectiveActivityStartMinutes(activity, dayIso)
  const endParsed = parseTimeToMinutes((activity.endTime ?? '').trim())
  if (endParsed !== null && endParsed > start) {
    return Math.min(endParsed, 24 * 60)
  }
  return Math.min(start + CAL_EVENT_DURATION_MIN, 24 * 60)
}

function computeCalendarResizeRange(
  dyPx: number,
  gridHeightPx: number,
  rangeMin: number,
  start0: number,
  end0: number,
): { start: number; end: number } {
  const dMin = Math.round(((dyPx / gridHeightPx) * rangeMin) / CAL_SNAP_MINUTES) * CAL_SNAP_MINUTES
  let end = snapCalendarMinutes(end0 + dMin)
  end = Math.max(start0 + CAL_SNAP_MINUTES, Math.min(end, CAL_END_HOUR * 60))
  return { start: start0, end }
}

function activityHasConfirmation(activity: StayActivity, stay?: Stay | null): boolean {
  if (activity.confirmationRef?.trim()) return true
  return Boolean(stay?.confirmationRef?.trim())
}

function isActivityImportant(activity: StayActivity, stay?: Stay | null): boolean {
  return parseTimeToMinutes(activity.time) !== null && activityHasConfirmation(activity, stay)
}

type CalOverlapLayout = { leftPct: number; widthPct: number }

type CalSlideStripPanes =
  | { mode: 'next'; left: string[]; right: string[] }
  | { mode: 'prev'; left: string[]; right: string[] }

/** Set on pointerdown on a calendar block so grab offset survives the activation-distance move. */
const SetCalDragGrabYPxContext = createContext<null | ((offsetYPx: number) => void)>(null)

type CalDragOverlayPayload = {
  stayId: string
  activity: StayActivity
  stay?: Stay
  important: boolean
  inProgress: boolean
  markerKind: MapMarkerKind
}

function computeCalendarOverlapLayouts(items: CalendarDayItem[], dayIso: string): Map<string, CalOverlapLayout> {
  type Ev = { id: string; startMin: number; endMin: number }
  const events: Ev[] = items.map(({ stayId, activity }) => {
    const startMin = effectiveActivityStartMinutes(activity, dayIso)
    const endMin = effectiveActivityEndMinutes(activity, dayIso)
    return { id: `${stayId}-${activity.id}`, startMin, endMin }
  })
  events.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const colEnd: number[] = []
  const colOf = new Map<string, number>()
  for (const e of events) {
    let col = colEnd.findIndex((end) => end <= e.startMin)
    if (col === -1) {
      col = colEnd.length
      colEnd.push(e.endMin)
    } else {
      colEnd[col] = e.endMin
    }
    colOf.set(e.id, col)
  }

  const out = new Map<string, CalOverlapLayout>()
  for (const e of events) {
    const overlapping = events.filter((o) => o.startMin < e.endMin && o.endMin > e.startMin)
    const laneCount = Math.max(overlapping.length > 0 ? Math.max(...overlapping.map((o) => colOf.get(o.id)!)) + 1 : 1, 1)
    const col = colOf.get(e.id)!
    out.set(e.id, {
      leftPct: (col / laneCount) * 100,
      widthPct: 100 / laneCount,
    })
  }
  return out
}

const findStayIdForDate = (stays: Stay[], dayIso: string): string | null => {
  for (const s of stays) {
    if (s.startDate <= dayIso && dayIso < s.endDate) return s.id
  }
  return null
}

/** Stay that covers the day, or first stay on the trip to store activities when no stay covers that date. */
const resolveStayIdForActivityStorage = (stays: Stay[], dayIso: string): string | null => {
  if (stays.length === 0) return null
  return findStayIdForDate(stays, dayIso) ?? stays[0]?.id ?? null
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

/** Trip itinerary days from start through end **inclusive** (end day is included for travel / wrap-up). */
function enumerateStayDays(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!start || !end) return []
  if (start.getTime() > end.getTime()) return []
  const days: string[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  while (cur.getTime() <= endMs) {
    days.push(toIsoDate(cur))
    cur.setDate(cur.getDate() + 1)
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

type Tab = 'planner' | 'itinerary' | 'budget' | 'map' | 'tips'

const DASHBOARD_TAB_LABELS: Record<Tab, string> = {
  planner: 'Planner',
  itinerary: 'Itinerary',
  budget: 'Budget',
  map: 'Map',
  tips: 'Tips',
}

type View = 'home' | 'dashboard'

const DASHBOARD_TABS: readonly Tab[] = ['planner', 'itinerary', 'budget', 'map', 'tips']

function parseAppUrlSearch(search: string): { view: View; tab: Tab; tripId: string | null; shareToken: string | null } {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const view: View = params.get('v') === 'dashboard' ? 'dashboard' : 'home'
  const tRaw = params.get('t')
  const tab: Tab =
    tRaw && (DASHBOARD_TABS as readonly string[]).includes(tRaw) ? (tRaw as Tab) : 'planner'
  const tripRaw = params.get('trip')?.trim()
  const shareRaw = params.get('share')?.trim()
  return { view, tab, tripId: tripRaw || null, shareToken: shareRaw || null }
}

function readInitialAppUrl(): { view: View; tab: Tab; tripId: string | null; shareToken: string | null } {
  if (typeof window === 'undefined') return { view: 'home', tab: 'planner', tripId: null, shareToken: null }
  return parseAppUrlSearch(window.location.search)
}

type BookingTab = 'rentalCar' | 'flight' | 'restaurant' | 'accommodation'
/** Synthetic stay id for trip-booking rows merged into the day schedule (calendar + timeline). */
const CAL_BOOKING_STAY_ID = '__trip_booking__'
type CalendarBookingRef = { tab: BookingTab; id: string }
type CalendarDayItem = {
  stayId: string
  stayLocation: string
  activity: StayActivity
  bookingRef?: CalendarBookingRef
}

/** Payload for the calendar item details / edit modal (activity or merged booking row). */
type CalendarActivityModalPayload = {
  stayId: string
  activity: StayActivity
  bookingRef?: CalendarBookingRef
  stayLocation?: string
}

const EMPTY_CALENDAR_DAY_ITEMS: CalendarDayItem[] = []

/** Matches map pin colours in mapMarkers.ts (stay / flight / rental / restaurant / activity / place). */
function calendarMapMarkerKind(item: Pick<CalendarDayItem, 'bookingRef'>): MapMarkerKind {
  const tab = item.bookingRef?.tab
  if (tab === 'flight') return 'flight'
  if (tab === 'rentalCar') return 'rental'
  if (tab === 'restaurant') return 'restaurant'
  return 'activity'
}

/** Uses the place line from search (name + address) or notes — no separate directions field. */
function activityDirectionsDestination(a: StayActivity): string {
  const pl = (a.placeLabel ?? '').trim()
  if (pl) return pl
  const n = (a.notes ?? '').trim()
  if (n) return n
  return (a.name ?? '').trim()
}

function directionsDestinationForScheduleItem(item: CalendarDayItem | undefined): string {
  if (!item) return ''
  const a = item.activity
  if (item.bookingRef?.tab === 'rentalCar') {
    return (a.notes || '').trim() || (a.name || '').trim()
  }
  if (item.bookingRef?.tab === 'flight') {
    const pl = (a.placeLabel ?? '').trim()
    if (pl) return pl
    return (a.name || '').trim()
  }
  return activityDirectionsDestination(a)
}

function resolveActivityForCalendarModal(p: CalendarActivityModalPayload, trip: Trip | null): StayActivity {
  if (!trip || p.bookingRef) return p.activity
  const stay = trip.stays.find((s) => s.id === p.stayId)
  return stay?.activities.find((a) => a.id === p.activity.id) ?? p.activity
}

function calendarItemKindLabel(p: Pick<CalendarActivityModalPayload, 'bookingRef'>): string {
  const tab = p.bookingRef?.tab
  if (tab === 'flight') return 'Flight'
  if (tab === 'rentalCar') return 'Rental car'
  if (tab === 'restaurant') return 'Restaurant'
  if (tab === 'accommodation') return 'Accommodation'
  return 'Activity'
}

function calendarPayloadToDayItem(p: CalendarActivityModalPayload): CalendarDayItem {
  return {
    stayId: p.stayId,
    stayLocation: p.stayLocation ?? '',
    activity: p.activity,
    bookingRef: p.bookingRef,
  }
}

type BookingFilter = BookingTab | 'all'
type BookingRowKind = BookingTab | 'activity'
type BookingManagementRow = {
  id: string
  kind: BookingRowKind
  filterKind: BookingTab
  sortTs: number
  overlapStartTs: number
  overlapEndTs: number
  dateText: string
  title: string
  subtitle: string
  /** Confirmation refs, times, etc. (not the price — see priceAmount). */
  meta?: string
  /** Parsed numeric amount for right-aligned currency display. */
  priceAmount?: number
  /** When kind is flight, drives baggage icon row in the list. */
  flightBaggage?: { checked: number; carryOn: number; personal: boolean }
  removable: boolean
  removeId?: string
  removeTab?: BookingTab
  stayId?: string
  activityId?: string
  kindLabel: string
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

const formatCountdownDuration = (from: Date, to: Date) => {
  if (to.getTime() <= from.getTime()) return '0s'
  const unit = (n: number, word: string) => `${n}\u00A0${word}${n === 1 ? '' : 's'}`

  const addYears = (d: Date, n: number) => {
    const x = new Date(d)
    x.setFullYear(x.getFullYear() + n)
    return x
  }
  const addMonths = (d: Date, n: number) => {
    const x = new Date(d)
    x.setMonth(x.getMonth() + n)
    return x
  }

  let years = to.getFullYear() - from.getFullYear()
  while (years > 0 && addYears(from, years).getTime() > to.getTime()) years -= 1
  let cursor = addYears(from, years)

  let months = (to.getFullYear() - cursor.getFullYear()) * 12 + (to.getMonth() - cursor.getMonth())
  while (months > 0 && addMonths(cursor, months).getTime() > to.getTime()) months -= 1
  cursor = addMonths(cursor, months)

  let remainingSec = Math.floor((to.getTime() - cursor.getTime()) / 1000)
  const days = Math.floor(remainingSec / 86400)
  remainingSec -= days * 86400
  const hours = Math.floor(remainingSec / 3600)
  remainingSec -= hours * 3600
  const minutes = Math.floor(remainingSec / 60)
  const seconds = remainingSec - minutes * 60

  if (years > 0) return `${unit(years, 'year')}, ${unit(months, 'month')}, ${unit(days, 'day')}`
  if (months > 0) return `${unit(months, 'month')}, ${unit(days, 'day')}, ${unit(hours, 'hour')}`
  if (days > 0) return `${unit(days, 'day')}, ${unit(hours, 'hour')}, ${unit(minutes, 'minute')}`
  if (hours > 0) return `${unit(hours, 'hour')}, ${unit(minutes, 'minute')}, ${unit(seconds, 'second')}`
  if (minutes > 0) return `${unit(minutes, 'minute')}, ${unit(seconds, 'second')}`
  return unit(seconds, 'second')
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

function CalendarBookingDetailsReadonly({
  tab,
  id,
  bookings,
}: {
  tab: BookingTab
  id: string
  bookings: TripBookings
}) {
  const row = (label: string, value: string | undefined) =>
    value?.trim() ? (
      <div key={label}>
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
        <p className="text-sm text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-words">{value.trim()}</p>
      </div>
    ) : null

  if (tab === 'rentalCar') {
    const b = bookings.rentalCars.find((x) => x.id === id)
    if (!b) return <p className="text-sm text-rose-600 dark:text-rose-400">This booking could not be found.</p>
    return (
      <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-700 pt-4 mt-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Planner booking</p>
        <div className="space-y-2.5">
          {row('Company', b.company)}
          {row('Pickup', `${b.pickupLocation} · ${formatSingleDateLabel(b.pickupDate)} ${(b.pickupTime ?? '').trim()}`)}
          {row('Dropoff', `${b.dropoffLocation} · ${formatSingleDateLabel(b.dropoffDate)} ${(b.dropoffTime ?? '').trim()}`)}
          {row('Confirmation', b.confirmation)}
          {row('Price', b.price)}
        </div>
      </div>
    )
  }
  if (tab === 'flight') {
    const b = bookings.flights.find((x) => x.id === id)
    if (!b) return <p className="text-sm text-rose-600 dark:text-rose-400">This booking could not be found.</p>
    const routeDisp = buildFlightRouteDisplay(b.fromIata, b.toIata, b.route)
    return (
      <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-700 pt-4 mt-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Planner booking</p>
        <div className="space-y-2.5">
          {row('Route', routeDisp)}
          {row('From', [b.fromLabel?.trim(), b.fromIata?.trim().toUpperCase()].filter(Boolean).join(' · '))}
          {row('To', [b.toLabel?.trim(), b.toIata?.trim().toUpperCase()].filter(Boolean).join(' · '))}
          {row('Airline', b.airline)}
          {row('Depart', `${formatSingleDateLabel(b.departDate)} ${(b.departTime ?? '').trim()}`)}
          {row('Arrive', `${formatSingleDateLabel(b.arriveDate || b.departDate)} ${(b.arriveTime ?? '').trim()}`)}
          {row('Bags', `Checked ${b.checkedBags} · Carry-on ${b.carryOnBags}${b.personalItem ? ' · Personal item' : ''}`)}
          {row('Confirmation', b.confirmation)}
          {row('Price', b.price)}
        </div>
      </div>
    )
  }
  if (tab === 'restaurant') {
    const b = bookings.restaurants.find((x) => x.id === id)
    if (!b) return <p className="text-sm text-rose-600 dark:text-rose-400">This booking could not be found.</p>
    return (
      <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-700 pt-4 mt-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Planner booking</p>
        <div className="space-y-2.5">
          {row('Restaurant', b.name)}
          {row('Reservation', formatSingleDateLabel(b.reservationDate))}
          {row('Confirmation', b.confirmation)}
          {row('Cost', b.cost)}
          {row('Notes', b.notes)}
        </div>
      </div>
    )
  }
  const b = bookings.accommodations.find((x) => x.id === id)
  if (!b) return <p className="text-sm text-rose-600 dark:text-rose-400">This booking could not be found.</p>
  return (
    <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-700 pt-4 mt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Planner booking</p>
      <div className="space-y-2.5">
        {row('Name', b.name)}
        {row('Check-in', formatSingleDateLabel(b.checkIn))}
        {row('Check-out', formatSingleDateLabel(b.checkOut))}
        {row('Confirmation', b.confirmation)}
      </div>
    </div>
  )
}

/** Month and year for the calendar strip title (from the leftmost visible trip day). */
const formatCalendarMonthYearLabel = (iso?: string) => {
  const date = parseIsoDate(iso)
  if (!date) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date)
}

const formatCalendarWeekdayShort = (iso?: string) => {
  const date = parseIsoDate(iso)
  if (!date) return ''
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
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

type ItineraryCalendarGridProps = {
  visibleDays: string[]
  timelineDays: string[]
  activitiesByDay: Map<string, CalendarDayItem[]>
  stays: Stay[]
  staysByDay: Map<string, Stay[]>
  todayIso: string
  nowMinutes: number
  selectedTimelineDate: string
  onSelectDay: (iso: string) => void
  onCalendarActivityDrop: (fromStayId: string, activityId: string, targetDayIso: string, newTime: string) => void
  onCalendarActivityResize?: (stayId: string, activityId: string, dayIso: string, startMinutes: number, endMinutes: number) => void
  onSelectCalendarItem: (item: CalendarDayItem) => void
  /** When true, activity blocks cannot be dragged or resized (e.g. shared trip viewer). */
  calendarReadOnly?: boolean
  weekStartIndex: number
  onPrevWeek: () => void
  onNextWeek: () => void
  canPrev: boolean
  canNext: boolean
  /** Shift visible window by one trip day while dragging near left/right edge. */
  onShiftCalendarDays: (delta: number) => void
  canShiftCalendarPrev: boolean
  canShiftCalendarNext: boolean
}

const formatCalendarHourLabel = (h: number) => {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

type CalResizeSession = {
  pointerId: number
  originY: number
  start0: number
  end0: number
}

function CalendarActivityBlock({
  activity,
  stayId,
  stay,
  dayIso,
  gridHeightPx,
  rangeMin,
  layout,
  onOpenDetail,
  nowMinutes,
  isTodayColumn,
  isBookingCalendarItem = false,
  markerKind,
  onResizeCommit,
  dragDisabled = false,
}: {
  activity: StayActivity
  stayId: string
  stay?: Stay
  dayIso: string
  gridHeightPx: number
  rangeMin: number
  layout: CalOverlapLayout
  onOpenDetail: () => void
  nowMinutes: number
  isTodayColumn: boolean
  isBookingCalendarItem?: boolean
  markerKind: MapMarkerKind
  onResizeCommit?: (startMinutes: number, endMinutes: number) => void
  dragDisabled?: boolean
}) {
  const setCalDragGrabYPx = useContext(SetCalDragGrabYPxContext)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `cal-drag-${stayId}-${activity.id}`,
    data: { stayId, activityId: activity.id },
    disabled: isBookingCalendarItem || dragDisabled,
  })
  const [resizeSession, setResizeSession] = useState<CalResizeSession | null>(null)
  const [previewRange, setPreviewRange] = useState<{ start: number; end: number } | null>(null)
  const onResizeCommitRef = useRef(onResizeCommit)
  onResizeCommitRef.current = onResizeCommit
  const showResize = Boolean(onResizeCommit && !isBookingCalendarItem && !dragDisabled)

  const baseStart = effectiveActivityStartMinutes(activity, dayIso)
  const baseEnd = effectiveActivityEndMinutes(activity, dayIso)
  const startMin = previewRange?.start ?? baseStart
  const endMin = previewRange?.end ?? baseEnd

  const parsed = parseTimeToMinutes(activity.time)
  const bookingTimeLine =
    activity.calendarTimeLabel?.trim() ||
    (parsed !== null ? activity.time : 'No time')
  const timeRangeLabel = `${formatMinutesToClockExact(startMin)}–${formatMinutesToClockExact(endMin)}`
  const scheduleLine = isBookingCalendarItem ? bookingTimeLine : timeRangeLabel

  const topPx = ((startMin - CAL_START_HOUR * 60) / rangeMin) * gridHeightPx
  const durationMin = Math.max(1, endMin - startMin)
  const minBlockPx = showResize ? 20 : 14
  const heightPx = Math.max(minBlockPx, (durationMin / rangeMin) * gridHeightPx)

  const important = isBookingCalendarItem
    ? Boolean(activity.confirmationRef?.trim())
    : isActivityImportant(activity, stay)
  const inProgress =
    isTodayColumn &&
    nowMinutes >= startMin &&
    nowMinutes < endMin

  useEffect(() => {
    if (!resizeSession) return undefined
    const { pointerId, originY, start0, end0 } = resizeSession

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const { start, end } = computeCalendarResizeRange(e.clientY - originY, gridHeightPx, rangeMin, start0, end0)
      setPreviewRange({ start, end })
    }

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const { start, end } = computeCalendarResizeRange(e.clientY - originY, gridHeightPx, rangeMin, start0, end0)
      onResizeCommitRef.current?.(start, end)
      setResizeSession(null)
      setPreviewRange(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [resizeSession, gridHeightPx, rangeMin])

  const beginResizeEnd = (e: React.PointerEvent) => {
    if (!onResizeCommit || isBookingCalendarItem) return
    e.preventDefault()
    e.stopPropagation()
    const s0 = effectiveActivityStartMinutes(activity, dayIso)
    const e0 = effectiveActivityEndMinutes(activity, dayIso)
    setPreviewRange({ start: s0, end: e0 })
    setResizeSession({
      pointerId: e.pointerId,
      originY: e.clientY,
      start0: s0,
      end0: e0,
    })
  }

  const nudgeEndResizeWithKeyboard = (deltaMinutes: number) => {
    if (!onResizeCommit || isBookingCalendarItem) return
    const s0 = effectiveActivityStartMinutes(activity, dayIso)
    const e0 = effectiveActivityEndMinutes(activity, dayIso)
    let end = snapCalendarMinutes(e0 + deltaMinutes)
    end = Math.max(s0 + CAL_SNAP_MINUTES, Math.min(end, CAL_END_HOUR * 60))
    onResizeCommit(s0, end)
  }

  const onEndHandleKeyDown = (e: React.KeyboardEvent) => {
    if (!onResizeCommit || isBookingCalendarItem) return
    const step = e.shiftKey ? 60 : CAL_SNAP_MINUTES
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      nudgeEndResizeWithKeyboard(-step)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      nudgeEndResizeWithKeyboard(step)
    }
  }

  const style: CSSProperties = {
    top: topPx,
    height: heightPx,
    left: `calc(${layout.leftPct}% + 2px)`,
    width: `calc(${layout.widthPct}% - 4px)`,
    ...(transform && !isDragging ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
    zIndex: isDragging ? 20 : resizeSession ? 25 : 2,
    pointerEvents: isDragging ? 'none' : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`itinerary-calendar-event itinerary-calendar-event--mk-${markerKind}${important ? ' itinerary-calendar-event--important' : ''}${inProgress ? ' itinerary-calendar-event--in-progress' : ''}${isBookingCalendarItem ? ' itinerary-calendar-event--locked' : ''}${resizeSession ? ' itinerary-calendar-event--resizing' : ''}${isDragging ? ' itinerary-calendar-event--drag-origin' : ''}`}
      {...(!isBookingCalendarItem
        ? {
            'data-cal-drag-stay': stayId,
            'data-cal-drag-activity': String(activity.id),
          }
        : {})}
      {...(durationMin < 60 ? { 'data-cal-sub-hour': '' } : {})}
      {...(durationMin >= 60 ? { 'data-cal-hour-plus': '' } : {})}
    >
      <div
        className="itinerary-calendar-event-drag"
        {...listeners}
        {...attributes}
        onPointerDownCapture={(e) => {
          if (isBookingCalendarItem || !setCalDragGrabYPx) return
          const root = (e.currentTarget as HTMLElement).closest('.itinerary-calendar-event') as HTMLElement | null
          if (!root) return
          const br = root.getBoundingClientRect()
          if (!(br.height > 0)) return
          const offset = Math.max(0, Math.min(br.height, e.clientY - br.top))
          setCalDragGrabYPx(offset)
        }}
        onClick={() => onOpenDetail()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenDetail()
          }
        }}
        role="button"
        tabIndex={0}
        title={
          isBookingCalendarItem
            ? `From Planner — open to edit time or day (${bookingTimeLine})`
            : `${activity.name} — ${timeRangeLabel}`
        }
      >
        {isBookingCalendarItem ? (
          <span className="itinerary-calendar-event-lock" aria-hidden>
            <Lock size={11} strokeWidth={2.25} />
          </span>
        ) : null}
        <p className="itinerary-calendar-event-title">{activity.name}</p>
        <p className="itinerary-calendar-event-time">{scheduleLine}</p>
      </div>
      {showResize ? (
        <button
          type="button"
          className="itinerary-calendar-event-resize itinerary-calendar-event-resize--end"
          aria-label="Adjust end time. Arrow up earlier end, arrow down later end. Shift for one hour."
          onPointerDown={beginResizeEnd}
          onKeyDown={onEndHandleKeyDown}
          tabIndex={0}
        />
      ) : null}
    </div>
  )
}

function CalendarDayHeaderCell({
  dayIso,
  dayIndex,
  isSelected,
  isToday,
  onHeaderClick,
  staysForDay,
}: {
  dayIso: string
  dayIndex: number
  isSelected: boolean
  isToday: boolean
  onHeaderClick: () => void
  staysForDay: Stay[]
}) {
  const weekdayShort = formatCalendarWeekdayShort(dayIso)
  const dateLabel = formatSingleDateLabel(dayIso)
  return (
    <div className={`itinerary-calendar-head-col ${isSelected ? 'is-selected' : ''}${isToday ? ' is-today' : ''}`}>
      <button type="button" className="itinerary-calendar-col-head" onClick={onHeaderClick}>
        <span className="itinerary-calendar-col-daynum">Day {dayIndex}</span>
        {weekdayShort ? <span className="itinerary-calendar-col-weekday">{weekdayShort}</span> : null}
        {dateLabel ? <span className="itinerary-calendar-col-date">{dateLabel}</span> : null}
      </button>
      <div className="itinerary-calendar-acc-strip" title={staysForDay.map((s) => s.location).join(' · ') || undefined}>
        {staysForDay.length === 0 ? (
          <span className="itinerary-calendar-acc-strip-empty">No stay</span>
        ) : (
          staysForDay.map((s) => (
            <span key={s.id} className="itinerary-calendar-acc-strip-chip">
              <BedDouble size={11} aria-hidden className="shrink-0 itinerary-calendar-acc-strip-icon" />
              <span className="itinerary-calendar-acc-strip-text">{s.location}</span>
            </span>
          ))
        )}
      </div>
    </div>
  )
}

/** Which day column contains the pointer; works when DragOverlay leaves dnd-kit without a valid `over`. */
function resolveCalendarDropFromPointer(
  clientX: number,
  clientY: number,
  dayIsos: string[],
): { dayIso: string; top: number; height: number } | null {
  for (const dayIso of dayIsos) {
    const el = document.querySelector(`[data-cal-drop-body="${dayIso}"]`) as HTMLElement | null
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    const pad = 2
    if (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    ) {
      return { dayIso, top: r.top, height: r.height }
    }
  }
  return null
}

type SnappedCalendarDropArgs = {
  overDayId?: string | null
  overRectTop?: number
  overRectHeight?: number
  lastHoveredDayIso?: string | null
  /** clientY − this = event block top (viewport Y); keeps the same point on the card under the cursor. */
  grabOffsetYPx?: number
  /** When set, snapped start is clamped so start + durationMin fits in the calendar day. */
  durationMin?: number
}

function resolveSnappedCalendarDrop(
  clientX: number,
  clientY: number,
  dayIsos: string[],
  args?: SnappedCalendarDropArgs,
): { dayIso: string; snappedStartMin: number } | null {
  const pointerHit = resolveCalendarDropFromPointer(clientX, clientY, dayIsos)
  let targetDayIso: string | null = pointerHit?.dayIso ?? null

  if (!targetDayIso && args?.overDayId?.startsWith('cal-day-')) {
    targetDayIso = args.overDayId.slice('cal-day-'.length)
  }
  if (!targetDayIso && args?.lastHoveredDayIso) {
    targetDayIso = args.lastHoveredDayIso
  }

  if (!targetDayIso) return null

  /* Always use live layout geometry. dnd-kit's over.rect can stay stale after scrollTop changes, which pins rel≈0 and glues the preview to the top. */
  const dropEl = document.querySelector(`[data-cal-drop-body="${targetDayIso}"]`) as HTMLElement | null
  if (!dropEl) return null
  const br = dropEl.getBoundingClientRect()
  if (br.width <= 0 || br.height <= 0) return null
  const dropTop = br.top
  const dropHeight = br.height

  const grab =
    args?.grabOffsetYPx != null && Number.isFinite(args.grabOffsetYPx) ? args.grabOffsetYPx : 0
  const anchorY = clientY - grab
  const rel = Math.min(1, Math.max(0, (anchorY - dropTop) / dropHeight))
  const rangeMinCalc = (CAL_END_HOUR - CAL_START_HOUR) * 60
  let newMin = Math.round(CAL_START_HOUR * 60 + rel * rangeMinCalc)
  newMin = snapCalendarMinutes(newMin)
  const calMin = CAL_START_HOUR * 60
  const calEndMin = CAL_END_HOUR * 60
  const dur =
    args?.durationMin != null && Number.isFinite(args.durationMin) && args.durationMin > 0
      ? Math.max(CAL_SNAP_MINUTES, args.durationMin)
      : null
  const maxStartByDuration =
    dur != null
      ? Math.floor((calEndMin - dur) / CAL_SNAP_MINUTES) * CAL_SNAP_MINUTES
      : calEndMin - CAL_SNAP_MINUTES
  newMin = Math.max(calMin, Math.min(maxStartByDuration, newMin))
  return { dayIso: targetDayIso, snappedStartMin: newMin }
}

/** Pointer position for this drag tick — matches @dnd-kit's internal pointer (avoids lag vs a separate window listener). */
function clientPointerFromDndEvent(event: { activatorEvent: Event; delta: { x: number; y: number } }): {
  x: number
  y: number
} | null {
  const base = getEventCoordinates(event.activatorEvent)
  if (!base) return null
  return { x: base.x + event.delta.x, y: base.y + event.delta.y }
}

function CalendarDayGridColumn({
  dayIso,
  gridHeightPx,
  isSelected,
  isToday,
  nowMinutes,
  children,
}: {
  dayIso: string
  gridHeightPx: number
  isSelected: boolean
  isToday: boolean
  nowMinutes: number
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cal-day-${dayIso}` })
  const hourCount = CAL_END_HOUR - CAL_START_HOUR
  const nowElapsedMin = nowMinutes - CAL_START_HOUR * 60
  const nowInGrid =
    isToday && nowElapsedMin >= 0 && nowElapsedMin < CAL_END_HOUR * 60
  const nowFrac = CAL_GRID_RANGE_MIN > 0 ? nowElapsedMin / CAL_GRID_RANGE_MIN : 0
  return (
    <div className={`itinerary-calendar-col itinerary-calendar-grid-col ${isSelected ? 'is-selected' : ''}${isToday ? ' is-today' : ''}`}>
      <div
        ref={setNodeRef}
        data-cal-drop-body={dayIso}
        className={`itinerary-calendar-grid-body ${isOver ? 'is-over' : ''}`}
        style={{ height: gridHeightPx }}
      >
        <div className="itinerary-calendar-hour-lines" aria-hidden>
          {Array.from({ length: hourCount }, (_, i) => (
            <div key={i} className="itinerary-calendar-hour-line" style={{ height: CAL_PX_PER_HOUR }} />
          ))}
        </div>
        {nowInGrid ? (
          <div
            className="itinerary-calendar-now-line"
            style={{ top: `${Math.min(1, Math.max(0, nowFrac)) * 100}%` }}
            aria-hidden
          />
        ) : null}
        <div className="itinerary-calendar-events-layer">{children}</div>
      </div>
    </div>
  )
}

function ItineraryCalendarGrid({
  visibleDays,
  timelineDays,
  activitiesByDay,
  stays,
  staysByDay,
  todayIso,
  nowMinutes,
  selectedTimelineDate,
  onSelectDay,
  onCalendarActivityDrop,
  onCalendarActivityResize,
  onSelectCalendarItem,
  calendarReadOnly = false,
  weekStartIndex,
  onPrevWeek,
  onNextWeek,
  canPrev,
  canNext,
  onShiftCalendarDays,
  canShiftCalendarPrev,
  canShiftCalendarNext,
}: ItineraryCalendarGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** Day column grid only (excludes time gutter and scroll chrome); wheel here scrolls hours. */
  const calDayColumnsRef = useRef<HTMLDivElement | null>(null)
  const calShellRef = useRef<HTMLDivElement | null>(null)
  const bodySlideRef = useRef<HTMLDivElement | null>(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const isDraggingCalRef = useRef(false)
  const lastHorizontalNudgeRef = useRef(0)
  /** When DragOverlay yields over=null on drop, use last hovered cal-day column. */
  const lastCalDayOverRef = useRef<string | null>(null)
  /** Pointer Y minus block top at drag start (client coords), for grab-point–preserving drop math. */
  const calGrabOffsetYPxRef = useRef(0)
  /** At most one vertical edge scroll per animation frame (avoids stacked DragMove scroll + snap jank). */
  const calEdgeScrollRafRef = useRef<number | null>(null)
  /** Restored in resetCalDragUi when a cal item drag ends; blocks native hour-viewport pan during drag. */
  const calHourViewportPrevTouchActionRef = useRef<string | null>(null)
  /** Set when a calendar item drag starts; cleared on week-swipe touchend so we never change week after moving an item. */
  const calMobileWeekSwipeSkipForDragRef = useRef(false)
  /** Latest `event.over` rect/id for drop preview; read inside rAF after scroll. */
  const lastCalSnapOverRef = useRef<{
    oid: string | null
    otop: number | undefined
    oheight: number | undefined
  }>({ oid: null, otop: undefined, oheight: undefined })
  const slideBusyRef = useRef(false)
  const pendingShiftDeltaRef = useRef<number | null>(null)
  const slideFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [calDragOverlay, setCalDragOverlay] = useState<CalDragOverlayPayload | null>(null)
  const [calDropPreview, setCalDropPreview] = useState<{ dayIso: string; startMin: number } | null>(null)
  const [calSlideStrip, setCalSlideStrip] = useState<CalSlideStripPanes | null>(null)
  const [calSlide, setCalSlide] = useState<{ transform: string; transition: string }>({
    transform: 'translateX(0px)',
    transition: '',
  })

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useEffect(() => {
    return () => {
      if (slideFallbackTimerRef.current !== null) clearTimeout(slideFallbackTimerRef.current)
    }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: CAL_DRAG_ACTIVATION_DELAY_MS,
        tolerance: CAL_DRAG_ACTIVATION_TOLERANCE_PX,
      },
    }),
  )
  const weekSwipeNavRef = useRef({ onPrevWeek, onNextWeek, canPrev, canNext })
  weekSwipeNavRef.current = { onPrevWeek, onNextWeek, canPrev, canNext }
  const setCalDragGrabYPx = useCallback((offsetYPx: number) => {
    calGrabOffsetYPxRef.current = offsetYPx
  }, [])
  const isCalMobileNarrow = useCalMobileNarrowViewport()
  const calScrollMaxHeightPx = isCalMobileNarrow ? CAL_MOBILE_VIEWPORT_HEIGHT_PX : CAL_VIEWPORT_HEIGHT_PX
  const gridHeightPx = (CAL_END_HOUR - CAL_START_HOUR) * CAL_PX_PER_HOUR
  const rangeMin = (CAL_END_HOUR - CAL_START_HOUR) * 60
  const hours = useMemo(() => {
    const out: number[] = []
    for (let h = CAL_START_HOUR; h < CAL_END_HOUR; h++) out.push(h)
    return out
  }, [])
  const rangeLabelEnd = Math.min(weekStartIndex + visibleDays.length, timelineDays.length)
  const leftmostDayIso = visibleDays[0] ?? ''
  const monthYearLabel = formatCalendarMonthYearLabel(leftmostDayIso)

  const stayById = useMemo(() => new Map(stays.map((s) => [s.id, s])), [stays])

  const layoutDays = useMemo(() => {
    if (calSlideStrip) return [...calSlideStrip.left, ...calSlideStrip.right]
    return visibleDays
  }, [calSlideStrip, visibleDays])

  const layoutByDay = useMemo(() => {
    const m = new Map<string, Map<string, CalOverlapLayout>>()
    for (const dayIso of layoutDays) {
      const items = activitiesByDay.get(dayIso) ?? []
      const raw = computeCalendarOverlapLayouts(items, dayIso)
      m.set(dayIso, raw)
    }
    return m
  }, [layoutDays, activitiesByDay])

  /** When the visible week slides away from the source day, keep a mounted draggable until drag end. */
  const dragAnchorLayoutInfo = useMemo(() => {
    if (!calDragOverlay) return null
    const dayIso = calDragOverlay.activity.date
    if (layoutDays.includes(dayIso)) return null
    const items = activitiesByDay.get(dayIso) ?? []
    const raw = computeCalendarOverlapLayouts(items, dayIso)
    const k = `${calDragOverlay.stayId}-${calDragOverlay.activity.id}`
    return { dayIso, layout: raw.get(k) ?? { leftPct: 0, widthPct: 100 } }
  }, [calDragOverlay, layoutDays, activitiesByDay])

  const visibleDaysKey = visibleDays.join('|')
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isDraggingCalRef.current) return
    if (calSlideStrip) return
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = Math.min(CAL_DEFAULT_SCROLL_TOP_PX, maxScroll)
  }, [weekStartIndex, visibleDaysKey, calSlideStrip, isCalMobileNarrow])

  useEffect(() => {
    const shell = calShellRef.current
    const cols = calDayColumnsRef.current
    if (!shell || !cols) return

    const onWheelCapture = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      if (isDraggingCalRef.current) return
      const t = e.target
      if (!(t instanceof Node) || !shell.contains(t)) return
      if (cols.contains(t)) return
      e.preventDefault()
      window.scrollBy({ top: e.deltaY, left: 0, behavior: 'auto' })
    }

    shell.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    return () => shell.removeEventListener('wheel', onWheelCapture, { capture: true })
  }, [visibleDaysKey, calSlideStrip])

  /** Narrow viewports: vertical pans on toolbar / week header (above the hour viewport) scroll the page — same idea as the wheel handler. */
  useEffect(() => {
    if (!isCalMobileNarrow) return
    const shell = calShellRef.current
    const hourViewport = scrollRef.current
    if (!shell || !hourViewport) return

    let lastY = 0
    let active = false

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        active = false
        return
      }
      const { clientX, clientY } = e.touches[0]
      const el = document.elementFromPoint(clientX, clientY)
      if (!(el instanceof Element) || !shell.contains(el) || hourViewport.contains(el)) {
        active = false
        return
      }
      active = true
      lastY = clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      if (isDraggingCalRef.current) return
      if (!active || e.touches.length !== 1) return
      const { clientX, clientY } = e.touches[0]
      const el = document.elementFromPoint(clientX, clientY)
      if (!(el instanceof Element) || hourViewport.contains(el)) {
        active = false
        return
      }
      if (!shell.contains(el)) {
        active = false
        return
      }
      e.preventDefault()
      const dy = lastY - clientY
      lastY = clientY
      window.scrollBy(0, dy)
    }

    const onTouchEnd = () => {
      active = false
    }

    const touchMoveOpts: AddEventListenerOptions = { passive: false }
    shell.addEventListener('touchstart', onTouchStart, { passive: true })
    shell.addEventListener('touchmove', onTouchMove, touchMoveOpts)
    shell.addEventListener('touchend', onTouchEnd)
    shell.addEventListener('touchcancel', onTouchEnd)

    return () => {
      shell.removeEventListener('touchstart', onTouchStart)
      shell.removeEventListener('touchmove', onTouchMove, touchMoveOpts)
      shell.removeEventListener('touchend', onTouchEnd)
      shell.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [visibleDaysKey, calSlideStrip, isCalMobileNarrow])

  /** Narrow layout: horizontal swipe on the calendar shell moves the visible week (same as prev/next arrows). */
  useEffect(() => {
    if (!isCalMobileNarrow) return
    const shell = calShellRef.current
    if (!shell) return

    let startX = 0
    let startY = 0
    let startT = 0
    let touchId: number | null = null
    let tracking = false

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        tracking = false
        touchId = null
        return
      }
      const raw = e.target
      if (!(raw instanceof Element) || !shell.contains(raw)) {
        tracking = false
        touchId = null
        return
      }
      if (raw.closest('button, a, input, textarea, select, [role="slider"]')) {
        tracking = false
        touchId = null
        return
      }
      const t = e.touches[0]
      calMobileWeekSwipeSkipForDragRef.current = false
      startX = t.clientX
      startY = t.clientY
      startT = performance.now()
      touchId = t.identifier
      tracking = true
    }

    const finishTouch = (e: TouchEvent) => {
      if (!tracking || touchId === null) return
      const ended = Array.from(e.changedTouches).find((c) => c.identifier === touchId)
      if (!ended) return
      tracking = false
      touchId = null

      if (calSlideStrip || slideBusyRef.current) return
      if (isDraggingCalRef.current) return
      if (calMobileWeekSwipeSkipForDragRef.current) {
        calMobileWeekSwipeSkipForDragRef.current = false
        return
      }

      const dt = performance.now() - startT
      if (dt > CAL_MOBILE_WEEK_SWIPE_MAX_MS) return

      const dx = ended.clientX - startX
      const dy = ended.clientY - startY
      const adx = Math.abs(dx)
      const ady = Math.abs(dy)
      if (adx < CAL_MOBILE_WEEK_SWIPE_MIN_PX) return
      if (adx < ady * CAL_MOBILE_WEEK_SWIPE_DOMINANCE) return

      const { onPrevWeek, onNextWeek, canPrev, canNext } = weekSwipeNavRef.current
      if (dx < 0 && canNext) onNextWeek()
      else if (dx > 0 && canPrev) onPrevWeek()
    }

    const capOpts: AddEventListenerOptions = { capture: true, passive: true }
    shell.addEventListener('touchstart', onTouchStart, capOpts)
    shell.addEventListener('touchend', finishTouch, capOpts)
    shell.addEventListener('touchcancel', finishTouch, capOpts)

    return () => {
      shell.removeEventListener('touchstart', onTouchStart, capOpts)
      shell.removeEventListener('touchend', finishTouch, capOpts)
      shell.removeEventListener('touchcancel', finishTouch, capOpts)
    }
  }, [isCalMobileNarrow, visibleDaysKey, calSlideStrip])

  useEffect(() => {
    if (!calDragOverlay) return undefined
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevBodyTouchAction = body.style.touchAction
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.touchAction = 'none'

    const gestureOverHourViewport = (clientX: number, clientY: number, fallbackTarget: EventTarget | null) => {
      const vp = scrollRef.current
      if (!vp) return false
      if (
        Number.isFinite(clientX) &&
        Number.isFinite(clientY) &&
        typeof document.elementFromPoint === 'function'
      ) {
        const hit = document.elementFromPoint(clientX, clientY)
        if (hit instanceof Node && vp.contains(hit)) return true
      }
      return fallbackTarget instanceof Node && vp.contains(fallbackTarget)
    }

    const onWheelCapture = (e: WheelEvent) => {
      if (gestureOverHourViewport(e.clientX, e.clientY, e.target)) return
      e.preventDefault()
    }
    const onTouchMoveCapture = (e: TouchEvent) => {
      /* Always preventDefault: exempting the hour viewport used to allow native scroll there, which steals the drag after long-press activation. */
      e.preventDefault()
    }
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    window.addEventListener('touchmove', onTouchMoveCapture, { capture: true, passive: false })

    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      body.style.touchAction = prevBodyTouchAction
      window.removeEventListener('wheel', onWheelCapture, true)
      window.removeEventListener('touchmove', onTouchMoveCapture, true)
      const vp = scrollRef.current
      if (vp && calHourViewportPrevTouchActionRef.current !== null) {
        vp.style.touchAction = calHourViewportPrevTouchActionRef.current
        calHourViewportPrevTouchActionRef.current = null
      }
    }
  }, [calDragOverlay])

  const slideSurfaceStyle: CSSProperties = {
    transform: calSlide.transform,
    transition: calSlide.transition,
    ...(calSlide.transition ? { willChange: 'transform' } : {}),
  }

  const finishShiftAnimation = () => {
    if (slideFallbackTimerRef.current !== null) {
      clearTimeout(slideFallbackTimerRef.current)
      slideFallbackTimerRef.current = null
    }
    const delta = pendingShiftDeltaRef.current
    if (delta === null) return
    pendingShiftDeltaRef.current = null
    onShiftCalendarDays(delta)
    setCalSlideStrip(null)
    setCalSlide({ transform: 'translateX(0px)', transition: 'none' })
    requestAnimationFrame(() => {
      setCalSlide({ transform: 'translateX(0px)', transition: '' })
      slideBusyRef.current = false
    })
  }

  const beginSlideShift = (dir: 1 | -1): boolean => {
    if (slideBusyRef.current) return false
    if ((dir === 1 && !canShiftCalendarNext) || (dir === -1 && !canShiftCalendarPrev)) return false

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

    const delta = dir * CAL_EDGE_SHIFT_DAYS

    if (prefersReduced) {
      onShiftCalendarDays(delta)
      return true
    }

    const nextPane =
      dir === 1 ? timelineDays.slice(weekStartIndex + 7, weekStartIndex + 14) : []
    const prevPane =
      dir === -1 ? timelineDays.slice(Math.max(0, weekStartIndex - 7), weekStartIndex) : []

    if (dir === 1 && nextPane.length === 0) return false
    if (dir === -1 && prevPane.length === 0) return false

    const strip: CalSlideStripPanes =
      dir === 1
        ? { mode: 'next', left: visibleDays, right: nextPane }
        : { mode: 'prev', left: prevPane, right: visibleDays }

    slideBusyRef.current = true
    pendingShiftDeltaRef.current = delta
    slideFallbackTimerRef.current = window.setTimeout(() => {
      slideFallbackTimerRef.current = null
      finishShiftAnimation()
    }, CAL_EDGE_SLIDE_MS + 150)

    setCalSlideStrip(strip)

    const txEase = `transform ${CAL_EDGE_SLIDE_MS}ms cubic-bezier(0.25, 0.8, 0.25, 1)`

    if (dir === 1) {
      setCalSlide({ transform: 'translateX(0%)', transition: 'none' })
      requestAnimationFrame(() => {
        setCalSlide({
          transform: 'translateX(-50%)',
          transition: txEase,
        })
      })
    } else {
      setCalSlide({ transform: 'translateX(-50%)', transition: 'none' })
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCalSlide({
            transform: 'translateX(0%)',
            transition: txEase,
          })
        })
      })
    }
    return true
  }

  const handleCalSlideEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.propertyName !== 'transform') return
    finishShiftAnimation()
  }

  const flushCalDropPreviewSnap = useCallback(() => {
    const dragAct = calDragOverlay?.activity
    const durationMin =
      dragAct != null
        ? Math.max(
            CAL_SNAP_MINUTES,
            effectiveActivityEndMinutes(dragAct, dragAct.date) -
              effectiveActivityStartMinutes(dragAct, dragAct.date),
          )
        : undefined
    const { oid, otop, oheight } = lastCalSnapOverRef.current
    const snapped = resolveSnappedCalendarDrop(pointerRef.current.x, pointerRef.current.y, layoutDays, {
      overDayId: oid,
      overRectTop: otop,
      overRectHeight: oheight,
      lastHoveredDayIso: lastCalDayOverRef.current,
      grabOffsetYPx: calGrabOffsetYPxRef.current,
      durationMin,
    })
    const nextPreview = snapped ? { dayIso: snapped.dayIso, startMin: snapped.snappedStartMin } : null
    setCalDropPreview((prev) => {
      if (
        (prev === null && nextPreview === null) ||
        (prev !== null &&
          nextPreview !== null &&
          prev.dayIso === nextPreview.dayIso &&
          prev.startMin === nextPreview.startMin)
      ) {
        return prev
      }
      return nextPreview
    })
  }, [layoutDays, calDragOverlay])

  const handleDragMove = (event: DragMoveEvent) => {
    if (!event.active) return
    const activeId = String(event.active.id)
    /* Real PointerEvent stream (window listener) — dnd-kit activator+delta can drift from the OS cursor after autoscroll. */
    const x = pointerRef.current.x
    const y = pointerRef.current.y

    let scheduledVertRafThisCall = false

    if (activeId.startsWith('cal-drag-')) {
      const o = event.over
      const oid = o?.id != null ? String(o.id) : null
      const orect = o?.rect
      lastCalSnapOverRef.current = {
        oid,
        otop: orect?.top,
        oheight: orect?.height,
      }

      const el = scrollRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        const margin = isCalMobileNarrow ? CAL_EDGE_SCROLL_MARGIN_MOBILE : CAL_EDGE_SCROLL_MARGIN_DESKTOP
        const inTop = y < r.top + margin
        const inBottom = y > r.bottom - margin
        const inVertEdge = inTop || inBottom
        /* Pending rAF from the edge band must not run after the pointer leaves it — that scroll+snap fights sync updates and flashes. */
        if (!inVertEdge && calEdgeScrollRafRef.current != null) {
          cancelAnimationFrame(calEdgeScrollRafRef.current)
          calEdgeScrollRafRef.current = null
        }
        if (inVertEdge && calEdgeScrollRafRef.current == null) {
          scheduledVertRafThisCall = true
          calEdgeScrollRafRef.current = requestAnimationFrame(() => {
            calEdgeScrollRafRef.current = null
            const s = scrollRef.current
            if (!s || !isDraggingCalRef.current) return
            const br = s.getBoundingClientRect()
            const yy = pointerRef.current.y
            const marginRaf = isCalMobileNarrow ? CAL_EDGE_SCROLL_MARGIN_MOBILE : CAL_EDGE_SCROLL_MARGIN_DESKTOP
            const stepRaf = isCalMobileNarrow ? CAL_EDGE_SCROLL_STEP_MOBILE : CAL_EDGE_SCROLL_STEP_DESKTOP
            const stillTop = yy < br.top + marginRaf
            const stillBottom = yy > br.bottom - marginRaf
            if (stillTop) s.scrollTop -= stepRaf
            else if (stillBottom) s.scrollTop += stepRaf
            flushCalDropPreviewSnap()
          })
        }

        const hMargin = isCalMobileNarrow ? CAL_EDGE_H_MARGIN_MOBILE : CAL_EDGE_H_MARGIN_DESKTOP
        const now = performance.now()
        const horizontalCooldownMs = isCalMobileNarrow
          ? CAL_EDGE_WEEK_COOLDOWN_MS_MOBILE
          : CAL_EDGE_WEEK_COOLDOWN_MS_DESKTOP
        if (now - lastHorizontalNudgeRef.current >= horizontalCooldownMs) {
          if (x > r.right - hMargin && canShiftCalendarNext) {
            if (beginSlideShift(1)) lastHorizontalNudgeRef.current = now
          } else if (x < r.left + hMargin && canShiftCalendarPrev) {
            if (beginSlideShift(-1)) lastHorizontalNudgeRef.current = now
          }
        }
      }

      if (!scheduledVertRafThisCall) {
        flushCalDropPreviewSnap()
      }
    }
  }

  const resetCalDragUi = () => {
    if (calEdgeScrollRafRef.current != null) {
      cancelAnimationFrame(calEdgeScrollRafRef.current)
      calEdgeScrollRafRef.current = null
    }
    const vp = scrollRef.current
    if (vp && calHourViewportPrevTouchActionRef.current !== null) {
      vp.style.touchAction = calHourViewportPrevTouchActionRef.current
      calHourViewportPrevTouchActionRef.current = null
    }
    isDraggingCalRef.current = false
    calGrabOffsetYPxRef.current = 0
    setCalDragOverlay(null)
    setCalDropPreview(null)
  }

  const handleCalDragStart = (event: DragStartEvent) => {
    if (String(event.active.id).startsWith('cal-drag-')) {
      calMobileWeekSwipeSkipForDragRef.current = true
    }
    isDraggingCalRef.current = true
    lastCalDayOverRef.current = null
    const startCoords = getEventCoordinates(event.activatorEvent)
    if (startCoords) pointerRef.current = { x: startCoords.x, y: startCoords.y }
    const d = event.active.data.current as { stayId: string; activityId: string } | undefined
    if (!d) return
    const stay = stays.find((s) => s.id === d.stayId)
    const activity = stay?.activities?.find((a) => a.id === d.activityId)
    if (!activity) return
    const hourVp = scrollRef.current
    if (hourVp && calHourViewportPrevTouchActionRef.current === null) {
      calHourViewportPrevTouchActionRef.current = hourVp.style.touchAction
      hourVp.style.touchAction = 'none'
    }
    /* Grab offset was set in pointerdown capture (see CalendarActivityBlock). */
    const important = isActivityImportant(activity, stay)
    const startMin = effectiveActivityStartMinutes(activity, activity.date)
    const endMin = effectiveActivityEndMinutes(activity, activity.date)
    const inProgress = activity.date === todayIso && nowMinutes >= startMin && nowMinutes < endMin
    setCalDragOverlay({
      stayId: d.stayId,
      activity,
      stay,
      important,
      inProgress,
      markerKind: 'activity',
    })
    setCalDropPreview({
      dayIso: activity.date,
      startMin: snapCalendarMinutes(effectiveActivityStartMinutes(activity, activity.date)),
    })
  }

  const handleDragOverCal = (event: DragOverEvent) => {
    const o = event.over
    if (!o) return
    const id = String(o.id)
    if (id.startsWith('cal-day-')) {
      lastCalDayOverRef.current = id.slice('cal-day-'.length)
    }
  }

  const handleCalendarDragEnd = (event: DragEndEvent) => {
    if (calendarReadOnly) {
      lastCalDayOverRef.current = null
      resetCalDragUi()
      return
    }
    const { active, over } = event
    const data = active.data.current as { stayId: string; activityId: string } | undefined
    if (!data) {
      lastCalDayOverRef.current = null
      resetCalDragUi()
      return
    }

    const fromDnd = clientPointerFromDndEvent(event)
    const px = fromDnd?.x ?? pointerRef.current.x
    const py = fromDnd?.y ?? pointerRef.current.y
    const lastHovered = lastCalDayOverRef.current
    lastCalDayOverRef.current = null
    const oid = over?.id != null ? String(over.id) : null
    const orect = over?.rect
    const endStay = stays.find((s) => s.id === data.stayId)
    const endAct = endStay?.activities?.find((a) => a.id === data.activityId)
    const durationMin =
      endAct != null
        ? Math.max(
            CAL_SNAP_MINUTES,
            effectiveActivityEndMinutes(endAct, endAct.date) - effectiveActivityStartMinutes(endAct, endAct.date),
          )
        : undefined
    const snapped = resolveSnappedCalendarDrop(px, py, layoutDays, {
      overDayId: oid,
      overRectTop: orect?.top,
      overRectHeight: orect?.height,
      lastHoveredDayIso: lastHovered,
      grabOffsetYPx: calGrabOffsetYPxRef.current,
      durationMin,
    })
    resetCalDragUi()

    if (!snapped) return
    const newTime = formatMinutesToTime(snapped.snappedStartMin)
    onCalendarActivityDrop(data.stayId, data.activityId, snapped.dayIso, newTime)
  }

  const handleCalDragCancel = () => {
    lastCalDayOverRef.current = null
    resetCalDragUi()
  }

  const renderHeaderCells = (days: string[], paneId: string) =>
    days.map((dayIso) => {
      const dayIndex = timelineDays.indexOf(dayIso) + 1
      const staysForDay = staysByDay.get(dayIso) ?? []
      return (
        <CalendarDayHeaderCell
          key={`${paneId}-${dayIso}`}
          dayIso={dayIso}
          dayIndex={dayIndex}
          isSelected={selectedTimelineDate === dayIso}
          isToday={dayIso === todayIso}
          onHeaderClick={() => onSelectDay(dayIso)}
          staysForDay={staysForDay}
        />
      )
    })

  const renderGridColumns = (days: string[], paneId: string) =>
    days.map((dayIso) => {
      const items = activitiesByDay.get(dayIso) ?? []
      const layouts = layoutByDay.get(dayIso) ?? new Map()
      let dropPreviewEl: ReactNode = null
      if (calDropPreview && calDragOverlay && calDropPreview.dayIso === dayIso) {
        const act = calDragOverlay.activity
        const previewStart = calDropPreview.startMin
        const durMin = Math.max(
          CAL_SNAP_MINUTES,
          effectiveActivityEndMinutes(act, act.date) - effectiveActivityStartMinutes(act, act.date),
        )
        const topPx = ((previewStart - CAL_START_HOUR * 60) / rangeMin) * gridHeightPx
        const minBlockPx = 14
        const heightPx = Math.max(minBlockPx, (durMin / rangeMin) * gridHeightPx)
        const previewLayout =
          layouts.get(`${calDragOverlay.stayId}-${act.id}`) ?? { leftPct: 0, widthPct: 100 }
        const previewTimeLabel = `${formatMinutesToTime(previewStart)}–${formatMinutesToTime(previewStart + durMin)}`
        dropPreviewEl = (
          <div
            key={`cal-preview-${calDragOverlay.stayId}-${act.id}`}
            className={`itinerary-calendar-event itinerary-calendar-event--mk-${calDragOverlay.markerKind} itinerary-calendar-drag-preview${
              calDragOverlay.important ? ' itinerary-calendar-event--important' : ''
            }${calDragOverlay.inProgress ? ' itinerary-calendar-event--in-progress' : ''}`}
            style={{
              top: topPx,
              height: heightPx,
              left: `calc(${previewLayout.leftPct}% + 2px)`,
              width: `calc(${previewLayout.widthPct}% - 4px)`,
            }}
            {...(durMin < 60 ? { 'data-cal-sub-hour': '' } : {})}
            {...(durMin >= 60 ? { 'data-cal-hour-plus': '' } : {})}
            aria-hidden
          >
            <div className="itinerary-calendar-event-drag itinerary-calendar-drag-preview-body">
              <p className="itinerary-calendar-event-title">{act.name}</p>
              <p className="itinerary-calendar-event-time">{previewTimeLabel}</p>
            </div>
          </div>
        )
      }
      return (
        <CalendarDayGridColumn
          key={`${paneId}-${dayIso}`}
          dayIso={dayIso}
          gridHeightPx={gridHeightPx}
          isSelected={selectedTimelineDate === dayIso}
          isToday={dayIso === todayIso}
          nowMinutes={nowMinutes}
        >
          {items.map((item) => {
            const { stayId, activity, bookingRef } = item
            const key = `${stayId}-${activity.id}`
            const layout = layouts.get(key) ?? { leftPct: 0, widthPct: 100 }
            const markerKind = calendarMapMarkerKind(item)
            return (
              <CalendarActivityBlock
                key={key}
                activity={activity}
                stayId={stayId}
                stay={stayById.get(stayId)}
                dayIso={dayIso}
                gridHeightPx={gridHeightPx}
                rangeMin={rangeMin}
                layout={layout}
                onOpenDetail={() => onSelectCalendarItem(item)}
                nowMinutes={nowMinutes}
                isTodayColumn={dayIso === todayIso}
                isBookingCalendarItem={Boolean(bookingRef)}
                markerKind={markerKind}
                dragDisabled={calendarReadOnly}
                onResizeCommit={
                  onCalendarActivityResize && !bookingRef && !calendarReadOnly
                    ? (startM, endM) => onCalendarActivityResize(stayId, activity.id, dayIso, startM, endM)
                    : undefined
                }
              />
            )
          })}
          {dropPreviewEl}
        </CalendarDayGridColumn>
      )
    })

  return (
    <SetCalDragGrabYPxContext.Provider value={setCalDragGrabYPx}>
      <DndContext
        autoScroll={false}
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleCalDragStart}
        onDragOver={handleDragOverCal}
        onDragEnd={handleCalendarDragEnd}
        onDragCancel={handleCalDragCancel}
        onDragMove={handleDragMove}
      >
      <div ref={calShellRef} className="itinerary-calendar-shell">
        <div className="itinerary-calendar-toolbar">
          <button
            type="button"
            className="itinerary-calendar-nav"
            onClick={onPrevWeek}
            disabled={!canPrev}
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="itinerary-calendar-range-label">
            Days {weekStartIndex + 1}–{rangeLabelEnd} of {timelineDays.length}
          </span>
          <button
            type="button"
            className="itinerary-calendar-nav"
            onClick={onNextWeek}
            disabled={!canNext}
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <p className="itinerary-calendar-hint text-xs text-neutral-500 mt-2">
          Click an activity to edit, or drag to move time or day. The day shows 12 hours at a time (scroll for the full 24h). With a mouse wheel, only the day columns scroll the hours—the time labels, scrollbar strip, and rest of the card scroll the page. Hold near the left or right edge while dragging to slide the visible week earlier or later (same step as the arrows). On a narrow screen, scroll vertically within the day columns. Click a day header to select it for recommendations below.
        </p>
        {monthYearLabel ? (
          <div className="itinerary-calendar-month-banner">
            <span className="itinerary-calendar-month-year">{monthYearLabel}</span>
          </div>
        ) : null}
        <div className="itinerary-calendar-week-header">
          <div className="itinerary-calendar-corner" aria-hidden />
          <div className="itinerary-calendar-header-slide-clip">
            <div
              className={`itinerary-calendar-header-slide-inner${calSlideStrip ? ' itinerary-calendar-header-slide-inner--strip' : ''}`}
              style={slideSurfaceStyle}
            >
              {calSlideStrip ? (
                <>
                  <div className="itinerary-calendar-week-pane">{renderHeaderCells(calSlideStrip.left, 'hL')}</div>
                  <div className="itinerary-calendar-week-pane">{renderHeaderCells(calSlideStrip.right, 'hR')}</div>
                </>
              ) : (
                renderHeaderCells(visibleDays, 'h')
              )}
            </div>
          </div>
        </div>
        <div
          ref={scrollRef}
          className="itinerary-calendar-scroll itinerary-calendar-hour-viewport"
          style={{ maxHeight: calScrollMaxHeightPx }}
        >
          <div className="itinerary-calendar-time-gutter">
            {hours.map((h) => (
              <div key={h} className="itinerary-calendar-time-label" style={{ height: CAL_PX_PER_HOUR }}>
                {formatCalendarHourLabel(h)}
              </div>
            ))}
          </div>
          <div ref={calDayColumnsRef} className="itinerary-calendar-columns-slide-clip">
            {calSlideStrip ? (
              <div
                ref={bodySlideRef}
                className="itinerary-calendar-slide-strip"
                style={slideSurfaceStyle}
                onTransitionEnd={handleCalSlideEnd}
              >
                <div className="itinerary-calendar-week-pane">
                  <div className="itinerary-calendar-columns">{renderGridColumns(calSlideStrip.left, 'gL')}</div>
                </div>
                <div className="itinerary-calendar-week-pane">
                  <div className="itinerary-calendar-columns">{renderGridColumns(calSlideStrip.right, 'gR')}</div>
                </div>
              </div>
            ) : (
              <div
                ref={bodySlideRef}
                className="itinerary-calendar-columns"
                style={slideSurfaceStyle}
                onTransitionEnd={handleCalSlideEnd}
              >
                {renderGridColumns(visibleDays, 'g')}
              </div>
            )}
          </div>
        </div>
      </div>
      {calDragOverlay && dragAnchorLayoutInfo ? (
        <div className="itinerary-calendar-drag-anchor" aria-hidden>
          <div className="itinerary-calendar-columns itinerary-calendar-drag-anchor-inner">
            <CalendarDayGridColumn
              dayIso={dragAnchorLayoutInfo.dayIso}
              gridHeightPx={gridHeightPx}
              isSelected={selectedTimelineDate === dragAnchorLayoutInfo.dayIso}
              isToday={dragAnchorLayoutInfo.dayIso === todayIso}
              nowMinutes={nowMinutes}
            >
              <CalendarActivityBlock
                activity={calDragOverlay.activity}
                stayId={calDragOverlay.stayId}
                stay={stayById.get(calDragOverlay.stayId)}
                dayIso={dragAnchorLayoutInfo.dayIso}
                gridHeightPx={gridHeightPx}
                rangeMin={rangeMin}
                layout={dragAnchorLayoutInfo.layout}
                onOpenDetail={() =>
                  onSelectCalendarItem({
                    stayId: calDragOverlay.stayId,
                    stayLocation: stayById.get(calDragOverlay.stayId)?.location ?? '',
                    activity: calDragOverlay.activity,
                  })
                }
                nowMinutes={nowMinutes}
                isTodayColumn={dragAnchorLayoutInfo.dayIso === todayIso}
                markerKind={calDragOverlay.markerKind}
              />
            </CalendarDayGridColumn>
          </div>
        </div>
      ) : null}
      <DragOverlay dropAnimation={null} />
      </DndContext>
    </SetCalDragGrabYPxContext.Provider>
  )
}

/** Home page trip list ordering by calendar dates (ISO YYYY-MM-DD). */
function sortKeyActiveAsc(t: Trip): string {
  const k = (t.startDate || t.endDate || '').trim()
  return k || '9999-12-31'
}

function sortKeyPastDesc(t: Trip): string {
  return (t.endDate || t.startDate || '').trim() || '0000-01-01'
}

function sortKeyCancelledDesc(t: Trip): string {
  return (t.startDate || t.endDate || '').trim() || '0000-01-01'
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  })
  const [displayCurrency] = useState(() => loadDisplayCurrency())
  const initialAppUrl = useMemo(() => readInitialAppUrl(), [])
  const [view, setView] = useState<View>(() => {
    if (isSupabaseConfigured() && !isDevAuthBypass() && initialAppUrl.shareToken) return 'dashboard'
    return initialAppUrl.view
  })
  const [activeTab, setActiveTab] = useState<Tab>(() => initialAppUrl.tab)
  const tripPendingFromUrlRef = useRef<string | null>(
    isSupabaseConfigured() && !isDevAuthBypass() && initialAppUrl.view === 'dashboard' && initialAppUrl.tripId
      ? initialAppUrl.tripId
      : null,
  )
  const shareTokenFromUrlRef = useRef<string | null>(
    isSupabaseConfigured() && !isDevAuthBypass() && initialAppUrl.shareToken ? initialAppUrl.shareToken : null,
  )
  const shareUrlHandledRef = useRef(false)
  const [shareInviteBanner, setShareInviteBanner] = useState<string | null>(null)
  const [expandedTripPanel, setExpandedTripPanel] = useState(true)
  const [selectedTimelineDate, setSelectedTimelineDate] = useState('')
  const [itineraryViewMode, setItineraryViewMode] = useState<'timeline' | 'calendar'>('timeline')
  const [calendarWeekStartIndex, setCalendarWeekStartIndex] = useState(0)
  const [calendarDropError, setCalendarDropError] = useState<string | null>(null)
  const isMobileCalNarrow = useCalMobileNarrowViewport()
  const [calendarActivityDetail, setCalendarActivityDetail] = useState<CalendarActivityModalPayload | null>(null)
  const [calendarActivityDetailEditing, setCalendarActivityDetailEditing] = useState(false)
  const [calendarDetailDraft, setCalendarDetailDraft] = useState<Partial<StayActivity> | null>(null)
  const [itineraryClock, setItineraryClock] = useState(() => Date.now())

  const [authReady, setAuthReady] = useState(() => !isSupabaseConfigured() || isDevAuthBypass())
  const [backendUserId, setBackendUserId] = useState<string | null>(null)
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    if (isDevAuthBypass()) return DEV_BYPASS_SESSION
    if (isSupabaseConfigured()) return null
    return loadAuthSession()
  })
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authEmailInput, setAuthEmailInput] = useState('')
  const [authPasswordInput, setAuthPasswordInput] = useState('')
  const [authPasswordConfirmInput, setAuthPasswordConfirmInput] = useState('')
  const [authNameInput, setAuthNameInput] = useState('')
  const [authFormError, setAuthFormError] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  /** Set when email confirmation is required (usually unused on personal PocketBase). */
  const [authPendingVerificationEmail, setAuthPendingVerificationEmail] = useState<string | null>(null)
  const [verificationResendMessage, setVerificationResendMessage] = useState<string | null>(null)
  const [localImportDismissed, setLocalImportDismissed] = useState(false)

  const skipRemoteSaveRef = useRef(true)
  const remoteFetchGenRef = useRef(0)

  const [state, setState] = useState<TripsState>(() => {
    if (isSupabaseConfigured() && !isDevAuthBypass()) return { trips: [], selectedTripId: null }
    const s = isDevAuthBypass() ? DEV_BYPASS_SESSION : loadAuthSession()
    const base = loadTripsState(s ? tripsStorageKey(s.email) : null)
    if (initialAppUrl.tripId && base.trips.some((t) => t.id === initialAppUrl.tripId)) {
      return { ...base, selectedTripId: initialAppUrl.tripId }
    }
    return base
  })
  const [placeSearchInput, setPlaceSearchInput] = useState('')
  const [showPlaceSuggestions, setShowPlaceSuggestions] = useState(false)
  const [placeSuggestionIndex, setPlaceSuggestionIndex] = useState(-1)
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
  const [stayCheckInTimeInput, setStayCheckInTimeInput] = useState('')
  const [stayCheckOutTimeInput, setStayCheckOutTimeInput] = useState('')
  const [stayPriceInput, setStayPriceInput] = useState('')
  const [stayBookingUrlInput, setStayBookingUrlInput] = useState('')
  const [stayConfirmationRefInput, setStayConfirmationRefInput] = useState('')
  const [stayError, setStayError] = useState<string | null>(null)
  const [bookingsTab, setBookingsTab] = useState<BookingTab>('rentalCar')
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>('all')
  const [bookingManagementExpanded, setBookingManagementExpanded] = useState(true)
  const [editingBookingForm, setEditingBookingForm] = useState<{ tab: BookingTab; id: string } | null>(null)
  const [editingStayId, setEditingStayId] = useState<string | null>(null)
  const [pinnedOverlapSourceId, setPinnedOverlapSourceId] = useState<string | null>(null)
  const [carCompanyInput, setCarCompanyInput] = useState('')
  const [carPickupLocationInput, setCarPickupLocationInput] = useState('')
  const [carDropoffLocationInput, setCarDropoffLocationInput] = useState('')
  const [carPickupInput, setCarPickupInput] = useState('')
  const [carPickupTimeInput, setCarPickupTimeInput] = useState('')
  const [carDropoffInput, setCarDropoffInput] = useState('')
  const [carDropoffTimeInput, setCarDropoffTimeInput] = useState('')
  const [carConfirmationInput, setCarConfirmationInput] = useState('')
  const [carPriceInput, setCarPriceInput] = useState('')
  const [flightFromIata, setFlightFromIata] = useState('')
  const [flightFromLabel, setFlightFromLabel] = useState('')
  const [flightToIata, setFlightToIata] = useState('')
  const [flightToLabel, setFlightToLabel] = useState('')
  const [flightAirlineInput, setFlightAirlineInput] = useState('')
  const [flightDepartInput, setFlightDepartInput] = useState('')
  const [flightDepartTimeInput, setFlightDepartTimeInput] = useState('')
  const [flightArriveDateInput, setFlightArriveDateInput] = useState('')
  const [flightArriveTimeInput, setFlightArriveTimeInput] = useState('')
  const [flightCheckedBags, setFlightCheckedBags] = useState(1)
  const [flightCarryOnBags, setFlightCarryOnBags] = useState(1)
  const [flightPersonalItem, setFlightPersonalItem] = useState(true)
  const [flightConfirmationInput, setFlightConfirmationInput] = useState('')
  const [flightPriceInput, setFlightPriceInput] = useState('')
  const [flightQuickInput, setFlightQuickInput] = useState('')
  const [restaurantNameInput, setRestaurantNameInput] = useState('')
  const [restaurantDateInput, setRestaurantDateInput] = useState('')
  const [restaurantConfirmationInput, setRestaurantConfirmationInput] = useState('')
  const [restaurantCostInput, setRestaurantCostInput] = useState('')
  const [restaurantNotesInput, setRestaurantNotesInput] = useState('')
  const [dismissedRecommendationKeys, setDismissedRecommendationKeys] = useState<string[]>([])
  const [activityDrafts, setActivityDrafts] = useState<
    Record<string, { name: string; time: string; confirmationRef: string; cost: string; notes: string }>
  >({})
  const [activityPlaceSearchInput, setActivityPlaceSearchInput] = useState('')
  const [draftPlaceMeta, setDraftPlaceMeta] = useState<Record<string, PlaceSuggestion>>({})
  const [activityMetaById, setActivityMetaById] = useState<Record<string, PlaceSuggestion>>({})
  const [selectedDayAnchorCoords, setSelectedDayAnchorCoords] = useState<Array<{ lat: number; lon: number }>>([])
  const [selectedDayRadiusPartial, setSelectedDayRadiusPartial] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [isBookingFormOpen, setIsBookingFormOpen] = useState(false)
  const [resolvedPointCoords, setResolvedPointCoords] = useState<Record<string, { lat: number; lon: number }>>({})
  const [mapCategoryVisible, setMapCategoryVisible] = useState<Record<MapCategory, boolean>>(defaultMapCategoryVisibility)
  /** Session-only hero; refetched when opening the dashboard so places are not stuck on one saved photo. */
  const [dashboardHeroUrl, setDashboardHeroUrl] = useState<string | null>(null)
  const [peakSeasonInfo, setPeakSeasonInfo] = useState<PeakSeasonInfo | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    description: ReactNode
    confirmLabel: string
    cancelLabel?: string
    variant?: 'default' | 'danger'
    onConfirm: () => void
  } | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareModalBusy, setShareModalBusy] = useState(false)
  const [shareModalError, setShareModalError] = useState<string | null>(null)
  const [shareModalMembers, setShareModalMembers] = useState<SharedMemberListItem[]>([])
  const [shareModalLinkToken, setShareModalLinkToken] = useState<string | null>(null)
  const [shareModalDefaultPerm, setShareModalDefaultPerm] = useState<'viewer' | 'editor'>('viewer')
  const [shareModalCopied, setShareModalCopied] = useState(false)

  const handleConfirmDialogAction = () => {
    if (!confirmDialog) return
    const { onConfirm } = confirmDialog
    onConfirm()
    setConfirmDialog(null)
  }

  useEffect(() => {
    if (isDevAuthBypass()) return
    if (!isSupabaseConfigured()) return
    const pb = getPocketBase()
    const apply = () => {
      const u = pb.authStore.record
      setBackendUserId(u?.id ?? null)
      setAuthSession(
        u
          ? authSessionFromPocketBaseUser({
              id: u.id,
              email: typeof u.email === 'string' ? u.email : null,
              name: typeof u.name === 'string' ? u.name : null,
            })
          : null,
      )
      setAuthReady(true)
    }
    apply()
    return pb.authStore.onChange(() => apply())
  }, [])

  useEffect(() => {
    if (!authSession) {
      setLocalImportDismissed(false)
      return
    }
    const k = `itinerary:import-dismissed:${normalizeEmail(authSession.email)}`
    setLocalImportDismissed(sessionStorage.getItem(k) === '1')
  }, [authSession?.email])

  useEffect(() => {
    if (!isSupabaseConfigured() || !authReady) return
    if (isDevAuthBypass()) {
      if (!authSession) return
      setState(loadTripsState(tripsStorageKey(authSession.email)))
      skipRemoteSaveRef.current = false
      return
    }
    if (!authSession || !backendUserId) {
      setState({ trips: [], selectedTripId: null })
      skipRemoteSaveRef.current = true
      return
    }
    const gen = ++remoteFetchGenRef.current
    skipRemoteSaveRef.current = true
    fetchMergedTripsState().then((s) => {
      if (gen !== remoteFetchGenRef.current) return
      setState(s)
      requestAnimationFrame(() => {
        skipRemoteSaveRef.current = false
      })
    })
  }, [authReady, backendUserId])

  useEffect(() => {
    if (!isSupabaseConfigured() || isDevAuthBypass()) return
    const tok = shareTokenFromUrlRef.current
    if (!tok || shareUrlHandledRef.current) return
    if (!authReady || !authSession) return
    shareUrlHandledRef.current = true
    const gen = remoteFetchGenRef.current
    skipRemoteSaveRef.current = true
    void acceptSharedItinerary(tok).then(async (r) => {
      if (!r.ok) {
        setShareInviteBanner(r.error)
        shareUrlHandledRef.current = false
        skipRemoteSaveRef.current = false
        return
      }
      const merged = await fetchMergedTripsState()
      if (gen !== remoteFetchGenRef.current) {
        skipRemoteSaveRef.current = false
        return
      }
      setState({ ...merged, selectedTripId: r.sourceTripId })
      setView('dashboard')
      shareTokenFromUrlRef.current = null
      setShareInviteBanner(null)
      const params = new URLSearchParams(window.location.search.startsWith('?') ? window.location.search.slice(1) : window.location.search)
      params.delete('share')
      const qs = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
      requestAnimationFrame(() => {
        skipRemoteSaveRef.current = false
      })
    })
  }, [authReady, authSession])

  useEffect(() => {
    if (!authSession?.email) return
    if (!isSupabaseConfigured() || isDevAuthBypass()) {
      saveTripsState(state, authSession.email)
      return
    }
    if (skipRemoteSaveRef.current) return
    const t = window.setTimeout(() => {
      void (async () => {
        const personal = tripsStateForPersonalSave(state)
        const pr = await upsertUserTrips(personal)
        if (!pr.ok) console.warn('user_trips save:', pr.error)
        for (const trip of state.trips) {
          const sh = trip.sharing
          if (!sh || (sh.role !== 'owner' && sh.role !== 'editor')) continue
          const ur = await upsertSharedItineraryTrip(sh.sharedItineraryId, trip)
          if (!ur.ok) console.warn('shared itinerary save:', ur.error)
        }
      })()
    }, 700)
    return () => window.clearTimeout(t)
  }, [state, authSession?.email])

  const localHasTripsForImport = useMemo(() => {
    if (!authSession) return false
    try {
      const raw = localStorage.getItem(tripsStorageKey(authSession.email))
      if (!raw) return false
      const p = JSON.parse(raw) as { trips?: unknown[] }
      return Array.isArray(p.trips) && p.trips.length > 0
    } catch {
      return false
    }
  }, [authSession?.email, state.trips.length])

  const showLocalImportBanner =
    isSupabaseConfigured() &&
    !isDevAuthBypass() &&
    authReady &&
    Boolean(authSession) &&
    !localImportDismissed &&
    state.trips.length === 0 &&
    localHasTripsForImport
  useEffect(() => {
    if (!authReady) return
    if (!authSession && view === 'dashboard') {
      setView('home')
    }
  }, [authReady, authSession, view])

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const pending = tripPendingFromUrlRef.current
    if (!pending) return
    if (view !== 'dashboard') return
    if (!authReady || !authSession) return
    const hasTrip = state.trips.some((t) => t.id === pending)
    if (hasTrip) {
      setState((prev) => ({ ...prev, selectedTripId: pending }))
      tripPendingFromUrlRef.current = null
    } else if (state.trips.length > 0) {
      tripPendingFromUrlRef.current = null
    }
  }, [view, authReady, authSession, state.trips])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const path = window.location.pathname
    const hash = window.location.hash || ''
    if (view === 'home') {
      const target = path + hash
      const current = path + window.location.search + hash
      if (target !== current) window.history.replaceState(null, '', target)
      return
    }
    const p = new URLSearchParams()
    p.set('v', 'dashboard')
    p.set('t', activeTab)
    if (state.selectedTripId) p.set('trip', state.selectedTripId)
    const search = `?${p.toString()}`
    const target = path + search + hash
    const current = path + window.location.search + hash
    if (target !== current) window.history.replaceState(null, '', target)
  }, [view, activeTab, state.selectedTripId])

  useEffect(() => {
    if (view === 'home') {
      document.title = formatDocumentTitle('Home')
    } else {
      document.title = formatDocumentTitle(DASHBOARD_TAB_LABELS[activeTab])
    }
  }, [view, activeTab])
  useEffect(() => {
    localStorage.setItem(THEME_KEY, isDarkMode ? 'dark' : 'light')
  }, [isDarkMode])
  useEffect(() => {
    const id = window.setInterval(() => setItineraryClock(Date.now()), 30000)
    return () => window.clearInterval(id)
  }, [])

  const selectedTrip = useMemo(() => {
    if (!state.selectedTripId) return null
    return state.trips.find((t) => t.id === state.selectedTripId) ?? null
  }, [state.selectedTripId, state.trips])

  const tripIsReadOnly = useMemo(() => isTripReadOnly(selectedTrip), [selectedTrip])

  useEffect(() => {
    if (!calendarActivityDetail) {
      setCalendarDetailDraft(null)
      setCalendarActivityDetailEditing(false)
      return
    }
    setCalendarActivityDetailEditing(false)
    const a = resolveActivityForCalendarModal(calendarActivityDetail, selectedTrip)
    const endT = (a.endTime ?? '').trim() || formatMinutesToTime(effectiveActivityEndMinutes(a, a.date))
    setCalendarDetailDraft({ ...a, endTime: endT })
  }, [calendarActivityDetail, selectedTrip])

  useEffect(() => {
    if (!isSupabaseConfigured() || isDevAuthBypass()) return
    if (!authSession || !backendUserId) return
    const sid = selectedTrip?.sharing?.sharedItineraryId
    if (!sid) return
    const pb = getPocketBase()
    let unsub: (() => void) | undefined
    void pb
      .collection('shared_itineraries')
      .subscribe(sid, (e) => {
        const row = e.record as { trip_json?: unknown }
        if (row?.trip_json == null) return
        const parsed = parseSingleTripFromUnknown(row.trip_json)
        if (!parsed) return
        setState((prev) => ({
          ...prev,
          trips: prev.trips.map((t) =>
            t.sharing?.sharedItineraryId === sid ? { ...parsed, sharing: t.sharing } : t,
          ),
        }))
      })
      .then((u) => {
        unsub = u
      })
      .catch(() => {})
    return () => {
      try {
        unsub?.()
        void pb.collection('shared_itineraries').unsubscribe(sid)
      } catch {
        // ignore
      }
    }
  }, [authSession, backendUserId, selectedTrip?.sharing?.sharedItineraryId])

  const mustDos = selectedTrip?.mustDos ?? []
  const packList = selectedTrip?.packList ?? []
  const visitPlaces = selectedTrip?.visitPlaces ?? []
  const stays = useMemo(() => [...(selectedTrip?.stays ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)), [selectedTrip?.stays])
  const bookings = selectedTrip?.bookings ?? EMPTY_TRIP_BOOKINGS
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
  const plannerActivitiesForBookingsTab = useMemo(() => {
    const rows: { stayId: string; stayLocation: string; activity: StayActivity }[] = []
    for (const s of stays) {
      for (const a of s.activities ?? []) {
        rows.push({ stayId: s.id, stayLocation: s.location, activity: a })
      }
    }
    return rows.sort(
      (x, y) =>
        x.activity.date.localeCompare(y.activity.date) || (x.activity.time || '').localeCompare(y.activity.time || ''),
    )
  }, [stays])
  const bookingManagementRows = useMemo(() => {
    const rows: BookingManagementRow[] = []
    const tsFromIso = (iso?: string, fallback = 0) => parseIsoDate(iso)?.getTime() ?? fallback
    const dayStartTs = (iso?: string, fallback = 0) => parseIsoDate(iso)?.getTime() ?? fallback
    const dayEndTs = (iso?: string, fallback = 0) => {
      const d = parseIsoDate(iso)
      if (!d) return fallback
      d.setHours(23, 59, 59, 999)
      return d.getTime()
    }
    const pointTs = (iso?: string, time?: string, fallback = 0) => {
      const d = parseIsoDate(iso)
      if (!d) return fallback
      const mins = parseTimeToMinutes(time ?? '')
      if (mins !== null) d.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
      return d.getTime()
    }
    const endExclusiveTs = (iso?: string, fallback = 0) => {
      const d = parseIsoDate(iso)
      if (!d) return fallback
      return d.getTime() - 1
    }

    for (const b of bookings.rentalCars) {
      if (!b.confirmation.trim()) continue
      const pickupT = (b.pickupTime ?? '').trim()
      const dropoffT = (b.dropoffTime ?? '').trim()
      const endDate = b.dropoffDate || b.pickupDate
      const overlapStartTs = b.pickupDate ? pointTs(b.pickupDate, pickupT, b.createdAt) : b.createdAt
      const overlapEndTs = endDate
        ? dropoffT
          ? pointTs(endDate, dropoffT, b.createdAt)
          : dayEndTs(endDate, b.createdAt)
        : overlapStartTs
      const pickupLabel = b.pickupDate
        ? `${formatSingleDateLabel(b.pickupDate)}${pickupT ? ` · ${pickupT}` : ''}`
        : 'No pickup date'
      const dropoffLabel = endDate ? `${formatSingleDateLabel(endDate)}${dropoffT ? ` · ${dropoffT}` : ''}` : ''
      rows.push({
        id: `rental-${b.id}`,
        kind: 'rentalCar',
        kindLabel: 'Rental car',
        filterKind: 'rentalCar',
        sortTs: b.pickupDate ? pointTs(b.pickupDate, pickupT, b.createdAt) : b.createdAt,
        overlapStartTs,
        overlapEndTs,
        dateText: dropoffLabel ? `${pickupLabel} → ${dropoffLabel}` : pickupLabel,
        title: b.company,
        subtitle: `${b.pickupLocation || 'Pickup'} -> ${b.dropoffLocation || 'Dropoff'}`,
        meta: b.confirmation.trim() || undefined,
        priceAmount: (() => {
          const n = parseAmount(b.price)
          return n > 0 ? n : undefined
        })(),
        removable: true,
        removeId: b.id,
        removeTab: 'rentalCar',
      })
    }
    for (const b of bookings.flights) {
      if (!b.confirmation.trim()) continue
      const depT = (b.departTime ?? '').trim()
      const arrT = (b.arriveTime ?? '').trim()
      const arrDate = (b.arriveDate || b.departDate || '').trim()
      const overlapStartTs = b.departDate
        ? depT && parseTimeToMinutes(depT) !== null
          ? pointTs(b.departDate, depT, b.createdAt)
          : dayStartTs(b.departDate, b.createdAt)
        : b.createdAt
      const overlapEndTs = arrDate
        ? arrT && parseTimeToMinutes(arrT) !== null
          ? pointTs(arrDate, arrT, b.createdAt)
          : dayEndTs(arrDate, b.createdAt)
        : b.departDate
          ? dayEndTs(b.departDate, b.createdAt)
          : overlapStartTs
      const routeDisp = buildFlightRouteDisplay(b.fromIata, b.toIata, b.route)
      const depLabel = b.departDate
        ? `${formatSingleDateLabel(b.departDate)}${depT ? ` · ${depT}` : ''}`
        : 'No departure date'
      const arrLabel = arrDate ? `${formatSingleDateLabel(arrDate)}${arrT ? ` · ${arrT}` : ''}` : ''
      const scheduleLine = [b.airline?.trim(), [depLabel, arrLabel].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')
      rows.push({
        id: `flight-${b.id}`,
        kind: 'flight',
        kindLabel: 'Flight',
        filterKind: 'flight',
        sortTs: b.departDate && depT && parseTimeToMinutes(depT) !== null ? pointTs(b.departDate, depT, b.createdAt) : tsFromIso(b.departDate, b.createdAt),
        overlapStartTs,
        overlapEndTs,
        dateText: arrLabel ? `${depLabel} → ${arrLabel}` : depLabel,
        title: routeDisp,
        subtitle: scheduleLine || (b.confirmation ? `Confirmation: ${b.confirmation}` : 'Flight booking'),
        meta: b.confirmation.trim() || undefined,
        priceAmount: (() => {
          const n = parseAmount(b.price)
          return n > 0 ? n : undefined
        })(),
        flightBaggage: {
          checked: b.checkedBags ?? 0,
          carryOn: b.carryOnBags ?? 0,
          personal: b.personalItem ?? false,
        },
        removable: true,
        removeId: b.id,
        removeTab: 'flight',
      })
    }
    for (const b of bookings.restaurants) {
      if (!b.confirmation.trim()) continue
      const overlapStartTs = dayStartTs(b.reservationDate, b.createdAt)
      const overlapEndTs = dayEndTs(b.reservationDate, b.createdAt)
      rows.push({
        id: `restaurant-${b.id}`,
        kind: 'restaurant',
        kindLabel: 'Dining',
        filterKind: 'restaurant',
        sortTs: tsFromIso(b.reservationDate, b.createdAt),
        overlapStartTs,
        overlapEndTs,
        dateText: b.reservationDate ? formatSingleDateLabel(b.reservationDate) : 'No date',
        title: b.name,
        subtitle: b.notes || 'Dining booking',
        meta: b.confirmation.trim() || undefined,
        priceAmount: (() => {
          const n = parseAmount(b.cost)
          return n > 0 ? n : undefined
        })(),
        removable: true,
        removeId: b.id,
        removeTab: 'restaurant',
      })
    }
    for (const { stayId, stayLocation, activity: a } of plannerActivitiesForBookingsTab) {
      if (!a.confirmationRef.trim()) continue
      const overlapPointTs = pointTs(a.date, a.time, a.createdAt)
      rows.push({
        id: `activity-${stayId}-${a.id}`,
        kind: 'activity',
        kindLabel: 'Activity',
        filterKind: 'restaurant',
        sortTs: tsFromIso(a.date, a.createdAt),
        overlapStartTs: overlapPointTs,
        overlapEndTs: overlapPointTs,
        dateText: a.date ? formatSingleDateLabel(a.date) : 'No date',
        title: a.name,
        subtitle: stayLocation || 'Itinerary activity',
        meta:
          [a.time, a.confirmationRef ? `Conf. ${a.confirmationRef}` : ''].filter(Boolean).join(' · ') || undefined,
        priceAmount: (() => {
          const n = parseAmount(a.cost)
          return n > 0 ? n : undefined
        })(),
        removable: true,
        stayId,
        activityId: a.id,
      })
    }
    for (const s of stays) {
      if (!s.confirmationRef.trim()) continue
      const cinT = (s.checkInTime ?? '').trim()
      const coutT = (s.checkOutTime ?? '').trim()
      const hasCin = cinT.length > 0 && parseTimeToMinutes(cinT) !== null
      const hasCout = coutT.length > 0 && parseTimeToMinutes(coutT) !== null
      const overlapStartTs = s.startDate
        ? hasCin
          ? pointTs(s.startDate, cinT, s.createdAt)
          : dayStartTs(s.startDate, s.createdAt)
        : s.createdAt
      const overlapEndTs = s.endDate
        ? hasCout
          ? pointTs(s.endDate, coutT, s.createdAt)
          : endExclusiveTs(s.endDate, s.createdAt)
        : s.startDate
          ? hasCout
            ? pointTs(s.startDate, coutT, s.createdAt)
            : dayEndTs(s.startDate, s.createdAt)
          : overlapStartTs
      const rangeLabel = formatDateRangeLabel(s.startDate, s.endDate)
      const dateParts = [rangeLabel]
      if (hasCin) dateParts.push(`In ${normalizeHhMmTime(cinT)}`)
      if (hasCout) dateParts.push(`Out ${normalizeHhMmTime(coutT)}`)
      rows.push({
        id: `stay-${s.id}`,
        kind: 'accommodation',
        kindLabel: 'Accommodation',
        filterKind: 'accommodation',
        sortTs: s.startDate && hasCin ? pointTs(s.startDate, cinT, s.createdAt) : tsFromIso(s.startDate, s.createdAt),
        overlapStartTs,
        overlapEndTs,
        dateText: dateParts.join(' · '),
        title: s.location || 'Accommodation',
        subtitle: s.address || 'No address',
        meta: s.confirmationRef.trim() || undefined,
        priceAmount: (() => {
          const n = parseAmount(s.price)
          return n > 0 ? n : undefined
        })(),
        removable: true,
        stayId: s.id,
      })
    }

    return rows.sort((a, b) => a.sortTs - b.sortTs || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title))
  }, [bookings.flights, bookings.rentalCars, bookings.restaurants, plannerActivitiesForBookingsTab, stays])
  const visibleBookingRows = useMemo(
    () => bookingManagementRows.filter((r) => bookingFilter === 'all' || r.filterKind === bookingFilter),
    [bookingManagementRows, bookingFilter],
  )
  const bookingOverlapLinks = useMemo(() => {
    const links = new Map<string, string[]>()
    for (const row of visibleBookingRows) links.set(row.id, [])
    for (let i = 0; i < visibleBookingRows.length; i++) {
      const a = visibleBookingRows[i]
      for (let j = i + 1; j < visibleBookingRows.length; j++) {
        const b = visibleBookingRows[j]
        if (a.kind !== b.kind) continue
        if (a.overlapStartTs <= b.overlapEndTs && b.overlapStartTs <= a.overlapEndTs) {
          links.get(a.id)?.push(b.id)
          links.get(b.id)?.push(a.id)
        }
      }
    }
    return links
  }, [visibleBookingRows])
  const activeOverlapSourceId = pinnedOverlapSourceId
  const activeOverlapIds = useMemo(() => {
    if (!activeOverlapSourceId) return new Set<string>()
    const ids = new Set<string>([activeOverlapSourceId])
    for (const id of bookingOverlapLinks.get(activeOverlapSourceId) ?? []) ids.add(id)
    return ids
  }, [activeOverlapSourceId, bookingOverlapLinks])
  const bookingKindChipClass: Record<BookingRowKind, string> = {
    rentalCar: 'bg-indigo-100 text-indigo-700',
    flight: 'bg-sky-100 text-sky-700',
    restaurant: 'bg-amber-100 text-amber-700',
    activity: 'bg-violet-100 text-violet-700',
    accommodation: 'bg-emerald-100 text-emerald-700',
  }
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

  const tripBuckets = useMemo(() => {
    const todayIso = toIsoDate(new Date(itineraryClock))
    const active: Trip[] = []
    const past: Trip[] = []
    const cancelled: Trip[] = []
    for (const t of state.trips) {
      if (t.cancelled) {
        cancelled.push(t)
        continue
      }
      if (t.endDate && t.endDate < todayIso) past.push(t)
      else active.push(t)
    }
    active.sort((a, b) => sortKeyActiveAsc(a).localeCompare(sortKeyActiveAsc(b)))
    past.sort((a, b) => sortKeyPastDesc(b).localeCompare(sortKeyPastDesc(a)))
    cancelled.sort((a, b) => sortKeyCancelledDesc(b).localeCompare(sortKeyCancelledDesc(a)))
    return { active, past, cancelled }
  }, [state.trips, itineraryClock])
  const timelineDays = useMemo(() => {
    if (!selectedTrip?.startDate || !selectedTrip?.endDate) return []
    return enumerateStayDays(selectedTrip.startDate, selectedTrip.endDate)
  }, [selectedTrip?.endDate, selectedTrip?.startDate])
  const tripDayCount = timelineDays.length
  const budgetPerDay = useMemo(() => {
    if (tripDayCount <= 0) return null
    return {
      vehicle: budgetTotals.vehicle / tripDayCount,
      flights: budgetTotals.flights / tripDayCount,
      accommodation: budgetTotals.accommodation / tripDayCount,
      activities: budgetTotals.activities / tripDayCount,
      food: budgetTotals.food / tripDayCount,
      total: budgetTotals.total / tripDayCount,
    }
  }, [budgetTotals, tripDayCount])
  const activitiesByDay = useMemo(() => {
    const map = new Map<string, CalendarDayItem[]>()
    const pushDay = (dayIso: string, item: CalendarDayItem) => {
      if (!dayIso) return
      const list = map.get(dayIso) ?? []
      list.push(item)
      map.set(dayIso, list)
    }
    for (const s of stays) {
      for (const a of s.activities ?? []) {
        pushDay(a.date, { stayId: s.id, stayLocation: s.location, activity: a })
      }
    }
    for (const c of bookings.rentalCars) {
      const pickupT = (c.pickupTime ?? '').trim()
      if (c.pickupDate && parseTimeToMinutes(pickupT) !== null) {
        const time = normalizeHhMmTime(pickupT)
        pushDay(c.pickupDate, {
          stayId: CAL_BOOKING_STAY_ID,
          stayLocation: 'Rental car',
          bookingRef: { tab: 'rentalCar', id: c.id },
          activity: {
            id: `cal-rental-pick-${c.id}`,
            date: c.pickupDate,
            name: `Car pickup · ${c.company}`,
            time,
            confirmationRef: c.confirmation,
            cost: c.price,
            notes: c.pickupLocation || 'Pickup',
            createdAt: c.createdAt,
          },
        })
      }
      const dropT = (c.dropoffTime ?? '').trim()
      if (c.dropoffDate && parseTimeToMinutes(dropT) !== null) {
        const time = normalizeHhMmTime(dropT)
        pushDay(c.dropoffDate, {
          stayId: CAL_BOOKING_STAY_ID,
          stayLocation: 'Rental car',
          bookingRef: { tab: 'rentalCar', id: c.id },
          activity: {
            id: `cal-rental-drop-${c.id}`,
            date: c.dropoffDate,
            name: `Car dropoff · ${c.company}`,
            time,
            confirmationRef: c.confirmation,
            cost: c.price,
            notes: c.dropoffLocation || 'Dropoff',
            createdAt: c.createdAt,
          },
        })
      }
    }
    for (const f of bookings.flights) {
      if (!f.confirmation.trim() || !f.departDate) continue
      const routeDisp = buildFlightRouteDisplay(f.fromIata, f.toIata, f.route).trim()
      const airline = (f.airline ?? '').trim()
      const titleBase = routeDisp || 'Flight'
      const title = airline ? `${titleBase} · ${airline}` : titleBase

      const depRaw = (f.departTime ?? '').trim()
      const arrRaw = (f.arriveTime ?? '').trim()
      const depM = parseTimeToMinutes(normalizeHhMmTime(depRaw))
      const arrM = parseTimeToMinutes(normalizeHhMmTime(arrRaw))
      const depTimeNorm = depM !== null ? normalizeHhMmTime(depRaw) : ''
      const arrTimeNorm = arrM !== null ? normalizeHhMmTime(arrRaw) : ''

      const arrDate = (f.arriveDate || f.departDate).trim()
      const sameDay = arrDate === f.departDate

      const fromPl = [f.fromLabel?.trim(), f.fromIata?.trim().toUpperCase()].filter(Boolean).join(' · ')
      const toPl = [f.toLabel?.trim(), f.toIata?.trim().toUpperCase()].filter(Boolean).join(' · ')

      if (sameDay) {
        let calLabel = ''
        if (depTimeNorm && arrTimeNorm) calLabel = `${depTimeNorm} – ${arrTimeNorm}`
        else if (depTimeNorm) calLabel = depTimeNorm
        else if (arrTimeNorm) calLabel = arrTimeNorm
        const positionTime = depTimeNorm || arrTimeNorm
        pushDay(f.departDate, {
          stayId: CAL_BOOKING_STAY_ID,
          stayLocation: 'Flight',
          bookingRef: { tab: 'flight', id: f.id },
          activity: {
            id: `cal-flight-${f.id}`,
            date: f.departDate,
            name: title,
            time: positionTime,
            calendarTimeLabel: calLabel || undefined,
            confirmationRef: f.confirmation,
            cost: f.price,
            notes: '',
            placeLabel: fromPl || undefined,
            createdAt: f.createdAt,
          },
        })
      } else {
        pushDay(f.departDate, {
          stayId: CAL_BOOKING_STAY_ID,
          stayLocation: 'Flight',
          bookingRef: { tab: 'flight', id: f.id },
          activity: {
            id: `cal-flight-dep-${f.id}`,
            date: f.departDate,
            name: title,
            time: depTimeNorm,
            calendarTimeLabel: depTimeNorm ? `Dep ${depTimeNorm}` : undefined,
            confirmationRef: f.confirmation,
            cost: f.price,
            notes: '',
            placeLabel: fromPl || undefined,
            createdAt: f.createdAt,
          },
        })
        pushDay(arrDate, {
          stayId: CAL_BOOKING_STAY_ID,
          stayLocation: 'Flight',
          bookingRef: { tab: 'flight', id: f.id },
          activity: {
            id: `cal-flight-arr-${f.id}`,
            date: arrDate,
            name: `Arrive · ${titleBase}`,
            time: arrTimeNorm,
            calendarTimeLabel: arrTimeNorm ? `Arr ${arrTimeNorm}` : undefined,
            confirmationRef: f.confirmation,
            cost: f.price,
            notes: '',
            placeLabel: toPl || undefined,
            createdAt: f.createdAt,
          },
        })
      }
    }
    for (const [k, list] of map) {
      list.sort((x, y) => {
        const xm = parseTimeToMinutes(x.activity.time)
        const ym = parseTimeToMinutes(y.activity.time)
        if (xm !== null && ym !== null) return xm - ym
        if (xm !== null) return -1
        if (ym !== null) return 1
        return (x.activity.time || '').localeCompare(y.activity.time || '')
      })
      map.set(k, list)
    }
    return map
  }, [stays, bookings.rentalCars, bookings.flights])
  const staysByDay = useMemo(() => {
    const map = new Map<string, Stay[]>()
    for (const day of timelineDays) {
      map.set(day, stays.filter((s) => s.startDate <= day && day < s.endDate))
    }
    return map
  }, [stays, timelineDays])


  const visibleCalendarDays = useMemo(
    () => timelineDays.slice(calendarWeekStartIndex, calendarWeekStartIndex + 7),
    [timelineDays, calendarWeekStartIndex],
  )
  const calendarMaxStart = Math.max(0, timelineDays.length - 7)
  const canPrevCalendar = calendarWeekStartIndex > 0
  const canNextCalendar = calendarWeekStartIndex < calendarMaxStart
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
  const recommendedPlaces = useCachedRecommendations(
    selectedTrip?.id,
    recommendationSeeds,
    selectedTrip?.country ?? '',
  )
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
  const selectedDayActivities = useMemo(
    () => activitiesByDay.get(selectedTimelineDate) ?? EMPTY_CALENDAR_DAY_ITEMS,
    [activitiesByDay, selectedTimelineDate],
  )
  const dayRecommendationRadius = useMemo(() => {
    const base = recommendedPlaces.recommendations
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
  }, [dismissedRecommendationKeys, plannedActivityNames, selectedDayAnchorCoords, selectedDayRadiusPartial, recommendedPlaces.recommendations])
  const visibleSelectedDayRecommendations = dayRecommendationRadius.selected
  const activityPlaceSearch = usePlaceSuggestions(activityPlaceSearchInput)
  const homeSearch = useDestinationSuggestions(newTripDestination)
  const mapPoints = useMemo(
    () =>
      buildMapPointsFromTrip(
        stays,
        visitPlaces,
        bookings.flights,
        bookings.rentalCars,
        bookings.restaurants,
        selectedTrip?.country ?? '',
      ),
    [stays, visitPlaces, bookings.flights, bookings.rentalCars, bookings.restaurants, selectedTrip?.country],
  )
  const mapCameraFingerprint = useMemo(() => {
    const pts = mapPoints.map((p) => `${p.key}|${p.lat ?? ''}|${p.lon ?? ''}`).join(';')
    const coords = Object.keys(resolvedPointCoords)
      .sort()
      .map((k) => {
        const c = resolvedPointCoords[k]
        return `${k}:${c.lat}:${c.lon}`
      })
      .join('|')
    return `${selectedTrip?.id ?? ''}|${selectedTrip?.endDate ?? ''}|${pts}|${coords}`
  }, [selectedTrip?.id, selectedTrip?.endDate, mapPoints, resolvedPointCoords])
  const todayIso = useMemo(() => toIsoDate(new Date(itineraryClock)), [itineraryClock])
  const nowMinutes = useMemo(() => {
    const d = new Date(itineraryClock)
    return d.getHours() * 60 + d.getMinutes()
  }, [itineraryClock])
  const activeSoonItem = useMemo((): CalendarDayItem | null => {
    if (!selectedTimelineDate || selectedTimelineDate !== todayIso) return null
    /** Next event must start within this many minutes (inclusive of its start minute). */
    const soonEnd = nowMinutes + 30
    const items = activitiesByDay.get(selectedTimelineDate) ?? []
    const candidates = items
      .filter(({ activity: a }) => {
        const m = parseTimeToMinutes(a.time)
        if (m === null) return false
        return m >= nowMinutes && m <= soonEnd
      })
      .sort((x, y) => (parseTimeToMinutes(x.activity.time) ?? 0) - (parseTimeToMinutes(y.activity.time) ?? 0))
    return candidates[0] ?? null
  }, [selectedTimelineDate, todayIso, nowMinutes, activitiesByDay])
  const activeSoonActivity = activeSoonItem?.activity ?? null
  const activeSoonDirectionsDestination = useMemo(
    () => directionsDestinationForScheduleItem(activeSoonItem ?? undefined),
    [activeSoonItem],
  )
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
  const sideQuestCountdown = useMemo(() => {
    const now = new Date(itineraryClock)
    const start = parseIsoDate(selectedTrip?.startDate)
    const end = parseIsoDate(selectedTrip?.endDate)
    if (!start || !end) {
      return { title: 'Countdown unavailable', subtitle: 'Set trip start and end dates to show countdown.' }
    }
    const endExclusive = new Date(end)
    endExclusive.setDate(endExclusive.getDate() + 1)
    if (now < start) {
      return {
        title: 'Trip starts in',
        subtitle: formatCountdownDuration(now, start),
      }
    }
    if (now < endExclusive) {
      return {
        title: 'Trip ends in',
        subtitle: formatCountdownDuration(now, endExclusive),
      }
    }
    return {
      title: 'Trip ended',
      subtitle: formatSingleDateLabel(selectedTrip?.endDate || ''),
    }
  }, [itineraryClock, selectedTrip?.startDate, selectedTrip?.endDate])
  useEffect(() => {
    setPlaceSuggestionIndex(-1)
  }, [placeSearchInput, showPlaceSuggestions])

  useEffect(() => {
    setHomeSuggestionIndex(-1)
  }, [newTripDestination, showHomeSuggestions])

  useEffect(() => {
    setBookingError(null)
    if (bookingsTab !== 'accommodation') {
      setStayError(null)
    }
  }, [bookingsTab])

  useEffect(() => {
    setState((prev) => {
      let changed = false
      const trips = prev.trips.map((trip) => {
        const filtered = trip.bookings.accommodations.filter((x) => x.confirmation.trim().length > 0)
        const filteredStays = trip.stays.filter((s) => s.confirmationRef.trim().length > 0)
        if (filtered.length === trip.bookings.accommodations.length && filteredStays.length === trip.stays.length) return trip
        changed = true
        return { ...trip, stays: filteredStays, bookings: { ...trip.bookings, accommodations: filtered } }
      })
      return changed ? { ...prev, trips } : prev
    })
  }, [])

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
    setCalendarWeekStartIndex(0)
    setCalendarDropError(null)
  }, [selectedTrip?.id])

  useEffect(() => {
    const maxStart = Math.max(0, timelineDays.length - 7)
    setCalendarWeekStartIndex((i) => Math.min(i, maxStart))
  }, [timelineDays.length])

  useEffect(() => {
    setActivityDrafts({})
  }, [selectedTrip?.id])

  useEffect(() => {
    const stay = selectedDayPrimaryStay
    if (!selectedTimelineDate || (!stay && selectedDayActivities.length === 0)) {
      setSelectedDayAnchorCoords([])
      setSelectedDayRadiusPartial(false)
      return
    }
    const coords: Array<{ lat: number; lon: number }> = []
    let unresolved = 0
    if (typeof stay?.lat === 'number' && typeof stay?.lon === 'number') {
      coords.push({ lat: stay.lat, lon: stay.lon })
    }
    for (const a of selectedDayActivities.slice(0, 5)) {
      if (typeof a.activity.lat === 'number' && typeof a.activity.lon === 'number') {
        coords.push({ lat: a.activity.lat, lon: a.activity.lon })
      } else {
        unresolved += 1
      }
    }
    const dedup = Array.from(new Map(coords.map((c) => [`${c.lat.toFixed(5)}:${c.lon.toFixed(5)}`, c])).values())
    setSelectedDayAnchorCoords(dedup)
    setSelectedDayRadiusPartial(unresolved > 0 || dedup.length === 0)
  }, [selectedDayActivities, selectedDayPrimaryStay, selectedTimelineDate])


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
    if (activeTab !== 'map' || !selectedTrip) return
    if (!isSupabaseConfigured()) return
    const unresolved = mapPoints.filter(
      (p) => !(typeof p.lat === 'number' && typeof p.lon === 'number') && !resolvedPointCoords[p.key],
    )
    if (unresolved.length === 0) return
    let cancelled = false
    const resolveMissing = async () => {
      const updates: Record<string, { lat: number; lon: number }> = {}
      for (const p of unresolved) {
        const query = [p.label, p.addressHint, selectedTrip.country].filter(Boolean).join(', ')
        try {
          const hit = await geocodeQuery(query)
          if (hit) updates[p.key] = { lat: hit.lat, lon: hit.lon }
        } catch {
          // ignore individual failures
        }
      }
      if (cancelled || Object.keys(updates).length === 0) return
      setResolvedPointCoords((prev) => ({ ...prev, ...updates }))
    }
    void resolveMissing()
    return () => {
      cancelled = true
    }
  }, [activeTab, mapPoints, resolvedPointCoords, selectedTrip])


  const createTrip = (country: string, startDate = '', endDate = '') => {
    const c = country.trim()
    if (!c) return
    const trip: Trip = {
      id: uid(),
      country: c,
      startDate,
      endDate,
      cancelled: false,
      createdAt: Date.now(),
      mustDos: [],
      packList: [],
      visitPlaces: [],
      stays: [],
      bookings: { rentalCars: [], flights: [], restaurants: [], accommodations: [] },
    }
    setState((prev) => ({ trips: [trip, ...prev.trips], selectedTripId: trip.id }))
  }

  const addPackListItem = () => {
    if (!state.selectedTripId) return
    if (tripIsReadOnly) return
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
    if (tripIsReadOnly) return
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
    if (tripIsReadOnly) return
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
    const m = text.match(/\b([A-Za-z]{3})\s*(?:->|to|-|—|–)\s*([A-Za-z]{3})\b/i)
    const parsed = m ? { from: m[1].toUpperCase(), to: m[2].toUpperCase() } : parseLegacyFlightRoute(text)
    const confMatch = text.match(/(?:confirmation|booking|pnr)\s*[:#]?\s*([A-Z0-9-]{5,})/i)
    const priceMatch = text.match(/([$€£]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:usd|eur|gbp))/i)
    if (parsed.from && !flightFromIata) {
      setFlightFromIata(parsed.from)
      const a = getAirportByIata(parsed.from)
      setFlightFromLabel(a ? formatAirportOptionLabel(a) : parsed.from)
    }
    if (parsed.to && !flightToIata) {
      setFlightToIata(parsed.to)
      const a = getAirportByIata(parsed.to)
      setFlightToLabel(a ? formatAirportOptionLabel(a) : parsed.to)
    }
    if (confMatch && !flightConfirmationInput) setFlightConfirmationInput(confMatch[1])
    if (priceMatch && !flightPriceInput) setFlightPriceInput(priceMatch[1])
  }

  const addBooking = () => {
    if (!state.selectedTripId) return false
    if (tripIsReadOnly) return false
    setBookingError(null)
    if (bookingsTab === 'rentalCar') {
      const company = carCompanyInput.trim()
      const confirmation = carConfirmationInput.trim()
      if (!company) {
        setBookingError('Car company is required.')
        return false
      }
      if (!confirmation) {
        setBookingError('Booking confirmation number is required.')
        return false
      }
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
                      pickupTime: carPickupTimeInput.trim(),
                      dropoffDate: carDropoffInput,
                      dropoffTime: carDropoffTimeInput.trim(),
                      confirmation,
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
      setCarPickupTimeInput('')
      setCarDropoffInput('')
      setCarDropoffTimeInput('')
      setCarConfirmationInput('')
      setCarPriceInput('')
      return true
    }
    if (bookingsTab === 'flight') {
      const from = flightFromIata.trim().toUpperCase()
      const to = flightToIata.trim().toUpperCase()
      const confirmation = flightConfirmationInput.trim()
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
        setBookingError('Select departure and arrival airports (search and pick a row to set IATA codes).')
        return false
      }
      if (!confirmation) {
        setBookingError('Booking confirmation number is required.')
        return false
      }
      const route = buildFlightRouteDisplay(from, to, '')
      const departTime = normalizeHhMmTime(flightDepartTimeInput)
      const arriveTime = normalizeHhMmTime(flightArriveTimeInput)
      const arriveDate = flightArriveDateInput.trim() || flightDepartInput
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
                      fromIata: from,
                      toIata: to,
                      fromLabel: flightFromLabel.trim(),
                      toLabel: flightToLabel.trim(),
                      airline: flightAirlineInput.trim(),
                      departDate: flightDepartInput,
                      departTime,
                      arriveDate,
                      arriveTime,
                      returnDate: '',
                      checkedBags: Math.min(9, Math.max(0, flightCheckedBags)),
                      carryOnBags: Math.min(9, Math.max(0, flightCarryOnBags)),
                      personalItem: flightPersonalItem,
                      confirmation,
                      price: flightPriceInput.trim(),
                      createdAt: Date.now(),
                    },
                  ],
                },
              }
            : t,
        ),
      }))
      setFlightFromIata('')
      setFlightFromLabel('')
      setFlightToIata('')
      setFlightToLabel('')
      setFlightAirlineInput('')
      setFlightDepartInput('')
      setFlightDepartTimeInput('')
      setFlightArriveDateInput('')
      setFlightArriveTimeInput('')
      setFlightCheckedBags(1)
      setFlightCarryOnBags(1)
      setFlightPersonalItem(true)
      setFlightConfirmationInput('')
      setFlightPriceInput('')
      setFlightQuickInput('')
      return true
    }
    if (bookingsTab === 'restaurant') {
      const name = restaurantNameInput.trim()
      const confirmation = restaurantConfirmationInput.trim()
      if (!name) {
        setBookingError('Restaurant name is required.')
        return false
      }
      if (!confirmation) {
        setBookingError('Booking confirmation number is required.')
        return false
      }
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
                      confirmation,
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
      return true
    }
    setBookingError('Accommodation details are managed in the Trip stays card.')
    return false
  }

  const removeBooking = (tab: BookingTab, id: string) => {
    if (!state.selectedTripId) return
    if (tripIsReadOnly) return
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
    if (tripIsReadOnly) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) => {
        if (t.id !== prev.selectedTripId) return t
        if (tab === 'rentalCar') return { ...t, bookings: { ...t.bookings, rentalCars: t.bookings.rentalCars.map((x) => (x.id === id ? updater(x) : x)) } }
        if (tab === 'flight') return { ...t, bookings: { ...t.bookings, flights: t.bookings.flights.map((x) => (x.id === id ? updater(x) : x)) } }
        if (tab === 'restaurant') return { ...t, bookings: { ...t.bookings, restaurants: t.bookings.restaurants.map((x) => (x.id === id ? updater(x) : x)) } }
        return t
      }),
    }))
  }

  const openEditBookingForm = (tab: BookingTab, id: string) => {
    if (tripIsReadOnly) return
    if (tab === 'rentalCar') {
      const b = bookings.rentalCars.find((x) => x.id === id)
      if (!b) return
      setCarCompanyInput(b.company)
      setCarPickupLocationInput(b.pickupLocation)
      setCarDropoffLocationInput(b.dropoffLocation)
      setCarPickupInput(b.pickupDate)
      setCarPickupTimeInput(b.pickupTime ?? '')
      setCarDropoffInput(b.dropoffDate)
      setCarDropoffTimeInput(b.dropoffTime ?? '')
      setCarConfirmationInput(b.confirmation)
      setCarPriceInput(b.price)
    } else if (tab === 'flight') {
      const b = bookings.flights.find((x) => x.id === id)
      if (!b) return
      let fi = b.fromIata
      let fl = b.fromLabel
      let ti = b.toIata
      let tl = b.toLabel
      if (!fi || !ti) {
        const p = parseLegacyFlightRoute(b.route)
        if (p.from && !fi) {
          fi = p.from
          const a = getAirportByIata(p.from)
          fl = a ? formatAirportOptionLabel(a) : p.from
        }
        if (p.to && !ti) {
          ti = p.to
          const a = getAirportByIata(p.to)
          tl = a ? formatAirportOptionLabel(a) : p.to
        }
      }
      setFlightFromIata(fi)
      setFlightFromLabel(fl)
      setFlightToIata(ti)
      setFlightToLabel(tl)
      setFlightAirlineInput(b.airline ?? '')
      setFlightDepartInput(b.departDate)
      setFlightDepartTimeInput(b.departTime ?? '')
      setFlightArriveDateInput(b.arriveDate ?? '')
      setFlightArriveTimeInput(b.arriveTime ?? '')
      setFlightCheckedBags(b.checkedBags ?? 0)
      setFlightCarryOnBags(b.carryOnBags ?? 0)
      setFlightPersonalItem(b.personalItem ?? false)
      setFlightConfirmationInput(b.confirmation)
      setFlightPriceInput(b.price)
      setFlightQuickInput('')
    } else if (tab === 'restaurant') {
      const b = bookings.restaurants.find((x) => x.id === id)
      if (!b) return
      setRestaurantNameInput(b.name)
      setRestaurantDateInput(b.reservationDate)
      setRestaurantConfirmationInput(b.confirmation)
      setRestaurantCostInput(b.cost)
      setRestaurantNotesInput(b.notes)
    }
    setBookingError(null)
    setEditingBookingForm({ tab, id })
    setEditingStayId(null)
    setIsBookingFormOpen(true)
  }

  const openEditStayForm = (stayId: string) => {
    if (tripIsReadOnly) return
    const s = stays.find((x) => x.id === stayId)
    if (!s) return
    setStayLocationInput(s.location)
    setStayAddressInput(s.address)
    setStayStartDate(s.startDate)
    setStayEndDate(s.endDate)
    setStayCheckInTimeInput(s.checkInTime ?? '')
    setStayCheckOutTimeInput(s.checkOutTime ?? '')
    setStayPriceInput(s.price)
    setStayBookingUrlInput(s.bookingUrl)
    setStayConfirmationRefInput(s.confirmationRef)
    setStayError(null)
    setBookingError(null)
    setBookingsTab('accommodation')
    setEditingBookingForm(null)
    setEditingStayId(stayId)
    setIsBookingFormOpen(true)
  }

  const resetBookingFormInputs = () => {
    setCarCompanyInput('')
    setCarPickupLocationInput('')
    setCarDropoffLocationInput('')
    setCarPickupInput('')
    setCarPickupTimeInput('')
    setCarDropoffInput('')
    setCarDropoffTimeInput('')
    setCarConfirmationInput('')
    setCarPriceInput('')
    setFlightFromIata('')
    setFlightFromLabel('')
    setFlightToIata('')
    setFlightToLabel('')
    setFlightAirlineInput('')
    setFlightDepartInput('')
    setFlightDepartTimeInput('')
    setFlightArriveDateInput('')
    setFlightArriveTimeInput('')
    setFlightCheckedBags(1)
    setFlightCarryOnBags(1)
    setFlightPersonalItem(true)
    setFlightConfirmationInput('')
    setFlightPriceInput('')
    setFlightQuickInput('')
    setRestaurantNameInput('')
    setRestaurantDateInput('')
    setRestaurantConfirmationInput('')
    setRestaurantCostInput('')
    setRestaurantNotesInput('')
    setStayLocationInput('')
    setStayAddressInput('')
    setStayStartDate('')
    setStayEndDate('')
    setStayCheckInTimeInput('')
    setStayCheckOutTimeInput('')
    setStayPriceInput('')
    setStayBookingUrlInput('')
    setStayConfirmationRefInput('')
    setBookingError(null)
    setStayError(null)
  }

  const saveBookingFormEdit = () => {
    if (!editingBookingForm) return false
    if (tripIsReadOnly) return false
    setBookingError(null)
    if (editingBookingForm.tab === 'rentalCar') {
      const company = carCompanyInput.trim()
      if (!company) {
        setBookingError('Car company is required.')
        return false
      }
      updateBooking('rentalCar', editingBookingForm.id, (x: CarBooking) => ({
        ...x,
        company,
        pickupLocation: carPickupLocationInput.trim(),
        dropoffLocation: carDropoffLocationInput.trim(),
        pickupDate: carPickupInput,
        pickupTime: carPickupTimeInput.trim(),
        dropoffDate: carDropoffInput,
        dropoffTime: carDropoffTimeInput.trim(),
        confirmation: carConfirmationInput.trim(),
        price: carPriceInput.trim(),
      }))
      return true
    }
    if (editingBookingForm.tab === 'flight') {
      const from = flightFromIata.trim().toUpperCase()
      const to = flightToIata.trim().toUpperCase()
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
        setBookingError('Select departure and arrival airports (search and pick a row to set IATA codes).')
        return false
      }
      const route = buildFlightRouteDisplay(from, to, '')
      const departTime = normalizeHhMmTime(flightDepartTimeInput)
      const arriveTime = normalizeHhMmTime(flightArriveTimeInput)
      const arriveDate = flightArriveDateInput.trim() || flightDepartInput
      updateBooking('flight', editingBookingForm.id, (x: FlightBooking) => ({
        ...x,
        route,
        fromIata: from,
        toIata: to,
        fromLabel: flightFromLabel.trim(),
        toLabel: flightToLabel.trim(),
        airline: flightAirlineInput.trim(),
        departDate: flightDepartInput,
        departTime,
        arriveDate,
        arriveTime,
        returnDate: '',
        checkedBags: Math.min(9, Math.max(0, flightCheckedBags)),
        carryOnBags: Math.min(9, Math.max(0, flightCarryOnBags)),
        personalItem: flightPersonalItem,
        confirmation: flightConfirmationInput.trim(),
        price: flightPriceInput.trim(),
      }))
      return true
    }
    if (editingBookingForm.tab === 'restaurant') {
      const name = restaurantNameInput.trim()
      if (!name) {
        setBookingError('Restaurant name is required.')
        return false
      }
      updateBooking('restaurant', editingBookingForm.id, (x: RestaurantBooking) => ({
        ...x,
        name,
        reservationDate: restaurantDateInput,
        confirmation: restaurantConfirmationInput.trim(),
        cost: restaurantCostInput.trim(),
        notes: restaurantNotesInput.trim(),
      }))
      return true
    }
    return false
  }

  const saveStayFormEdit = () => {
    if (!editingStayId || !state.selectedTripId || !selectedTrip) return false
    if (tripIsReadOnly) return false
    const location = stayLocationInput.trim()
    const confirmationRef = stayConfirmationRefInput.trim()
    if (!location || !stayStartDate || !stayEndDate) {
      setStayError('Please enter location, check-in, and check-out dates.')
      return false
    }
    if (!confirmationRef) {
      setStayError('Booking confirmation number is required.')
      return false
    }
    if (stayEndDate < stayStartDate) {
      setStayError('Check-out date cannot be before check-in.')
      return false
    }
    if (selectedTrip.startDate && stayStartDate < selectedTrip.startDate) {
      setStayError(`Stay starts before trip starts (${selectedTrip.startDate}).`)
      return false
    }
    if (selectedTrip.endDate && stayEndDate > selectedTrip.endDate) {
      setStayError(`Stay ends after trip ends (${selectedTrip.endDate}).`)
      return false
    }
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id !== prev.selectedTripId
          ? trip
          : {
              ...trip,
              stays: trip.stays.map((s) =>
                s.id !== editingStayId
                  ? s
                  : {
                      ...s,
                      location,
                      address: stayAddressInput.trim(),
                      startDate: stayStartDate,
                      endDate: stayEndDate,
                      checkInTime: stayCheckInTimeInput.trim(),
                      checkOutTime: stayCheckOutTimeInput.trim(),
                      price: stayPriceInput.trim(),
                      bookingUrl: stayBookingUrlInput.trim() ? normalizeBookingUrl(stayBookingUrlInput) : '',
                      confirmationRef,
                    },
              ),
            },
      ),
    }))
    return true
  }

  const removeStay = (stayId: string) => {
    if (!state.selectedTripId) return
    if (tripIsReadOnly) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id !== prev.selectedTripId ? trip : { ...trip, stays: trip.stays.filter((s) => s.id !== stayId) },
      ),
    }))
  }

  const addVisitPlace = (label: string, coords?: { lat: number; lon: number }) => {
    const t = label.trim()
    if (!t || !state.selectedTripId) return
    if (tripIsReadOnly) return
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
    if (tripIsReadOnly) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id === prev.selectedTripId ? { ...trip, visitPlaces: trip.visitPlaces.filter((p) => p.id !== placeId) } : trip,
      ),
    }))
  }

  const updateVisitPlaceCost = (placeId: string, cost: string) => {
    if (!state.selectedTripId) return
    if (tripIsReadOnly) return
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
                      confirmationRef: '',
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
    const storageStayId = resolveStayIdForActivityStorage(stays, selectedTimelineDate)
    if (!storageStayId) return
    const targetStay = stays.find((s) => s.id === storageStayId)
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
                      confirmationRef: '',
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

  const saveTripDates = () => {
    if (!selectedTrip || !state.selectedTripId) return
    if (tripIsReadOnly) return
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
    if (!state.selectedTripId || !selectedTrip) return false
    if (tripIsReadOnly) return false
    const location = stayLocationInput.trim()
    const confirmationRef = stayConfirmationRefInput.trim()
    if (!location || !stayStartDate || !stayEndDate) {
      setStayError('Please enter location, check-in, and check-out dates.')
      return false
    }
    if (!confirmationRef) {
      setStayError('Booking confirmation number is required.')
      return false
    }
    if (stayEndDate < stayStartDate) {
      setStayError('Check-out date cannot be before check-in.')
      return false
    }
    if (selectedTrip.startDate && stayStartDate < selectedTrip.startDate) {
      setStayError(`Stay starts before trip starts (${selectedTrip.startDate}).`)
      return false
    }
    if (selectedTrip.endDate && stayEndDate > selectedTrip.endDate) {
      setStayError(`Stay ends after trip ends (${selectedTrip.endDate}).`)
      return false
    }

    const stayId = uid()
    const address = stayAddressInput.trim()
    const country = selectedTrip.country
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) =>
        trip.id === prev.selectedTripId
          ? {
              ...trip,
              stays: [
                ...trip.stays,
                {
                  id: stayId,
                  location,
                  address,
                  startDate: stayStartDate,
                  endDate: stayEndDate,
                  checkInTime: stayCheckInTimeInput.trim(),
                  checkOutTime: stayCheckOutTimeInput.trim(),
                  price: stayPriceInput.trim(),
                  bookingUrl: stayBookingUrlInput.trim() ? normalizeBookingUrl(stayBookingUrlInput) : '',
                  confirmationRef,
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
    setStayCheckInTimeInput('')
    setStayCheckOutTimeInput('')
    setStayPriceInput('')
    setStayBookingUrlInput('')
    setStayConfirmationRefInput('')

    // Geocode once and persist (Nominatim via PocketBase cache) — never on every map open.
    if (isSupabaseConfigured() && !isDevAuthBypass()) {
      const q = [address || location, country].filter(Boolean).join(', ')
      void geocodeQuery(q).then((hit) => {
        if (!hit) return
        setState((prev) => ({
          ...prev,
          trips: prev.trips.map((trip) =>
            trip.id !== prev.selectedTripId
              ? trip
              : {
                  ...trip,
                  stays: trip.stays.map((s) =>
                    s.id === stayId ? { ...s, lat: hit.lat, lon: hit.lon } : s,
                  ),
                },
          ),
        }))
      })
    }
    return true
  }

  const addStayActivity = (stayId: string, date: string) => {
    if (!state.selectedTripId) return
    if (tripIsReadOnly) return
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
                      confirmationRef: (draft?.confirmationRef ?? '').trim() || (stays.find((x) => x.id === stayId)?.confirmationRef ?? '').trim(),
                      cost: draft?.cost ?? '',
                      notes: draft?.notes ?? '',
                      photoUrl: selectedMeta?.photoUrl,
                      googleMapsUri: selectedMeta ? placeGoogleUrl(selectedMeta) : undefined,
                      placeLabel: selectedMeta?.label,
                      category: selectedMeta ? resolveRecommendationCategory(selectedMeta.category, selectedMeta.label, selectedMeta.primaryType, selectedMeta.types) : undefined,
                      primaryType: selectedMeta?.primaryType,
                      lat: typeof selectedMeta?.lat === 'number' ? selectedMeta.lat : undefined,
                      lon: typeof selectedMeta?.lon === 'number' ? selectedMeta.lon : undefined,
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
    setActivityDrafts((prev) => ({ ...prev, [draftKey]: { name: '', time: '', confirmationRef: '', cost: '', notes: '' } }))
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
    if (tripIsReadOnly) return
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

  const moveStayActivityBetweenStays = (activityId: string, fromStayId: string, toStayId: string, patch: Partial<StayActivity>) => {
    if (!state.selectedTripId || fromStayId === toStayId) return
    if (tripIsReadOnly) return
    setState((prev) => {
      const trip = prev.trips.find((t) => t.id === prev.selectedTripId)
      if (!trip) return prev
      let moved: StayActivity | null = null
      const without = trip.stays.map((s) => {
        if (s.id !== fromStayId) return s
        const act = (s.activities ?? []).find((a) => a.id === activityId)
        if (!act) return s
        moved = { ...act, ...patch }
        return { ...s, activities: (s.activities ?? []).filter((a) => a.id !== activityId) }
      })
      if (!moved) return prev
      return {
        ...prev,
        trips: prev.trips.map((t) => {
          if (t.id !== prev.selectedTripId) return t
          return {
            ...t,
            stays: without.map((s) => {
              if (s.id !== toStayId) return s
              const next = [...(s.activities ?? []), moved!]
              next.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
              return { ...s, activities: next }
            }),
          }
        }),
      }
    })
  }

  const applyCalendarDrop = (fromStayId: string, activityId: string, targetDayIso: string, newTime: string) => {
    if (tripIsReadOnly) return
    const targetStayId = resolveStayIdForActivityStorage(stays, targetDayIso)
    if (!targetStayId) {
      setCalendarDropError('Add at least one accommodation on the trip before scheduling activities.')
      return
    }
    setCalendarDropError(null)
    const fromStay = stays.find((s) => s.id === fromStayId)
    const act = fromStay?.activities?.find((a) => a.id === activityId)
    const newStartM = parseTimeToMinutes(newTime)
    const patch: Partial<StayActivity> = { date: targetDayIso, time: newTime }
    if (act && newStartM !== null) {
      const oldStart = effectiveActivityStartMinutes(act, act.date)
      const oldEnd = effectiveActivityEndMinutes(act, act.date)
      const dur = Math.max(CAL_SNAP_MINUTES, oldEnd - oldStart)
      const newEndM = newStartM + dur
      patch.endTime = formatMinutesToTime(snapCalendarMinutes(newEndM))
    }
    if (fromStayId === targetStayId) {
      updateStayActivity(fromStayId, activityId, patch)
      return
    }
    moveStayActivityBetweenStays(activityId, fromStayId, targetStayId, patch)
  }

  const applyCalendarActivityResize = (
    stayId: string,
    activityId: string,
    dayIso: string,
    startMinutes: number,
    endMinutes: number,
  ) => {
    if (tripIsReadOnly) return
    const targetStayId = resolveStayIdForActivityStorage(stays, dayIso)
    if (!targetStayId) {
      setCalendarDropError('Add at least one accommodation on the trip before scheduling activities.')
      return
    }
    setCalendarDropError(null)
    let start = snapCalendarMinutes(startMinutes)
    let end = snapCalendarMinutes(endMinutes)
    end = Math.max(start + CAL_SNAP_MINUTES, Math.min(CAL_END_HOUR * 60, end))
    start = Math.max(0, Math.min(start, end - CAL_SNAP_MINUTES))
    start = snapCalendarMinutes(start)
    end = snapCalendarMinutes(end)
    const patch: Partial<StayActivity> = {
      date: dayIso,
      time: formatMinutesToTime(start),
      endTime: formatMinutesToTime(end),
    }
    if (stayId === targetStayId) {
      updateStayActivity(stayId, activityId, patch)
    } else {
      moveStayActivityBetweenStays(activityId, stayId, targetStayId, patch)
    }
  }

  const removeStayActivity = (stayId: string, activityId: string) => {
    if (!state.selectedTripId) return
    if (tripIsReadOnly) return
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

  const setTripCancelledFlag = (tripId: string, cancelled: boolean) => {
    const tr = state.trips.find((x) => x.id === tripId)
    if (tr && isTripReadOnly(tr)) return
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((trip) => (trip.id === tripId ? { ...trip, cancelled } : trip)),
    }))
  }

  const permanentlyRemoveTrip = (tripId: string) => {
    const tr = state.trips.find((x) => x.id === tripId)
    if (tr?.sharing?.role === 'viewer' || tr?.sharing?.role === 'editor') return
    if (tr?.sharing?.role === 'owner') {
      void revokeSharedItineraryEntire(tr.sharing.sharedItineraryId)
    }
    setState((prev) => {
      const trips = prev.trips.filter((t) => t.id !== tripId)
      const nextSelected =
        prev.selectedTripId === tripId
          ? (trips.find((t) => !t.cancelled)?.id ?? trips[0]?.id ?? null)
          : prev.selectedTripId
      return { trips, selectedTripId: nextSelected }
    })
  }

  const moveTripToCancelled = () => {
    if (!selectedTrip || selectedTrip.cancelled) return
    if (tripIsReadOnly) return
    const trip = selectedTrip
    setConfirmDialog({
      title: 'Cancel trip?',
      description: `Move "${trip.country}" to Cancelled? You can restore it from the home screen or delete it permanently.`,
      confirmLabel: 'Cancel Trip',
      cancelLabel: 'Keep trip',
      variant: 'danger',
      onConfirm: () => {
        const id = trip.id
        setState((prev) => {
          const trips = prev.trips.map((t) => (t.id === id ? { ...t, cancelled: true } : t))
          return { trips, selectedTripId: null }
        })
        setView('home')
      },
    })
  }

  const handleLogout = async () => {
    if (isDevAuthBypass()) {
      skipRemoteSaveRef.current = true
      remoteFetchGenRef.current += 1
      setAuthSession(null)
      setBackendUserId(null)
      setState({ trips: [], selectedTripId: null })
      setView('home')
      setAuthFormError(null)
      setAuthPasswordInput('')
      setAuthPasswordConfirmInput('')
      setAuthPendingVerificationEmail(null)
      setVerificationResendMessage(null)
      return
    }
    if (isSupabaseConfigured()) {
      skipRemoteSaveRef.current = true
      remoteFetchGenRef.current += 1
      getPocketBase().authStore.clear()
    } else {
      clearAuthSession()
    }
    setAuthSession(null)
    setBackendUserId(null)
    setState({ trips: [], selectedTripId: null })
    setView('home')
    setAuthFormError(null)
    setAuthPasswordInput('')
    setAuthPasswordConfirmInput('')
    setAuthPendingVerificationEmail(null)
    setVerificationResendMessage(null)
  }

  const handleResendVerificationEmail = async () => {
    setVerificationResendMessage('Ask your admin to confirm the account in PocketBase, or disable email verification for personal use.')
  }

  const handleDismissEmailVerification = () => {
    setAuthPendingVerificationEmail(null)
    setVerificationResendMessage(null)
    setAuthFormError(null)
    setAuthMode('login')
  }

  const handleImportLocalTrips = () => {
    if (!authSession) return
    const next = loadTripsState(tripsStorageKey(authSession.email))
    setState(next)
    if (!isSupabaseConfigured() || isDevAuthBypass()) {
      skipRemoteSaveRef.current = false
    } else {
      skipRemoteSaveRef.current = true
      void upsertUserTrips(next).then(() => {
        requestAnimationFrame(() => {
          skipRemoteSaveRef.current = false
        })
      })
    }
    sessionStorage.setItem(`itinerary:import-dismissed:${normalizeEmail(authSession.email)}`, '1')
    setLocalImportDismissed(true)
  }

  const handleDismissLocalImport = () => {
    if (!authSession) return
    sessionStorage.setItem(`itinerary:import-dismissed:${normalizeEmail(authSession.email)}`, '1')
    setLocalImportDismissed(true)
  }

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAuthFormError(null)
    setAuthBusy(true)
    const email = authEmailInput.trim()
    const password = authPasswordInput
    try {
      if (isSupabaseConfigured()) {
        const pb = getPocketBase()
        const normalized = normalizeEmail(email)
        if (authMode === 'register') {
          const pwCheck = validateRegistrationPassword(password)
          if (!pwCheck.ok) {
            setAuthFormError(pwCheck.message)
            return
          }
          if (password !== authPasswordConfirmInput) {
            setAuthFormError('Passwords do not match.')
            return
          }
          try {
            await pb.collection('users').create({
              email: normalized,
              password,
              passwordConfirm: password,
              name: authNameInput.trim(),
            })
            await pb.collection('users').authWithPassword(normalized, password)
            await upsertProfileDisplayName(authNameInput.trim())
            setAuthPendingVerificationEmail(null)
            setVerificationResendMessage(null)
          } catch (err: any) {
            const msg = err?.message || err?.data?.message || 'Sign up failed.'
            setAuthFormError(mapAuthError(String(msg), err?.data?.code || err?.status))
            return
          }
          setAuthPasswordInput('')
          setAuthPasswordConfirmInput('')
          setAuthNameInput('')
          return
        }
        try {
          await pb.collection('users').authWithPassword(normalized, password)
        } catch (err: any) {
          const msg = err?.message || err?.data?.message || 'Sign in failed.'
          setAuthFormError(mapAuthError(String(msg), err?.data?.code || err?.status))
          return
        }
        setAuthPasswordInput('')
        setAuthPasswordConfirmInput('')
        return
      }

      if (authMode === 'register') {
        if (password !== authPasswordConfirmInput) {
          setAuthFormError('Passwords do not match.')
          return
        }
        const r = await registerUser(email, password, authNameInput)
        if (!r.ok) {
          setAuthFormError(r.error)
          return
        }
        migrateLegacyTripsIfNeeded(normalizeEmail(email))
        setAuthSession(loadAuthSession())
        setState(loadTripsState(tripsStorageKey(normalizeEmail(email))))
        setAuthPasswordInput('')
        setAuthPasswordConfirmInput('')
        setAuthNameInput('')
      } else {
        const r = await loginUser(email, password)
        if (!r.ok) {
          setAuthFormError(r.error)
          return
        }
        migrateLegacyTripsIfNeeded(normalizeEmail(email))
        setAuthSession(loadAuthSession())
        setState(loadTripsState(tripsStorageKey(normalizeEmail(email))))
        setAuthPasswordInput('')
        setAuthPasswordConfirmInput('')
      }
    } finally {
      setAuthBusy(false)
    }
  }

  const buildShareUrl = (token: string, tripId: string) => {
    const path = window.location.pathname || '/'
    const p = new URLSearchParams()
    p.set('v', 'dashboard')
    p.set('trip', tripId)
    p.set('share', token)
    return `${window.location.origin}${path}?${p.toString()}`
  }

  const openShareModal = async () => {
    if (!selectedTrip || !isSupabaseConfigured() || isDevAuthBypass()) return
    setShareModalCopied(false)
    setShareModalOpen(true)
    setShareModalError(null)
    setShareModalBusy(true)
    if (!selectedTrip.sharing) {
      setShareModalLinkToken(null)
      setShareModalMembers([])
      setShareModalDefaultPerm('viewer')
      setShareModalBusy(false)
      return
    }
    if (selectedTrip.sharing.role !== 'owner') {
      setShareModalError('Only the trip owner can manage the share link.')
      setShareModalMembers([])
      setShareModalLinkToken(null)
      setShareModalBusy(false)
      return
    }
    const meta = await fetchSharedItineraryMeta(selectedTrip.sharing.sharedItineraryId)
    if (!meta.ok) {
      setShareModalError(meta.error)
      setShareModalBusy(false)
      return
    }
    setShareModalLinkToken(meta.shareToken)
    setShareModalDefaultPerm(meta.defaultPermission)
    const mem = await fetchSharedItineraryMembers(selectedTrip.sharing.sharedItineraryId)
    if (mem.ok) setShareModalMembers(mem.members)
    else setShareModalError(mem.error)
    setShareModalBusy(false)
  }

  const enableSharing = async () => {
    if (!selectedTrip?.id || selectedTrip.sharing) return
    setShareModalBusy(true)
    setShareModalError(null)
    const r = await createSharedItinerary({
      sourceTripId: selectedTrip.id,
      trip: selectedTrip,
      defaultPermission: shareModalDefaultPerm,
    })
    if (!r.ok) {
      setShareModalError(r.error)
      setShareModalBusy(false)
      return
    }
    const tid = selectedTrip.id
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) =>
        t.id === tid
          ? {
              ...t,
              sharing: { sharedItineraryId: r.sharedItineraryId, sourceTripId: tid, role: 'owner' as const },
            }
          : t,
      ),
    }))
    setShareModalLinkToken(r.shareToken)
    setShareModalMembers([])
    setShareModalBusy(false)
  }

  if (view === 'home') {
    const openTrip = (tripId: string) => {
      setState((prev) => ({ ...prev, selectedTripId: tripId }))
      setView('dashboard')
    }
    const renderTripCard = (trip: Trip, section: 'active' | 'past' | 'cancelled') => {
      const muted = section === 'past' || section === 'cancelled'
      const startYearLabel = (() => {
        const d = parseIsoDate(trip.startDate) ?? parseIsoDate(trip.endDate)
        return d ? String(d.getFullYear()) : null
      })()
      const hasTopRightCluster =
        Boolean(startYearLabel) || section === 'active' || section === 'cancelled'
      const mainButtonPad = hasTopRightCluster
        ? section === 'cancelled'
          ? 'p-5 pr-[9.5rem] sm:pr-[10.5rem] md:pr-40'
          : section === 'active'
            ? 'p-5 pr-24 sm:pr-28 md:pr-32'
            : 'p-5 pr-12 sm:pr-14'
        : 'p-5'
      return (
        <div
          key={trip.id}
          className={`relative group rounded-2xl border transition-[border-color,box-shadow,background-color] duration-150 ${
            muted
              ? 'border-neutral-200/80 bg-neutral-50/90 dark:bg-neutral-900/50 dark:border-neutral-700'
              : 'border-sky-200/80 bg-white dark:bg-neutral-900/90 dark:border-sky-900/50 shadow-sm hover:shadow-md hover:border-sky-300/80'
          }`}
        >
          <button
            type="button"
            onClick={() => openTrip(trip.id)}
            className={`w-full text-left rounded-2xl ${mainButtonPad}`}
          >
            <div
              className={`font-semibold text-lg flex items-center gap-2 ${section === 'cancelled' ? 'line-through text-neutral-500' : 'text-neutral-900 dark:text-neutral-100'}`}
            >
              {trip.sharing ? <Users size={18} className="shrink-0 text-sky-600 dark:text-sky-400" aria-hidden /> : null}
              <span>{trip.country}</span>
            </div>
            <div className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              {formatDateRangeWithYear(trip.startDate, trip.endDate) || 'Dates not set'}
            </div>
            <div className="text-xs text-neutral-500 mt-2">{trip.mustDos.length} side-quests</div>
          </button>
          {hasTopRightCluster ? (
            <div className="absolute top-3 right-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1.5 sm:gap-2">
              {section === 'active' ? (
                <button
                  type="button"
                  title="Mark trip as cancelled"
                  onClick={(e) => {
                    e.stopPropagation()
                    setTripCancelledFlag(trip.id, true)
                  }}
                  className="p-2 rounded-xl text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <CircleSlash size={18} aria-hidden />
                </button>
              ) : null}
              {section === 'cancelled' ? (
                <>
                  <button
                    type="button"
                    title="Restore trip"
                    onClick={(e) => {
                      e.stopPropagation()
                      setTripCancelledFlag(trip.id, false)
                    }}
                    className="text-xs px-2 py-1 rounded-lg bg-neutral-200/90 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-600"
                  >
                    Restore
                  </button>
                  {(!trip.sharing || trip.sharing.role === 'owner') ? (
                  <button
                    type="button"
                    title="Delete permanently"
                    onClick={(e) => {
                      e.stopPropagation()
                      const tid = trip.id
                      const name = trip.country
                      setConfirmDialog({
                        title: 'Delete trip permanently?',
                        description: `Permanently delete "${name}"? This cannot be undone.`,
                        confirmLabel: 'Delete permanently',
                        cancelLabel: 'Cancel',
                        variant: 'danger',
                        onConfirm: () => permanentlyRemoveTrip(tid),
                      })
                    }}
                    className="p-2 rounded-lg text-neutral-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                  ) : null}
                </>
              ) : null}
              {startYearLabel ? (
                <span className="text-xs font-semibold tabular-nums text-neutral-500 dark:text-neutral-400 select-none shrink-0">
                  {startYearLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )
    }

    return (
      <>
        <ConfirmDialog
          open={confirmDialog !== null}
          onClose={() => setConfirmDialog(null)}
          title={confirmDialog?.title ?? ''}
          description={confirmDialog?.description ?? ''}
          confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
          cancelLabel={confirmDialog?.cancelLabel ?? 'Cancel'}
          variant={confirmDialog?.variant ?? 'default'}
          onConfirm={handleConfirmDialogAction}
        />
        <div
          className={`min-h-screen overflow-x-hidden bg-gradient-to-br from-sky-100/90 via-white to-indigo-50/80 dark:from-neutral-950 dark:via-neutral-900 dark:to-sky-950/40 text-neutral-900 font-sans ${isDarkMode ? 'dark' : ''}`}
        >
        <div className="sticky top-0 z-40 border-b border-white/40 dark:border-neutral-800/80 bg-white/75 dark:bg-neutral-950/80 backdrop-blur-md">
          <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3 min-w-0">
            <a href="/" className="min-w-0 shrink inline-flex items-center gap-2.5 text-neutral-900 dark:text-white no-underline">
              <BrandLogo className="h-8 w-8 shrink-0" />
              <span className="text-lg font-serif font-semibold tracking-tight truncate">{BRAND_NAME}</span>
            </a>
            <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
              {authSession ? (
                <>
                  <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300 max-w-[200px] truncate">
                    <User size={16} className="shrink-0 opacity-70" aria-hidden />
                    {authSession.name}
                  </span>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <LogOut size={16} aria-hidden />
                    Log out
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setIsDarkMode((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white/90 dark:bg-neutral-900 text-sm font-medium shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                aria-label="Toggle dark mode"
              >
                {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                {isDarkMode ? 'Light' : 'Dark'}
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-12 md:py-16">
          <header className="text-center max-w-2xl mx-auto">
            <p className="text-sm font-medium uppercase tracking-widest text-sky-700/90 dark:text-sky-400/90">{BRAND_HOME_KICKER}</p>
            <h1 className="mt-2 text-4xl md:text-5xl font-serif font-bold text-neutral-900 dark:text-white">{BRAND_HOME_HEADLINE}</h1>
            <p className="mt-4 text-neutral-600 dark:text-neutral-400 leading-relaxed">{BRAND_HOME_SUBTEXT}</p>
          </header>

          {isSupabaseConfigured() && !authReady ? (
            <p className="mt-12 text-center text-sm text-neutral-500 dark:text-neutral-400">Loading session…</p>
          ) : !authSession ? (
            isSupabaseConfigured() && authPendingVerificationEmail ? (
              <div className="mt-12 max-w-md mx-auto rounded-3xl border border-neutral-200/90 dark:border-neutral-700 bg-white/90 dark:bg-neutral-900/90 shadow-xl shadow-sky-900/5 dark:shadow-black/40 p-8">
                <div className="text-center mb-2">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400 mb-3">
                    <Mail className="w-6 h-6" aria-hidden />
                  </div>
                  <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">Confirm your email</h2>
                  <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                    We sent a confirmation link to{' '}
                    <span className="font-medium text-neutral-800 dark:text-neutral-200 break-all">
                      {authPendingVerificationEmail}
                    </span>
                    . Click the link in that email to finish signing up, then return here and log in.
                  </p>
                </div>
                {verificationResendMessage ? (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 mb-2">{verificationResendMessage}</p>
                ) : null}
                {authFormError ? <p className="text-sm text-rose-600 dark:text-rose-400 mb-2">{authFormError}</p> : null}
                <div className="flex flex-col gap-2 mt-4">
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void handleResendVerificationEmail()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-neutral-200 dark:border-neutral-600 font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-60"
                  >
                    <Mail size={18} aria-hidden />
                    {authBusy ? 'Sending…' : 'Resend confirmation email'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDismissEmailVerification}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white font-semibold shadow-lg hover:from-sky-500 hover:to-indigo-500"
                  >
                    Back to log in
                  </button>
                </div>
                <p className="mt-6 text-xs text-center text-neutral-500 dark:text-neutral-500">
                  Did not get the email? Check your spam folder. You can resend after a short wait.
                </p>
              </div>
            ) : (
            <div className="mt-12 max-w-md mx-auto rounded-3xl border border-neutral-200/90 dark:border-neutral-700 bg-white/90 dark:bg-neutral-900/90 shadow-xl shadow-sky-900/5 dark:shadow-black/40 p-8">
              <div className="flex rounded-2xl bg-neutral-100 dark:bg-neutral-800 p-1 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login')
                    setAuthFormError(null)
                    setAuthPasswordConfirmInput('')
                    setAuthPendingVerificationEmail(null)
                    setVerificationResendMessage(null)
                  }}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors ${
                    authMode === 'login' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500'
                  }`}
                >
                  Log in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register')
                    setAuthFormError(null)
                    setAuthPasswordConfirmInput('')
                    setAuthPendingVerificationEmail(null)
                    setVerificationResendMessage(null)
                  }}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors ${
                    authMode === 'register' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500'
                  }`}
                >
                  Create account
                </button>
              </div>
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                {authMode === 'register' ? (
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Name</label>
                    <input
                      value={authNameInput}
                      onChange={(e) => setAuthNameInput(e.target.value)}
                      autoComplete="name"
                      className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                      placeholder="Your name"
                    />
                  </div>
                ) : null}
                <div>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Email</label>
                  <input
                    type="email"
                    name="email"
                    value={authEmailInput}
                    onChange={(e) => setAuthEmailInput(e.target.value)}
                    autoComplete="email"
                    spellCheck={false}
                    maxLength={254}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Password</label>
                  <input
                    type="password"
                    name="password"
                    value={authPasswordInput}
                    onChange={(e) => setAuthPasswordInput(e.target.value)}
                    autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                    spellCheck={false}
                    maxLength={128}
                    minLength={authMode === 'register' ? 12 : 1}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                    placeholder="••••••••"
                    required
                  />
                  {authMode === 'register' ? (
                    <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-500">{PASSWORD_RULES_SUMMARY}</p>
                  ) : null}
                </div>
                {authMode === 'register' ? (
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Confirm password
                    </label>
                    <input
                      type="password"
                      name="password-confirm"
                      value={authPasswordConfirmInput}
                      onChange={(e) => setAuthPasswordConfirmInput(e.target.value)}
                      autoComplete="new-password"
                      spellCheck={false}
                      maxLength={128}
                      minLength={12}
                      className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                      placeholder="Repeat password"
                      required
                    />
                  </div>
                ) : null}
                {authFormError ? <p className="text-sm text-rose-600 dark:text-rose-400">{authFormError}</p> : null}
                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white font-semibold shadow-lg hover:from-sky-500 hover:to-indigo-500 disabled:opacity-60"
                >
                  <LogIn size={18} aria-hidden />
                  {authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Log in'}
                </button>
              </form>
              <p className="mt-6 text-xs text-center text-neutral-500 dark:text-neutral-500">
                {isSupabaseConfigured()
                  ? 'Sign-in uses a secure connection. Passwords are never stored in plain text. Your trips sync to your account when you are online.'
                  : 'Accounts are stored only in this browser. Passwords are hashed before storage. Clearing site data will remove them.'}
              </p>
            </div>
            )
          ) : (
            <>
              {showLocalImportBanner ? (
                <div
                  role="status"
                  className="mt-10 max-w-2xl mx-auto rounded-2xl border border-amber-200/90 bg-amber-50/95 dark:bg-amber-950/35 dark:border-amber-800/80 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <p className="text-sm text-amber-950 dark:text-amber-100/95">
                    This browser has saved trips for your account that are not in the cloud yet. Upload them to sync across devices.
                  </p>
                  <div className="flex flex-wrap gap-2 shrink-0 justify-end">
                    <button
                      type="button"
                      onClick={handleImportLocalTrips}
                      className="px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-600"
                    >
                      Upload from this browser
                    </button>
                    <button
                      type="button"
                      onClick={handleDismissLocalImport}
                      className="px-4 py-2 rounded-xl border border-amber-300/80 dark:border-amber-700 text-sm font-medium text-amber-950 dark:text-amber-100 hover:bg-amber-100/80 dark:hover:bg-amber-900/50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="mt-10 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setNewTripDestination('')
                    setNewTripStartDate('')
                    setNewTripEndDate('')
                    setNewTripRange(undefined)
                    setShowAddTripModal(true)
                  }}
                  className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white font-semibold shadow-lg shadow-sky-900/20 hover:from-sky-500 hover:to-indigo-500 transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] motion-reduce:hover:scale-100"
                >
                  Add new trip
                </button>
              </div>

              <div className="mt-14 space-y-12">
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Calendar className="text-sky-600 dark:text-sky-400" size={22} aria-hidden />
                    <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">Current &amp; upcoming</h2>
                  </div>
                  {tripBuckets.active.length === 0 ? (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-600 px-4 py-8 text-center">
                      No active trips. Start planning your next getaway.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tripBuckets.active.map((trip) => renderTripCard(trip, 'active'))}
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <History className="text-neutral-500 dark:text-neutral-400" size={22} aria-hidden />
                    <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">Past trips</h2>
                  </div>
                  {tripBuckets.past.length === 0 ? (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">No past trips yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tripBuckets.past.map((trip) => renderTripCard(trip, 'past'))}
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <CircleSlash className="text-rose-500/90" size={22} aria-hidden />
                    <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">Cancelled</h2>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4 max-w-xl">
                    Trips removed from the planner appear here. Restore them to your lists or delete permanently.
                  </p>
                  {tripBuckets.cancelled.length === 0 ? (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">No cancelled trips.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tripBuckets.cancelled.map((trip) => renderTripCard(trip, 'cancelled'))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
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
      </>
    )
  }

  return (
    <>
      <ConfirmDialog
        open={confirmDialog !== null}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title ?? ''}
        description={confirmDialog?.description ?? ''}
        confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
        cancelLabel={confirmDialog?.cancelLabel ?? 'Cancel'}
        variant={confirmDialog?.variant ?? 'default'}
        onConfirm={handleConfirmDialogAction}
      />
      {shareModalOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => {
            if (!shareModalBusy) setShareModalOpen(false)
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 id="share-modal-title" className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                Shared itinerary
              </h2>
              <button
                type="button"
                className="rounded-lg p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => !shareModalBusy && setShareModalOpen(false)}
                aria-label="Close"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            {shareModalError ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{shareModalError}</p> : null}
            {selectedTrip && !selectedTrip.sharing ? (
              <div className="mt-3">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Enable sharing to invite others with a link. The itinerary syncs from the cloud for everyone with access.
                </p>
                <label className="mt-4 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  Default access for new people via link
                </label>
                <select
                  value={shareModalDefaultPerm}
                  onChange={(e) => setShareModalDefaultPerm(e.target.value === 'editor' ? 'editor' : 'viewer')}
                  className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
                >
                  <option value="viewer">View only</option>
                  <option value="editor">Can edit</option>
                </select>
                <button
                  type="button"
                  disabled={shareModalBusy}
                  onClick={() => void enableSharing()}
                  className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {shareModalBusy ? 'Working…' : 'Enable sharing'}
                </button>
              </div>
            ) : null}
            {selectedTrip?.sharing?.role === 'owner' ? (
              <div className="mt-3">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Share this link. New joiners get the default permission below.
                </p>
                {shareModalLinkToken ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      readOnly
                      className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-600 dark:bg-neutral-800"
                      value={buildShareUrl(shareModalLinkToken, selectedTrip.sharing.sourceTripId)}
                    />
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          buildShareUrl(shareModalLinkToken, selectedTrip.sharing!.sourceTripId),
                        )
                        setShareModalCopied(true)
                        window.setTimeout(() => setShareModalCopied(false), 2000)
                      }}
                    >
                      <Copy size={16} aria-hidden />
                      Copy
                    </button>
                  </div>
                ) : null}
                {shareModalCopied ? <p className="mt-1 text-xs text-green-600 dark:text-green-400">Copied to clipboard.</p> : null}
                <label className="mt-4 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  Default for new link joiners
                </label>
                <select
                  value={shareModalDefaultPerm}
                  onChange={(e) => {
                    const v = e.target.value === 'editor' ? 'editor' : 'viewer'
                    setShareModalDefaultPerm(v)
                    void updateSharedItineraryDefaultPermission(selectedTrip.sharing!.sharedItineraryId, v)
                  }}
                  className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
                >
                  <option value="viewer">View only</option>
                  <option value="editor">Can edit</option>
                </select>
                <h3 className="mt-6 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Members</h3>
                {shareModalBusy ? <p className="mt-2 text-xs text-neutral-500">Loading…</p> : null}
                <ul className="mt-2 space-y-2 text-sm">
                  {shareModalMembers.map((m) => (
                    <li
                      key={m.userId}
                      className="flex flex-col gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-600 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0 truncate text-neutral-800 dark:text-neutral-200">
                        {m.displayName || `User ${m.userId.slice(0, 8)}…`}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={m.role}
                          onChange={(e) => {
                            const role = e.target.value === 'editor' ? 'editor' : 'viewer'
                            void updateSharedMemberRole(selectedTrip.sharing!.sharedItineraryId, m.userId, role).then((r) => {
                              if (r.ok) {
                                setShareModalMembers((prev) =>
                                  prev.map((x) => (x.userId === m.userId ? { ...x, role } : x)),
                                )
                              }
                            })
                          }}
                          className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-800"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          onClick={() => {
                            void revokeSharedItineraryMember(selectedTrip.sharing!.sharedItineraryId, m.userId).then((r) => {
                              if (r.ok) {
                                setShareModalMembers((prev) => prev.filter((x) => x.userId !== m.userId))
                              }
                            })
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="mt-6 text-sm font-semibold text-rose-600 hover:underline"
                  onClick={() => {
                    const sid = selectedTrip.sharing!.sharedItineraryId
                    const tid = selectedTrip.id
                    setConfirmDialog({
                      title: 'Stop sharing for everyone?',
                      description:
                        'Collaborators will lose access. This trip stays on your account as a personal itinerary (no longer synced with others).',
                      confirmLabel: 'Revoke share',
                      cancelLabel: 'Cancel',
                      variant: 'danger',
                      onConfirm: () => {
                        void revokeSharedItineraryEntire(sid).then((r) => {
                          if (r.ok) {
                            setState((prev) => ({
                              ...prev,
                              trips: prev.trips.map((t) => (t.id === tid ? stripSharingFromTrip(t) : t)),
                            }))
                            setShareModalOpen(false)
                          }
                        })
                      },
                    })
                  }}
                >
                  Revoke entire share
                </button>
              </div>
            ) : null}
            {selectedTrip?.sharing && selectedTrip.sharing.role !== 'owner' ? (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
                You can collaborate on this trip but only the owner can manage the invite link and members.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    <div className={`min-h-screen bg-gradient-to-b from-sky-50 via-white to-neutral-100 text-neutral-900 font-sans ${isDarkMode ? 'dark' : ''}`}>

      {calendarActivityDetail ? (() => {
        const calPayload = calendarActivityDetail
        const calModalAct = resolveActivityForCalendarModal(calPayload, selectedTrip)
        const calModalDayItem = calendarPayloadToDayItem(calPayload)
        const directionsDest = directionsDestinationForScheduleItem(calModalDayItem).trim()
        const directionsHref = directionsDest
          ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(directionsDest)}`
          : ''
        const sm = effectiveActivityStartMinutes(calModalAct, calModalAct.date)
        const em = effectiveActivityEndMinutes(calModalAct, calModalAct.date)
        const timeDisplay =
          calModalAct.calendarTimeLabel?.trim() || `${formatMinutesToTime(sm)}–${formatMinutesToTime(em)}`
        const calModalMeta = activityMetaById[calModalAct.id]
        const photoUrl = calModalAct.photoUrl || calModalMeta?.photoUrl
        const categoryLine = calModalAct.category || calModalMeta?.category
        const googleUri = calModalAct.googleMapsUri || calModalMeta?.googleMapsUri
        const calModalHostStay =
          !calPayload.bookingRef && calPayload.stayId !== CAL_BOOKING_STAY_ID
            ? selectedTrip?.stays.find((s) => s.id === calPayload.stayId)
            : null
        const kindLabel = calendarItemKindLabel(calPayload)
        const isBookingRow = Boolean(calPayload.bookingRef)
        const showActivityEdit =
          calendarActivityDetailEditing && calendarDetailDraft && !isBookingRow

        return (
          <div
            className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
            role="presentation"
            onClick={() => setCalendarActivityDetail(null)}
          >
            <div
              className="w-[min(100%,28rem)] max-h-[min(92vh,40rem)] flex flex-col bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cal-activity-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 pb-0 shrink-0 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {showActivityEdit ? 'Edit activity' : `${kindLabel} details`}
                  </p>
                  <h3
                    id="cal-activity-modal-title"
                    className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5 break-words"
                  >
                    {calModalAct.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCalendarActivityDetail(null)}
                  className="shrink-0 p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 mt-4 flex-1 overflow-y-auto min-h-0 space-y-4 pb-2">
                {showActivityEdit ? (
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Name</label>
                    <input
                      value={calendarDetailDraft?.name ?? ''}
                      disabled={tripIsReadOnly}
                      onChange={(e) => setCalendarDetailDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 text-sm disabled:opacity-50"
                    />
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Start time</label>
                    <input
                      type="time"
                      value={calendarDetailDraft?.time ?? ''}
                      disabled={tripIsReadOnly}
                      onChange={(e) => setCalendarDetailDraft((d) => (d ? { ...d, time: e.target.value } : d))}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 text-sm disabled:opacity-50"
                    />
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">End time</label>
                    <input
                      type="time"
                      value={calendarDetailDraft?.endTime ?? ''}
                      disabled={tripIsReadOnly}
                      onChange={(e) => setCalendarDetailDraft((d) => (d ? { ...d, endTime: e.target.value } : d))}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 text-sm disabled:opacity-50"
                    />
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Confirmation #</label>
                    <input
                      value={calendarDetailDraft?.confirmationRef ?? ''}
                      disabled={tripIsReadOnly}
                      onChange={(e) => setCalendarDetailDraft((d) => (d ? { ...d, confirmationRef: e.target.value } : d))}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 text-sm disabled:opacity-50"
                    />
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Cost</label>
                    <input
                      value={calendarDetailDraft?.cost ?? ''}
                      disabled={tripIsReadOnly}
                      onChange={(e) => setCalendarDetailDraft((d) => (d ? { ...d, cost: e.target.value } : d))}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 text-sm disabled:opacity-50"
                    />
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Notes</label>
                    <textarea
                      value={calendarDetailDraft?.notes ?? ''}
                      disabled={tripIsReadOnly}
                      onChange={(e) => setCalendarDetailDraft((d) => (d ? { ...d, notes: e.target.value } : d))}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 text-sm resize-y disabled:opacity-50"
                    />
                  </div>
                ) : (
                  <>
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt=""
                        className="w-full max-h-40 object-cover rounded-xl border border-neutral-200 dark:border-neutral-700"
                      />
                    ) : null}
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Date</p>
                        <p className="text-neutral-900 dark:text-neutral-100">
                          {formatSingleDateLabel(calModalAct.date) || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Time</p>
                        <p className="text-neutral-900 dark:text-neutral-100 tabular-nums">{timeDisplay}</p>
                      </div>
                      {calPayload.stayLocation?.trim() ? (
                        <div>
                          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Type</p>
                          <p className="text-neutral-900 dark:text-neutral-100">{calPayload.stayLocation.trim()}</p>
                        </div>
                      ) : null}
                      {calModalHostStay ? (
                        <div>
                          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Accommodation</p>
                          <p className="text-neutral-900 dark:text-neutral-100 font-medium">{calModalHostStay.location}</p>
                          {calModalHostStay.address?.trim() ? (
                            <p className="text-neutral-600 dark:text-neutral-300 text-xs mt-0.5">
                              {calModalHostStay.address.trim()}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {categoryLine ? (
                        <div>
                          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Category</p>
                          <p className="text-neutral-900 dark:text-neutral-100">{categoryLine}</p>
                        </div>
                      ) : null}
                      {calModalAct.placeLabel?.trim() ? (
                        <div>
                          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Place</p>
                          <p className="text-neutral-900 dark:text-neutral-100">{calModalAct.placeLabel.trim()}</p>
                        </div>
                      ) : null}
                      {(directionsHref || googleUri) ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {directionsHref ? (
                            <a
                              href={directionsHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-xs font-semibold text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                            >
                              <MapPin size={14} aria-hidden />
                              Directions
                            </a>
                          ) : null}
                          {googleUri ? (
                            <a
                              href={googleUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                            >
                              <ExternalLink size={14} aria-hidden />
                              Google Maps
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {isBookingRow && calPayload.bookingRef && selectedTrip ? (
                      <CalendarBookingDetailsReadonly
                        tab={calPayload.bookingRef.tab}
                        id={calPayload.bookingRef.id}
                        bookings={selectedTrip.bookings}
                      />
                    ) : null}
                    {!isBookingRow ? (
                      <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-700 pt-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                          Activity details
                        </p>
                        {calModalAct.confirmationRef?.trim() ? (
                          <div>
                            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Confirmation #</p>
                            <p className="text-sm text-neutral-900 dark:text-neutral-100">{calModalAct.confirmationRef.trim()}</p>
                          </div>
                        ) : null}
                        {calModalAct.cost?.trim() ? (
                          <div>
                            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Cost</p>
                            <p className="text-sm text-neutral-900 dark:text-neutral-100">{calModalAct.cost.trim()}</p>
                          </div>
                        ) : null}
                        {calModalAct.notes?.trim() ? (
                          <div>
                            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Notes</p>
                            <p className="text-sm text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-words">
                              {calModalAct.notes.trim()}
                            </p>
                          </div>
                        ) : null}
                        {!calModalAct.confirmationRef?.trim() && !calModalAct.cost?.trim() && !calModalAct.notes?.trim() ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">No confirmation, cost, or notes on this activity.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="p-6 pt-4 shrink-0 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-950/40">
                {showActivityEdit ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={tripIsReadOnly}
                      onClick={() => {
                        removeStayActivity(calPayload.stayId, calPayload.activity.id)
                        setCalendarActivityDetail(null)
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50 disabled:opacity-40"
                    >
                      Delete
                    </button>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setCalendarActivityDetailEditing(false)
                          const a = resolveActivityForCalendarModal(calPayload, selectedTrip)
                          const endT =
                            (a.endTime ?? '').trim() || formatMinutesToTime(effectiveActivityEndMinutes(a, a.date))
                          setCalendarDetailDraft({ ...a, endTime: endT })
                        }}
                        className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={tripIsReadOnly || !calendarDetailDraft}
                        onClick={() => {
                          if (!calendarDetailDraft) return
                          const timeNorm = normalizeHhMmTime((calendarDetailDraft.time ?? '').trim())
                          let endNorm = normalizeHhMmTime((calendarDetailDraft.endTime ?? '').trim())
                          const tsm = parseTimeToMinutes(timeNorm)
                          const tem = parseTimeToMinutes(endNorm)
                          if (tsm !== null && (tem === null || tem <= tsm)) {
                            endNorm = formatMinutesToTime(Math.min(24 * 60, tsm + CAL_EVENT_DURATION_MIN))
                          }
                          updateStayActivity(calPayload.stayId, calPayload.activity.id, {
                            name: (calendarDetailDraft.name ?? '').trim(),
                            time: timeNorm,
                            endTime: endNorm,
                            confirmationRef: (calendarDetailDraft.confirmationRef ?? '').trim(),
                            cost: calendarDetailDraft.cost ?? '',
                            notes: calendarDetailDraft.notes ?? '',
                          })
                          setCalendarActivityDetail(null)
                        }}
                        className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCalendarActivityDetail(null)}
                      className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      Close
                    </button>
                    {!tripIsReadOnly ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (calPayload.bookingRef) {
                            const br = calPayload.bookingRef
                            setCalendarActivityDetail(null)
                            setActiveTab('planner')
                            setBookingsTab(br.tab)
                            setBookingFilter(br.tab)
                            openEditBookingForm(br.tab, br.id)
                          } else {
                            setCalendarActivityDetailEditing(true)
                          }
                        }}
                        className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500"
                      >
                        <Pencil size={16} aria-hidden />
                        Edit
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })() : null}

      {/* Hero stays put; planner content below scrolls up over it */}
      <div className="sticky top-0 z-0 w-full">
        <div className="relative h-[min(48vh,560px)] min-h-[300px] max-sm:h-[min(44vh,480px)] max-sm:min-h-[280px] w-full overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-3 sm:px-4 sm:pt-4">
            <div
              className="pointer-events-auto flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView('home')}
                  className="inline-flex shrink-0 items-center gap-2 px-3 py-2 sm:px-4 rounded-xl border border-white/40 bg-black/35 backdrop-blur-md text-white text-sm font-medium shadow-lg hover:bg-black/45"
                >
                  Back to Home
                </button>
                {authSession ? (
                  <>
                    <span className="hidden min-[380px]:inline-flex max-w-[140px] sm:max-w-[160px] items-center gap-1.5 truncate px-3 py-2 rounded-xl border border-white/25 bg-black/25 backdrop-blur-md text-white text-xs">
                      <User size={14} className="shrink-0 opacity-90" aria-hidden />
                      {authSession.name}
                    </span>
                    <button
                      type="button"
                      onClick={handleLogout}
                      aria-label="Log out"
                      className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl border border-white/40 bg-black/35 backdrop-blur-md text-white text-sm font-medium shadow-lg hover:bg-black/45"
                    >
                      <LogOut size={16} aria-hidden />
                      <span className="hidden sm:inline">Log out</span>
                    </button>
                  </>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDarkMode((v) => !v)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/40 bg-black/35 backdrop-blur-md text-white text-sm font-medium shadow-lg hover:bg-black/45"
                  aria-label="Toggle dark mode"
                >
                  {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                  <span className="hidden sm:inline">{isDarkMode ? 'Light' : 'Dark'}</span>
                </button>
              </div>
            </div>
          </div>
          <img
            src={dashboardHeroUrl || DEFAULT_HERO_IMAGE}
            className="absolute inset-0 h-full w-full object-cover"
            alt="Hero"
          />
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/35 to-black/60 flex flex-col items-center justify-center gap-2.5 sm:gap-3.5 pt-[4.5rem] sm:pt-20 pb-12 max-sm:pb-14 text-white px-3 text-center sm:px-4 overflow-hidden"
          >
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold drop-shadow-md px-1 flex flex-wrap items-center justify-center gap-3">
              {selectedTrip?.sharing ? <Users className="shrink-0 text-white/90" size={40} aria-hidden /> : null}
              {!selectedTrip ? <BrandLogo className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 drop-shadow-md" /> : null}
              <span>{selectedTrip ? `Trip to: ${selectedTrip.country}` : BRAND_NAME}</span>
            </h1>
            <p className="text-sm sm:text-base md:text-lg max-w-2xl opacity-95 px-1">{BRAND_DASHBOARD_SUBTITLE}</p>
            {shareInviteBanner ? (
              <p className="text-sm text-amber-200 max-w-xl rounded-lg bg-black/25 px-3 py-2 border border-amber-400/40">
                {shareInviteBanner}
              </p>
            ) : null}
            {tripIsReadOnly ? (
              <p className="text-sm text-white/95 max-w-xl rounded-lg bg-black/35 px-3 py-2 border border-white/25">
                View-only access: you can browse this shared itinerary but cannot edit it.
              </p>
            ) : null}
            {isSupabaseConfigured() && !isDevAuthBypass() && authSession && selectedTrip && !tripIsReadOnly ? (
              <div className="flex flex-wrap justify-center gap-2">
                {selectedTrip.sharing?.role === 'owner' ? (
                  <button
                    type="button"
                    onClick={() => void openShareModal()}
                    className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-black/35 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md hover:bg-black/50"
                  >
                    <Users size={16} aria-hidden />
                    Manage sharing
                  </button>
                ) : !selectedTrip.sharing ? (
                  <button
                    type="button"
                    onClick={() => void openShareModal()}
                    className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-black/35 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md hover:bg-black/50"
                  >
                    <Link2 size={16} aria-hidden />
                    Share trip
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="flex gap-3 flex-wrap justify-center text-sm font-medium">
              <span className="bg-white/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/30 shadow-lg">
                {selectedTrip ? `Current: ${selectedTrip.country}` : 'No trip selected'}
              </span>
              <span className="bg-white/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/30 shadow-lg">
                {selectedTrip?.startDate || selectedTrip?.endDate
                  ? formatDateRangeWithYear(selectedTrip?.startDate, selectedTrip?.endDate)
                  : `Side-Quests remaining: ${remaining}`}
              </span>
            </div>
            <div className="w-full max-w-md rounded-2xl border border-white/30 bg-black/25 backdrop-blur-md px-5 py-2.5 text-center shadow-lg">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-100">{sideQuestCountdown.title}</p>
              <p className="mt-0.5 text-lg md:text-xl font-bold leading-tight text-white">{sideQuestCountdown.subtitle}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + main scroll over the sticky hero; hero peeks behind the upper half of the tab bar */}
      <div className="relative z-10">
        <div className="relative z-20 mx-auto max-w-5xl px-3 sm:px-4 -mt-9">
          <div className="overflow-x-auto overscroll-x-contain rounded-2xl border border-white/70 bg-white/90 p-1.5 shadow-2xl backdrop-blur-md dark:border-neutral-700/80 dark:bg-neutral-900/90 sm:p-2.5 [scrollbar-width:thin]">
          <div className="flex w-max flex-nowrap gap-1 sm:w-full sm:flex-wrap sm:gap-1">
          <button
            onClick={() => setActiveTab('planner')}
            className={`flex min-h-11 min-w-[5.25rem] flex-none sm:min-h-0 sm:flex-1 items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-3 px-1 rounded-lg transition-colors duration-150 active:opacity-90 ${
              activeTab === 'planner' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <Calendar size={18} className="shrink-0" />
            <span className="font-semibold text-xs sm:text-base whitespace-nowrap">Planner</span>
          </button>
          <button
            onClick={() => setActiveTab('itinerary')}
            className={`flex min-h-11 min-w-[5.25rem] flex-none sm:min-h-0 sm:flex-1 items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-3 px-1 rounded-lg transition-colors duration-150 active:opacity-90 ${
              activeTab === 'itinerary' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <Calendar size={18} className="shrink-0" />
            <span className="font-semibold text-xs sm:text-base whitespace-nowrap">Itinerary</span>
          </button>
          <button
            onClick={() => setActiveTab('budget')}
            className={`flex min-h-11 min-w-[5.25rem] flex-none sm:min-h-0 sm:flex-1 items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-3 px-1 rounded-lg transition-colors duration-150 active:opacity-90 ${
              activeTab === 'budget' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <DollarSign size={18} className="shrink-0" />
            <span className="font-semibold text-xs sm:text-base whitespace-nowrap">Budget</span>
          </button>
          <button
            onClick={() => setActiveTab('tips')}
            className={`flex min-h-11 min-w-[5.25rem] flex-none sm:min-h-0 sm:flex-1 items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-3 px-1 rounded-lg transition-colors duration-150 active:opacity-90 ${
              activeTab === 'tips' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <Compass size={18} className="shrink-0" />
            <span className="font-semibold text-xs sm:text-base whitespace-nowrap">Tips</span>
          </button>
          <button
            onClick={() => setActiveTab('map')}
            className={`flex min-h-11 min-w-[5.25rem] flex-none sm:min-h-0 sm:flex-1 items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-3 px-1 rounded-lg transition-colors duration-150 active:opacity-90 ${
              activeTab === 'map' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <MapIcon size={18} className="shrink-0" />
            <span className="font-semibold text-xs sm:text-base whitespace-nowrap">Map</span>
          </button>
        </div>
      </div>
      </div>

        {/* Sheet starts mid-tab so the hero shows behind the upper half of the tab bar */}
        <div className="relative z-10 -mt-[2.25rem] bg-gradient-to-b from-sky-50 via-white to-neutral-100 pt-[3.75rem] dark:from-neutral-950 dark:via-neutral-900 dark:to-sky-950/40">
        <main className="max-w-5xl mx-auto px-3 sm:px-4 pb-12 max-sm:pb-[max(3rem,env(safe-area-inset-bottom,0px))]">
        {activeTab === 'planner' && (
          <div
            className={`space-y-8 animate-in fade-in duration-200${tripIsReadOnly ? ' pointer-events-none opacity-[0.82]' : ''}`}
          >
            {/* Bookings */}
            <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 overflow-hidden">
              <button
                type="button"
                onClick={() => setBookingManagementExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-4 px-4 py-4 sm:px-7 sm:py-5 hover:bg-neutral-50 transition-colors text-left"
                aria-expanded={bookingManagementExpanded}
                aria-controls="booking-management-panel"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Calendar className="text-blue-600 shrink-0" size={20} aria-hidden />
                  <div>
                    <h2 className="text-2xl font-serif font-bold">Booking management</h2>
                    <p className="text-neutral-500 text-sm">
                      {bookingManagementExpanded
                        ? 'One timeline for all bookings, filterable by type.'
                        : `${bookingManagementRows.length} booking${bookingManagementRows.length !== 1 ? 's' : ''} · ${
                            bookingFilter === 'all'
                              ? 'All types'
                              : bookingFilter === 'rentalCar'
                                ? 'Rental car'
                                : bookingFilter === 'flight'
                                  ? 'Flight'
                                  : bookingFilter === 'restaurant'
                                    ? 'Dining & activities'
                                    : 'Accommodation'
                          }`}
                    </p>
                  </div>
                </div>
                {bookingManagementExpanded ? <ChevronUp size={20} className="shrink-0 text-neutral-500" /> : <ChevronDown size={20} className="shrink-0 text-neutral-500" />}
              </button>

              {bookingManagementExpanded ? (
              <div id="booking-management-panel" className="px-4 pb-6 sm:px-7 sm:pb-7">
              <div className="flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1 -mx-1 px-1 sm:grid sm:grid-cols-5 sm:overflow-visible sm:pb-0 sm:px-0 sm:mx-0">
                <button
                  type="button"
                  onClick={() => setBookingFilter('all')}
                  className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${bookingFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingsTab('rentalCar')
                    setBookingFilter('rentalCar')
                  }}
                  className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${bookingFilter === 'rentalCar' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Rental Car
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingsTab('flight')
                    setBookingFilter('flight')
                  }}
                  className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${bookingFilter === 'flight' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Flight
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingsTab('restaurant')
                    setBookingFilter('restaurant')
                  }}
                  className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${bookingFilter === 'restaurant' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Dining & activities
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingsTab('accommodation')
                    setBookingFilter('accommodation')
                  }}
                  className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${bookingFilter === 'accommodation' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Accommodation
                </button>
              </div>

              <ul className="mt-4 space-y-2">
                {visibleBookingRows.length === 0 ? (
                  <li className="text-sm text-neutral-700 dark:text-neutral-300">No matching bookings yet.</li>
                ) : (
                  visibleBookingRows.map((row) => {
                    const overlapTargets = bookingOverlapLinks.get(row.id) ?? []
                    const isOverlap = overlapTargets.length > 0
                    const isOverlapHighlighted = activeOverlapIds.has(row.id)
                    const canEditBookingRow =
                      (row.kind !== 'activity' && row.kind !== 'accommodation' && !!row.removeId && !!row.removeTab) ||
                      (row.kind === 'accommodation' && !!row.stayId)
                    return (
                      <li
                        key={row.id}
                        id={`booking-row-${row.id}`}
                        className={`px-3 py-2.5 rounded-xl border !opacity-100 !text-neutral-950 dark:!text-neutral-100 ${isOverlap ? '!border-red-400 !bg-red-50 dark:!border-red-500/70 dark:!bg-red-950/30' : '!border-neutral-200 !bg-white dark:!border-neutral-700 dark:!bg-neutral-900/70'} ${isOverlapHighlighted ? '!ring-2 !ring-red-500 !border-red-500 dark:!ring-red-400 dark:!border-red-400' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold !text-neutral-950 dark:!text-neutral-200">{row.dateText}</p>
                          <div className="flex items-center gap-2">
                            {isOverlap ? (
                              <button
                                type="button"
                                onClick={() => setPinnedOverlapSourceId((prev) => (prev === row.id ? null : row.id))}
                                className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full border ${activeOverlapSourceId === row.id ? '!bg-red-600 !text-white !border-red-600 dark:!bg-red-500 dark:!border-red-400 dark:!text-white' : '!bg-red-100 !text-red-900 !border-red-500 dark:!bg-red-900/50 dark:!text-red-200 dark:!border-red-500/70'}`}
                                title="Click to highlight overlaps"
                              >
                                <TriangleAlert className="h-3 w-3" aria-hidden />
                                Overlap
                              </button>
                            ) : null}
                            <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full ${bookingKindChipClass[row.kind]}`}>
                              {row.kind === 'rentalCar'
                                ? 'Rental car'
                                : row.kind === 'flight'
                                  ? 'Flight'
                                  : row.kind === 'restaurant'
                                    ? 'Dining'
                                    : row.kind === 'accommodation'
                                      ? 'Accommodation'
                                      : 'Activity'}
                            </span>
                          </div>
                        </div>
                        <p className="mt-1 text-sm font-semibold !text-neutral-950 dark:!text-neutral-100">{row.title}</p>
                        <p className="text-xs !text-neutral-900 dark:!text-neutral-300">{row.subtitle}</p>
                        {row.meta || (row.priceAmount != null && row.priceAmount > 0) ? (
                          <div className="mt-0.5 flex items-start justify-between gap-3">
                            {row.meta ? (
                              <p className="text-xs !text-neutral-900 dark:!text-neutral-300 flex-1 min-w-0">{row.meta}</p>
                            ) : (
                              <span className="flex-1" />
                            )}
                            {row.priceAmount != null && row.priceAmount > 0 ? (
                              <span className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100 shrink-0">
                                {formatMoneyAmount(row.priceAmount, displayCurrency)}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {row.kind === 'flight' && row.flightBaggage ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-400">
                            {row.flightBaggage.checked > 0 ? (
                              <span className="inline-flex items-center gap-1" title="Checked bags">
                                <Luggage size={15} strokeWidth={1.75} aria-hidden />
                                <span>×{row.flightBaggage.checked}</span>
                              </span>
                            ) : null}
                            {row.flightBaggage.carryOn > 0 ? (
                              <span className="inline-flex items-center gap-1" title="Carry-on bags">
                                <Briefcase size={15} strokeWidth={1.75} aria-hidden />
                                <span>×{row.flightBaggage.carryOn}</span>
                              </span>
                            ) : null}
                            {row.flightBaggage.personal ? (
                              <span className="inline-flex items-center gap-1" title="Personal item">
                                <ShoppingBag size={15} strokeWidth={1.75} aria-hidden />
                                <span>Personal</span>
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-[11px] !text-neutral-900 dark:!text-neutral-300">
                            {row.kind === 'activity' ? 'Removable from booking management.' : 'Editable/removable from booking management.'}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (row.kind !== 'activity' && row.kind !== 'accommodation' && row.removeId && row.removeTab) {
                                  openEditBookingForm(row.removeTab, row.removeId)
                                } else if (row.kind === 'accommodation' && row.stayId) {
                                  openEditStayForm(row.stayId)
                                }
                              }}
                              disabled={!canEditBookingRow}
                              title={canEditBookingRow ? 'Edit booking' : 'This item is not editable from this card'}
                              className="inline-flex items-center justify-center h-6 w-6 rounded-md border border-neutral-300 text-neutral-800 hover:text-neutral-950 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed dark:border-neutral-600 dark:text-neutral-200 dark:hover:text-white dark:hover:bg-neutral-800"
                              aria-label={canEditBookingRow ? 'Edit booking' : 'Read-only item'}
                            >
                              <Ellipsis size={14} />
                            </button>
                            {row.kind === 'activity' && row.stayId && row.activityId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const stayId = row.stayId!
                                  const activityId = row.activityId!
                                  setConfirmDialog({
                                    title: 'Delete booking?',
                                    description: 'Are you sure you want to permanently delete this booking?',
                                    confirmLabel: 'Delete',
                                    cancelLabel: 'Cancel',
                                    variant: 'danger',
                                    onConfirm: () => removeStayActivity(stayId, activityId),
                                  })
                                }}
                                className="text-xs text-rose-700 border border-rose-300 rounded-md px-2 py-1 hover:bg-rose-50"
                              >
                                Remove
                              </button>
                            ) : null}
                            {row.kind === 'accommodation' && row.stayId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const stayId = row.stayId!
                                  setConfirmDialog({
                                    title: 'Delete booking?',
                                    description: 'Are you sure you want to permanently delete this booking?',
                                    confirmLabel: 'Delete',
                                    cancelLabel: 'Cancel',
                                    variant: 'danger',
                                    onConfirm: () => removeStay(stayId),
                                  })
                                }}
                                className="text-xs text-rose-700 border border-rose-300 rounded-md px-2 py-1 hover:bg-rose-50"
                              >
                                Remove
                              </button>
                            ) : null}
                            {row.kind !== 'activity' && row.kind !== 'accommodation' && row.removeId && row.removeTab ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const tab = row.removeTab!
                                  const id = row.removeId!
                                  setConfirmDialog({
                                    title: 'Delete booking?',
                                    description: 'Are you sure you want to permanently delete this booking?',
                                    confirmLabel: 'Delete',
                                    cancelLabel: 'Cancel',
                                    variant: 'danger',
                                    onConfirm: () => removeBooking(tab, id),
                                  })
                                }}
                                className="text-xs text-rose-700 border border-rose-300 rounded-md px-2 py-1 hover:bg-rose-50"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    )
                  })
                )}
              </ul>

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    resetBookingFormInputs()
                    setEditingBookingForm(null)
                    setEditingStayId(null)
                    setIsBookingFormOpen(true)
                  }}
                  disabled={!selectedTrip}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold disabled:opacity-50"
                >
                  Add booking
                </button>
                <p className="text-xs text-neutral-700 dark:text-neutral-300">Only items with confirmation numbers are shown in this list.</p>
              </div>
              </div>
              ) : null}
            </div>
            {isBookingFormOpen ? (
              <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
                <div className="w-[min(100%,42rem)] max-h-[85vh] overflow-auto bg-white rounded-2xl shadow-2xl p-6 border border-neutral-200">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">
                      {editingBookingForm || editingStayId ? 'Edit' : 'Add'} {bookingsTab === 'rentalCar' ? 'rental car' : bookingsTab === 'flight' ? 'flight' : bookingsTab === 'restaurant' ? 'dining/activity' : 'accommodation'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBookingFormOpen(false)
                        setEditingBookingForm(null)
                        setEditingStayId(null)
                      }}
                      className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200"
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-4">
                    {bookingsTab === 'rentalCar' ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Rental company</label>
                            <input value={carCompanyInput} onChange={(e) => setCarCompanyInput(e.target.value)} disabled={!selectedTrip} placeholder="e.g. Hertz" className="w-full px-3 py-2 rounded-xl border border-neutral-200" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Confirmation #</label>
                            <input value={carConfirmationInput} onChange={(e) => setCarConfirmationInput(e.target.value)} disabled={!selectedTrip} placeholder="Required" className="w-full px-3 py-2 rounded-xl border border-neutral-200" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Pickup location</label>
                            <input
                              value={carPickupLocationInput}
                              onChange={(e) => setCarPickupLocationInput(e.target.value)}
                              disabled={!selectedTrip}
                              placeholder="Airport, address, or branch"
                              className="w-full px-3 py-2 rounded-xl border border-neutral-200"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Dropoff location</label>
                            <input
                              value={carDropoffLocationInput}
                              onChange={(e) => setCarDropoffLocationInput(e.target.value)}
                              disabled={!selectedTrip}
                              placeholder="Airport, city, or branch"
                              className="w-full px-3 py-2 rounded-xl border border-neutral-200"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Pickup date</label>
                            <DateSingleDropdown
                              date={carPickupInput}
                              onChange={setCarPickupInput}
                              disabled={!selectedTrip}
                              placeholder="Pickup date"
                              initialMonthIso={selectedTrip?.startDate}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Pickup time</label>
                            <input
                              type="time"
                              value={carPickupTimeInput}
                              onChange={(e) => setCarPickupTimeInput(e.target.value)}
                              disabled={!selectedTrip}
                              className="w-full px-3 py-2 rounded-xl border border-neutral-200"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Dropoff date</label>
                            <DateSingleDropdown
                              date={carDropoffInput}
                              onChange={setCarDropoffInput}
                              disabled={!selectedTrip}
                              placeholder="Dropoff date"
                              initialMonthIso={selectedTrip?.startDate || carPickupInput}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Dropoff time</label>
                            <input
                              type="time"
                              value={carDropoffTimeInput}
                              onChange={(e) => setCarDropoffTimeInput(e.target.value)}
                              disabled={!selectedTrip}
                              className="w-full px-3 py-2 rounded-xl border border-neutral-200"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Price</label>
                          <input value={carPriceInput} onChange={(e) => setCarPriceInput(e.target.value)} disabled={!selectedTrip} placeholder="e.g. $320" className="w-full px-3 py-2 rounded-xl border border-neutral-200 sm:max-w-xs" />
                        </div>
                      </div>
                    ) : null}

                    {bookingsTab === 'flight' ? (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">From</label>
                            <AirportCombobox
                              iata={flightFromIata}
                              labelText={flightFromLabel}
                              disabled={!selectedTrip}
                              onSelect={(a: AirportRecord) => {
                                setFlightFromIata(a.iata)
                                setFlightFromLabel(formatAirportOptionLabel(a))
                              }}
                              onClear={() => {
                                setFlightFromIata('')
                                setFlightFromLabel('')
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">To</label>
                            <AirportCombobox
                              iata={flightToIata}
                              labelText={flightToLabel}
                              disabled={!selectedTrip}
                              onSelect={(a: AirportRecord) => {
                                setFlightToIata(a.iata)
                                setFlightToLabel(formatAirportOptionLabel(a))
                              }}
                              onClear={() => {
                                setFlightToIata('')
                                setFlightToLabel('')
                              }}
                            />
                          </div>
                        </div>
                        <div className="mt-3">
                          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Airline</label>
                          <input
                            value={flightAirlineInput}
                            onChange={(e) => setFlightAirlineInput(e.target.value)}
                            disabled={!selectedTrip}
                            placeholder="e.g. United, Delta"
                            className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900"
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Departure date</label>
                            <DateSingleDropdown
                              date={flightDepartInput}
                              onChange={setFlightDepartInput}
                              disabled={!selectedTrip}
                              placeholder="Departure date"
                              initialMonthIso={selectedTrip?.startDate}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Departure time</label>
                            <input
                              type="time"
                              value={flightDepartTimeInput}
                              onChange={(e) => setFlightDepartTimeInput(e.target.value)}
                              disabled={!selectedTrip}
                              className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Arrival date</label>
                            <DateSingleDropdown
                              date={flightArriveDateInput}
                              onChange={setFlightArriveDateInput}
                              disabled={!selectedTrip}
                              placeholder="Arrival date (defaults to departure if empty)"
                              initialMonthIso={selectedTrip?.startDate || flightDepartInput}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Arrival time</label>
                            <input
                              type="time"
                              value={flightArriveTimeInput}
                              onChange={(e) => setFlightArriveTimeInput(e.target.value)}
                              disabled={!selectedTrip}
                              className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900"
                            />
                          </div>
                        </div>
                        <div className="mt-3">
                          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Baggage</p>
                          <div className="flex flex-wrap items-end gap-4">
                            <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                              <span className="inline-flex items-center gap-1">
                                <Luggage size={14} className="shrink-0 opacity-80" aria-hidden />
                                Checked
                              </span>
                              <select
                                value={flightCheckedBags}
                                onChange={(e) => setFlightCheckedBags(Number(e.target.value))}
                                disabled={!selectedTrip}
                                className="px-2 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900 text-sm min-w-[4.5rem]"
                              >
                                {[0, 1, 2, 3, 4, 5].map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                              <span className="inline-flex items-center gap-1">
                                <Briefcase size={14} className="shrink-0 opacity-80" aria-hidden />
                                Carry-on
                              </span>
                              <select
                                value={flightCarryOnBags}
                                onChange={(e) => setFlightCarryOnBags(Number(e.target.value))}
                                disabled={!selectedTrip}
                                className="px-2 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900 text-sm min-w-[4.5rem]"
                              >
                                {[0, 1, 2, 3].map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-neutral-700 dark:text-neutral-300 pb-2">
                              <input
                                type="checkbox"
                                checked={flightPersonalItem}
                                onChange={(e) => setFlightPersonalItem(e.target.checked)}
                                disabled={!selectedTrip}
                                className="rounded border-neutral-300"
                              />
                              <ShoppingBag size={16} className="shrink-0 opacity-80" aria-hidden />
                              Personal item
                            </label>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={flightConfirmationInput}
                            onChange={(e) => setFlightConfirmationInput(e.target.value)}
                            disabled={!selectedTrip}
                            placeholder="Confirmation #"
                            className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900"
                          />
                          <input
                            value={flightPriceInput}
                            onChange={(e) => setFlightPriceInput(e.target.value)}
                            disabled={!selectedTrip}
                            placeholder="Price"
                            className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900"
                          />
                        </div>
                        <input
                          value={flightQuickInput}
                          onChange={(e) => setFlightQuickInput(e.target.value)}
                          disabled={!selectedTrip}
                          placeholder="Paste flight details (e.g. SFO-LAX) to autofill airports, confirmation, price"
                          className="mt-2 w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900 text-sm"
                        />
                        <button
                          type="button"
                          onClick={autofillFlightFromText}
                          disabled={!selectedTrip || !flightQuickInput.trim()}
                          className="mt-2 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
                        >
                          Autofill from pasted text
                        </button>
                      </>
                    ) : null}

                    {bookingsTab === 'restaurant' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <input value={restaurantNameInput} onChange={(e) => setRestaurantNameInput(e.target.value)} disabled={!selectedTrip} placeholder="Restaurant" className="px-3 py-2 rounded-xl border border-neutral-200" />
                        <DateSingleDropdown date={restaurantDateInput} onChange={setRestaurantDateInput} disabled={!selectedTrip} placeholder="Booking date" initialMonthIso={selectedTrip?.startDate} />
                        <input value={restaurantConfirmationInput} onChange={(e) => setRestaurantConfirmationInput(e.target.value)} disabled={!selectedTrip} placeholder="Booking #" className="px-3 py-2 rounded-xl border border-neutral-200" />
                        <input value={restaurantCostInput} onChange={(e) => setRestaurantCostInput(e.target.value)} disabled={!selectedTrip} placeholder="Cost" className="px-3 py-2 rounded-xl border border-neutral-200" />
                        <input value={restaurantNotesInput} onChange={(e) => setRestaurantNotesInput(e.target.value)} disabled={!selectedTrip} placeholder="Notes" className="px-3 py-2 rounded-xl border border-neutral-200 sm:col-span-4" />
                      </div>
                    ) : null}

                    {bookingsTab === 'accommodation' ? (
                      <>
                        <p className="text-sm text-neutral-600 mb-3">Accommodation entries are managed in stays. Address is optional and can be added later.</p>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
                          <input value={stayLocationInput} onChange={(e) => setStayLocationInput(e.target.value)} disabled={!selectedTrip} placeholder={selectedTrip ? 'Stay location (hotel/city)' : 'Select a trip first'} className="md:col-span-2 px-3 py-2 rounded-xl border border-neutral-200" />
                          <input value={stayAddressInput} onChange={(e) => setStayAddressInput(e.target.value)} disabled={!selectedTrip} placeholder="Accommodation address (optional)" className="md:col-span-2 px-3 py-2 rounded-xl border border-neutral-200" />
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
                          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Check-in time</label>
                              <input
                                type="time"
                                value={stayCheckInTimeInput}
                                onChange={(e) => setStayCheckInTimeInput(e.target.value)}
                                disabled={!selectedTrip}
                                className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Check-out time</label>
                              <input
                                type="time"
                                value={stayCheckOutTimeInput}
                                onChange={(e) => setStayCheckOutTimeInput(e.target.value)}
                                disabled={!selectedTrip}
                                className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900"
                              />
                            </div>
                          </div>
                          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 self-start">
                            <input value={stayPriceInput} onChange={(e) => setStayPriceInput(e.target.value)} disabled={!selectedTrip} placeholder="Price" className="px-3 py-2 rounded-xl border border-neutral-200" />
                            <input value={stayConfirmationRefInput} onChange={(e) => setStayConfirmationRefInput(e.target.value)} disabled={!selectedTrip} placeholder="Confirmation #" className="px-3 py-2 rounded-xl border border-neutral-200" />
                          </div>
                          <input value={stayBookingUrlInput} onChange={(e) => setStayBookingUrlInput(e.target.value)} disabled={!selectedTrip} placeholder="Booking link" className="md:col-span-4 px-3 py-2 rounded-xl border border-neutral-200" />
                        </div>
                        {stayError ? <p className="mt-2 text-xs text-rose-700">{stayError}</p> : null}
                      </>
                    ) : null}
                  </div>

                  {bookingError ? <p className="mt-3 text-xs text-rose-700">{bookingError}</p> : null}

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsBookingFormOpen(false)
                        setEditingBookingForm(null)
                        setEditingStayId(null)
                      }}
                      className="px-3 py-2 rounded-lg border border-neutral-200 text-sm"
                    >
                      Cancel
                    </button>
                    {bookingsTab === 'accommodation' ? (
                      <button
                        type="button"
                        onClick={() => {
                          const ok = editingStayId ? saveStayFormEdit() : addStay()
                          if (ok) {
                            setIsBookingFormOpen(false)
                            setEditingBookingForm(null)
                            setEditingStayId(null)
                          }
                        }}
                        disabled={!selectedTrip}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {editingStayId ? 'Save changes' : 'Add stay'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const ok = editingBookingForm ? saveBookingFormEdit() : addBooking()
                          if (ok) {
                            setIsBookingFormOpen(false)
                            setEditingBookingForm(null)
                          }
                        }}
                        disabled={!selectedTrip}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {editingBookingForm ? 'Save changes' : 'Add booking'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Places to visit */}
            <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedTripPanel((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-4 sm:px-7 sm:py-5 hover:bg-neutral-50 transition-colors"
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
                <div className="px-4 pb-6 sm:px-7 sm:pb-7">
                  <div className="flex flex-col sm:flex-row gap-3 mb-6 items-start sm:items-center">
                    <div className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-neutral-200 bg-neutral-50 text-sm text-neutral-700 shadow-sm">
                      {selectedTrip ? `Current trip: ${selectedTrip.country}` : 'No trip selected'}
                    </div>
                    {selectedTrip?.cancelled ? (
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setTripCancelledFlag(selectedTrip.id, false)}
                          className="px-4 py-3 rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                        >
                          Restore trip
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const t = selectedTrip
                            setConfirmDialog({
                              title: 'Delete trip permanently?',
                              description: `Permanently delete "${t.country}"? This cannot be undone.`,
                              confirmLabel: 'Delete permanently',
                              cancelLabel: 'Cancel',
                              variant: 'danger',
                              onConfirm: () => permanentlyRemoveTrip(t.id),
                            })
                          }}
                          className="px-4 py-3 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                        >
                          Delete permanently
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!selectedTrip}
                        onClick={moveTripToCancelled}
                        className="px-4 py-3 rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:hover:bg-transparent shrink-0"
                      >
                        Cancel Trip
                      </button>
                    )}
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
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-neutral-800">Recommended places</h3>
                        <p className="text-xs text-neutral-500">
                          {selectedTrip
                            ? 'Cached on your NAS. Refresh only when you want new ideas (free Overpass/OSM — no Google).'
                            : 'Select a trip to see recommendations.'}
                        </p>
                        {recommendedPlaces.fetchedAt ? (
                          <p className="text-[11px] text-neutral-400 mt-1">
                            Last refreshed {new Date(recommendedPlaces.fetchedAt).toLocaleString()}
                            {recommendedPlaces.source ? ` · ${recommendedPlaces.source}` : ''}
                          </p>
                        ) : selectedTrip ? (
                          <p className="text-[11px] text-neutral-400 mt-1">No cached recommendations yet.</p>
                        ) : null}
                      </div>
                      {selectedTrip && isSupabaseConfigured() && !isDevAuthBypass() ? (
                        <button
                          type="button"
                          disabled={recommendedPlaces.refreshing || recommendedPlaces.loading}
                          onClick={() => void recommendedPlaces.refresh()}
                          className="shrink-0 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        >
                          {recommendedPlaces.refreshing ? 'Refreshing…' : 'Refresh recommendations'}
                        </button>
                      ) : null}
                    </div>
                    {!selectedTrip ? null : recommendedPlaces.loading ? (
                      <p className="text-sm text-neutral-500">Loading cached recommendations...</p>
                    ) : recommendedPlaces.error ? (
                      <p className="text-xs text-rose-700">{recommendedPlaces.error}</p>
                    ) : visibleRecommendations.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {visibleRecommendations.map((rec) => {
                          const googleUrl =
                            rec.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.label)}`
                          const imageUrl = rec.photoUrl || DEFAULT_HERO_IMAGE
                          const primaryTitle = rec.label.split(',')[0]?.trim() || rec.label
                          const addressTail = rec.label.split(',').slice(1).join(',').trim()
                          return (
                            <div
                              key={rec.key}
                              className="text-left px-3 py-3 rounded-xl border border-neutral-200 bg-white hover:bg-blue-50/50 transition-colors"
                            >
                              <div className="flex gap-3 items-start sm:items-center">
                                <img
                                  src={imageUrl}
                                  alt=""
                                  loading="lazy"
                                  className="w-[92px] h-[58px] rounded-lg object-cover border border-neutral-200 shrink-0 bg-neutral-100"
                                />
                                <div className="min-w-0 flex-1 flex flex-col gap-2">
                                  <p className="sm:hidden text-sm text-neutral-800 font-medium break-words w-full">{primaryTitle}</p>
                                  <div className="sm:hidden flex w-full items-center justify-between gap-2 flex-wrap">
                                    <a
                                      href={googleUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 shrink-0"
                                    >
                                      <ExternalLink size={12} />
                                      Google
                                    </a>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => setDismissedRecommendationKeys((prev) => (prev.includes(rec.key) ? prev : [...prev, rec.key]))}
                                        className="p-1 rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
                                        aria-label={`Dismiss recommendation ${rec.label}`}
                                      >
                                        <X size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => addRecommendedActivity(rec)}
                                        className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-xs hover:from-blue-500 hover:to-indigo-500 transition-colors shadow-sm whitespace-nowrap"
                                      >
                                        Add
                                      </button>
                                    </div>
                                  </div>
                                  <div className="hidden sm:flex sm:flex-row sm:items-center sm:gap-3 w-full min-w-0">
                                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                                      <p className="text-sm text-neutral-800 font-medium break-words">{primaryTitle}</p>
                                      {addressTail ? (
                                        <p className="text-xs text-neutral-500 break-words">{addressTail}</p>
                                      ) : null}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
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
                                      <button
                                        type="button"
                                        onClick={() => addRecommendedActivity(rec)}
                                        className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-xs hover:from-blue-500 hover:to-indigo-500 transition-colors shadow-sm whitespace-nowrap"
                                      >
                                        Add
                                      </button>
                                    </div>
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
                      Trips, places, and side-quests are saved locally in your browser. Refresh-safe.
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
          <div
            className={`animate-in fade-in duration-200${itineraryViewMode === 'timeline' ? ' max-sm:overflow-x-hidden' : ''}${tripIsReadOnly ? ' pointer-events-none opacity-[0.82]' : ''}`}
          >
            <div
              className={`bg-white rounded-3xl shadow-lg border border-neutral-100 p-4 sm:p-7${
                itineraryViewMode === 'calendar' && isMobileCalNarrow
                  ? ' max-sm:bg-transparent max-sm:shadow-none max-sm:border-0 max-sm:p-0 max-sm:rounded-none'
                  : ''
              }`}
            >
              <div
                className={`flex items-center justify-between gap-4 flex-wrap${
                  itineraryViewMode === 'calendar' && isMobileCalNarrow ? ' max-sm:px-4 max-sm:pb-2' : ''
                }`}
              >
                <div className="min-w-0">
                  <h2 className="text-2xl font-serif font-bold">Itinerary</h2>
                  <p
                    className={`text-neutral-500 text-sm${itineraryViewMode === 'calendar' && isMobileCalNarrow ? ' max-sm:hidden' : ''}`}
                  >
                    Day-by-day planner with a visual timeline and quick context cards.
                  </p>
                  {itineraryViewMode === 'calendar' && isMobileCalNarrow ? (
                    <p className="text-neutral-500 text-xs mt-0.5 sm:hidden">Calendar — scroll hours; tap a day for tips below.</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setItineraryViewMode((m) => (m === 'timeline' ? 'calendar' : 'timeline'))}
                  className="shrink-0 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                >
                  <Calendar size={16} aria-hidden />
                  {itineraryViewMode === 'timeline' ? 'Calendar View' : 'Timeline View'}
                </button>
              </div>

              {selectedTrip && timelineDays.length > 0 ? (
                <div
                  className={`mt-5 space-y-5${
                    itineraryViewMode === 'calendar' && isMobileCalNarrow ? ' max-sm:mt-3 max-sm:space-y-4 max-sm:px-0' : ''
                  }`}
                >
                  {itineraryViewMode === 'timeline' ? (
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
                  ) : null}

                  {(() => {
                    if (itineraryViewMode === 'calendar' && isMobileCalNarrow) return null
                    const activeStays = staysByDay.get(selectedTimelineDate) ?? []
                    const anchorStay = activeStays[0]
                    const selectedActivities = activitiesByDay.get(selectedTimelineDate) ?? []
                    const highlightedActivity = selectedActivities[0]?.activity
                    const isTodayCard = selectedTimelineDate === todayIso
                    const titleName = isTodayCard
                      ? activeSoonActivity?.name ?? 'Nothing in the next 30 minutes'
                      : highlightedActivity?.name ?? 'No activity yet'
                    const titleNotes = isTodayCard
                      ? activeSoonActivity?.notes ||
                        (activeSoonActivity ? '' : 'No timed activity starting in the next 30 minutes (needs a parseable time).')
                      : highlightedActivity?.notes || formatSingleDateLabel(selectedTimelineDate)
                    const titleTime = isTodayCard
                      ? activeSoonActivity?.time || (activeSoonActivity ? '' : '—')
                      : highlightedActivity?.time || 'No time set'
                    const firstSched = selectedActivities[0]
                    let highlightDirectionsDest = (activeSoonDirectionsDestination || '').trim()
                    if (!highlightDirectionsDest && !isTodayCard && firstSched) {
                      highlightDirectionsDest = directionsDestinationForScheduleItem(firstSched)
                    }
                    if (!highlightDirectionsDest) {
                      highlightDirectionsDest = (anchorStay?.address || anchorStay?.location || '').trim()
                    }
                    if (!highlightDirectionsDest && selectedTrip?.country) {
                      highlightDirectionsDest = selectedTrip.country.trim()
                    }
                    const highlightDirectionsHref =
                      highlightDirectionsDest.length > 0
                        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(highlightDirectionsDest)}`
                        : 'https://www.google.com/maps/'

                    return (
                      <div className="grid grid-cols-1 gap-4">
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

                        <div className="itinerary-highlight-card md:hidden">
                          <span className="itinerary-highlight-pill">Active soon</span>
                          <h3 className="mt-3 text-2xl font-semibold">{titleName}</h3>
                          <p className="mt-1 text-sm text-neutral-500">{titleNotes}</p>
                          <div className="mt-4 flex items-center justify-between gap-2 flex-wrap text-xs text-neutral-500">
                            <span>{titleTime}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <a
                                href={highlightDirectionsHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="itinerary-summary-link"
                              >
                                <ExternalLink size={12} aria-hidden />
                                Directions
                              </a>
                              <span>{selectedActivities.length} activities</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  <div
                    className={`itinerary-timeline-shell${
                      itineraryViewMode === 'calendar' && isMobileCalNarrow
                        ? ' itinerary-timeline-shell--calendar-mobile max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none max-sm:p-0 max-sm:rounded-none'
                        : ''
                    }`}
                  >
                    {itineraryViewMode === 'timeline' ? (
                      <>
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold">
                            {selectedDayNumber ? `Day ${selectedDayNumber}: ${formatSingleDateLabel(selectedTimelineDate)}` : `Day: ${formatSingleDateLabel(selectedTimelineDate)}`}
                          </h3>
                          <span className="text-xs text-neutral-500">{(activitiesByDay.get(selectedTimelineDate) ?? []).length} activities</span>
                        </div>
                        <div className="mt-4 space-y-2">
                          {(activitiesByDay.get(selectedTimelineDate) ?? []).map((item) => {
                            const { stayId, activity: a, bookingRef } = item
                            const rowKey = `${stayId}-${a.id}`
                            if (bookingRef) {
                              return (
                                <div key={rowKey} className="itinerary-activity-row-wrap">
                                  <div className="itinerary-activity-lane-dot" />
                                  <div className="itinerary-activity-row">
                                    <div
                                      className="itinerary-activity-photo-square itinerary-activity-photo-square--placeholder flex items-center justify-center text-neutral-400 dark:text-neutral-500"
                                      aria-hidden
                                    >
                                      <Car size={20} strokeWidth={1.75} />
                                    </div>
                                    <div className="itinerary-activity-main">
                                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
                                        <span className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-600 text-xs font-medium tabular-nums w-full sm:w-[92px] shrink-0 bg-neutral-50 dark:bg-neutral-800/80">
                                          {a.time}
                                        </span>
                                        <span className="flex-1 min-w-0 w-full sm:min-w-[120px] px-2 py-1 text-xs font-medium text-neutral-800 dark:text-neutral-100">{a.name}</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActiveTab('planner')
                                            setBookingsTab(bookingRef.tab)
                                            setBookingFilter(bookingRef.tab)
                                            openEditBookingForm(bookingRef.tab, bookingRef.id)
                                          }}
                                          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                                        >
                                          Edit booking
                                        </button>
                                      </div>
                                      {a.notes ? <p className="mt-1 text-xs text-neutral-500">{a.notes}</p> : null}
                                    </div>
                                  </div>
                                </div>
                              )
                            }
                            return (
                              <div key={rowKey} className="itinerary-activity-row-wrap">
                                <div className="itinerary-activity-lane-dot" />
                                <div className="itinerary-activity-row">
                                  {(a.photoUrl || activityMetaById[a.id]?.photoUrl) ? (
                                    <img src={a.photoUrl || activityMetaById[a.id]?.photoUrl} alt={a.name} className="itinerary-activity-photo-square" />
                                  ) : (
                                    <div className="itinerary-activity-photo-square itinerary-activity-photo-square--placeholder" />
                                  )}
                                  <div className="itinerary-activity-main">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
                                      <input type="time" value={a.time} onChange={(e) => updateStayActivity(stayId, a.id, { time: e.target.value })} className="px-2 py-1 rounded border border-neutral-200 text-xs w-full sm:w-[92px]" />
                                      <input value={a.name} onChange={(e) => updateStayActivity(stayId, a.id, { name: e.target.value })} className="flex-1 min-w-0 w-full sm:min-w-[120px] px-2 py-1 rounded border border-neutral-200 text-xs" />
                                      <input
                                        value={a.confirmationRef}
                                        onChange={(e) => updateStayActivity(stayId, a.id, { confirmationRef: e.target.value })}
                                        placeholder="Conf. #"
                                        className="px-2 py-1 rounded border border-neutral-200 text-xs w-full sm:w-[100px]"
                                      />
                                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                        <input value={a.cost} onChange={(e) => updateStayActivity(stayId, a.id, { cost: e.target.value })} placeholder="Cost" className="flex-1 min-w-0 sm:flex-none px-2 py-1 rounded border border-neutral-200 text-xs sm:w-[88px]" />
                                        <button type="button" onClick={() => removeStayActivity(stayId, a.id)} className="p-2 rounded text-neutral-500 hover:bg-neutral-100 shrink-0" aria-label="Remove activity"><X size={14} /></button>
                                      </div>
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
                            )
                          })}
                          {(activitiesByDay.get(selectedTimelineDate) ?? []).length === 0 ? <p className="text-xs text-neutral-500">No activities for this day yet.</p> : null}
                        </div>
                      </>
                    ) : (
                      <div className={isMobileCalNarrow ? 'itinerary-calendar-viewport-breakout' : ''}>
                        {calendarDropError ? (
                          <p
                            className={`text-sm text-rose-600 mb-2${isMobileCalNarrow ? ' max-sm:px-4' : ''}`}
                          >
                            {calendarDropError}
                          </p>
                        ) : null}
                        {isMobileCalNarrow ? (
                          <div className="max-sm:px-4 max-sm:pt-3 max-sm:mb-3 itinerary-cal-mobile-upcoming">
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50/90 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/60">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                                Accommodation
                              </p>
                              {selectedDayPrimaryStay ? (
                                <div className="mt-1.5 flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate flex items-center gap-1.5">
                                      <BedDouble size={14} className="shrink-0 opacity-70" aria-hidden />
                                      {selectedDayPrimaryStay.location || 'Stay'}
                                    </p>
                                    {selectedDayPrimaryStay.address?.trim() ? (
                                      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
                                        {selectedDayPrimaryStay.address.trim()}
                                      </p>
                                    ) : null}
                                  </div>
                                  {(selectedDayPrimaryStay.address || selectedDayPrimaryStay.location)?.trim() ? (
                                    <a
                                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                                        (selectedDayPrimaryStay.address || selectedDayPrimaryStay.location).trim(),
                                      )}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                    >
                                      <MapPin size={12} aria-hidden />
                                      Map
                                    </a>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                                  Add accommodation in Planner to see where you&apos;re staying.
                                </p>
                              )}
                            </div>
                          </div>
                        ) : null}
                        <div className="itinerary-calendar-mode itinerary-calendar-mobile-bleed">
                        <ItineraryCalendarGrid
                          visibleDays={visibleCalendarDays}
                          timelineDays={timelineDays}
                          activitiesByDay={activitiesByDay}
                          stays={stays}
                          staysByDay={staysByDay}
                          todayIso={todayIso}
                          nowMinutes={nowMinutes}
                          selectedTimelineDate={selectedTimelineDate}
                          onSelectDay={setSelectedTimelineDate}
                          onCalendarActivityDrop={applyCalendarDrop}
                          onCalendarActivityResize={applyCalendarActivityResize}
                          calendarReadOnly={tripIsReadOnly}
                          onSelectCalendarItem={(item) =>
                            setCalendarActivityDetail({
                              stayId: item.stayId,
                              activity: item.activity,
                              bookingRef: item.bookingRef,
                              stayLocation: item.stayLocation,
                            })
                          }
                          weekStartIndex={calendarWeekStartIndex}
                          onPrevWeek={() => setCalendarWeekStartIndex((i) => Math.max(0, i - 7))}
                          onNextWeek={() => setCalendarWeekStartIndex((i) => Math.min(calendarMaxStart, i + 7))}
                          canPrev={canPrevCalendar}
                          canNext={canNextCalendar}
                          onShiftCalendarDays={(delta) =>
                            setCalendarWeekStartIndex((i) => Math.max(0, Math.min(calendarMaxStart, i + delta)))
                          }
                          canShiftCalendarPrev={calendarWeekStartIndex > 0}
                          canShiftCalendarNext={calendarWeekStartIndex < calendarMaxStart}
                        />
                        </div>
                      </div>
                    )}

                    <div
                      className={`itinerary-day-recommendations ${
                        itineraryViewMode === 'calendar'
                          ? 'mt-8 pt-4 border-t border-neutral-200 dark:border-neutral-700 max-sm:mt-4 max-sm:px-4 max-sm:rounded-xl max-sm:bg-white max-sm:border max-sm:border-neutral-200 max-sm:pt-4 max-sm:shadow-sm dark:max-sm:bg-neutral-900 dark:max-sm:border-neutral-700'
                          : ''
                      }`}
                    >
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
                      ) : recommendedPlaces.loading ? (
                        <p className="mt-2 text-xs text-neutral-500">Loading recommendations...</p>
                      ) : recommendedPlaces.error ? (
                        <p className="mt-2 text-xs text-rose-700">{recommendedPlaces.error}</p>
                      ) : visibleSelectedDayRecommendations.length > 0 ? (
                        <ul className="mt-2 space-y-2">
                          {visibleSelectedDayRecommendations.map((rec) => {
                            const recTitle = rec.label.split(',')[0]?.trim() || rec.label
                            const recAddress =
                              rec.label.split(',').slice(1).join(',').trim() || rec.seedLabel || 'Nearby pick'
                            return (
                              <li key={`day-rec-${rec.key}`} className="itinerary-rec-row items-start sm:!items-center">
                                {rec.photoUrl ? (
                                  <img src={rec.photoUrl} alt="" className="itinerary-rec-photo" />
                                ) : (
                                  <div className="itinerary-rec-photo itinerary-rec-photo--placeholder" />
                                )}
                                <div className="min-w-0 flex-1 flex flex-col gap-1">
                                  <p className="sm:hidden text-sm font-medium text-neutral-800 break-words w-full">{recTitle}</p>
                                  <div className="sm:hidden flex w-full items-center justify-between gap-2 flex-wrap">
                                    <a
                                      href={placeGoogleUrl(rec)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="itinerary-google-link shrink-0"
                                    >
                                      <ExternalLink size={12} />
                                      Google
                                    </a>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => setDismissedRecommendationKeys((prev) => (prev.includes(rec.key) ? prev : [...prev, rec.key]))}
                                        className="itinerary-rec-dismiss"
                                        aria-label={`Dismiss ${rec.label}`}
                                        title="Dismiss recommendation"
                                      >
                                        <X size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => addRecommendationToSelectedDay(rec)}
                                        className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold whitespace-nowrap"
                                      >
                                        Add to Day
                                      </button>
                                    </div>
                                  </div>
                                  <div className="hidden sm:flex sm:flex-row sm:items-center sm:gap-3 w-full min-w-0">
                                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <p className="text-sm font-medium text-neutral-800 break-words">{recTitle}</p>
                                        <span className="itinerary-rec-category">{rec.category || 'Other'}</span>
                                      </div>
                                      <p className="text-xs text-neutral-500 break-words">{recAddress}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <a
                                        href={placeGoogleUrl(rec)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="itinerary-google-link inline-flex items-center"
                                      >
                                        <ExternalLink size={12} />
                                        Google
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() => setDismissedRecommendationKeys((prev) => (prev.includes(rec.key) ? prev : [...prev, rec.key]))}
                                        className="itinerary-rec-dismiss"
                                        aria-label={`Dismiss ${rec.label}`}
                                        title="Dismiss recommendation"
                                      >
                                        <X size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => addRecommendationToSelectedDay(rec)}
                                        className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold whitespace-nowrap"
                                      >
                                        Add to Day
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-neutral-500">No recommendations found for this day yet.</p>
                      )}
                    </div>

                    {(() => {
                      const activeStays = staysByDay.get(selectedTimelineDate) ?? []
                      const stayOnThisDay = activeStays[0]
                      const storageStayId = resolveStayIdForActivityStorage(stays, selectedTimelineDate)
                      const draftKey = `${storageStayId ?? 'none'}|${selectedTimelineDate}`
                      const draft = activityDrafts[draftKey] ?? { name: '', time: '', confirmationRef: '', cost: '', notes: '' }
                      if (!storageStayId) {
                        return (
                          <p
                            className={`mt-4 text-xs text-neutral-500${
                              itineraryViewMode === 'calendar' && isMobileCalNarrow ? ' max-sm:px-4' : ''
                            }`}
                          >
                            Add at least one accommodation on this trip to save activities (they can be scheduled on any trip day).
                          </p>
                        )
                      }
                      const activityNamePlaceholder = stayOnThisDay
                        ? `Add activity for ${stayOnThisDay.location}`
                        : 'Add activity for this day'
                      return (
                        <div
                          className={`mt-4${
                            itineraryViewMode === 'calendar' && isMobileCalNarrow ? ' max-sm:px-4' : ''
                          }`}
                        >
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
                                          confirmationRef: draft.confirmationRef,
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
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_90px_100px_90px_auto] gap-2">
                          <input value={draft.name} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, name: e.target.value } }))} placeholder={activityNamePlaceholder} className="px-2 py-1.5 rounded border border-neutral-200 text-xs w-full" />
                          <input type="time" value={draft.time} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, time: e.target.value } }))} className="px-2 py-1.5 rounded border border-neutral-200 text-xs w-full md:w-auto" />
                          <input
                            value={draft.confirmationRef}
                            onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, confirmationRef: e.target.value } }))}
                            placeholder="Conf. #"
                            className="px-2 py-1.5 rounded border border-neutral-200 text-xs w-full md:w-auto"
                          />
                          <input value={draft.cost} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, cost: e.target.value } }))} placeholder="Cost" className="px-2 py-1.5 rounded border border-neutral-200 text-xs w-full md:w-auto" />
                          <button type="button" onClick={() => addStayActivity(storageStayId, selectedTimelineDate)} className="px-3 py-2.5 rounded bg-blue-600 text-white text-xs font-semibold w-full md:w-auto min-h-10">Add</button>
                          <input value={draft.notes} onChange={(e) => setActivityDrafts((prev) => ({ ...prev, [draftKey]: { ...draft, notes: e.target.value } }))} placeholder="Notes" className="md:col-span-5 px-2 py-1.5 rounded border border-neutral-200 text-xs" />
                          {draftPlaceMeta[draftKey] ? (
                            <div className="md:col-span-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center text-xs text-neutral-500">
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

                  {stayError ? (
                    <p
                      className={`text-xs text-rose-700${
                        itineraryViewMode === 'calendar' && isMobileCalNarrow ? ' max-sm:px-4' : ''
                      }`}
                    >
                      {stayError}
                    </p>
                  ) : null}
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
          <div className={`animate-in fade-in duration-200${tripIsReadOnly ? ' pointer-events-none opacity-[0.82]' : ''}`}>
            <div className="bg-white rounded-3xl shadow-lg p-4 sm:p-8 border border-neutral-100">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <h2 className="text-3xl font-serif font-bold">Budget</h2>
                  <p className="text-neutral-500 mt-2">
                    {selectedTrip
                      ? `Live totals for ${selectedTrip.country}.`
                      : 'Select a trip to view categorized budget totals.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 pl-4 pr-3 py-3 sm:min-w-[250px] w-full sm:w-fit">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Estimated Budget</p>
                  <p className="text-4xl font-bold text-indigo-900 mt-1 leading-none">{formatMoneyAmount(budgetTotals.total, displayCurrency)}</p>
                  <p className="mt-1 text-xs text-indigo-700/80">
                    {budgetPerDay ? `${formatMoneyAmount(budgetPerDay.total, displayCurrency)}/day` : 'Set trip dates for per-day average'}
                  </p>
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
                  <div className="text-right">
                    <p className="text-xl font-bold text-neutral-900">{formatMoneyAmount(budgetTotals.vehicle, displayCurrency)}</p>
                    <p className="text-xs text-neutral-500">{budgetPerDay ? `${formatMoneyAmount(budgetPerDay.vehicle, displayCurrency)}/day` : '—'}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-violet-100 text-violet-700 inline-flex items-center justify-center shrink-0">
                      <Plane size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Flights</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-neutral-900">{formatMoneyAmount(budgetTotals.flights, displayCurrency)}</p>
                    <p className="text-xs text-neutral-500">{budgetPerDay ? `${formatMoneyAmount(budgetPerDay.flights, displayCurrency)}/day` : '—'}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 inline-flex items-center justify-center shrink-0">
                      <BedDouble size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Accommodation</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-neutral-900">{formatMoneyAmount(budgetTotals.accommodation, displayCurrency)}</p>
                    <p className="text-xs text-neutral-500">{budgetPerDay ? `${formatMoneyAmount(budgetPerDay.accommodation, displayCurrency)}/day` : '—'}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-amber-100 text-amber-700 inline-flex items-center justify-center shrink-0">
                      <Compass size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Activities</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-neutral-900">{formatMoneyAmount(budgetTotals.activities, displayCurrency)}</p>
                    <p className="text-xs text-neutral-500">{budgetPerDay ? `${formatMoneyAmount(budgetPerDay.activities, displayCurrency)}/day` : '—'}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-rose-100 text-rose-700 inline-flex items-center justify-center shrink-0">
                      <UtensilsCrossed size={18} />
                    </span>
                    <p className="font-bold text-neutral-900">Food</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-neutral-900">{formatMoneyAmount(budgetTotals.food, displayCurrency)}</p>
                    <p className="text-xs text-neutral-500">{budgetPerDay ? `${formatMoneyAmount(budgetPerDay.food, displayCurrency)}/day` : '—'}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 text-xs text-neutral-500">
                Uses prices from rental car bookings, flight bookings, accommodation entries, restaurant bookings, and activity costs from places to visit.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-lg p-4 sm:p-7 border border-neutral-100">
              <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
                <div className="min-w-0">
                  <h2 className="text-2xl font-serif font-bold">Map</h2>
                  <p className="text-neutral-500 text-sm">
                    {selectedTrip ? 'Polarsteps-style route on free OpenStreetMap tiles.' : 'Select a trip to see the map.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="px-3 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold">
                    Overall progress: {overallTripProgressPct !== null ? `${overallTripProgressPct}%` : 'N/A'}
                  </span>
                  <span className="px-3 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold">
                    {currentStay ? `Current stay: ${currentStay.location}` : 'No active stay today'}
                  </span>
                </div>
              </div>

              {selectedTrip ? (
                <ul className="mt-4 list-none space-y-2.5 text-sm">
                  {MAP_CATEGORIES.map((c) => {
                    const vis = mapCategoryVisible[c]
                    const label = MAP_LEGEND_LABELS[c]
                    const ariaLabel = `${vis ? 'Hide' : 'Show'} ${MAP_CATEGORY_LABELS[c]} on map`
                    const Icon = MAP_LEGEND_ICON[c]
                    const circleBg =
                      c === 'accommodation'
                        ? 'bg-blue-600'
                        : c === 'place'
                          ? 'bg-emerald-600'
                          : c === 'flight'
                            ? 'bg-violet-600'
                            : c === 'rental'
                              ? 'bg-indigo-600'
                              : c === 'dining'
                                ? 'bg-amber-600'
                                : 'bg-rose-600'
                    return (
                      <li key={c} className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => setMapCategoryVisible((prev) => ({ ...prev, [c]: !prev[c] }))}
                          aria-pressed={vis}
                          aria-label={ariaLabel}
                          className={`inline-flex h-7 w-7 shrink-0 rounded-full items-center justify-center shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 ${circleBg} ${
                            vis ? '' : 'opacity-45 grayscale'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2} aria-hidden />
                        </button>
                        <span className={`text-neutral-800 ${vis ? '' : 'text-neutral-400'}`}>{label}</span>
                      </li>
                    )
                  })}
                  <li className="flex items-center gap-3 min-w-0 pt-1 border-t border-neutral-200 mt-1">
                    <span className="inline-block h-1 w-8 shrink-0 rounded-full bg-blue-600 opacity-90" aria-hidden />
                    <span className="text-neutral-700">Outbound: stays and flights (straight line)</span>
                  </li>
                  <li className="flex items-center gap-3 min-w-0">
                    <span
                      className="inline-block h-1 w-8 shrink-0 border-t-2 border-dotted border-neutral-500 opacity-90"
                      aria-hidden
                    />
                    <span className="text-neutral-700">Return leg</span>
                  </li>
                </ul>
              ) : null}

              <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-2 h-[min(520px,calc(100dvh-12rem))] min-h-[280px] sm:h-[520px] sm:min-h-0">
                {!selectedTrip ? (
                  <div className="h-full flex items-center justify-center text-sm text-neutral-500">Select a trip to load map locations.</div>
                ) : (
                  <TripMap
                    active={activeTab === 'map'}
                    mapPoints={mapPoints}
                    mapCategoryVisible={mapCategoryVisible}
                    stays={stays}
                    visitPlaces={visitPlaces}
                    flights={bookings.flights}
                    rentalCars={bookings.rentalCars}
                    restaurants={bookings.restaurants}
                    country={selectedTrip.country}
                    tripEndDate={selectedTrip.endDate}
                    resolvedPointCoords={resolvedPointCoords}
                    cameraFingerprint={mapCameraFingerprint}
                  />
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold">Stay route order</p>
                  <ol className="mt-2 space-y-1 text-sm text-neutral-700 list-decimal list-inside">
                    {stays.length === 0 ? <li className="text-neutral-500">No stays added yet.</li> : null}
                    {stays.map((s) => {
                      const cinT = (s.checkInTime ?? '').trim()
                      const coutT = (s.checkOutTime ?? '').trim()
                      const cinOk = cinT && parseTimeToMinutes(cinT) !== null
                      const coutOk = coutT && parseTimeToMinutes(coutT) !== null
                      const timeSuffix =
                        cinOk || coutOk
                          ? ` · ${[cinOk ? `in ${normalizeHhMmTime(cinT)}` : '', coutOk ? `out ${normalizeHhMmTime(coutT)}` : '']
                              .filter(Boolean)
                              .join(', ')}`
                          : ''
                      return (
                        <li key={s.id}>
                          {s.location}{' '}
                          {s.startDate || s.endDate ? `(${formatDateRangeLabel(s.startDate, s.endDate)}${timeSuffix})` : ''}
                        </li>
                      )
                    })}
                  </ol>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold">Key locations</p>
                  <ul className="mt-2 space-y-1 text-sm text-neutral-700">
                    {mapPoints.length === 0 ? <li className="text-neutral-500">No map locations available.</li> : null}
                    {mapPoints.slice(0, 16).map((p) => (
                      <li key={p.key}>
                        <span className="font-medium">{MAP_CATEGORY_LABELS[p.category]}:</span> {p.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tips' && (
          <div className="animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-lg p-4 sm:p-8 border border-neutral-100">
              <h2 className="text-3xl font-serif font-bold">Tips</h2>
              <p className="text-neutral-500 mt-2">Coming next. This area can host packing, timing, and safety notes.</p>
            </div>
          </div>
        )}
        </main>
        </div>
      </div>

      <footer className="relative z-10 bg-neutral-900 text-white/50 py-10 px-4 text-center text-sm">
        <p className="mb-2">{BRAND_FOOTER_TAGLINE}</p>
        <p>Local-first • Saved in your browser</p>
      </footer>
    </div>
    <p
      className="pointer-events-none fixed bottom-3 right-3 z-[200] max-w-[min(100vw-1.5rem,20rem)] select-text truncate rounded-md border border-white/15 bg-neutral-950/85 px-2 py-1 text-[10px] tabular-nums text-white shadow-lg backdrop-blur-sm dark:border-white/20"
      aria-label="Application build"
      title={APP_BUILD}
    >
      Build {APP_BUILD}
    </p>
    </>
  )
}


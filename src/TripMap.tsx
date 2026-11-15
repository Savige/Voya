import { useEffect, useRef, useState } from 'react'
import { Globe2, Map as MapIcon, Satellite, Square } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createFresnelAtmosphereLayer, FRESNEL_LAYER_ID } from './globeFresnelLayer'
import { ensureMapImages } from './mapIcons'
import type { MapCategory, MapPoint } from './mapItinerary'
import {
  buildLegGeometries,
  buildTripRoute,
  greatCircleLine,
  midpointAlongLine,
  peekLegGeometries,
} from './mapTripRoute'
import type { CarBooking, FlightBooking, RestaurantBooking, Stay, VisitPlace } from './tripTypes'
import type { LightSpecification, SkySpecification } from 'maplibre-gl'

type BasemapMode = 'streets' | 'satellite'
type ProjectionMode = 'flat' | 'globe'

/** Even viewport light — no day/night, no sun-scatter wash. */
const EVEN_LIGHT: LightSpecification = {
  anchor: 'viewport',
  color: '#ffffff',
  intensity: 0.7,
  position: [1.15, 210, 30],
}

/**
 * Native MapLibre atmosphere is sun-scattering (washes the whole disk blue when
 * lit face-on). Keep it off — Fresnel rim is the custom wp-fresnel-atmosphere layer.
 */
const GLOBE_RIM_SKY: SkySpecification = {
  'sky-color': '#000814',
  'horizon-color': '#000814',
  'fog-color': '#000814',
  'fog-ground-blend': 1,
  'horizon-fog-blend': 0,
  'sky-horizon-blend': 0,
  'atmosphere-blend': 0,
}

/** Flat streets — light map chrome. fog-ground-blend must stay 0 or mercator milks rasters. */
const FLAT_STREETS_SKY: SkySpecification = {
  'sky-color': '#c5d6e6',
  'horizon-color': '#c5d6e6',
  'fog-color': '#c5d6e6',
  'fog-ground-blend': 0,
  'horizon-fog-blend': 0,
  'sky-horizon-blend': 0,
  'atmosphere-blend': 0,
}

/** Flat satellite — same: zero fog blend so Sentinel tiles stay crisp. */
const FLAT_SATELLITE_SKY: SkySpecification = {
  'sky-color': '#c5d6e6',
  'horizon-color': '#c5d6e6',
  'fog-color': '#c5d6e6',
  'fog-ground-blend': 0,
  'horizon-fog-blend': 0,
  'sky-horizon-blend': 0,
  'atmosphere-blend': 0,
}

/** Bumps on each presentation so stale style.load/idle retries can't re-apply old flat fog. */
let satellitePresentationGen = 0

/**
 * Both basemaps in one style — Streets ↔ Satellite toggles visibility only.
 * Avoids setStyle wiping Fresnel, overlays, and cached tiles on every swap.
 * Note: do NOT enable 3D `terrain` — HTML/geo markers drift vs the mesh on globe zoom.
 */
function combinedBasemapStyle(initial: BasemapMode): maplibregl.StyleSpecification {
  const streetsOn = initial === 'streets'
  return {
    version: 8,
    // Number badges on pins — demotiles serves Noto Sans (Open Sans Regular 404s and can blank the style).
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap',
        maxzoom: 19,
      },
      satellite: {
        type: 'raster',
        tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
        tileSize: 256,
        attribution: 'EOX Sentinel-2 (CC BY 4.0)',
        maxzoom: 14,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        // Opaque globe disk so stars never show through unloaded tiles.
        paint: { 'background-color': '#071018', 'background-opacity': 1 },
      },
      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        // Always present under OSM on globe Streets so the disk stays opaque.
        layout: { visibility: 'visible' },
        paint: {
          'raster-contrast': 0.14,
          'raster-saturation': 0.1,
          'raster-brightness-min': 0.04,
          'raster-brightness-max': 0.96,
        },
      },
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        layout: { visibility: streetsOn ? 'visible' : 'none' },
        paint: { 'raster-opacity': 1 },
      },
    ],
    sky: GLOBE_RIM_SKY,
    light: EVEN_LIGHT,
  }
}

const ROUTE_FLIGHT_SRC = 'wp-route-flight'
const ROUTE_DRIVE_SRC = 'wp-route-drive'
const ROUTE_ICONS_SRC = 'wp-route-icons'
const STOPS_SRC = 'wp-stops'
const POI_SRC = 'wp-poi'
const STOPS_HIT = 'wp-stops-hit'
const STOPS_CIRCLE = 'wp-stops-circle'
const STOPS_NUM = 'wp-stops-num'
const STOPS_LABEL = 'wp-stops-label'
const AIRPORT_BADGE = 'wp-airport-badge'
const AIRPORT_CITY = 'wp-airport-city'
const POI_CIRCLE = 'wp-poi-circle'
/** Numbered pin disc radius (px). Plane/car sprites are 40 CSS px in mapIcons. */
const STOP_PIN_RADIUS = 11
const ROUTE_ICON_SPRITE_CSS = 40
/** Match numbered pin diameter so white badges stay readable on satellite. */
const ROUTE_ICON_SIZE = (STOP_PIN_RADIUS * 2) / ROUTE_ICON_SPRITE_CSS

function dottedLinePaint(basemap: BasemapMode) {
  // White vanishes on OSM streets — use dark ink there.
  return basemap === 'satellite'
    ? {
        'line-color': '#ffffff',
        'line-width': 2.1,
        'line-dasharray': [0.8, 1.6],
        'line-opacity': 0.92,
      }
    : {
        'line-color': '#0f172a',
        'line-width': 2.4,
        'line-dasharray': [0.8, 1.5],
        'line-opacity': 0.88,
      }
}

function applyProjection(map: maplibregl.Map, mode: ProjectionMode) {
  try {
    map.setProjection({ type: mode === 'globe' ? 'globe' : 'mercator' })
  } catch (err) {
    console.warn('[TripMap] setProjection skipped', err)
  }
}

/** Toggle Streets/Satellite without setStyle — keeps Fresnel + overlays alive. */
function setBasemapVisibility(map: maplibregl.Map, basemap: BasemapMode, projection: ProjectionMode = 'globe') {
  const streets = basemap === 'streets'
  const globe = projection === 'globe'
  if (map.getLayer('osm')) {
    map.setLayoutProperty('osm', 'visibility', streets ? 'visible' : 'none')
  }
  if (map.getLayer('satellite')) {
    // Globe + Streets: leave satellite under OSM so the sphere stays opaque
    // (OSM alone can leave the disk translucent and stars show through).
    const showSat = !streets || globe
    map.setLayoutProperty('satellite', 'visibility', showSat ? 'visible' : 'none')
  }
}

/**
 * Globe chrome (stars + Fresnel rim) for both Satellite and Streets.
 * Flat = no rim. Always rewrite sky + satellite paint so flat fog/brightness
 * cannot stick after Flat Streets → Satellite / Globe.
 */
function applyBasemapPresentation(
  map: maplibregl.Map,
  basemap: BasemapMode,
  projection: ProjectionMode,
  opts?: { remountFresnel?: boolean },
) {
  const gen = ++satellitePresentationGen
  if (!map.isStyleLoaded()) {
    map.once('idle', () => {
      if (gen !== satellitePresentationGen) return
      applyBasemapPresentation(map, basemap, projection, opts)
    })
    return
  }
  try {
    const globe = projection === 'globe'
    setBasemapVisibility(map, basemap, projection)

    if (map.getLayer('background')) {
      // Globe: opaque disk (stars only in space). Flat streets: transparent; flat sat: fill.
      if (globe) {
        map.setPaintProperty(
          'background',
          'background-color',
          basemap === 'streets' ? '#b9d2e0' : '#071018',
        )
        map.setPaintProperty('background', 'background-opacity', 1)
      } else {
        map.setPaintProperty('background', 'background-color', '#c5d6e6')
        map.setPaintProperty('background', 'background-opacity', basemap === 'satellite' ? 1 : 0)
      }
    }
    if (map.getLayer('satellite')) {
      // Never lift blacks on flat (0.18 was the milky wash after Flat Streets → Satellite).
      map.setPaintProperty('satellite', 'raster-brightness-min', globe ? 0.04 : 0)
      map.setPaintProperty('satellite', 'raster-brightness-max', globe ? 0.96 : 1)
      map.setPaintProperty('satellite', 'raster-contrast', globe ? 0.14 : 0.12)
      map.setPaintProperty('satellite', 'raster-saturation', globe ? 0.1 : 0.08)
      map.setPaintProperty('satellite', 'raster-opacity', 1)
    }
    if (map.getLayer('osm')) {
      map.setPaintProperty('osm', 'raster-opacity', 1)
    }
    map.setLight(EVEN_LIGHT)
    try {
      const sky = globe
        ? GLOBE_RIM_SKY
        : basemap === 'satellite'
          ? FLAT_SATELLITE_SKY
          : FLAT_STREETS_SKY
      map.setSky(sky)
    } catch {
      /* sky optional on some builds */
    }
    syncFresnelLayer(map, globe, Boolean(opts?.remountFresnel))
    try {
      map.triggerRepaint()
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn('[TripMap] basemap presentation skipped', err)
  }
}

/** Keep Fresnel above osm/satellite so opaque tiles don't erase the rim. */
function placeFresnelAboveBasemap(map: maplibregl.Map) {
  if (!map.getLayer(FRESNEL_LAYER_ID)) return
  const underOverlays = [
    'wp-route-flight-line',
    'wp-route-drive-line',
    STOPS_HIT,
    STOPS_CIRCLE,
    STOPS_LABEL,
    AIRPORT_BADGE,
  ].find((id) => map.getLayer(id))
  try {
    if (underOverlays) map.moveLayer(FRESNEL_LAYER_ID, underOverlays)
    else map.moveLayer(FRESNEL_LAYER_ID) // top of stack
  } catch {
    /* ignore */
  }
}

function syncFresnelLayer(map: maplibregl.Map, globe: boolean, remount = false) {
  try {
    if (!globe) {
      if (map.getLayer(FRESNEL_LAYER_ID)) map.removeLayer(FRESNEL_LAYER_ID)
      return
    }
    if (!map.isStyleLoaded()) return

    // Remount after Flat→Globe so the rim isn't left dead from the flat strip.
    // Streets ↔ Satellite (stay on globe) keeps the existing layer.
    if (remount && map.getLayer(FRESNEL_LAYER_ID)) {
      map.removeLayer(FRESNEL_LAYER_ID)
    }
    if (!map.getLayer(FRESNEL_LAYER_ID)) {
      map.addLayer(createFresnelAtmosphereLayer(() => map))
    }
    placeFresnelAboveBasemap(map)
  } catch (err) {
    console.warn('[TripMap] fresnel layer skipped', err)
  }
}

/** Widest framing — Earth ~⅓ of the map height; cannot zoom out past this. */
const MAP_MIN_ZOOM = 1.2
const MAP_DEFAULT_ZOOM = 1.2

/** Keep pitch at 0 so the globe stays centered in the starfield while Earth rotates under the camera. */
function focusTripBounds(
  map: maplibregl.Map,
  points: Array<{ lat: number; lon: number }>,
  duration = 1600,
) {
  if (points.length === 0) {
    map.easeTo({ center: [0, 18], zoom: MAP_DEFAULT_ZOOM, bearing: 0, pitch: 0, duration })
    return
  }
  if (points.length === 1) {
    map.flyTo({
      center: [points[0].lon, points[0].lat],
      zoom: 5.5,
      bearing: 0,
      pitch: 0,
      duration,
      essential: true,
    })
    return
  }
  const bounds = new maplibregl.LngLatBounds()
  for (const p of points) bounds.extend([p.lon, p.lat])
  // fitBounds with pitch offsets the sphere in globe mode — ease to centroid + zoom instead.
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const center: [number, number] = [(ne.lng + sw.lng) / 2, (ne.lat + sw.lat) / 2]
  const latSpan = Math.max(0.5, Math.abs(ne.lat - sw.lat))
  const lngSpan = Math.max(0.5, Math.abs(ne.lng - sw.lng))
  const span = Math.max(latSpan, lngSpan * Math.cos((center[1] * Math.PI) / 180))
  const zoom = Math.max(MAP_MIN_ZOOM, Math.min(6.8, Math.log2(360 / span) - 0.35))
  map.flyTo({
    center,
    zoom,
    bearing: 0,
    pitch: 0,
    duration,
    essential: true,
  })
}

function focusMarker(map: maplibregl.Map, lon: number, lat: number) {
  map.flyTo({
    center: [lon, lat],
    zoom: 5.8,
    pitch: 0,
    bearing: 0,
    duration: 1700,
    essential: true,
  })
}

type Props = {
  active: boolean
  mapPoints: MapPoint[]
  mapCategoryVisible: Record<MapCategory, boolean>
  stays: Stay[]
  visitPlaces: VisitPlace[]
  flights: FlightBooking[]
  rentalCars: CarBooking[]
  restaurants: RestaurantBooking[]
  country: string
  tripEndDate?: string
  /** Extra session coords for points missing lat/lon */
  resolvedPointCoords: Record<string, { lat: number; lon: number }>
  cameraFingerprint: string
  /** Page-level starfield blooms behind Earth — hide the local canvas when true. */
  pageStarfield?: boolean
  /** Page star bloom progress 0–1; at 1 the globe recenters on the trip. */
  skyLit?: number
  /** Notify App when globe chrome (stars + transparent page) should be active. */
  onGlobeChromeChange?: (active: boolean) => void
  /** Streets vs satellite — starfield planets/moon recolor with Streets chrome. */
  onBasemapChange?: (mode: BasemapMode) => void
  /** When set, fly the camera to this stay pin once the map is ready. */
  focusStayId?: string | null
  /** Called after a focusStayId fly completes (or cannot resolve). */
  onFocusStayConsumed?: () => void
}

export function TripMap({
  active,
  mapPoints,
  mapCategoryVisible,
  stays,
  visitPlaces: _visitPlaces,
  flights,
  rentalCars: _rentalCars,
  restaurants: _restaurants,
  country: _country,
  tripEndDate: _tripEndDate,
  resolvedPointCoords,
  cameraFingerprint,
  pageStarfield = false,
  skyLit = 0,
  onGlobeChromeChange,
  onBasemapChange,
  focusStayId = null,
  onFocusStayConsumed,
}: Props) {
  void _country
  void _tripEndDate
  void _visitPlaces
  void _rentalCars
  void _restaurants
  const shellRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const visibleCoordsRef = useRef<Array<{ lat: number; lon: number }>>([])
  const basemapRef = useRef<BasemapMode>('satellite')
  const projectionRef = useRef<ProjectionMode>('globe')
  const focusedFingerprintRef = useRef<string>('')
  /** One intro focus per Map-tab mount — never fight the user or Flat→Globe. */
  const autoFocusDoneRef = useRef(false)
  /** After the page star bloom settles, fly back to the trip once. */
  const bloomRecenterDoneRef = useRef(false)
  const programmaticMoveRef = useRef(false)
  const userMovedRef = useRef(false)
  const onFocusStayConsumedRef = useRef(onFocusStayConsumed)
  onFocusStayConsumedRef.current = onFocusStayConsumed
  const focusStayIdRef = useRef(focusStayId)
  focusStayIdRef.current = focusStayId
  const [basemap, setBasemap] = useState<BasemapMode>('satellite')
  const [projection, setProjection] = useState<ProjectionMode>('globe')
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [showRecenter, setShowRecenter] = useState(false)
  basemapRef.current = basemap
  projectionRef.current = projection
  // Stars + Fresnel rim whenever Globe is on (Satellite or Streets).
  const showStarfield = projection === 'globe'
  void pageStarfield

  useEffect(() => {
    onGlobeChromeChange?.(Boolean(active && showStarfield))
    return () => onGlobeChromeChange?.(false)
  }, [active, showStarfield, onGlobeChromeChange])

  useEffect(() => {
    onBasemapChange?.(basemap)
  }, [basemap, onBasemapChange])

  const flyToTrip = (duration = 1600) => {
    const map = mapRef.current
    if (!map || visibleCoordsRef.current.length === 0) return
    programmaticMoveRef.current = true
    setShowRecenter(false)
    const focusKey = cameraFingerprint || `n:${visibleCoordsRef.current.length}`
    focusedFingerprintRef.current = focusKey
    focusTripBounds(map, visibleCoordsRef.current, duration)
  }

  const resolveStayCoords = (stayId: string): { lat: number; lon: number } | null => {
    const key = `stay:${stayId}`
    const fromPoint = mapPoints.find((p) => p.key === key)
    if (typeof fromPoint?.lat === 'number' && typeof fromPoint?.lon === 'number') {
      return { lat: fromPoint.lat, lon: fromPoint.lon }
    }
    const fb = resolvedPointCoords[key]
    if (fb) return fb
    const stay = stays.find((s) => s.id === stayId)
    if (typeof stay?.lat === 'number' && typeof stay?.lon === 'number') {
      return { lat: stay.lat, lon: stay.lon }
    }
    return null
  }

  useEffect(() => {
    if (!active || !focusStayId) return
    let cancelled = false
    let attempts = 0

    const tryFocus = () => {
      if (cancelled) return
      const map = mapRef.current
      if (!map) {
        attempts += 1
        if (attempts < 12) {
          window.setTimeout(tryFocus, 120)
        } else {
          onFocusStayConsumedRef.current?.()
        }
        return
      }
      const coords = resolveStayCoords(focusStayId)
      if (!coords) {
        // Coords may still be geocoding — retry briefly, then give up.
        attempts += 1
        if (attempts < 12) {
          window.setTimeout(tryFocus, 160)
        } else {
          onFocusStayConsumedRef.current?.()
        }
        return
      }
      programmaticMoveRef.current = true
      setShowRecenter(false)
      userMovedRef.current = false
      focusMarker(map, coords.lon, coords.lat)
      onFocusStayConsumedRef.current?.()
    }

    // Style / markers may still be painting when switching tabs.
    const t = window.setTimeout(tryFocus, 280)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
    // resolveStayCoords closes over latest mapPoints / stays / resolvedPointCoords
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusStayId, mapPoints, resolvedPointCoords, stays, styleEpoch])

  useEffect(() => {
    if (!active || !containerRef.current) return
    if (mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: combinedBasemapStyle(basemapRef.current),
      center: [0, 18],
      zoom: MAP_DEFAULT_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      attributionControl: { compact: true },
    })
    // Zoom / compass hidden — pinch, scroll, and Recenter cover navigation.
    const paintAfterStyle = () => {
      try {
        map.setTerrain(null)
        applyProjection(map, projectionRef.current)
        applyBasemapPresentation(map, basemapRef.current, projectionRef.current)
      } catch (err) {
        console.warn('[TripMap] style paint skipped', err)
      }
    }
    map.on('load', () => {
      try {
        // Never enable 3D terrain — it desyncs overlays from the globe during zoom.
        paintAfterStyle()
        setStyleEpoch((n) => n + 1)
        if (map.isStyleLoaded()) map.resize()
        map.once('idle', () => {
          paintAfterStyle()
          setStyleEpoch((n) => n + 1)
        })
      } catch (err) {
        console.warn('[TripMap] load handler skipped', err)
      }
    })
    // Rare full style reloads only — Streets ↔ Satellite no longer calls setStyle.
    map.on('style.load', () => {
      try {
        paintAfterStyle()
        requestAnimationFrame(() => {
          paintAfterStyle()
          setStyleEpoch((n) => n + 1)
        })
        map.once('idle', () => {
          paintAfterStyle()
          setStyleEpoch((n) => n + 1)
        })
      } catch (err) {
        console.warn('[TripMap] style.load handler skipped', err)
      }
    })
    mapRef.current = map
    ;(window as unknown as { __waypointMap?: maplibregl.Map }).__waypointMap = map

    return () => {
      popupRef.current?.remove()
      popupRef.current = null
      const win = window as unknown as { __waypointMap?: maplibregl.Map }
      if (win.__waypointMap === map) delete win.__waypointMap
      map.remove()
      mapRef.current = null
    }
  }, [active])

  useEffect(() => {
    const map = mapRef.current
    const shell = shellRef.current
    if (!active || !map || !shell) return

    const safeResize = () => {
      try {
        if (!map.isStyleLoaded()) return
        map.resize()
      } catch (err) {
        console.warn('[TripMap] resize skipped', err)
      }
    }

    // Only resize once the style is ready — early resize triggered the black-screen crash.
    if (map.isStyleLoaded()) safeResize()
    else map.once('load', safeResize)

    // Keep MapLibre's canvas-container matched to the shell (h-full alone can collapse to 0).
    const ro = new ResizeObserver(() => safeResize())
    ro.observe(shell)
    return () => ro.disconnect()
  }, [active])

  const basemapMountedRef = useRef(false)
  const projectionMountedRef = useRef(false)

  // Streets ↔ Satellite: visibility only — Fresnel, overlays, and tiles stay warm.
  useEffect(() => {
    const map = mapRef.current
    if (!active || !map) return
    if (!basemapMountedRef.current) {
      basemapMountedRef.current = true
      return
    }
    if (!map.isStyleLoaded()) return
    applyBasemapPresentation(map, basemap, projectionRef.current)
    // Route line colors differ per basemap — nudge overlay paint without style reload.
    setStyleEpoch((n) => n + 1)
  }, [active, basemap])

  // Flat ↔ Globe keeps the same style/overlays — only swaps projection + lighting.
  // Do not auto-recenter when selecting Globe (user asked to keep their framing).
  useEffect(() => {
    const map = mapRef.current
    if (!active || !map) return
    if (!projectionMountedRef.current) {
      projectionMountedRef.current = true
      return
    }
    applyProjection(map, projection)
    if (!map.isStyleLoaded()) return
    // Remount Fresnel when entering globe so Flat→Globe always restores atmosphere.
    applyBasemapPresentation(map, basemapRef.current, projection, {
      remountFresnel: projection === 'globe',
    })
    // Projection transform can lag one frame — re-assert sky/paint/rim after it settles.
    const gen = satellitePresentationGen
    requestAnimationFrame(() => {
      if (gen !== satellitePresentationGen || !mapRef.current) return
      applyBasemapPresentation(map, basemapRef.current, projection, {
        remountFresnel: projection === 'globe',
      })
    })
  }, [active, projection])

  useEffect(() => {
    if (!active) {
      basemapMountedRef.current = false
      projectionMountedRef.current = false
      focusedFingerprintRef.current = ''
      autoFocusDoneRef.current = false
      bloomRecenterDoneRef.current = false
      userMovedRef.current = false
      programmaticMoveRef.current = false
      setShowRecenter(false)
      return
    }
    // Opening the Map tab: allow one intro focus animation.
    focusedFingerprintRef.current = ''
    autoFocusDoneRef.current = false
    bloomRecenterDoneRef.current = false
    userMovedRef.current = false
  }, [active])

  // Recenter once the bloom has been running ~2s (skyLit → 1); no extra post-wait.
  useEffect(() => {
    if (!active || !pageStarfield) return
    if (skyLit < 1) {
      if (skyLit <= 0) bloomRecenterDoneRef.current = false
      return
    }
    if (projection !== 'globe') return
    if (bloomRecenterDoneRef.current || userMovedRef.current) return
    const map = mapRef.current
    if (!map || visibleCoordsRef.current.length === 0) return
    bloomRecenterDoneRef.current = true
    autoFocusDoneRef.current = true
    programmaticMoveRef.current = true
    setShowRecenter(false)
    requestAnimationFrame(() => {
      const m = mapRef.current
      if (!m || userMovedRef.current) return
      try {
        if (m.isStyleLoaded()) m.resize()
      } catch {
        /* ignore */
      }
      programmaticMoveRef.current = true
      focusTripBounds(m, visibleCoordsRef.current, 1600)
    })
  }, [active, pageStarfield, projection, skyLit])

  // Google Maps–style Recenter: only after the user pans/zooms away from the trip framing.
  // Programmatic flyTo/easeTo also emit zoom/rotate/pitch start — ignore those (no originalEvent).
  useEffect(() => {
    const map = mapRef.current
    if (!active || !map) return

    const onUserGesture = (e: { originalEvent?: Event }) => {
      if (programmaticMoveRef.current) return
      if (!e.originalEvent) return
      // Interrupting the intro fly counts as user control — never auto-fly again.
      userMovedRef.current = true
      autoFocusDoneRef.current = true
    }
    const onMoveEnd = () => {
      if (programmaticMoveRef.current) {
        programmaticMoveRef.current = false
        return
      }
      if (userMovedRef.current) setShowRecenter(true)
    }

    map.on('dragstart', onUserGesture)
    map.on('zoomstart', onUserGesture)
    map.on('rotatestart', onUserGesture)
    map.on('pitchstart', onUserGesture)
    map.on('moveend', onMoveEnd)
    return () => {
      map.off('dragstart', onUserGesture)
      map.off('zoomstart', onUserGesture)
      map.off('rotatestart', onUserGesture)
      map.off('pitchstart', onUserGesture)
      map.off('moveend', onMoveEnd)
    }
  }, [active, styleEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (!active || !map) return
    let cancelled = false

    const resolved = mapPoints
      .map((p) => {
        if (typeof p.lat === 'number' && typeof p.lon === 'number') return { ...p, lat: p.lat, lon: p.lon }
        const fallback = resolvedPointCoords[p.key]
        if (fallback) return { ...p, lat: fallback.lat, lon: fallback.lon }
        return null
      })
      .filter((p): p is MapPoint & { lat: number; lon: number } => Boolean(p))

    // Optional category pins (places / dining / etc.) — not the main numbered route.
    const poiResolved = resolved.filter(
      (p) =>
        mapCategoryVisible[p.category] &&
        p.category !== 'accommodation' &&
        p.category !== 'flight',
    )

    // Route builder reads stay.lat/lon — hydrate from geocode cache when missing.
    const staysWithCoords = stays.map((s) => {
      if (typeof s.lat === 'number' && typeof s.lon === 'number') return s
      const fb = resolvedPointCoords[`stay:${s.id}`]
      if (fb) return { ...s, lat: fb.lat, lon: fb.lon }
      return s
    })
    const polar = buildTripRoute(staysWithCoords, flights) // route geometry for map overlays
    visibleCoordsRef.current = polar.markers.map((m) => ({ lat: m.lat, lon: m.lon }))

    type Fc = {
      type: 'FeatureCollection'
      features: Array<{
        type: 'Feature'
        properties: Record<string, string | number>
        geometry:
          | { type: 'LineString'; coordinates: Array<[number, number]> }
          | { type: 'Point'; coordinates: [number, number] }
      }>
    }

    const setOrAddLine = (sourceId: string, layerId: string, lines: Array<[number, number]>[]) => {
      const geo: Fc = {
        type: 'FeatureCollection',
        features: lines
          .filter((c) => c.length >= 2)
          .map((coordinates) => ({
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'LineString' as const, coordinates },
          })),
      }
      const paint = dottedLinePaint(basemapRef.current)
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
      if (src) {
        src.setData(geo)
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'line-color', paint['line-color'])
          map.setPaintProperty(layerId, 'line-width', paint['line-width'])
          map.setPaintProperty(layerId, 'line-opacity', paint['line-opacity'])
        }
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geo })
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint,
        })
      }
    }

    const setOrAddGeo = (sourceId: string, data: Fc) => {
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(data)
      else map.addSource(sourceId, { type: 'geojson', data })
    }

    const ensureStopLayers = () => {
      // Layer order + symbol-sort-key control collision:
      // numbered circles always win; location bubbles beat transport icons;
      // departure/arrival IATA badges stay visible.
      if (!map.getLayer(STOPS_HIT)) {
        map.addLayer({
          id: STOPS_HIT,
          type: 'circle',
          source: STOPS_SRC,
          filter: ['==', ['get', 'kind'], 'stop'],
          paint: { 'circle-radius': 20, 'circle-opacity': 0 },
        })
      }
      if (!map.getLayer(STOPS_CIRCLE)) {
        map.addLayer({
          id: STOPS_CIRCLE,
          type: 'circle',
          source: STOPS_SRC,
          filter: ['==', ['get', 'kind'], 'stop'],
          paint: {
            'circle-radius': STOP_PIN_RADIUS,
            'circle-color': '#1e3a5f',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 1,
          },
        })
      }
      if (!map.getLayer(STOPS_NUM)) {
        map.addLayer({
          id: STOPS_NUM,
          type: 'symbol',
          source: STOPS_SRC,
          filter: ['==', ['get', 'kind'], 'stop'],
          layout: {
            'text-field': ['get', 'index'],
            'text-size': 12,
            'text-font': ['Noto Sans Regular'],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-anchor': 'center',
          },
          paint: { 'text-color': '#ffffff' },
        })
      }

      // Transport icons first in the stack (drawn under labels); collide away first.
      if (!map.getLayer('wp-route-icons-sym')) {
        map.addLayer({
          id: 'wp-route-icons-sym',
          type: 'symbol',
          source: ROUTE_ICONS_SRC,
          minzoom: 4,
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ROUTE_ICON_SIZE,
            'icon-rotate': 0,
            'icon-rotation-alignment': 'viewport',
            'icon-pitch-alignment': 'viewport',
            'icon-allow-overlap': false,
            'icon-ignore-placement': false,
            'icon-padding': 8,
            'symbol-sort-key': 80,
          },
        })
      } else {
        map.setLayoutProperty('wp-route-icons-sym', 'icon-size', ROUTE_ICON_SIZE)
        map.setLayoutProperty('wp-route-icons-sym', 'icon-rotate', 0)
        map.setLayoutProperty('wp-route-icons-sym', 'icon-rotation-alignment', 'viewport')
        map.setLayoutProperty('wp-route-icons-sym', 'icon-pitch-alignment', 'viewport')
        map.setLayoutProperty('wp-route-icons-sym', 'icon-allow-overlap', false)
        map.setLayoutProperty('wp-route-icons-sym', 'icon-ignore-placement', false)
        map.setLayoutProperty('wp-route-icons-sym', 'icon-padding', 8)
        map.setLayoutProperty('wp-route-icons-sym', 'symbol-sort-key', 80)
        map.setLayerZoomRange('wp-route-icons-sym', 4, 24)
      }

      // Origin / final airport badges — always kept.
      if (!map.getLayer(AIRPORT_BADGE)) {
        map.addLayer({
          id: AIRPORT_BADGE,
          type: 'symbol',
          source: STOPS_SRC,
          filter: ['==', ['get', 'kind'], 'airport'],
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-font': ['Noto Sans Regular'],
            'text-anchor': 'center',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'icon-image': 'wp-iata-badge',
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [5, 9, 5, 9],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'symbol-sort-key': 5,
          },
          paint: { 'text-color': '#ffffff' },
        })
      }
      if (!map.getLayer(AIRPORT_CITY)) {
        map.addLayer({
          id: AIRPORT_CITY,
          type: 'symbol',
          source: STOPS_SRC,
          filter: ['==', ['get', 'kind'], 'airport'],
          minzoom: 3.5,
          layout: {
            'text-field': ['get', 'cityLabel'],
            'text-size': 11,
            'text-font': ['Noto Sans Regular'],
            'text-anchor': 'top',
            'text-offset': [0, 1.15],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-optional': true,
            'text-padding': 6,
            'symbol-sort-key': 20,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(2,6,14,0.75)',
            'text-halo-width': 1.2,
          },
        })
      } else {
        map.setLayoutProperty(AIRPORT_CITY, 'text-allow-overlap', false)
        map.setLayoutProperty(AIRPORT_CITY, 'text-ignore-placement', false)
        map.setLayoutProperty(AIRPORT_CITY, 'text-optional', true)
        map.setLayoutProperty(AIRPORT_CITY, 'symbol-sort-key', 20)
        map.setLayerZoomRange(AIRPORT_CITY, 3.5, 24)
      }

      // Location name bubbles — collide; beat transport icons; hide when packed.
      if (!map.getLayer(STOPS_LABEL)) {
        map.addLayer({
          id: STOPS_LABEL,
          type: 'symbol',
          source: STOPS_SRC,
          filter: ['==', ['get', 'kind'], 'stop'],
          minzoom: 3,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-font': ['Noto Sans Regular'],
            'text-anchor': 'bottom',
            'text-offset': [0, -1.75],
            'text-max-width': 10,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'icon-image': 'wp-label-pill',
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [6, 12, 6, 12],
            'icon-anchor': 'bottom',
            'icon-allow-overlap': false,
            'icon-ignore-placement': false,
            'icon-padding': 2,
            'text-padding': 2,
            'text-optional': true,
            'symbol-sort-key': ['get', 'sortKey'],
          },
          paint: { 'text-color': '#0f172a' },
        })
      } else {
        map.setLayoutProperty(STOPS_LABEL, 'text-size', 11)
        map.setLayoutProperty(STOPS_LABEL, 'text-offset', [0, -1.75])
        map.setLayoutProperty(STOPS_LABEL, 'text-allow-overlap', false)
        map.setLayoutProperty(STOPS_LABEL, 'text-ignore-placement', false)
        map.setLayoutProperty(STOPS_LABEL, 'text-optional', true)
        map.setLayoutProperty(STOPS_LABEL, 'icon-text-fit', 'both')
        map.setLayoutProperty(STOPS_LABEL, 'icon-text-fit-padding', [6, 12, 6, 12])
        map.setLayoutProperty(STOPS_LABEL, 'icon-allow-overlap', false)
        map.setLayoutProperty(STOPS_LABEL, 'icon-ignore-placement', false)
        map.setLayoutProperty(STOPS_LABEL, 'symbol-sort-key', ['get', 'sortKey'])
        try {
          map.setLayoutProperty(STOPS_LABEL, 'icon-offset', undefined as unknown as [number, number])
        } catch {
          /* older styles may not have icon-offset */
        }
        map.setLayerZoomRange(STOPS_LABEL, 3, 24)
      }

      // Keep numbered circles + labels above transport icons.
      // moveLayer(id, beforeId) inserts below beforeId — must use STOPS_CIRCLE,
      // not STOPS_LABEL, or car/plane sprites cover number badges.
      if (map.getLayer('wp-route-icons-sym') && map.getLayer(STOPS_CIRCLE)) {
        try {
          map.moveLayer('wp-route-icons-sym', STOPS_CIRCLE)
        } catch {
          /* ignore */
        }
      }

      if (!map.getLayer(POI_CIRCLE) && map.getSource(POI_SRC)) {
        map.addLayer({
          id: POI_CIRCLE,
          type: 'circle',
          source: POI_SRC,
          minzoom: 5,
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#1e3a5f',
            'circle-opacity': 0.92,
          },
        })
      }
    }

    const paintSync = (flightLines: Array<[number, number]>[], driveLines: Array<[number, number]>[]) => {
      try {
        ensureMapImages(map)
        setOrAddLine(ROUTE_FLIGHT_SRC, `${ROUTE_FLIGHT_SRC}-line`, flightLines)
        setOrAddLine(ROUTE_DRIVE_SRC, `${ROUTE_DRIVE_SRC}-line`, driveLines)

        const iconFeatures: Fc['features'] = []
        for (const line of flightLines) {
          const mid = midpointAlongLine(line)
          if (!mid) continue
          iconFeatures.push({
            type: 'Feature',
            properties: { icon: 'wp-plane' },
            geometry: { type: 'Point', coordinates: mid.coord },
          })
        }
        for (const line of driveLines) {
          const mid = midpointAlongLine(line)
          if (!mid) continue
          iconFeatures.push({
            type: 'Feature',
            properties: { icon: 'wp-car' },
            geometry: { type: 'Point', coordinates: mid.coord },
          })
        }
        setOrAddGeo(ROUTE_ICONS_SRC, { type: 'FeatureCollection', features: iconFeatures })

        const stopFeatures: Fc['features'] = polar.markers.map((m) => ({
          type: 'Feature' as const,
          properties: {
            id: m.id,
            kind: m.kind,
            index: m.index != null ? String(m.index) : '',
            // Lower sort-key wins collision — prefer earlier itinerary stops' labels.
            sortKey: m.index != null ? m.index : 50,
            label: m.label,
            cityLabel: m.cityLabel ?? '',
          },
          geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] as [number, number] },
        }))
        setOrAddGeo(STOPS_SRC, { type: 'FeatureCollection', features: stopFeatures })

        const poiFeatures: Fc['features'] = poiResolved.map((p) => ({
          type: 'Feature' as const,
          properties: { key: p.key, label: p.label },
          geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
        }))
        setOrAddGeo(POI_SRC, { type: 'FeatureCollection', features: poiFeatures })

        ensureStopLayers()
        if (projectionRef.current === 'globe') {
          placeFresnelAboveBasemap(map)
        }
      } catch (err) {
        console.warn('[TripMap] paint failed', err)
      }
    }

    const onPinClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const [lon, lat] = f.geometry.coordinates as [number, number]
      const label = String(f.properties?.label || f.properties?.cityLabel || '')
      popupRef.current?.remove()
      popupRef.current = new maplibregl.Popup({ offset: 14, closeButton: true })
        .setLngLat([lon, lat])
        .setText(label)
        .addTo(map)
      programmaticMoveRef.current = true
      focusMarker(map, lon, lat)
      setShowRecenter(true)
    }

    const setPointer = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const clearPointer = () => {
      map.getCanvas().style.cursor = ''
    }

    const maybeFocusTrip = () => {
      // One intro focus only — never after the user has touched the map / Flat→Globe.
      if (autoFocusDoneRef.current || userMovedRef.current) return
      if (visibleCoordsRef.current.length === 0) return
      if (!map.isStyleLoaded()) return
      const focusKey = cameraFingerprint || `n:${visibleCoordsRef.current.length}`
      if (focusedFingerprintRef.current === focusKey) return
      autoFocusDoneRef.current = true
      focusedFingerprintRef.current = focusKey
      programmaticMoveRef.current = true
      setShowRecenter(false)
      focusTripBounds(map, visibleCoordsRef.current, 1600)
    }

    const bindClicks = () => {
      if (!map.getLayer(STOPS_HIT)) return
      map.off('click', STOPS_HIT, onPinClick)
      map.off('click', STOPS_CIRCLE, onPinClick)
      map.on('click', STOPS_HIT, onPinClick)
      map.on('click', STOPS_CIRCLE, onPinClick)
      map.off('mouseenter', STOPS_HIT, setPointer)
      map.off('mouseleave', STOPS_HIT, clearPointer)
      map.on('mouseenter', STOPS_HIT, setPointer)
      map.on('mouseleave', STOPS_HIT, clearPointer)
    }

    const paintAndFocus = async () => {
      if (!map.isStyleLoaded()) return
      const quickFlight = polar.legs
        .filter((l) => l.kind === 'flight')
        .map((l) => greatCircleLine(l.from, l.to))
      // Prefer last-known road polylines so styleEpoch remounts don't wipe OSRM back to chords.
      const cached = peekLegGeometries(polar.legs)
      const quickDrive =
        cached?.drive ??
        polar.legs
          .filter((l) => l.kind === 'drive')
          .map((l) => [
            [l.from.lon, l.from.lat] as [number, number],
            [l.to.lon, l.to.lat] as [number, number],
          ])
      if (!cancelled) {
        paintSync(quickFlight, quickDrive)
        bindClicks()
        maybeFocusTrip()
      }

      const geom = await buildLegGeometries(polar.legs)
      // Always apply road geometry when the map is still alive — don't let a
      // superseded styleEpoch cancel leave permanent straight chords.
      if (!mapRef.current || mapRef.current !== map) return
      try {
        if (!map.isStyleLoaded()) return
        paintSync(geom.flight, geom.drive)
        bindClicks()
      } catch (err) {
        console.warn('[TripMap] road paint skipped', err)
      }
    }

    const run = () => {
      void paintAndFocus()
    }

    // `load` only fires once per map; after setStyle we must use style.load.
    // Use a persistent listener so we never miss a Streets ↔ Satellite swap.
    const onStyleLoad = () => {
      requestAnimationFrame(run)
    }
    if (map.isStyleLoaded()) run()
    map.on('style.load', onStyleLoad)

    return () => {
      cancelled = true
      map.off('style.load', onStyleLoad)
      map.off('click', STOPS_HIT, onPinClick)
      map.off('click', STOPS_CIRCLE, onPinClick)
      map.off('mouseenter', STOPS_HIT, setPointer)
      map.off('mouseleave', STOPS_HIT, clearPointer)
    }
  }, [
    active,
    cameraFingerprint,
    flights,
    mapCategoryVisible,
    mapPoints,
    resolvedPointCoords,
    stays,
    styleEpoch,
  ])

  const ctrlBtn = (activeBtn: boolean) =>
    `flex h-8 w-8 items-center justify-center transition-colors ${
      activeBtn
        ? 'bg-sky-700 text-white'
        : 'bg-neutral-950/90 text-slate-200 hover:bg-neutral-800 hover:text-white'
    }`

  return (
    <div
      ref={shellRef}
      className={`relative h-full w-full overflow-hidden ${
        showStarfield ? 'bg-transparent' : 'bg-[#02040a]'
      }`}
    >
      <div
        ref={containerRef}
        className={`waypoint-map-root absolute inset-0 z-[1]${showStarfield ? ' waypoint-globe-map' : ''}`}
      />
      <div
        className="absolute left-2 top-2 z-10 flex flex-col overflow-hidden rounded-md border border-slate-500/80 shadow-lg backdrop-blur-sm divide-y divide-slate-600/80"
        role="toolbar"
        aria-label="Map view"
      >
        <button
          type="button"
          onClick={() => setBasemap('streets')}
          className={ctrlBtn(basemap === 'streets')}
          aria-pressed={basemap === 'streets'}
          title="Streets"
          aria-label="Streets"
        >
          <MapIcon className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setBasemap('satellite')}
          className={ctrlBtn(basemap === 'satellite')}
          aria-pressed={basemap === 'satellite'}
          title="Satellite"
          aria-label="Satellite"
        >
          <Satellite className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setProjection('flat')}
          className={ctrlBtn(projection === 'flat')}
          aria-pressed={projection === 'flat'}
          title="Flat"
          aria-label="Flat"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setProjection('globe')}
          className={ctrlBtn(projection === 'globe')}
          aria-pressed={projection === 'globe'}
          title="Globe"
          aria-label="Globe"
        >
          <Globe2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {showRecenter ? (
        <button
          type="button"
          onClick={() => flyToTrip(1200)}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-slate-500 bg-neutral-950/90 px-5 py-2.5 text-sm font-semibold text-slate-100 shadow-lg backdrop-blur-sm transition hover:bg-neutral-800 hover:text-white"
        >
          Recenter
        </button>
      ) : null}
    </div>
  )
}

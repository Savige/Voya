import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createMapMarkerContent } from './mapMarkers'
import {
  buildRouteEvents,
  buildRoutePointsWithTs,
  resolveReturnThresholdTs,
  splitOutboundReturnPath,
  type MapCategory,
  type MapPoint,
} from './mapItinerary'
import type { CarBooking, FlightBooking, RestaurantBooking, Stay, VisitPlace } from './tripTypes'

/** Free raster tiles (no API key). OSM Standard via openstreetmap.fr mirror policy — fine for personal NAS use. */
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
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
}

export function TripMap({
  active,
  mapPoints,
  mapCategoryVisible,
  stays,
  visitPlaces,
  flights,
  rentalCars,
  restaurants,
  country,
  tripEndDate,
  resolvedPointCoords,
  cameraFingerprint,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const cameraAppliedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!active || !containerRef.current) return
    if (mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [0, 20],
      zoom: 1.5,
      attributionControl: {},
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    return () => {
      for (const m of markersRef.current) m.remove()
      markersRef.current = []
      map.remove()
      mapRef.current = null
      cameraAppliedRef.current = null
    }
  }, [active])

  useEffect(() => {
    const map = mapRef.current
    if (!active || !map) return

    const resolved = mapPoints
      .map((p) => {
        if (typeof p.lat === 'number' && typeof p.lon === 'number') return { ...p, lat: p.lat, lon: p.lon }
        const fallback = resolvedPointCoords[p.key]
        if (fallback) return { ...p, lat: fallback.lat, lon: fallback.lon }
        return null
      })
      .filter((p): p is MapPoint & { lat: number; lon: number } => Boolean(p))

    const visibleResolved = resolved.filter((p) => mapCategoryVisible[p.category])
    const coordByKey = new Map(resolved.map((p) => [p.key, { lat: p.lat, lng: p.lon }] as const))

    const routeEvents = buildRouteEvents(
      stays,
      visitPlaces,
      flights,
      rentalCars,
      restaurants,
      country,
      { ...mapCategoryVisible, accommodation: true, flight: true },
    )
    const routePointsWithTs = buildRoutePointsWithTs(
      routeEvents.map((e) => ({ ts: e.ts, key: e.key })),
      coordByKey,
    )
    const returnThreshold = resolveReturnThresholdTs(flights, tripEndDate)
    const { outbound, ret } = splitOutboundReturnPath(routePointsWithTs, returnThreshold)

    const ensureLine = (id: string, coords: Array<{ lat: number; lng: number }>, dashed: boolean) => {
      const geo = {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: coords.map((c) => [c.lng, c.lat] as [number, number]),
        },
      }
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (src) {
        src.setData(geo)
      } else if (coords.length >= 2) {
        map.addSource(id, { type: 'geojson', data: geo })
        map.addLayer({
          id: `${id}-line`,
          type: 'line',
          source: id,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: dashed
            ? {
                'line-color': '#78716c',
                'line-width': 3,
                'line-dasharray': [1.2, 1.6],
                'line-opacity': 0.9,
              }
            : {
                'line-color': '#2563eb',
                'line-width': 4,
                'line-opacity': 0.85,
              },
        })
      }
      if (coords.length < 2) {
        if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`)
        if (map.getSource(id)) map.removeSource(id)
      }
    }

    const paint = () => {
      ensureLine('waypoint-outbound', outbound, false)
      ensureLine('waypoint-return', ret, true)

      for (const m of markersRef.current) m.remove()
      markersRef.current = []

      let stopIndex = 0
      for (const p of visibleResolved) {
        stopIndex += 1
        const el = createMapMarkerContent(p.markerKind)
        el.style.position = 'relative'
        const badge = document.createElement('span')
        badge.textContent = String(stopIndex)
        badge.style.cssText =
          'position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:#0f172a;color:#fff;font:700 10px/16px system-ui;text-align:center;'
        el.appendChild(badge)
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lon, p.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setText(p.label))
          .addTo(map)
        markersRef.current.push(marker)
      }

      if (cameraFingerprint !== cameraAppliedRef.current) {
        cameraAppliedRef.current = cameraFingerprint
        const bounds = new maplibregl.LngLatBounds()
        let n = 0
        for (const p of visibleResolved) {
          bounds.extend([p.lon, p.lat])
          n++
        }
        for (const p of [...outbound, ...ret]) {
          bounds.extend([p.lng, p.lat])
          n++
        }
        if (n > 1) {
          map.fitBounds(bounds, { padding: 56, maxZoom: 12, duration: 600 })
        } else if (n === 1) {
          const only = visibleResolved[0] ?? {
            lat: outbound[0]?.lat ?? ret[0]?.lat ?? 0,
            lon: outbound[0]?.lng ?? ret[0]?.lng ?? 0,
          }
          map.easeTo({ center: [only.lon, only.lat], zoom: 10, duration: 500 })
        }
      }
    }

    if (map.isStyleLoaded()) paint()
    else map.once('load', paint)
  }, [
    active,
    cameraFingerprint,
    country,
    flights,
    mapCategoryVisible,
    mapPoints,
    rentalCars,
    resolvedPointCoords,
    restaurants,
    stays,
    tripEndDate,
    visitPlaces,
  ])

  return <div ref={containerRef} className="h-full w-full rounded-xl overflow-hidden" />
}

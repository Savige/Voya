import { Map as MapIcon, MapPin, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { nightsBetween } from './TripRoutePlanner'
import {
  nightsInRange,
  stayAccommodationForDate,
  stayAccommodations,
  stayLodgingCoverage,
  type Stay,
  type StayActivity,
} from './tripTypes'
import type { PlaceSuggestion } from './placesTypes'
import { ItineraryAtmosphere } from './ItineraryAtmosphere'

type Draft = {
  name: string
  time: string
  confirmationRef: string
  cost: string
  notes: string
}

type PlaceMeta = PlaceSuggestion & {
  googleMapsUri?: string
  category?: string
}

type Props = {
  stays: Stay[]
  readOnly?: boolean
  tripCountry?: string
  stopComposer: { stayId: string; date: string } | null
  onOpenStopComposer: (stayId: string, date: string) => void
  onCloseStopComposer: () => void
  activityDrafts: Record<string, Draft>
  setActivityDrafts: Dispatch<SetStateAction<Record<string, Draft>>>
  draftPlaceMeta: Record<string, PlaceMeta>
  setDraftPlaceMeta: Dispatch<SetStateAction<Record<string, PlaceMeta>>>
  activityPlaceSearchInput: string
  setActivityPlaceSearchInput: (value: string) => void
  activityPlaceSuggestions: PlaceSuggestion[]
  activityPlaceSearchError?: string | null
  placeGoogleUrl: (place: {
    label: string
    googleMapsUri?: string
    lat?: number
    lon?: number
  }) => string
  resolveRecommendationCategory: (
    category: string | undefined,
    label: string,
    primaryType?: string,
    types?: string[],
  ) => string
  onAddStop: (stayId: string, date: string) => void
  onRemoveStop: (stayId: string, activityId: string) => void
  onOpenStop: (stayId: string, activity: StayActivity, stayLocation: string) => void
  onOpenPlanner: () => void
  onOpenOnMap: (stayId: string) => void
  onEditLodging?: (stayId: string, lodgingId?: string | 'new') => void
  formatDayLabel: (iso: string) => string
  formatStayRange: (start: string, end: string) => string
}

function DayProgressRing({ done, total }: { done: number; total: number }) {
  const size = 28
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = total <= 0 ? 0 : Math.min(1, done / total)
  const offset = c * (1 - pct)
  return (
    <div
      className="relative shrink-0"
      title={total === 0 ? 'No stops yet' : `${done} of ${total} stops`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-white/15"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-sky-400 transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums text-sky-100">
        {total === 0 ? '0' : `${done}/${total}`}
      </span>
    </div>
  )
}

export function ItineraryDestinationsView({
  stays,
  readOnly,
  stopComposer,
  onOpenStopComposer,
  onCloseStopComposer,
  activityDrafts,
  setActivityDrafts,
  draftPlaceMeta,
  setDraftPlaceMeta,
  activityPlaceSearchInput,
  setActivityPlaceSearchInput,
  activityPlaceSuggestions,
  activityPlaceSearchError,
  placeGoogleUrl,
  resolveRecommendationCategory,
  onAddStop,
  onRemoveStop,
  onOpenStop,
  onOpenPlanner,
  onOpenOnMap,
  onEditLodging,
  formatDayLabel,
  formatStayRange,
}: Props) {
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const stripBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [highlightStayId, setHighlightStayId] = useState<string | null>(null)
  const highlightTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (highlightTimer.current != null) window.clearTimeout(highlightTimer.current)
    }
  }, [])

  const scrollToStay = (stayId: string) => {
    const el = sectionRefs.current[stayId]
    if (el) {
      // Account for sticky toolbar + trip tabs so the destination isn't hidden underneath.
      const stickyTop = document.querySelector<HTMLElement>('[data-trip-nav]')
      const toolbar = document.querySelector<HTMLElement>('[data-dashboard-toolbar]')
      const offset =
        (toolbar?.getBoundingClientRect().height ?? 64) +
        (stickyTop?.getBoundingClientRect().height ?? 56) +
        12
      const y = el.getBoundingClientRect().top + window.scrollY - offset
      window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: 'smooth' })
    }
    stripBtnRefs.current[stayId]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
    setHighlightStayId(stayId)
    if (highlightTimer.current != null) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightStayId(null), 1400)
  }

  if (stays.length === 0) {
    return (
      <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 p-6 text-center">
        <ItineraryAtmosphere />
        <div className="relative z-10">
          <p className="text-sm text-slate-200/90">
            Add destinations in Planner first, then chart stops along the path.
          </p>
          <button
            type="button"
            onClick={onOpenPlanner}
            className="mt-3 inline-flex items-center rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400"
          >
            Open Planner
          </button>
        </div>
      </div>
    )
  }

  const compactStrip = stays.length > 8

  return (
    <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_40px_rgba(56,189,248,0.08)]">
      <ItineraryAtmosphere />

      <div className="relative z-10 p-4 sm:p-5">
        {/* Journey strip — horizontal scroll; compact (numbers only) when many stops */}
        <div className="mb-5 overflow-x-auto pb-1 [scrollbar-width:thin]">
          <div className="flex min-w-min items-center gap-0 px-1">
            {stays.map((stay, index) => {
              const active = highlightStayId === stay.id
              return (
                <div key={stay.id} className="flex items-center">
                  {index > 0 ? (
                    <div
                      className={`mx-0.5 h-px shrink-0 bg-gradient-to-r from-sky-400/50 to-indigo-400/40 sm:mx-1 ${
                        compactStrip ? 'w-3 sm:w-5' : 'w-6 sm:w-10'
                      }`}
                      aria-hidden
                    />
                  ) : null}
                  <button
                    type="button"
                    ref={(btn) => {
                      stripBtnRefs.current[stay.id] = btn
                    }}
                    onClick={() => scrollToStay(stay.id)}
                    className={`group flex flex-col items-center rounded-xl py-1 transition-transform duration-300 ${
                      compactStrip ? 'max-w-[2.75rem] gap-1 px-1' : 'max-w-[7.5rem] gap-1.5 px-1.5'
                    } ${active ? 'scale-105' : 'hover:scale-[1.03]'}`}
                    title={stay.location || `Stop ${index + 1}`}
                  >
                    <span
                      className={`flex items-center justify-center rounded-full font-bold text-white shadow-md transition-shadow duration-300 ${
                        compactStrip ? 'h-7 w-7 text-[10px]' : 'h-8 w-8 text-xs'
                      } ${
                        active
                          ? 'bg-sky-400 shadow-sky-400/50 ring-2 ring-sky-200/80'
                          : 'bg-blue-600 ring-2 ring-white/25 group-hover:ring-sky-300/50'
                      }`}
                    >
                      {index + 1}
                    </span>
                    {!compactStrip ? (
                      <span className="w-full truncate text-center text-[10px] font-semibold text-slate-200/90">
                        {stay.location || 'Destination'}
                      </span>
                    ) : null}
                  </button>
                </div>
              )
            })}
          </div>
          {compactStrip ? (
            <p className="mt-1.5 truncate text-center text-[10px] text-slate-400">
              {highlightStayId
                ? stays.find((s) => s.id === highlightStayId)?.location || 'Destination'
                : `${stays.length} destinations — tap a number to jump`}
            </p>
          ) : null}
        </div>

        {/* Numbered spine + cards */}
        <div className="relative space-y-0">
          {stays.map((stay, index) => {
            const nights = nightsBetween(stay.startDate, stay.endDate)
            const days = nightsInRange(stay.startDate, stay.endDate)
            const lodgings = stayAccommodations(stay).filter((a) => a.confirmationRef.trim())
            const lodgingLabel =
              lodgings.length === 0
                ? 'No lodging'
                : lodgings.length === 1
                  ? lodgings[0].name || lodgings[0].confirmationRef
                  : `${lodgings.length} accommodations`
            const coverage = stayLodgingCoverage(stay)
            const isLast = index === stays.length - 1
            const highlighted = highlightStayId === stay.id

            return (
              <div
                key={stay.id}
                ref={(el) => {
                  sectionRefs.current[stay.id] = el
                }}
                className="itin-dest-enter relative flex gap-3 sm:gap-4"
                style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
              >
                {/* Spine */}
                <div className="relative flex w-8 shrink-0 flex-col items-center sm:w-9">
                  <span
                    className={`z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-md sm:h-9 sm:w-9 ${
                      highlighted
                        ? 'bg-sky-400 ring-2 ring-sky-200/70'
                        : 'bg-blue-600 ring-2 ring-white/20'
                    }`}
                  >
                    {index + 1}
                  </span>
                  {!isLast ? (
                    <div
                      className="mt-1 w-px flex-1 bg-gradient-to-b from-sky-400/50 via-indigo-400/30 to-transparent"
                      aria-hidden
                    />
                  ) : null}
                </div>

                <section
                  className={`mb-4 min-w-0 flex-1 rounded-2xl border p-4 backdrop-blur-md transition-[box-shadow,border-color,background-color] duration-500 sm:p-5 ${
                    highlighted
                      ? 'border-sky-400/50 bg-slate-900/65 shadow-[0_0_28px_rgba(56,189,248,0.22)]'
                      : 'border-white/15 bg-slate-900/42 shadow-lg shadow-black/20'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)]"
                          aria-hidden
                          title="Destination"
                        />
                        <h3 className="font-serif text-xl font-bold text-white">
                          {stay.location || 'Untitled destination'}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-sm text-slate-300/90">
                        {formatStayRange(stay.startDate, stay.endDate)}
                        {nights > 0 ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
                      </p>
                      {onEditLodging && !readOnly ? (
                        <button
                          type="button"
                          onClick={() =>
                            onEditLodging(
                              stay.id,
                              lodgings.length === 1 ? lodgings[0].id : lodgings[0]?.id || 'new',
                            )
                          }
                          className="mt-1 flex max-w-full items-center gap-1.5 rounded-md text-left text-xs font-medium text-slate-400 underline-offset-2 hover:text-sky-200 hover:underline"
                          title={
                            lodgings.length
                              ? 'Edit lodging'
                              : 'Add lodging'
                          }
                        >
                          <MapPin size={12} className="shrink-0 opacity-70" aria-hidden />
                          <span className="truncate">{lodgingLabel}</span>
                        </button>
                      ) : (
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                          <MapPin size={12} className="shrink-0 opacity-70" aria-hidden />
                          <span className="truncate">{lodgingLabel}</span>
                        </p>
                      )}
                      {coverage.partialCoverage ? (
                        <p className="mt-1 text-[11px] font-medium text-amber-300/90">
                          Lodging covers {coverage.coveredNights} of {coverage.totalNights} nights
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenOnMap(stay.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-500/15 px-2.5 text-xs font-semibold text-sky-100 hover:bg-sky-500/25"
                    >
                      <MapIcon size={13} aria-hidden />
                      Open on map
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {days.length === 0 ? (
                      <p className="text-xs text-slate-400">No nights on this destination yet.</p>
                    ) : (
                      days.map((day) => {
                        const stops = (stay.activities ?? [])
                          .filter((a) => a.date === day)
                          .slice()
                          .sort(
                            (a, b) =>
                              (a.time || '').localeCompare(b.time || '') || a.createdAt - b.createdAt,
                          )
                        const composing =
                          stopComposer?.stayId === stay.id && stopComposer.date === day
                        const draftKey = `${stay.id}|${day}`
                        const draft = activityDrafts[draftKey] ?? {
                          name: '',
                          time: '',
                          confirmationRef: '',
                          cost: '',
                          notes: '',
                        }
                        const dayLodging = stayAccommodationForDate(stay, day)
                        const dayLodgingName = (
                          dayLodging?.name ||
                          dayLodging?.confirmationRef ||
                          ''
                        ).trim()
                        const stopTotal = stops.length
                        const stopDone = stops.filter((s) => Boolean(s.time?.trim())).length

                        return (
                          <div
                            key={day}
                            className="rounded-xl border border-white/10 bg-slate-950/40 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <DayProgressRing done={stopDone} total={stopTotal} />
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-100">
                                    {formatDayLabel(day)}
                                  </p>
                                  {dayLodgingName ? (
                                    <p className="text-[11px] text-slate-400 truncate">
                                      {dayLodgingName}
                                    </p>
                                  ) : coverage.partialCoverage &&
                                    coverage.uncoveredNights.includes(day) ? (
                                    <p className="text-[11px] font-medium text-amber-300/90">
                                      No lodging this night
                                    </p>
                                  ) : (
                                    <p className="text-[11px] text-slate-500">
                                      {stopTotal === 0
                                        ? 'No stops yet'
                                        : `${stopDone} timed · ${stopTotal} stop${stopTotal === 1 ? '' : 's'}`}
                                    </p>
                                  )}
                                </div>
                              </div>
                              {!readOnly ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (composing) onCloseStopComposer()
                                    else onOpenStopComposer(stay.id, day)
                                  }}
                                  className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-white/25 px-2.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
                                >
                                  <Plus size={13} aria-hidden />
                                  {composing ? 'Cancel' : 'Add stop'}
                                </button>
                              ) : null}
                            </div>

                            <ul className="mt-2 space-y-1.5">
                              {stops.map((stop) => {
                                const mapsLabel =
                                  (stop.placeLabel || '').trim() ||
                                  [stop.name, stop.notes].filter(Boolean).join(', ') ||
                                  stop.name
                                const mapsUrl = placeGoogleUrl({
                                  label: mapsLabel,
                                  googleMapsUri: stop.googleMapsUri,
                                  lat: stop.lat,
                                  lon: stop.lon,
                                })
                                return (
                                <li key={stop.id}>
                                  <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2.5 py-2">
                                    <span
                                      className="mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]"
                                      aria-hidden
                                      title="Stop"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => onOpenStop(stay.id, stop, stay.location)}
                                      className="min-w-0 flex-1 text-left"
                                    >
                                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                        {stop.time ? (
                                          <span className="text-xs font-semibold tabular-nums text-slate-400">
                                            {stop.time}
                                          </span>
                                        ) : null}
                                        <span className="text-sm font-medium text-slate-100">
                                          {stop.name}
                                        </span>
                                      </div>
                                      {stop.notes ? (
                                        <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">
                                          {stop.notes}
                                        </p>
                                      ) : null}
                                    </button>
                                    <a
                                      href={mapsUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-sky-200"
                                      aria-label={`Open ${stop.name} in Maps`}
                                      title="Open in Maps"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <MapPin size={14} aria-hidden />
                                    </a>
                                    {!readOnly ? (
                                      <button
                                        type="button"
                                        onClick={() => onRemoveStop(stay.id, stop.id)}
                                        className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200"
                                        aria-label={`Remove ${stop.name}`}
                                      >
                                        <X size={14} />
                                      </button>
                                    ) : null}
                                  </div>
                                </li>
                                )
                              })}
                              {stops.length === 0 && !composing ? (
                                <li className="px-0.5 py-1 text-xs text-slate-500">No stops yet.</li>
                              ) : null}
                            </ul>

                            {composing && !readOnly ? (
                              <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                                <input
                                  value={activityPlaceSearchInput}
                                  onChange={(e) => setActivityPlaceSearchInput(e.target.value)}
                                  placeholder="Search place name or address"
                                  className="w-full rounded-lg border border-white/15 bg-slate-950/80 px-2.5 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                                />
                                {activityPlaceSearchInput.trim().length >= 2 ? (
                                  <div className="max-h-40 overflow-y-auto rounded-lg border border-white/15 bg-slate-950">
                                    {activityPlaceSearchError ? (
                                      <p className="px-2.5 py-2 text-xs text-rose-300">
                                        {activityPlaceSearchError}
                                      </p>
                                    ) : (
                                      activityPlaceSuggestions.slice(0, 5).map((place) => (
                                        <button
                                          key={place.key}
                                          type="button"
                                          className="block w-full border-b border-white/10 px-2.5 py-2 text-left text-xs text-slate-200 last:border-0 hover:bg-white/5"
                                          onClick={() => {
                                            const placeName =
                                              place.label.split(',')[0]?.trim() || place.label
                                            const placeAddress = place.label
                                              .split(',')
                                              .slice(1)
                                              .join(',')
                                              .trim()
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
                                                category: resolveRecommendationCategory(
                                                  place.category,
                                                  place.label,
                                                  place.primaryType,
                                                  place.types,
                                                ),
                                              },
                                            }))
                                            setActivityPlaceSearchInput('')
                                          }}
                                        >
                                          {place.label}
                                        </button>
                                      ))
                                    )}
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                  <input
                                    value={draft.name}
                                    onChange={(e) =>
                                      setActivityDrafts((prev) => ({
                                        ...prev,
                                        [draftKey]: { ...draft, name: e.target.value },
                                      }))
                                    }
                                    placeholder="Stop name"
                                    className="rounded-lg border border-white/15 bg-slate-950/80 px-2.5 py-2 text-sm text-slate-100"
                                  />
                                  <input
                                    type="time"
                                    value={draft.time}
                                    onChange={(e) =>
                                      setActivityDrafts((prev) => ({
                                        ...prev,
                                        [draftKey]: { ...draft, time: e.target.value },
                                      }))
                                    }
                                    className="rounded-lg border border-white/15 bg-slate-950/80 px-2 py-2 text-sm text-slate-100"
                                  />
                                </div>
                                <input
                                  value={draft.notes}
                                  onChange={(e) =>
                                    setActivityDrafts((prev) => ({
                                      ...prev,
                                      [draftKey]: { ...draft, notes: e.target.value },
                                    }))
                                  }
                                  placeholder="Notes (optional)"
                                  className="w-full rounded-lg border border-white/15 bg-slate-950/80 px-2.5 py-2 text-sm text-slate-100"
                                />
                                {draftPlaceMeta[draftKey] ? (
                                  <p className="truncate text-[11px] text-slate-400">
                                    Place: {draftPlaceMeta[draftKey].label}
                                  </p>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={!draft.name.trim()}
                                  onClick={() => onAddStop(stay.id, day)}
                                  className="w-full rounded-xl bg-sky-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
                                >
                                  Save stop
                                </button>
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                </section>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

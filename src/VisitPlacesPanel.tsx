import { ExternalLink, MapPin, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchLocationPhoto } from './locationPhotos'
import { usePlaceSuggestions } from './placesHooks'
import type { PlaceSuggestion } from './placesTypes'
import {
  VISIT_PLACE_CATEGORIES,
  type VisitPlace,
  type VisitPlaceCategory,
} from './tripTypes'

function mapToVisitCategory(
  raw: string | undefined,
  label: string,
): VisitPlaceCategory {
  const t = `${raw || ''} ${label}`.toLowerCase()
  if (/\b(hike|hiking|trail|track|walk|trek|park)\b/.test(t) || raw === 'Hike/Walk') return 'Hike'
  if (/\b(restaurant|cafe|dining|food|eatery|bistro)\b/.test(t) || raw === 'Restaurant' || raw === 'Cafe')
    return 'Restaurant'
  if (
    /\b(lookout|viewpoint|view|scenic|tower|summit|overlook)\b/.test(t) ||
    raw === 'Landmark'
  )
    return 'Lookout'
  if (/\b(town|city|village|suburb)\b/.test(t)) return 'Town'
  if (
    /\b(activity|adventure|tour|museum|experience|kayak|surf|zipline)\b/.test(t) ||
    raw === 'Experiences/Adventure' ||
    raw === 'Museum/Culture'
  )
    return 'Activity'
  if ((VISIT_PLACE_CATEGORIES as readonly string[]).includes(raw || '')) {
    return raw as VisitPlaceCategory
  }
  return 'Other'
}

type Props = {
  places: VisitPlace[]
  readOnly?: boolean
  tripCountry?: string
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
  onAdd: (place: Omit<VisitPlace, 'id' | 'createdAt'>) => void
  onDelete: (placeId: string) => void
}

export function VisitPlacesPanel({
  places,
  readOnly,
  tripCountry,
  placeGoogleUrl,
  resolveRecommendationCategory,
  onAdd,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState<VisitPlaceCategory>('Other')
  const [draft, setDraft] = useState<PlaceSuggestion | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const search = usePlaceSuggestions(query)

  const sorted = useMemo(() => {
    return [...places].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }, [places])

  useEffect(() => {
    if (!draft) {
      setPhotoUrl(undefined)
      return
    }
    if (draft.photoUrl) {
      setPhotoUrl(draft.photoUrl)
      return
    }
    let cancelled = false
    const q = [draft.label, tripCountry].filter(Boolean).join(', ')
    void fetchLocationPhoto(q, { pick: 'best', purpose: 'avatar', thumbWidth: 480 }).then((url) => {
      if (!cancelled) setPhotoUrl(url || undefined)
    })
    return () => {
      cancelled = true
    }
  }, [draft, tripCountry])

  const pickSuggestion = (place: PlaceSuggestion) => {
    setDraft(place)
    setQuery(place.label)
    const inferred = resolveRecommendationCategory(
      place.category,
      place.label,
      place.primaryType,
      place.types,
    )
    setCategory(mapToVisitCategory(inferred, place.label))
  }

  const clearDraft = () => {
    setDraft(null)
    setQuery('')
    setNotes('')
    setCategory('Other')
    setPhotoUrl(undefined)
  }

  const save = async () => {
    if (readOnly || saving) return
    const label = (draft?.label || query).trim()
    if (!label) return
    setSaving(true)
    try {
      const name =
        (draft?.name || label.split(',')[0] || label).trim() || label
      const mapsUri = placeGoogleUrl({
        label,
        googleMapsUri: draft?.googleMapsUri,
        lat: draft?.lat,
        lon: draft?.lon,
      })
      onAdd({
        label,
        name,
        ...(typeof draft?.lat === 'number' ? { lat: draft.lat } : {}),
        ...(typeof draft?.lon === 'number' ? { lon: draft.lon } : {}),
        ...(photoUrl ? { photoUrl } : {}),
        category,
        googleMapsUri: mapsUri,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      clearDraft()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-neutral-100 p-7 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-serif font-bold text-neutral-900 dark:text-neutral-100">
            Places to explore
          </h2>
          <p className="text-neutral-500 text-sm">
            Research spots — not on the itinerary yet.
          </p>
        </div>
        <span className="px-3 py-1 rounded-full border border-sky-200 bg-sky-50 text-sky-800 text-xs font-semibold dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
          {places.length} saved
        </span>
      </div>

      {!readOnly ? (
        <div className="mt-4 space-y-3">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (draft && e.target.value.trim() !== draft.label) setDraft(null)
              }}
              disabled={!onAdd}
              placeholder="Search a place to research…"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
            {query.trim().length >= 2 && !draft ? (
              <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
                {search.autocompleteError ? (
                  <p className="px-3 py-2 text-xs text-rose-600">{search.autocompleteError}</p>
                ) : search.suggestions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-neutral-500">No matches yet…</p>
                ) : (
                  search.suggestions.slice(0, 8).map((place) => (
                    <button
                      key={place.key}
                      type="button"
                      className="block w-full border-b border-neutral-100 px-3 py-2 text-left text-sm text-neutral-800 last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-900"
                      onClick={() => pickSuggestion(place)}
                    >
                      {place.label}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {draft || query.trim() ? (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-950/60">
              <div className="flex gap-3">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800">
                  {photoUrl ? (
                    <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-neutral-400">
                      <MapPin size={22} aria-hidden />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {(draft?.name || draft?.label || query).split(',')[0]}
                  </p>
                  <p className="truncate text-xs text-neutral-500">{draft?.label || query}</p>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as VisitPlaceCategory)}
                      className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      {VISIT_PLACE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      className="min-w-[10rem] flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={clearDraft}
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                >
                  <X size={13} aria-hidden />
                  Clear
                </button>
                <button
                  type="button"
                  disabled={saving || !(draft?.label || query).trim()}
                  onClick={() => void save()}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  <Plus size={13} aria-hidden />
                  Save place
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <p className="mt-5 text-sm text-neutral-500">
          {readOnly
            ? 'No research places on this trip.'
            : 'Search and save lookouts, hikes, restaurants, and other ideas while you plan.'}
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((place) => {
            const title = (place.name || place.label.split(',')[0] || place.label).trim()
            const mapsUrl = placeGoogleUrl({
              label: place.label,
              googleMapsUri: place.googleMapsUri,
              lat: place.lat,
              lon: place.lon,
            })
            return (
              <li
                key={place.id}
                className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950/50"
              >
                <div className="aspect-[16/10] bg-neutral-200 dark:bg-neutral-800">
                  {place.photoUrl ? (
                    <img
                      src={place.photoUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-neutral-400">
                      <MapPin size={28} aria-hidden />
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
                        {title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{place.label}</p>
                    </div>
                    {place.category ? (
                      <span className="shrink-0 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                        {place.category}
                      </span>
                    ) : null}
                  </div>
                  {place.notes ? (
                    <p className="line-clamp-3 text-xs text-neutral-600 dark:text-neutral-400">
                      {place.notes}
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-600 dark:text-sky-300"
                    >
                      <ExternalLink size={12} aria-hidden />
                      Maps
                    </a>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => onDelete(place.id)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-500 hover:bg-white hover:text-rose-600 dark:hover:bg-neutral-900"
                        aria-label={`Remove ${title}`}
                      >
                        <Trash2 size={13} aria-hidden />
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

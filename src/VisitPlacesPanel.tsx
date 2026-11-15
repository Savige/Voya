import { ExternalLink, ImagePlus, MapPin, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CATEGORY_PLACEHOLDER,
  fileToPhotoDataUrl,
  resolvePlacePhoto,
} from './placePhotos'
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
  // Peaks/summits/mountains → Hike (e.g. Roy's Peak), not Lookout.
  if (
    /\b(hike|hiking|trail|track|walk|trek|park|peak|peaks|summit|mountain|ridge|saddle|alpine)\b/.test(
      t,
    ) ||
    raw === 'Hike/Walk'
  )
    return 'Hike'
  if (
    /\b(restaurant|cafe|café|dining|food|eatery|bistro|pub|bar|shop)\b/.test(t) ||
    raw === 'Restaurant' ||
    raw === 'Cafe'
  )
    return 'Restaurant'
  if (
    /\b(lookout|viewpoint|scenic|tower|overlook|heights)\b/.test(t) ||
    raw === 'Landmark'
  )
    return 'Lookout'
  if (/\b(town|city|village|suburb|neighbourhood|neighborhood)\b/.test(t)) return 'Town'
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

function CategoryThumb({
  category,
  className,
}: {
  category?: string
  className?: string
}) {
  const key = ((VISIT_PLACE_CATEGORIES as readonly string[]).includes(category || '')
    ? category
    : 'Other') as VisitPlaceCategory
  const style = CATEGORY_PLACEHOLDER[key] || CATEGORY_PLACEHOLDER.Other
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-1 ${style.bg} ${className || ''}`}>
      <MapPin size={22} aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-wide">{style.label}</span>
    </div>
  )
}

type Props = {
  places: VisitPlace[]
  readOnly?: boolean
  tripCountry?: string
  tripCountryCode?: string
  nearLat?: number
  nearLon?: number
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
  onUpdate: (placeId: string, patch: Partial<VisitPlace>) => void
  onDelete: (placeId: string) => void
}

export function VisitPlacesPanel({
  places,
  readOnly,
  tripCountry,
  tripCountryCode,
  nearLat,
  nearLon,
  placeGoogleUrl,
  resolveRecommendationCategory,
  onAdd,
  onUpdate,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState<VisitPlaceCategory>('Other')
  const [draft, setDraft] = useState<PlaceSuggestion | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | undefined>()
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const draftFileRef = useRef<HTMLInputElement>(null)
  const backfilled = useRef(new Set<string>())
  const search = usePlaceSuggestions(query, {
    nearLat,
    nearLon,
    country: tripCountry,
    countryCode: tripCountryCode,
  })

  const sorted = useMemo(() => {
    return [...places].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }, [places])

  useEffect(() => {
    if (!draft) {
      setPhotoUrl(undefined)
      setPhotoError(null)
      setPasteUrl('')
      return
    }
    if (draft.photoUrl) {
      setPhotoUrl(draft.photoUrl)
      return
    }
    let cancelled = false
    setPhotoBusy(true)
    void resolvePlacePhoto({
      label: draft.label,
      name: draft.name,
      wikidataId: draft.wikidataId,
      country: draft.country || tripCountry,
      category: draft.category || draft.primaryType,
    })
      .then((url) => {
        if (!cancelled) setPhotoUrl(url || undefined)
      })
      .finally(() => {
        if (!cancelled) setPhotoBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [draft, tripCountry])

  // Lazy backfill empty saved cards (Wikidata/Commons only) + fix weak categories.
  useEffect(() => {
    if (readOnly) return
    for (const place of places) {
      const rawCat = (place.category || '').trim()
      if (!rawCat || rawCat === 'Other' || rawCat.toLowerCase() === 'peak') {
        const better = mapToVisitCategory(rawCat || undefined, `${place.name || ''} ${place.label}`)
        if (better !== 'Other' && better !== rawCat) {
          onUpdate(place.id, { category: better })
        }
      }
      if (place.photoUrl || backfilled.current.has(place.id)) continue
      backfilled.current.add(place.id)
      void resolvePlacePhoto({
        label: place.label,
        name: place.name,
        wikidataId: place.wikidataId,
        country: tripCountry,
        category: place.category,
      }).then((url) => {
        if (url) onUpdate(place.id, { photoUrl: url })
      })
    }
  }, [places, readOnly, tripCountry, onUpdate])

  const pickSuggestion = (place: PlaceSuggestion) => {
    setDraft(place)
    setQuery(place.label)
    setPhotoError(null)
    setPasteUrl('')
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
    setPhotoError(null)
    setPasteUrl('')
  }

  const applyPasteUrl = (target: 'draft' | string) => {
    const url = pasteUrl.trim()
    if (!url) return
    try {
      // Basic sanity — allow http(s) and data URLs.
      if (!/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) {
        setPhotoError('Use an https image URL')
        return
      }
      setPhotoError(null)
      if (target === 'draft') {
        setPhotoUrl(url)
        setPasteUrl('')
      } else {
        onUpdate(target, { photoUrl: url })
        setPasteUrl('')
      }
    } catch {
      setPhotoError('Invalid image URL')
    }
  }

  const onPickFile = async (file: File | undefined, target: 'draft' | string) => {
    if (!file) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const dataUrl = await fileToPhotoDataUrl(file)
      if (target === 'draft') setPhotoUrl(dataUrl)
      else onUpdate(target, { photoUrl: dataUrl })
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not use image')
    } finally {
      setPhotoBusy(false)
    }
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
        ...(draft?.wikidataId ? { wikidataId: draft.wikidataId } : {}),
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
            Research spots — not on the itinerary yet. Photos from Wikidata/Commons when available.
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
              placeholder="Search a place or business…"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
            {query.trim().length >= 2 && !draft ? (
              <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
                {search.autocompleteError ? (
                  <p className="px-3 py-2 text-xs text-rose-600">{search.autocompleteError}</p>
                ) : null}
                {search.suggestions.length === 0 && !search.autocompleteError ? (
                  <p className="px-3 py-2 text-xs text-neutral-500">No matches yet…</p>
                ) : null}
                {search.suggestions.slice(0, 8).map((place) => (
                  <button
                    key={place.key}
                    type="button"
                    className="block w-full border-b border-neutral-100 px-3 py-2 text-left text-sm text-neutral-800 last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-900"
                    onClick={() => pickSuggestion(place)}
                  >
                    <span className="block truncate font-medium">
                      {place.name || place.label.split(',')[0]}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">
                      {place.category ? `${place.category} · ` : ''}
                      {place.label}
                    </span>
                  </button>
                ))}
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
                    <CategoryThumb category={category} />
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

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  placeholder="Paste photo URL"
                  className="min-w-[12rem] flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
                <button
                  type="button"
                  onClick={() => applyPasteUrl('draft')}
                  disabled={!pasteUrl.trim()}
                  className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200"
                >
                  Use URL
                </button>
                <input
                  ref={draftFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void onPickFile(e.target.files?.[0], 'draft')
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={() => draftFileRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
                >
                  <ImagePlus size={13} aria-hidden />
                  {photoBusy ? 'Working…' : 'Upload'}
                </button>
              </div>
              {photoError ? <p className="mt-1 text-xs text-rose-600">{photoError}</p> : null}

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
                    <CategoryThumb category={place.category} />
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
                  {!readOnly && !place.photoUrl ? (
                    <CardPhotoAdd
                      onUrl={(url) => onUpdate(place.id, { photoUrl: url })}
                      onFile={(file) => void onPickFile(file, place.id)}
                    />
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

function CardPhotoAdd({
  onUrl,
  onFile,
}: {
  onUrl: (url: string) => void
  onFile: (file: File | undefined) => void
}) {
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Add photo URL"
        className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
      />
      <button
        type="button"
        disabled={!url.trim()}
        onClick={() => {
          const v = url.trim()
          if (!v) return
          if (!/^https?:\/\//i.test(v) && !v.startsWith('data:image/')) return
          onUrl(v)
          setUrl('')
        }}
        className="rounded-md border border-neutral-200 px-1.5 py-1 text-[11px] font-medium disabled:opacity-40 dark:border-neutral-700"
      >
        Use
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center gap-0.5 rounded-md border border-neutral-200 px-1.5 py-1 text-[11px] font-medium dark:border-neutral-700"
      >
        <ImagePlus size={11} aria-hidden />
        Upload
      </button>
    </div>
  )
}

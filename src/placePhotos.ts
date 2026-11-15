/**
 * Free place photos: Wikidata P18 → Wikimedia Commons → null (UI uses category placeholder).
 */

import { fetchLocationPhoto } from './locationPhotos'
import type { VisitPlaceCategory } from './tripTypes'

const WD_MEMORY = new Map<string, string | null>()
const WD_INFLIGHT = new Map<string, Promise<string | null>>()

function commonsFileUrl(fileTitle: string, thumbWidth = 800): Promise<string | null> {
  const title = fileTitle.startsWith('File:') ? fileTitle : `File:${fileTitle}`
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: String(thumbWidth),
    format: 'json',
    origin: '*',
  })
  return fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; url?: string }> }> } } | null) => {
      if (!data?.query?.pages) return null
      const page = Object.values(data.query.pages)[0]
      const info = page?.imageinfo?.[0]
      return info?.thumburl || info?.url || null
    })
    .catch(() => null)
}

/** Resolve Wikimedia Commons image from a Wikidata Q-id (property P18). */
export async function fetchWikidataPhoto(
  wikidataId: string,
  thumbWidth = 800,
): Promise<string | null> {
  const id = wikidataId.trim().toUpperCase()
  if (!/^Q\d+$/i.test(id)) return null
  if (WD_MEMORY.has(id)) return WD_MEMORY.get(id) ?? null
  const existing = WD_INFLIGHT.get(id)
  if (existing) return existing

  const pending = (async () => {
    try {
      const params = new URLSearchParams({
        action: 'wbgetclaims',
        entity: id,
        property: 'P18',
        format: 'json',
        origin: '*',
      })
      const res = await fetch(`https://www.wikidata.org/w/api.php?${params.toString()}`)
      if (!res.ok) return null
      const data = (await res.json()) as {
        claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> }
      }
      const fileName = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
      if (!fileName || typeof fileName !== 'string') return null
      return commonsFileUrl(fileName, thumbWidth)
    } catch {
      return null
    }
  })().then((url) => {
    WD_MEMORY.set(id, url)
    WD_INFLIGHT.delete(id)
    return url
  })

  WD_INFLIGHT.set(id, pending)
  return pending
}

export type ResolvePlacePhotoInput = {
  label: string
  name?: string
  wikidataId?: string
  country?: string
  category?: string
}

/** Wikidata P18 first, then Commons scenic search — never paid APIs. */
export async function resolvePlacePhoto(
  input: ResolvePlacePhotoInput,
): Promise<string | null> {
  if (input.wikidataId) {
    const wd = await fetchWikidataPhoto(input.wikidataId)
    if (wd) return wd
  }
  const shortName = (input.name || input.label.split(',')[0] || input.label).trim()
  const queries = [
    [shortName, input.category, input.country].filter(Boolean).join(', '),
    [shortName, input.country].filter(Boolean).join(', '),
    shortName,
  ]
  for (const q of queries) {
    if (!q || q.length < 2) continue
    const url = await fetchLocationPhoto(q, {
      pick: 'best',
      purpose: 'avatar',
      thumbWidth: 640,
    })
    if (url) return url
  }
  return null
}

export const CATEGORY_PLACEHOLDER: Record<
  VisitPlaceCategory | 'Other',
  { bg: string; label: string }
> = {
  Hike: { bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200', label: 'Hike' },
  Restaurant: {
    bg: 'bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200',
    label: 'Restaurant',
  },
  Activity: { bg: 'bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200', label: 'Activity' },
  Lookout: { bg: 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200', label: 'Lookout' },
  Town: { bg: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200', label: 'Town' },
  Other: { bg: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300', label: 'Place' },
}

/** Compress a local image file to a JPEG data URL for trip JSON storage ($0). */
export function fileToPhotoDataUrl(file: File, maxEdge = 720, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Choose an image file'))
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('Image must be under 8 MB'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Invalid image'))
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not process image'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        try {
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Could not encode image'))
        }
      }
      img.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  })
}

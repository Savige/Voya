/**
 * Royalty-free place photos via Wikimedia Commons (CC / public domain).
 * Prefer modern landscape photographs — not prints, book plates, or ultra-wide
 * historic panoramas that look wrong as circular stay thumbnails.
 */

export const DEFAULT_HERO_IMAGE =
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1200&auto=format&fit=crop'

const HERO_RANDOM_POOL = 12
/** Bump when scoring/filters change so stale wrong thumbs are refetched. */
const CACHE_STORAGE_KEY = 'waypoint:location-photo:v8'
const memoryCache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

/** Reject pre-digital / early digicam era for "modern landscape" look. */
const MIN_PHOTO_YEAR = 2012
/** Soft preference for more recent shoots. */
const PREFERRED_PHOTO_YEAR = 2016

const TITLE_NOISE = [
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
  'engraving',
  'etching',
  'lithograph',
  'woodcut',
  'mezzotint',
  'aquatint',
  'drawing',
  'sketch',
  'watercolor',
  'watercolour',
  'painting',
  'oil on',
  'google art',
  'book plate',
  'bookplate',
  'titel op object',
  'title on object',
  'rp-f-',
  'rp-p-',
  'catalogue',
  'catalog',
  'manuscript',
  'postcard',
  'postage',
  'newspaper',
  'clipping',
  'cartoon',
  'comic',
  'scan of',
  'scanned',
  'facsimile',
  'plaque',
  'museum label',
  'historic',
  'historical',
  'vintage',
  'antique',
  'sepia',
  'black and white',
  'black & white',
  'b&w',
  'monochrome',
]

/** Close-ups / subjects that are not place landscapes. */
const CLOSEUP_NOISE = [
  'rose',
  'roses',
  'flower',
  'flowers',
  'bloom',
  'botanic',
  'botanical',
  'sculpture',
  'sculptures',
  'statue',
  'statues',
  'memorial',
  'remembrance',
  'cemetery',
  'grave',
  'war memorial',
  'bridge of remembrance',
  'close-up',
  'closeup',
  'close up',
  'macro',
  'butterfly',
  'insect',
  'bird',
  'dogs',
  'dog ',
  'cat ',
  'cats',
  'sailors',
  'navy',
  'interior of',
  'inside the',
  'museum exhibit',
  'lights at',
  'night lights',
  'christmas lights',
  // Car models pollute "skyline" searches.
  'nissan skyline',
  'prince skyline',
  'ford galaxie',
  'skyliner',
  'gts-x',
  'coupe',
  // Street-level / documentary — poor place thumbnails.
  'busy',
  'street view',
  'high angle view of busy',
  '.pdf',
  '(ia ',
  // Quirky / personal viewpoints — not the place's iconic landscape.
  'vacant',
  'abandoned',
  'derelict',
  'from vacant',
  'my house',
  'our house',
  'bedroom',
  'backyard',
  'back yard',
  'living room',
  'kitchen',
  'stream valley',
]

/** Strong “this is the place” cues for city/town thumbs. */
const ICONIC_PLACE_HINTS = [
  'harbour',
  'harbor',
  'skyline',
  'cityscape',
  'waterfront',
  'aerial',
  'drone',
  'downtown',
  'cbd',
  'lookout',
  'from above',
  'glacier',
  'lake ',
  ' mountains',
]

/** Title patterns that are almost never modern travel landscapes. */
const TITLE_REJECT_RE = [
  /\b(ca\.?|circa|c\.)\s*1[6-9]\d{2}\b/i,
  /\b1[6-8]\d{2}\s*[-–—]\s*1[6-9]\d{2}\b/,
  /\b1[6-8]\d{2}\b/,
  /\b(19[0-6]\d)\b/, // pre-1970 still usually archival for our purposes when undated EXIF
]

/** Scenic modern photo cues (panorama intentionally omitted — crops badly as a circle). */
const SCENIC_HINTS = [
  'landscape',
  'aerial',
  'drone',
  'skyline',
  'harbor',
  'harbour',
  'waterfront',
  'downtown',
  'bay',
  'coast',
  'beach',
  'mountains',
  'mountain',
  'lake',
  'river',
  'sunset',
  'sunrise',
  'cityscape',
  'townscape',
  'lookout',
  'viewpoint',
  'view of',
  'view from',
  'from above',
  'hills',
  'valley',
  'glacier',
  'fjord',
  'sound',
]

export type LocationPhotoOptions = {
  /** Prefer a resized Commons thumb (good for 56px avatars). */
  thumbWidth?: number
  /** `best` = stable top score; `random` = pick from a top pool (hero banners). */
  pick?: 'best' | 'random'
  /** Minimum source width/height before accepting a candidate. */
  minWidth?: number
  minHeight?: number
  /**
   * `avatar` — modern landscape that crops well to a circle.
   * `hero` — wide scenic banner (still prefers modern photos).
   */
  purpose?: 'avatar' | 'hero'
}

type ExtMeta = Record<string, { value?: string } | undefined>

/** Fold māori macrons etc. so "Wānaka" hits the same Commons files as "Wanaka". */
function foldDiacritics(s: string): string {
  try {
    return s.normalize('NFD').replace(/\p{M}/gu, '')
  } catch {
    return s
  }
}

function primaryPlaceQuery(location: string): string {
  const t = foldDiacritics(location).trim()
  if (!t) return ''
  const first = t.split(',')[0]?.trim() ?? t
  return first.length >= 2 ? first : t
}

function contextFromQuery(location: string): string {
  const parts = foldDiacritics(location)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return ''
  return parts.slice(1).join(' ').toLowerCase()
}

/** Extra search seeds when the place name implies a natural feature. */
function featureSearches(primary: string, contextNorm: string): string[] {
  const p = primary.toLowerCase()
  const ctx = contextNorm ? ` ${contextNorm}` : ''
  const out: string[] = []
  if (/\bfranz josef\b|\bfox glacier\b|\bjosef\b/.test(p)) {
    out.push(`Franz Josef Glacier${ctx}`, `Franz Josef Glacier${ctx} aerial`, `Franz Josef Glacier${ctx} landscape`)
  }
  if (/\bwanaka\b|\bwānaka\b/.test(p)) {
    out.push(`Lake Wanaka${ctx}`, `Lake Wanaka${ctx} landscape`, `Wanaka${ctx} aerial`)
  }
  if (/\bqueenstown\b/.test(p)) {
    out.push(`Queenstown${ctx} lake`, `Queenstown${ctx} aerial`, `Queenstown${ctx} skyline`)
  }
  if (/\bchristchurch\b/.test(p)) {
    out.push(
      `Christchurch${ctx} cityscape`,
      `Christchurch${ctx} aerial`,
      `Christchurch${ctx} city`,
      `Christchurch${ctx} harbour`,
    )
  }
  if (/\bwellington\b/.test(p)) {
    out.push(
      `Wellington${ctx} harbour`,
      `Wellington Harbour${ctx}`,
      `Wellington${ctx} waterfront`,
      `Wellington${ctx} cityscape`,
      `Wellington${ctx} aerial`,
      `Oriental Bay Wellington${ctx}`,
    )
  }
  return out
}

function cacheKey(location: string, opts: LocationPhotoOptions): string {
  const pick = opts.pick ?? 'best'
  const tw = opts.thumbWidth ?? 0
  const purpose = opts.purpose ?? (tw ? 'avatar' : 'hero')
  return `${purpose}:${pick}:${tw}:${location.trim().toLowerCase()}`
}

function readPersistentCache(key: string): string | null | undefined {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return undefined
    const map = JSON.parse(raw) as Record<string, string | null>
    if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined
    return map[key] ?? null
  } catch {
    return undefined
  }
}

function writePersistentCache(key: string, url: string | null): void {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY)
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, string | null>
    map[key] = url
    const keys = Object.keys(map)
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 160)) delete map[k]
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore quota / private mode */
  }
}

export function peekLocationPhotoCache(
  location: string,
  opts: LocationPhotoOptions = { pick: 'best', thumbWidth: 256, purpose: 'avatar' },
): string | null {
  const key = cacheKey(location, opts)
  if (memoryCache.has(key)) return memoryCache.get(key) ?? null
  const persisted = readPersistentCache(key)
  if (persisted !== undefined) {
    memoryCache.set(key, persisted)
    return persisted
  }
  return null
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Pull a 4-digit year from Commons extmetadata / title. */
function extractYear(...sources: Array<string | undefined>): number | null {
  for (const raw of sources) {
    if (!raw) continue
    const text = stripHtml(raw)
    // Prefer full ISO-ish dates first.
    const iso = text.match(/\b(20\d{2}|19\d{2}|18\d{2})[-/.]\d{1,2}[-/.]\d{1,2}\b/)
    if (iso) return Number(iso[1])
    const taken = text.match(
      /\b(?:taken on|taken|dated|date|ca\.?|circa)[^\d]{0,12}(20\d{2}|19\d{2}|18\d{2})\b/i,
    )
    if (taken) return Number(taken[1])
    // Range like "1879-1892" → treat as the earlier (archival) year.
    const range = text.match(/\b(1[6-9]\d{2})\s*[-–—]\s*(1[6-9]\d{2})\b/)
    if (range) return Number(range[1])
    const years = [...text.matchAll(/\b(20\d{2}|19\d{2}|18\d{2})\b/g)].map((m) => Number(m[1]))
    if (years.length) {
      const modern = years.filter((y) => y >= 1990 && y <= new Date().getFullYear() + 1)
      if (modern.length) return Math.max(...modern)
      return Math.min(...years)
    }
  }
  return null
}

/** Local hour 0–23 from EXIF-ish strings, if present. */
function extractHour(...sources: Array<string | undefined>): number | null {
  for (const raw of sources) {
    if (!raw) continue
    const text = stripHtml(raw)
    const m =
      text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/) ||
      text.match(/\b([01]?\d|2[0-3])[.h]([0-5]\d)\b/)
    if (m) return Number(m[1])
  }
  return null
}

function isArchivalTitle(titleNorm: string): boolean {
  return TITLE_REJECT_RE.some((re) => re.test(titleNorm))
}

function metaValue(meta: ExtMeta | undefined, key: string): string {
  return stripHtml(String(meta?.[key]?.value ?? ''))
}

function contextHitSafe(titleNorm: string, contextNorm: string): boolean {
  if (!contextNorm) return false
  return contextNorm
    .split(/[\s,.-]+/)
    .filter((t) => t.length >= 4)
    .some((t) => titleNorm.includes(t))
}

function scoreCandidate(args: {
  titleNorm: string
  primaryNorm: string
  queryTokens: string[]
  contextNorm: string
  year: number | null
  hour: number | null
  width: number
  height: number
  descriptionNorm: string
  purpose: 'avatar' | 'hero'
}): number {
  const {
    titleNorm,
    primaryNorm,
    queryTokens,
    contextNorm,
    year,
    hour,
    width,
    height,
    descriptionNorm,
    purpose,
  } = args

  if (queryTokens.length === 0) {
    if (primaryNorm.length < 3 || !titleNorm.includes(primaryNorm)) return -1
  } else {
    const matched = queryTokens.filter((token) => titleNorm.includes(token)).length
    if (matched === 0) return -1
  }

  let score = 0
  const blob = `${titleNorm} ${descriptionNorm}`

  if (primaryNorm.length >= 3 && titleNorm.includes(primaryNorm)) score += 18
  const matched = queryTokens.filter((token) => titleNorm.includes(token)).length
  score += matched * 4
  if (queryTokens.length >= 2 && matched < 2) score -= 6

  const scenicHits = SCENIC_HINTS.filter((hint) => blob.includes(hint)).length
  score += scenicHits * 5
  if (purpose === 'avatar' && scenicHits === 0) score -= 12
  if (/\blandscape\b/.test(blob)) score += 10

  const iconicHits = ICONIC_PLACE_HINTS.filter((hint) => blob.includes(hint)).length
  if (iconicHits > 0) score += 14 + iconicHits * 3
  else if (purpose === 'avatar') score -= 8

  // Personal / interior vantage points even if the bay is in frame.
  if (/\b(house|apartment|flat|window|balcony|rooftop of)\b/.test(titleNorm)) {
    score -= purpose === 'avatar' ? 22 : 10
  }

  // "Skyline" alone is weak — car models and other cities pollute it.
  if (titleNorm.includes('skyline')) {
    if (primaryNorm && titleNorm.includes(primaryNorm)) score += 6
    else score -= 20
  }

  // Ultra-wide panoramas are a poor circular crop; only mild OK for hero banners.
  if (/\bpanorama\b|\bpanoramic\b/.test(titleNorm)) {
    score += purpose === 'hero' ? 2 : -16
  }

  // Night / artificial-light shots often look muddy at 56px.
  if (/\b(lights? at|night view|nightscape|illuminat)\b/.test(blob)) {
    score -= purpose === 'avatar' ? 14 : 4
  }
  if (/\b(busy|street|pedestrian|traffic)\b/.test(blob)) {
    score -= purpose === 'avatar' ? 14 : 6
  }

  if (contextNorm) {
    if (contextHitSafe(titleNorm, contextNorm) || contextHitSafe(descriptionNorm, contextNorm)) {
      score += 24
    } else score -= 20
  }

  if (primaryNorm.length >= 3 && titleNorm.includes(primaryNorm)) {
    const after = titleNorm.split(primaryNorm)[1] ?? ''
    if (
      /\b(bridge|castle|abbey|cathedral|church|palace|manor|station|sailors|navy|museum)\b/.test(
        after,
      ) &&
      !contextHitSafe(titleNorm, contextNorm)
    ) {
      score -= 16
    }
  }

  // Modernity — hard reject handled earlier; still rank newer higher.
  if (year != null) {
    if (year >= 2020) score += 18
    else if (year >= PREFERRED_PHOTO_YEAR) score += 12
    else if (year >= MIN_PHOTO_YEAR) score += 4
  } else {
    // Unknown date: keep as weak fallback only.
    score -= 8
  }

  // Daylight landscapes read much better as tiny circular thumbs.
  if (hour != null) {
    if (hour >= 7 && hour <= 18) score += 14
    else if (hour >= 19 || hour <= 5) score -= 16
  }

  // Year baked into the filename (e.g. "… 1987.jpg").
  const titleYear = extractYear(titleNorm)
  if (titleYear != null && titleYear < MIN_PHOTO_YEAR) return -1

  const mp = (width * height) / 1_000_000
  if (mp >= 24) score += 10
  else if (mp >= 12) score += 6
  else if (mp >= 6) score += 3
  else score -= 2

  const ratio = width / Math.max(1, height)
  if (purpose === 'avatar') {
    // Circle crop wants roughly landscape-to-square, not a strip panorama.
    if (ratio >= 1.05 && ratio <= 1.7) score += 8
    else if (ratio > 1.7 && ratio <= 2.1) score += 2
    else if (ratio > 2.3) score -= 18
    if (ratio < 0.85) score -= 6
  } else {
    if (ratio >= 1.3) score += 3
    if (ratio < 1) score -= 2
  }

  return score
}

async function fetchLocationPhotoUncached(
  location: string,
  opts: LocationPhotoOptions,
): Promise<string | null> {
  const q = foldDiacritics(location).trim()
  if (!q) return null

  const pick = opts.pick ?? 'best'
  const thumbWidth = opts.thumbWidth
  const purpose = opts.purpose ?? (thumbWidth ? 'avatar' : 'hero')
  const minWidth = opts.minWidth ?? (purpose === 'avatar' ? 800 : 1200)
  const minHeight = opts.minHeight ?? (purpose === 'avatar' ? 600 : 700)

  const primary = primaryPlaceQuery(q)
  const primaryNorm = primary.toLowerCase().replace(/_/g, ' ')
  const contextNorm = contextFromQuery(q)
  const rawTokens = primary
    .toLowerCase()
    .split(/[\s,.-]+/)
    .filter(Boolean)
  let queryTokens =
    rawTokens.length === 1 && rawTokens[0].length >= 3
      ? rawTokens
      : rawTokens.filter((t) => t.length >= 3)

  if (queryTokens.length === 0) {
    const fromFull = q
      .toLowerCase()
      .split(/[\s,.-]+/)
      .filter((t) => t.length >= 4)
    if (fromFull.length) queryTokens = fromFull
    else if (primaryNorm.length >= 3) queryTokens = [primaryNorm]
  }

  const scoped = contextNorm
    ? [
        `${primary} ${contextNorm} landscape`,
        `${primary} ${contextNorm} aerial`,
        `${primary} ${contextNorm} drone`,
        `${primary} ${contextNorm} cityscape`,
        `${primary} ${contextNorm}`,
      ]
    : []

  const searches = [
    ...featureSearches(primary, contextNorm),
    ...scoped,
    `${primary} landscape`,
    `${primary} aerial view`,
    `${primary} drone`,
    `${primary} view of`,
    `${primary} lookout`,
    `${primary} mountains`,
    `${primary} lake`,
    `${primary} glacier`,
    `${primary} harbour`,
    `${primary} waterfront`,
    `${primary} cityscape`,
    `${primary} coast`,
  ]

  const fetchCandidates = async (search: string) => {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: search,
      gsrnamespace: '6',
      gsrlimit: '30',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      format: 'json',
      origin: '*',
    })
    if (thumbWidth) params.set('iiurlwidth', String(thumbWidth))

    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`)
    if (!res.ok) return []
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string
            imageinfo?: Array<{
              url?: string
              thumburl?: string
              width?: number
              height?: number
              mime?: string
              extmetadata?: ExtMeta
            }>
          }
        >
      }
    }
    const pages = data?.query?.pages ? Object.values(data.query.pages) : []

    return pages
      .map((p) => {
        const info = p?.imageinfo?.[0]
        const fullUrl = info?.url
        const url = (thumbWidth && info?.thumburl) || fullUrl
        const width = Number(info?.width ?? 0)
        const height = Number(info?.height ?? 0)
        const titleRaw = String(p?.title ?? '')
        const titleNorm = titleRaw.toLowerCase().replace(/_/g, ' ')
        if (typeof url !== 'string' || !url) return null
        if (width < minWidth || height < minHeight) return null
        const mime = String(info?.mime ?? '')
        if (mime && mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
          return null
        }

        for (const noise of TITLE_NOISE) {
          if (titleNorm.includes(noise)) return null
        }
        for (const noise of CLOSEUP_NOISE) {
          if (titleNorm.includes(noise)) return null
        }
        if (/\brp-[a-z]-\d/.test(titleNorm) || /titel op object/.test(titleNorm)) return null
        if (isArchivalTitle(titleNorm)) return null

        const meta = info?.extmetadata
        const dateOriginal = metaValue(meta, 'DateTimeOriginal')
        const dateTime = metaValue(meta, 'DateTime')
        const dateMeta = metaValue(meta, 'DateTimeMetadata')
        const descriptionNorm = metaValue(meta, 'ImageDescription').toLowerCase()
        const year = extractYear(dateOriginal, dateTime, dateMeta, titleRaw)
        const hour = extractHour(dateOriginal, dateTime, dateMeta)
        // Archival ranges in the title win over a modern upload/EXIF date.
        if (isArchivalTitle(titleNorm) || (year != null && year < MIN_PHOTO_YEAR)) return null

        // Ultra-wide strips are almost always old panorama plates for avatars.
        const ratio = width / Math.max(1, height)
        if (purpose === 'avatar' && ratio > 2.6) return null

        const relevance = scoreCandidate({
          titleNorm,
          primaryNorm,
          queryTokens,
          contextNorm,
          year,
          hour,
          width,
          height,
          descriptionNorm,
          purpose,
        })
        if (relevance < 0) return null

        return { url, score: relevance, width, height, title: titleNorm, year }
      })
      .filter(
        (
          x,
        ): x is {
          url: string
          score: number
          width: number
          height: number
          title: string
          year: number | null
        } => Boolean(x),
      )
  }

  try {
    const allCandidates: {
      url: string
      score: number
      width: number
      height: number
      title: string
      year: number | null
    }[] = []
    // Don't stop at the first "okay" lake shot — keep searching long enough to
    // find daylight / higher-res options (Wanaka northern-part vs lake landscape).
    const minSearchesBeforeEarlyExit = Math.min(5, searches.length)
    for (let i = 0; i < searches.length; i++) {
      const candidates = await fetchCandidates(searches[i])
      allCandidates.push(...candidates)
      const strongModernScenic = allCandidates.some(
        (c) =>
          c.score >= 55 &&
          c.year != null &&
          c.year >= 2020 &&
          SCENIC_HINTS.some((h) => c.title.includes(h)) &&
          (!contextNorm || contextHitSafe(c.title, contextNorm)),
      )
      if (i + 1 >= minSearchesBeforeEarlyExit && strongModernScenic) break
      if (allCandidates.length >= 40) break
    }

    if (allCandidates.length === 0) return null
    const deduped = allCandidates
      .sort((a, b) => b.score - a.score)
      .filter((c, idx, arr) => arr.findIndex((x) => x.url === c.url) === idx)

    const isScenic = (title: string) => SCENIC_HINTS.some((h) => title.includes(h))
    const isIconic = (title: string) => ICONIC_PLACE_HINTS.some((h) => title.includes(h))
    const scenic = deduped.filter((c) => isScenic(c.title))
    const iconicModern = deduped.filter(
      (c) => isIconic(c.title) && c.year != null && c.year >= PREFERRED_PHOTO_YEAR,
    )
    const scenicModern = scenic.filter((c) => c.year != null && c.year >= PREFERRED_PHOTO_YEAR)
    const datedModern = deduped.filter((c) => c.year != null && c.year >= PREFERRED_PHOTO_YEAR)
    // Prefer iconic harbour/skyline/aerial modern shots over random scenic corners.
    const poolSource =
      iconicModern.length > 0
        ? iconicModern
        : scenicModern.length > 0
          ? scenicModern
          : scenic.length > 0
            ? scenic
            : datedModern.length > 0
              ? datedModern
              : deduped

    if (pick === 'random') {
      const pool = poolSource.slice(0, Math.max(1, Math.min(HERO_RANDOM_POOL, poolSource.length)))
      return pool[Math.floor(Math.random() * pool.length)]?.url ?? null
    }
    return poolSource[0]?.url ?? null
  } catch {
    return null
  }
}

/** Cached Commons photo for a place name (optionally "City, Country"). */
export async function fetchLocationPhoto(
  location: string,
  opts: LocationPhotoOptions = {},
): Promise<string | null> {
  const key = cacheKey(location, opts)
  if (memoryCache.has(key)) return memoryCache.get(key) ?? null
  const persisted = readPersistentCache(key)
  if (persisted !== undefined) {
    memoryCache.set(key, persisted)
    return persisted
  }

  const existing = inflight.get(key)
  if (existing) return existing

  const pending = fetchLocationPhotoUncached(location, opts).then((url) => {
    memoryCache.set(key, url)
    writePersistentCache(key, url)
    inflight.delete(key)
    return url
  })
  inflight.set(key, pending)
  return pending
}

/** Dashboard / trip hero — random scenic pick from modern Commons candidates. */
export async function fetchLocationHeroImage(location: string): Promise<string | null> {
  return fetchLocationPhoto(location, { pick: 'random', purpose: 'hero' })
}

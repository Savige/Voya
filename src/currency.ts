export const DISPLAY_CURRENCY_STORAGE_KEY = 'waypoint:display-currency:v1'
export const DEFAULT_DISPLAY_CURRENCY = 'AUD'

const FRANKFURTER_V2_RATES = 'https://api.frankfurter.dev/v2/rates'
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** Common ISO 4217 codes for the display-currency picker (unlock later). */
export const DISPLAY_CURRENCIES: { code: string; label: string }[] = [
  { code: 'USD', label: 'USD — US dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British pound' },
  { code: 'CAD', label: 'CAD — Canadian dollar' },
  { code: 'AUD', label: 'AUD — Australian dollar' },
  { code: 'JPY', label: 'JPY — Japanese yen' },
  { code: 'CHF', label: 'CHF — Swiss franc' },
  { code: 'NZD', label: 'NZD — New Zealand dollar' },
  { code: 'INR', label: 'INR — Indian rupee' },
  { code: 'MXN', label: 'MXN — Mexican peso' },
  { code: 'SGD', label: 'SGD — Singapore dollar' },
  { code: 'SEK', label: 'SEK — Swedish krona' },
]

/** Currencies offered in the Budget converter (Google-style pair picker). */
export const CONVERTER_CURRENCIES: { code: string; label: string }[] = [
  ...DISPLAY_CURRENCIES,
  { code: 'THB', label: 'THB — Thai baht' },
  { code: 'IDR', label: 'IDR — Indonesian rupiah' },
  { code: 'VND', label: 'VND — Vietnamese dong' },
  { code: 'FJD', label: 'FJD — Fijian dollar' },
  { code: 'HKD', label: 'HKD — Hong Kong dollar' },
  { code: 'KRW', label: 'KRW — South Korean won' },
  { code: 'PHP', label: 'PHP — Philippine peso' },
  { code: 'MYR', label: 'MYR — Malaysian ringgit' },
  { code: 'CNY', label: 'CNY — Chinese yuan' },
  { code: 'ZAR', label: 'ZAR — South African rand' },
]

/**
 * Fallback: units of foreign currency per 1 AUD (same shape as Frankfurter v2 base=AUD).
 * Used only when the live API is unreachable.
 */
const FALLBACK_PER_AUD: Record<string, number> = {
  AUD: 1,
  NZD: 1.09,
  USD: 0.65,
  EUR: 0.6,
  GBP: 0.51,
  CAD: 0.9,
  JPY: 100,
  CHF: 0.57,
  SGD: 0.87,
  SEK: 6.9,
  INR: 55,
  MXN: 12,
}

/** Country / destination name → ISO currency (trip.country strings). */
const COUNTRY_CURRENCY: { match: RegExp; code: string }[] = [
  { match: /\b(australia|australian)\b/i, code: 'AUD' },
  { match: /\b(new\s*zealand|aotearoa)\b/i, code: 'NZD' },
  { match: /\b(united\s*states|usa|u\.s\.a\.?)\b/i, code: 'USD' },
  { match: /\b(united\s*kingdom|england|scotland|wales|britain|great\s*britain)\b/i, code: 'GBP' },
  { match: /\b(japan|japanese)\b/i, code: 'JPY' },
  { match: /\b(canada|canadian)\b/i, code: 'CAD' },
  { match: /\b(singapore)\b/i, code: 'SGD' },
  { match: /\b(switzerland|swiss)\b/i, code: 'CHF' },
  { match: /\b(india|indian)\b/i, code: 'INR' },
  { match: /\b(mexico|mexican)\b/i, code: 'MXN' },
  { match: /\b(sweden|swedish)\b/i, code: 'SEK' },
  { match: /\b(france|germany|italy|spain|netherlands|portugal|ireland|austria|belgium|finland|greece|eurozone|europe)\b/i, code: 'EUR' },
  { match: /\b(thailand)\b/i, code: 'THB' },
  { match: /\b(indonesia|bali)\b/i, code: 'IDR' },
  { match: /\b(vietnam)\b/i, code: 'VND' },
  { match: /\b(fiji)\b/i, code: 'FJD' },
]

export type FxSnapshot = {
  asOf: string
  /** Quote units per 1 AUD (Frankfurter v2 shape with base=AUD). */
  perAud: Record<string, number>
  source: 'live' | 'fallback'
}

let fxCache: { at: number; snapshot: FxSnapshot } | null = null
let fxInflight: Promise<FxSnapshot> | null = null

/** Display currency is locked to AUD for now (picker comes later). */
export function loadDisplayCurrency(): string {
  return DEFAULT_DISPLAY_CURRENCY
}

/** No-op until multi-currency UI returns — always stay on AUD. */
export function saveDisplayCurrency(_code: string): void {
  try {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, DEFAULT_DISPLAY_CURRENCY)
  } catch {
    /* ignore */
  }
}

/** Infer destination ISO currency from a trip country / destination string. */
export function currencyForCountry(countryOrDestination: string | undefined | null): string {
  const raw = String(countryOrDestination || '').trim()
  if (!raw) return DEFAULT_DISPLAY_CURRENCY
  if (/^[A-Z]{3}$/i.test(raw)) return raw.toUpperCase()
  for (const row of COUNTRY_CURRENCY) {
    if (row.match.test(raw)) return row.code
  }
  return DEFAULT_DISPLAY_CURRENCY
}

/** Full English currency name for converter UI (e.g. "New Zealand Dollar"). */
export function currencyFullName(code: string): string {
  const c = code.trim().toUpperCase()
  if (!c) return ''
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(c)
    if (name) return name
  } catch {
    /* fall through */
  }
  const row = CONVERTER_CURRENCIES.find((x) => x.code === c)
  if (row) {
    const stripped = row.label.replace(/^[A-Z]{3}\s*[—–-]\s*/i, '').trim()
    if (stripped) {
      return stripped.replace(/\b\w/g, (ch) => ch.toUpperCase())
    }
  }
  return c
}

export function formatMoneyAmount(value: number, currencyCode: string): string {
  const code = currencyCode.toUpperCase()
  const maxFrac = code === 'JPY' ? 0 : 2
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: maxFrac,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: DEFAULT_DISPLAY_CURRENCY,
      maximumFractionDigits: 2,
    }).format(value)
  }
}

export type ParsedMoney = {
  amount: number
  currency: string | null
  raw: string
}

/** Parse strings like "NZD 420", "AUD 125.60", "$274.35", "A$12". */
export function parseMoney(raw?: string): ParsedMoney | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t) return null
  const cleaned = t.replace(/,/g, '')
  const m =
    cleaned.match(/^([A-Z]{3})\s*\$?\s*(-?\d+(?:\.\d+)?)$/i) ||
    cleaned.match(/^([A$]|NZ\$|A\$|US\$)\s*(-?\d+(?:\.\d+)?)$/i) ||
    cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([A-Z]{3})$/i) ||
    cleaned.match(/^\$\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) {
    const n = cleaned.match(/-?\d+(?:\.\d+)?/)
    if (!n) return null
    return { amount: Number(n[0]), currency: null, raw: t }
  }
  let currency: string | null = null
  let amount = 0
  if (m[1] && /^-?\d/.test(m[1])) {
    amount = Number(m[1])
    currency = (m[2] || '').toUpperCase() || null
  } else if (m[2] && /^-?\d/.test(m[2])) {
    amount = Number(m[2])
    const sym = (m[1] || '').toUpperCase()
    if (sym === '$' || sym === 'A$' || sym === 'AU$') currency = 'AUD'
    else if (sym === 'NZ$') currency = 'NZD'
    else if (sym === 'US$') currency = 'USD'
    else currency = sym.length === 3 ? sym : null
  } else {
    return null
  }
  if (!Number.isFinite(amount)) return null
  return { amount, currency, raw: t }
}

function fallbackSnapshot(): FxSnapshot {
  return {
    asOf: new Date().toISOString().slice(0, 10),
    perAud: { ...FALLBACK_PER_AUD },
    source: 'fallback',
  }
}

type FrankfurterV2Row = { date?: string; base?: string; quote?: string; rate?: number }

async function fetchLiveSnapshot(): Promise<FxSnapshot> {
  const res = await fetch(`${FRANKFURTER_V2_RATES}?base=AUD`)
  if (!res.ok) throw new Error(`fx http ${res.status}`)
  const data = (await res.json()) as FrankfurterV2Row[] | { rates?: Record<string, number>; date?: string }
  const perAud: Record<string, number> = { AUD: 1 }
  let asOf = ''

  if (Array.isArray(data)) {
    for (const row of data) {
      const quote = String(row.quote || '').toUpperCase()
      const rate = Number(row.rate)
      if (!quote || !Number.isFinite(rate) || rate <= 0) continue
      perAud[quote] = rate
      if (row.date && (!asOf || String(row.date) > asOf)) asOf = String(row.date)
    }
  } else if (data && typeof data === 'object' && data.rates) {
    // Compatibility if a map-shaped response appears.
    asOf = String(data.date || '')
    for (const [code, per] of Object.entries(data.rates)) {
      if (typeof per === 'number' && per > 0) perAud[code.toUpperCase()] = per
    }
  } else {
    throw new Error('fx shape')
  }

  if (Object.keys(perAud).length < 2) throw new Error('fx empty')
  return {
    asOf: asOf || new Date().toISOString().slice(0, 10),
    perAud,
    source: 'live',
  }
}

/** Latest FX snapshot (live Frankfurter v2, or fallback). Shared by Budget + imports. */
export async function getFxSnapshot(force = false): Promise<FxSnapshot> {
  const now = Date.now()
  if (!force && fxCache && now - fxCache.at < FX_CACHE_TTL_MS) {
    return fxCache.snapshot
  }
  if (!force && fxInflight) return fxInflight

  fxInflight = (async () => {
    try {
      const snapshot = await fetchLiveSnapshot()
      fxCache = { at: Date.now(), snapshot }
      return snapshot
    } catch {
      const snapshot = fallbackSnapshot()
      // Don't overwrite a still-fresh live cache on transient failure.
      if (!fxCache || Date.now() - fxCache.at >= FX_CACHE_TTL_MS) {
        fxCache = { at: Date.now(), snapshot }
      }
      return fxCache.snapshot.source === 'live' ? fxCache.snapshot : snapshot
    } finally {
      fxInflight = null
    }
  })()

  return fxInflight
}

function perAudOf(snapshot: FxSnapshot, code: string): number {
  const c = code.toUpperCase()
  return snapshot.perAud[c] ?? FALLBACK_PER_AUD[c] ?? 1
}

/** Convert amount between ISO currencies using snapshot (AUD pivot). */
export function convertAmountWithSnapshot(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  snapshot: FxSnapshot,
): number {
  if (!Number.isFinite(amount)) return 0
  const from = fromCurrency.toUpperCase()
  const to = toCurrency.toUpperCase()
  if (from === to) return amount
  const inAud = amount / perAudOf(snapshot, from)
  return inAud * perAudOf(snapshot, to)
}

export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string = DEFAULT_DISPLAY_CURRENCY,
): Promise<number> {
  const snapshot = await getFxSnapshot()
  return convertAmountWithSnapshot(amount, fromCurrency, toCurrency, snapshot)
}

/** AUD per 1 unit of `currency` (for rate display). */
export function audPerUnit(currency: string, snapshot: FxSnapshot): number {
  const c = currency.toUpperCase()
  if (c === 'AUD') return 1
  const per = perAudOf(snapshot, c)
  return per > 0 ? 1 / per : 0
}

/** How many units of `to` equal 1 unit of `from`. */
export function rateBetween(fromCurrency: string, toCurrency: string, snapshot: FxSnapshot): number {
  return convertAmountWithSnapshot(1, fromCurrency, toCurrency, snapshot)
}

/** Format a converter amount for the paired field (avoids long float noise). */
export function formatConverterAmount(value: number, currencyCode: string): string {
  if (!Number.isFinite(value)) return ''
  const code = currencyCode.toUpperCase()
  const abs = Math.abs(value)
  let digits = 2
  if (code === 'JPY' || code === 'KRW' || code === 'VND' || code === 'IDR') digits = 0
  else if (abs > 0 && abs < 0.01) digits = 6
  else if (abs > 0 && abs < 1) digits = 4
  const fixed = value.toFixed(digits)
  // Trim trailing zeros after decimal, keep at least one digit for decimals when needed.
  if (!fixed.includes('.')) return fixed
  return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

function rateToAudMultiplierSync(currency: string): number {
  const c = currency.toUpperCase()
  if (c === 'AUD') return 1
  const per = fxCache?.snapshot.perAud[c] ?? FALLBACK_PER_AUD[c] ?? 1
  return per > 0 ? 1 / per : 1
}

/** Convert a money string into display currency; keeps original when different. */
export async function convertMoneyString(
  raw: string | undefined,
  toCurrency: string = DEFAULT_DISPLAY_CURRENCY,
): Promise<{ display: string; original: string | null; currency: string | null }> {
  const parsed = parseMoney(raw)
  if (!parsed) return { display: (raw || '').trim(), original: null, currency: null }
  const from = (parsed.currency || toCurrency).toUpperCase()
  const to = toCurrency.toUpperCase()
  if (from === to) {
    return {
      display: formatMoneyAmount(parsed.amount, to),
      original: null,
      currency: from,
    }
  }
  const converted = await convertAmount(parsed.amount, from, to)
  return {
    display: formatMoneyAmount(converted, to),
    original: `${from} ${parsed.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    currency: from,
  }
}

/** Sync convert using cached/fallback rates. */
export function convertMoneyToDisplaySync(
  raw: string | undefined,
  toCurrency: string = DEFAULT_DISPLAY_CURRENCY,
): number {
  const parsed = parseMoney(raw)
  if (!parsed) return 0
  const from = (parsed.currency || toCurrency).toUpperCase()
  const to = toCurrency.toUpperCase()
  if (from === to) return parsed.amount
  const inAud = parsed.amount * rateToAudMultiplierSync(from)
  if (to === 'AUD') return inAud
  const toPerAud = fxCache?.snapshot.perAud[to] ?? FALLBACK_PER_AUD[to] ?? 1
  return inAud * toPerAud
}

export function formatMoneyWithOriginal(
  display: string,
  original: string | null | undefined,
): string {
  if (!original) return display
  return `${display} (${original})`
}

/** Warm FX cache (non-blocking). */
export function prefetchFxRates(): void {
  void getFxSnapshot()
}

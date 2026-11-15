import {
  convertAmountWithSnapshot,
  convertMoneyToDisplaySync,
  DEFAULT_DISPLAY_CURRENCY,
  formatMoneyAmount,
  parseMoney,
  type FxSnapshot,
} from './currency'
import {
  stayAccommodations,
  type Trip,
} from './tripTypes'

export type BudgetCategoryId = 'flights' | 'cars' | 'lodging' | 'food' | 'activities'

export type BudgetLineItem = {
  id: string
  category: BudgetCategoryId
  label: string
  amountAud: number
  display: string
  original: string | null
}

export type BudgetCategoryGroup = {
  id: BudgetCategoryId
  label: string
  subtotalAud: number
  display: string
  items: BudgetLineItem[]
}

export type TripBudgetSummary = {
  currency: string
  totalAud: number
  totalDisplay: string
  paidAud: number
  paidDisplay: string
  owingAud: number
  owingDisplay: string
  categories: BudgetCategoryGroup[]
  itemCount: number
}

const CATEGORY_ORDER: Array<{ id: BudgetCategoryId; label: string }> = [
  { id: 'flights', label: 'Flights' },
  { id: 'cars', label: 'Cars' },
  { id: 'lodging', label: 'Lodging' },
  { id: 'food', label: 'Food' },
  { id: 'activities', label: 'Activities' },
]

/** Convert a money string to AUD using snapshot when provided. */
export function moneyStringToAud(
  raw: string | undefined,
  snapshot?: FxSnapshot | null,
): number {
  const parsed = parseMoney(raw)
  if (!parsed) return 0
  const from = (parsed.currency || DEFAULT_DISPLAY_CURRENCY).toUpperCase()
  if (from === 'AUD') return parsed.amount
  if (snapshot) return convertAmountWithSnapshot(parsed.amount, from, 'AUD', snapshot)
  return convertMoneyToDisplaySync(raw, 'AUD')
}

function resolveOriginal(
  displayRaw: string | undefined,
  originalRaw: string | undefined,
  currencyHint?: string,
): string | null {
  const explicit = (originalRaw || '').trim()
  if (explicit) return explicit
  const parsed = parseMoney(displayRaw)
  if (!parsed) return null
  const from = (parsed.currency || currencyHint || '').toUpperCase()
  if (!from || from === 'AUD') return null
  return `${from} ${parsed.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function pushItem(
  items: BudgetLineItem[],
  partial: {
    id: string
    category: BudgetCategoryId
    label: string
    amountRaw?: string
    originalRaw?: string
    currency?: string
  },
  snapshot?: FxSnapshot | null,
): void {
  const amountRaw = (partial.amountRaw || '').trim()
  if (!amountRaw) return
  const amountAud = moneyStringToAud(amountRaw, snapshot)
  if (!Number.isFinite(amountAud) || amountAud === 0) {
    // Keep zero-priced rows only when the string parsed to an explicit 0.
    const parsed = parseMoney(amountRaw)
    if (!parsed || parsed.amount !== 0) return
  }
  items.push({
    id: partial.id,
    category: partial.category,
    label: partial.label.trim() || 'Item',
    amountAud,
    display: formatMoneyAmount(amountAud, DEFAULT_DISPLAY_CURRENCY),
    original: resolveOriginal(amountRaw, partial.originalRaw, partial.currency),
  })
}

/** Build a read-only AUD spend rollup for the Budget tab. */
export function buildTripBudgetSummary(
  trip: Trip | null | undefined,
  snapshot?: FxSnapshot | null,
): TripBudgetSummary {
  const empty: TripBudgetSummary = {
    currency: DEFAULT_DISPLAY_CURRENCY,
    totalAud: 0,
    totalDisplay: formatMoneyAmount(0, DEFAULT_DISPLAY_CURRENCY),
    paidAud: 0,
    paidDisplay: formatMoneyAmount(0, DEFAULT_DISPLAY_CURRENCY),
    owingAud: 0,
    owingDisplay: formatMoneyAmount(0, DEFAULT_DISPLAY_CURRENCY),
    categories: [],
    itemCount: 0,
  }
  if (!trip) return empty

  const lines: BudgetLineItem[] = []
  const bookings = trip.bookings

  for (const f of bookings?.flights || []) {
    const label =
      [f.airline, f.flightNumber].filter(Boolean).join(' ').trim() ||
      f.route ||
      [f.fromIata, f.toIata].filter(Boolean).join(' → ') ||
      'Flight'
    pushItem(
      lines,
      { id: `flight:${f.id}`, category: 'flights', label, amountRaw: f.price },
      snapshot,
    )
  }

  for (const c of bookings?.rentalCars || []) {
    const label = c.company.trim() || 'Rental car'
    pushItem(
      lines,
      { id: `car:${c.id}`, category: 'cars', label, amountRaw: c.price },
      snapshot,
    )
  }

  /** Prefer a non-zero total; never let "NZD 0" paid hide price/owing. */
  const pickLodgingAmount = (row: {
    price?: string
    amountPaid?: string
    amountOwing?: string
    priceOriginal?: string
    amountPaidOriginal?: string
    amountOwingOriginal?: string
  }): { amountRaw: string; originalRaw?: string } => {
    const price = (row.price || '').trim()
    const paid = (row.amountPaid || '').trim()
    const owing = (row.amountOwing || '').trim()
    const priceN = moneyStringToAud(price, snapshot)
    if (price && priceN !== 0) {
      return {
        amountRaw: price,
        originalRaw: (row.priceOriginal || '').trim() || undefined,
      }
    }
    const paidN = moneyStringToAud(paid, snapshot)
    const owingN = moneyStringToAud(owing, snapshot)
    if (owing && owingN !== 0 && (!paid || paidN === 0)) {
      return {
        amountRaw: owing,
        originalRaw: (row.amountOwingOriginal || '').trim() || undefined,
      }
    }
    if (paid && paidN !== 0) {
      return {
        amountRaw: paid,
        originalRaw: (row.amountPaidOriginal || '').trim() || undefined,
      }
    }
    if (owing) {
      return {
        amountRaw: owing,
        originalRaw: (row.amountOwingOriginal || '').trim() || undefined,
      }
    }
    if (price) {
      return {
        amountRaw: price,
        originalRaw: (row.priceOriginal || '').trim() || undefined,
      }
    }
    if (paid) {
      return {
        amountRaw: paid,
        originalRaw: (row.amountPaidOriginal || '').trim() || undefined,
      }
    }
    return { amountRaw: '' }
  }

  // Stay lodgings are the planner source of truth. Also pick up orphan rows
  // still only on bookings.accommodations (or stay rows with empty money).
  const lodgingIds = new Set<string>()
  const lodgingConfs = new Set<string>()
  const lodgingConfHasMoney = new Set<string>()
  for (const stay of trip.stays || []) {
    for (const lodging of stayAccommodations(stay)) {
      lodgingIds.add(lodging.id)
      const conf = lodging.confirmationRef.trim().toLowerCase()
      if (conf) lodgingConfs.add(conf)
      const { amountRaw, originalRaw } = pickLodgingAmount(lodging)
      if (conf && amountRaw && moneyStringToAud(amountRaw, snapshot) !== 0) {
        lodgingConfHasMoney.add(conf)
      }
      pushItem(
        lines,
        {
          id: `lodging:${lodging.id}`,
          category: 'lodging',
          label: lodging.name || lodging.confirmationRef || stay.location || 'Accommodation',
          amountRaw,
          originalRaw,
          currency: lodging.currency,
        },
        snapshot,
      )
    }
  }
  for (const row of bookings?.accommodations || []) {
    const conf = String(row.confirmation || '')
      .trim()
      .toLowerCase()
    // Skip only when this confirmation already contributed a non-zero stay line.
    if (conf && lodgingConfHasMoney.has(conf)) continue
    if (!conf && lodgingIds.has(row.id)) continue
    const { amountRaw, originalRaw } = pickLodgingAmount(row)
    pushItem(
      lines,
      {
        id: `lodging-booking:${row.id}`,
        category: 'lodging',
        label: row.name || row.confirmation || 'Accommodation',
        amountRaw,
        originalRaw,
        currency: row.currency,
      },
      snapshot,
    )
  }

  for (const r of bookings?.restaurants || []) {
    pushItem(
      lines,
      {
        id: `restaurant:${r.id}`,
        category: 'food',
        label: r.name.trim() || 'Restaurant',
        amountRaw: r.cost,
      },
      snapshot,
    )
  }

  for (const stay of trip.stays || []) {
    for (const activity of stay.activities || []) {
      pushItem(
        lines,
        {
          id: `activity:${activity.id}`,
          category: 'activities',
          label: activity.name.trim() || 'Activity',
          amountRaw: activity.cost,
        },
        snapshot,
      )
    }
  }

  for (const place of trip.visitPlaces || []) {
    pushItem(
      lines,
      {
        id: `visit:${place.id}`,
        category: 'activities',
        label: place.label.trim() || 'Place',
        amountRaw: place.cost,
      },
      snapshot,
    )
  }

  let paidAud = 0
  let owingAud = 0
  for (const stay of trip.stays || []) {
    for (const lodging of stayAccommodations(stay)) {
      paidAud += moneyStringToAud(lodging.amountPaid, snapshot)
      owingAud += moneyStringToAud(lodging.amountOwing, snapshot)
    }
  }

  const categories: BudgetCategoryGroup[] = []
  let totalAud = 0
  for (const meta of CATEGORY_ORDER) {
    const items = lines.filter((x) => x.category === meta.id)
    if (!items.length) continue
    const subtotalAud = items.reduce((sum, x) => sum + x.amountAud, 0)
    totalAud += subtotalAud
    categories.push({
      id: meta.id,
      label: meta.label,
      subtotalAud,
      display: formatMoneyAmount(subtotalAud, DEFAULT_DISPLAY_CURRENCY),
      items,
    })
  }

  return {
    currency: DEFAULT_DISPLAY_CURRENCY,
    totalAud,
    totalDisplay: formatMoneyAmount(totalAud, DEFAULT_DISPLAY_CURRENCY),
    paidAud,
    paidDisplay: formatMoneyAmount(paidAud, DEFAULT_DISPLAY_CURRENCY),
    owingAud,
    owingDisplay: formatMoneyAmount(owingAud, DEFAULT_DISPLAY_CURRENCY),
    categories,
    itemCount: lines.length,
  }
}

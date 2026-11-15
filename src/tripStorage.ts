import { tripsStorageKey } from './auth'
import { findStayForAccommodation } from './lodgingMatch'
import type {
  AccommodationBooking,
  CarBooking,
  FlightBooking,
  MustDo,
  PackListItem,
  RestaurantBooking,
  Stay,
  StayActivity,
  StopAccommodation,
  Trip,
  TripSharing,
  TripsState,
  VisitPlace,
} from './tripTypes'
import { stayAccommodations, stripSharingFromTrip } from './tripTypes'

function newLodgingId(): string {
  return `lodging_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function parseOneStopAccommodation(
  a: any,
  fallback: { location?: string } = {},
): StopAccommodation | null {
  if (!a || typeof a !== 'object') return null
  const confirmationRef = String(a.confirmationRef ?? '').trim()
  const name = String(a.name ?? '').trim()
  const address = String(a.address ?? '').trim()
  const price = String(a.price ?? '').trim()
  const amountPaid = String(a.amountPaid ?? '').trim()
  const amountOwing = String(a.amountOwing ?? '').trim()
  const priceOriginal = String(a.priceOriginal ?? '').trim()
  const amountPaidOriginal = String(a.amountPaidOriginal ?? '').trim()
  const amountOwingOriginal = String(a.amountOwingOriginal ?? '').trim()
  const currency = String(a.currency ?? '').trim()
  const bookingUrl = String(a.bookingUrl ?? '').trim()
  const checkInTime = String(a.checkInTime ?? '').trim()
  const checkOutTime = String(a.checkOutTime ?? '').trim()
  const photoUrl = String(a.photoUrl ?? '').trim()
  // Previously soft-cancelled lodgings are dropped permanently.
  if (a.status === 'cancelled') return null
  // Do NOT invent stay-wide dates here — that blocks booking-row enrichment and hides coverage gaps.
  const checkIn = String(a.checkIn ?? '').trim()
  const checkOut = String(a.checkOut ?? '').trim()
  const id = String(a.id ?? '').trim() || newLodgingId()
  if (!confirmationRef && !name && !address && !price && !bookingUrl && !photoUrl) return null
  return {
    id,
    name: name || confirmationRef || String(fallback.location ?? '').trim() || 'Accommodation',
    address,
    checkIn,
    checkOut,
    checkInTime,
    checkOutTime,
    price,
    ...(amountPaid ? { amountPaid } : {}),
    ...(amountOwing ? { amountOwing } : {}),
    ...(priceOriginal ? { priceOriginal } : {}),
    ...(amountPaidOriginal ? { amountPaidOriginal } : {}),
    ...(amountOwingOriginal ? { amountOwingOriginal } : {}),
    ...(currency ? { currency } : {}),
    bookingUrl,
    confirmationRef,
    ...(photoUrl ? { photoUrl } : {}),
  }
}

function parseStopAccommodations(x: any): StopAccommodation[] {
  const fallback = { location: String(x?.location ?? '').trim() }
  if (Array.isArray(x?.accommodations)) {
    return x.accommodations
      .map((a: any) => parseOneStopAccommodation(a, fallback))
      .filter((a: StopAccommodation | null): a is StopAccommodation => Boolean(a))
  }
  if (x?.accommodation && typeof x.accommodation === 'object') {
    const one = parseOneStopAccommodation(x.accommodation, fallback)
    return one ? [one] : []
  }
  // Legacy flat Stay lodging fields → one nested lodging when any lodging signal exists.
  const confirmationRef = String(x.confirmationRef ?? '').trim()
  const address = String(x.address ?? '').trim()
  const price = String(x.price ?? '').trim()
  const bookingUrl = String(x.bookingUrl ?? '').trim()
  const checkInTime = String(x.checkInTime ?? '').trim()
  const checkOutTime = String(x.checkOutTime ?? '').trim()
  if (!confirmationRef && !address && !price && !bookingUrl && !checkInTime && !checkOutTime) return []
  return [
    {
      id: newLodgingId(),
      name: String(x.location ?? '').trim() || 'Accommodation',
      address,
      checkIn: '',
      checkOut: '',
      checkInTime,
      checkOutTime,
      price,
      bookingUrl,
      confirmationRef,
    },
  ]
}

type BookingDateRow = {
  confirmation?: unknown
  checkIn?: unknown
  checkOut?: unknown
  checkInTime?: unknown
  checkOutTime?: unknown
  photoUrl?: unknown
  price?: unknown
  amountPaid?: unknown
  amountOwing?: unknown
  priceOriginal?: unknown
  amountPaidOriginal?: unknown
  amountOwingOriginal?: unknown
  currency?: unknown
  address?: unknown
  bookingUrl?: unknown
  name?: unknown
}

function pickNonEmpty(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    const t = String(v ?? '').trim()
    if (t) return t
  }
  return ''
}

/** Merge two lodging rows without letting empty strings wipe known fields. */
export function mergeStopAccommodations(
  primary: StopAccommodation,
  secondary: StopAccommodation,
): StopAccommodation {
  const amountPaid = pickNonEmpty(primary.amountPaid, secondary.amountPaid) || undefined
  const amountOwing = pickNonEmpty(primary.amountOwing, secondary.amountOwing) || undefined
  const priceOriginal = pickNonEmpty(primary.priceOriginal, secondary.priceOriginal) || undefined
  const amountPaidOriginal =
    pickNonEmpty(primary.amountPaidOriginal, secondary.amountPaidOriginal) || undefined
  const amountOwingOriginal =
    pickNonEmpty(primary.amountOwingOriginal, secondary.amountOwingOriginal) || undefined
  const currency = pickNonEmpty(primary.currency, secondary.currency) || undefined
  const photoUrl = pickNonEmpty(primary.photoUrl, secondary.photoUrl) || undefined
  return {
    id: primary.id || secondary.id,
    name: pickNonEmpty(primary.name, secondary.name, 'Accommodation'),
    address: pickNonEmpty(primary.address, secondary.address),
    checkIn: pickNonEmpty(primary.checkIn, secondary.checkIn),
    checkOut: pickNonEmpty(primary.checkOut, secondary.checkOut),
    checkInTime: pickNonEmpty(primary.checkInTime, secondary.checkInTime),
    checkOutTime: pickNonEmpty(primary.checkOutTime, secondary.checkOutTime),
    price: pickNonEmpty(primary.price, secondary.price),
    ...(amountPaid ? { amountPaid } : {}),
    ...(amountOwing ? { amountOwing } : {}),
    ...(priceOriginal ? { priceOriginal } : {}),
    ...(amountPaidOriginal ? { amountPaidOriginal } : {}),
    ...(amountOwingOriginal ? { amountOwingOriginal } : {}),
    ...(currency ? { currency } : {}),
    bookingUrl: pickNonEmpty(primary.bookingUrl, secondary.bookingUrl),
    confirmationRef: pickNonEmpty(primary.confirmationRef, secondary.confirmationRef),
    ...(photoUrl ? { photoUrl } : {}),
  }
}

function mergeAccommodationBookings(
  primary: AccommodationBooking,
  secondary: AccommodationBooking,
): AccommodationBooking {
  const amountPaid = pickNonEmpty(primary.amountPaid, secondary.amountPaid) || undefined
  const amountOwing = pickNonEmpty(primary.amountOwing, secondary.amountOwing) || undefined
  const priceOriginal = pickNonEmpty(primary.priceOriginal, secondary.priceOriginal) || undefined
  const amountPaidOriginal =
    pickNonEmpty(primary.amountPaidOriginal, secondary.amountPaidOriginal) || undefined
  const amountOwingOriginal =
    pickNonEmpty(primary.amountOwingOriginal, secondary.amountOwingOriginal) || undefined
  const currency = pickNonEmpty(primary.currency, secondary.currency) || undefined
  const photoUrl = pickNonEmpty(primary.photoUrl, secondary.photoUrl) || undefined
  const address = pickNonEmpty(primary.address, secondary.address) || undefined
  const price = pickNonEmpty(primary.price, secondary.price) || undefined
  const bookingUrl = pickNonEmpty(primary.bookingUrl, secondary.bookingUrl) || undefined
  const checkInTime = pickNonEmpty(primary.checkInTime, secondary.checkInTime) || undefined
  const checkOutTime = pickNonEmpty(primary.checkOutTime, secondary.checkOutTime) || undefined
  return {
    id: primary.id || secondary.id,
    name: pickNonEmpty(primary.name, secondary.name, 'Accommodation'),
    checkIn: pickNonEmpty(primary.checkIn, secondary.checkIn),
    checkOut: pickNonEmpty(primary.checkOut, secondary.checkOut),
    confirmation: pickNonEmpty(primary.confirmation, secondary.confirmation),
    ...(address ? { address } : {}),
    ...(price ? { price } : {}),
    ...(amountPaid ? { amountPaid } : {}),
    ...(amountOwing ? { amountOwing } : {}),
    ...(priceOriginal ? { priceOriginal } : {}),
    ...(amountPaidOriginal ? { amountPaidOriginal } : {}),
    ...(amountOwingOriginal ? { amountOwingOriginal } : {}),
    ...(currency ? { currency } : {}),
    ...(bookingUrl ? { bookingUrl } : {}),
    ...(photoUrl ? { photoUrl } : {}),
    ...(checkInTime ? { checkInTime } : {}),
    ...(checkOutTime ? { checkOutTime } : {}),
    createdAt: Math.min(primary.createdAt || Date.now(), secondary.createdAt || Date.now()),
  }
}

function unionAccommodationsByConfirmation(
  primary: StopAccommodation[],
  secondary: StopAccommodation[],
): StopAccommodation[] {
  const byKey = new Map<string, StopAccommodation>()
  const keyOf = (a: StopAccommodation) => {
    const conf = a.confirmationRef.trim().toLowerCase()
    return conf || `id:${a.id}`
  }
  for (const a of secondary) byKey.set(keyOf(a), a)
  for (const a of primary) {
    const k = keyOf(a)
    const other = byKey.get(k)
    byKey.set(k, other ? mergeStopAccommodations(a, other) : a)
  }
  return [...byKey.values()]
}

function unionBookingAccommodations(
  primary: AccommodationBooking[],
  secondary: AccommodationBooking[],
): AccommodationBooking[] {
  const byKey = new Map<string, AccommodationBooking>()
  const keyOf = (a: AccommodationBooking) => {
    const conf = String(a.confirmation || '')
      .trim()
      .toLowerCase()
    return conf || `id:${a.id}`
  }
  for (const a of secondary) byKey.set(keyOf(a), a)
  for (const a of primary) {
    const k = keyOf(a)
    const other = byKey.get(k)
    byKey.set(k, other ? mergeAccommodationBookings(a, other) : a)
  }
  return [...byKey.values()]
}

/**
 * Copy missing lodging details from Trip.bookings.accommodations onto stop lodgings.
 * Always fills blank price/address/url/times; only overwrites dates when missing or
 * still carrying a legacy stay-wide placeholder.
 */
export function enrichAccommodationsFromBookings(
  accommodations: StopAccommodation[],
  stay: { startDate?: string; endDate?: string },
  bookingRows: BookingDateRow[] | undefined,
): StopAccommodation[] {
  if (!accommodations.length || !bookingRows?.length) return accommodations
  const stayStart = String(stay.startDate ?? '').trim()
  const stayEnd = String(stay.endDate ?? '').trim()
  return accommodations.map((lodging) => {
    const conf = lodging.confirmationRef.trim().toLowerCase()
    if (!conf) return lodging
    const match = bookingRows.find(
      (b) => String(b?.confirmation ?? '').trim().toLowerCase() === conf,
    )
    if (!match) return lodging
    const bIn = String(match.checkIn ?? '').trim()
    const bOut = String(match.checkOut ?? '').trim()

    const hasOwn = Boolean(lodging.checkIn && lodging.checkOut)
    const looksLegacyFullStay =
      hasOwn && stayStart && stayEnd && lodging.checkIn === stayStart && lodging.checkOut === stayEnd
    const takeDates = Boolean(bIn || bOut) && (!hasOwn || looksLegacyFullStay)

    const checkInTime = pickNonEmpty(lodging.checkInTime, String(match.checkInTime ?? ''))
    const checkOutTime = pickNonEmpty(lodging.checkOutTime, String(match.checkOutTime ?? ''))
    const photoUrl = pickNonEmpty(lodging.photoUrl, String(match.photoUrl ?? '')) || undefined
    const price = pickNonEmpty(lodging.price, String(match.price ?? ''))
    const address = pickNonEmpty(lodging.address, String(match.address ?? ''))
    const bookingUrl = pickNonEmpty(lodging.bookingUrl, String(match.bookingUrl ?? ''))
    const name = pickNonEmpty(lodging.name, String(match.name ?? ''), 'Accommodation')
    const amountPaid = pickNonEmpty(lodging.amountPaid, String(match.amountPaid ?? '')) || undefined
    const amountOwing = pickNonEmpty(lodging.amountOwing, String(match.amountOwing ?? '')) || undefined
    const priceOriginal =
      pickNonEmpty(lodging.priceOriginal, String(match.priceOriginal ?? '')) || undefined
    const amountPaidOriginal =
      pickNonEmpty(lodging.amountPaidOriginal, String(match.amountPaidOriginal ?? '')) || undefined
    const amountOwingOriginal =
      pickNonEmpty(lodging.amountOwingOriginal, String(match.amountOwingOriginal ?? '')) || undefined
    const currency = pickNonEmpty(lodging.currency, String(match.currency ?? '')) || undefined
    return {
      ...lodging,
      name,
      address,
      bookingUrl,
      checkIn: takeDates ? bIn || lodging.checkIn : lodging.checkIn,
      checkOut: takeDates ? bOut || bIn || lodging.checkOut : lodging.checkOut,
      checkInTime,
      checkOutTime,
      price,
      ...(amountPaid ? { amountPaid } : {}),
      ...(amountOwing ? { amountOwing } : {}),
      ...(priceOriginal ? { priceOriginal } : {}),
      ...(amountPaidOriginal ? { amountPaidOriginal } : {}),
      ...(amountOwingOriginal ? { amountOwingOriginal } : {}),
      ...(currency ? { currency } : {}),
      ...(photoUrl ? { photoUrl } : {}),
    }
  })
}

function newLodgingIdLocal(): string {
  return `lodging_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function lodgingFromBookingRow(
  row: AccommodationBooking,
  prev?: StopAccommodation | null,
): StopAccommodation {
  return {
    id: prev?.id || newLodgingIdLocal(),
    name: (row.name || prev?.name || 'Accommodation').trim(),
    address: (row.address || prev?.address || '').trim(),
    checkIn: (row.checkIn || prev?.checkIn || '').trim(),
    checkOut: (row.checkOut || prev?.checkOut || '').trim(),
    checkInTime: (row.checkInTime || prev?.checkInTime || '').trim(),
    checkOutTime: (row.checkOutTime || prev?.checkOutTime || '').trim(),
    price: (row.price || prev?.price || '').trim(),
    ...(row.amountPaid || prev?.amountPaid
      ? { amountPaid: (row.amountPaid || prev?.amountPaid || '').trim() }
      : {}),
    ...(row.amountOwing || prev?.amountOwing
      ? { amountOwing: (row.amountOwing || prev?.amountOwing || '').trim() }
      : {}),
    ...(row.priceOriginal || prev?.priceOriginal
      ? { priceOriginal: (row.priceOriginal || prev?.priceOriginal || '').trim() }
      : {}),
    ...(row.amountPaidOriginal || prev?.amountPaidOriginal
      ? { amountPaidOriginal: (row.amountPaidOriginal || prev?.amountPaidOriginal || '').trim() }
      : {}),
    ...(row.amountOwingOriginal || prev?.amountOwingOriginal
      ? { amountOwingOriginal: (row.amountOwingOriginal || prev?.amountOwingOriginal || '').trim() }
      : {}),
    ...(row.currency || prev?.currency ? { currency: (row.currency || prev?.currency || '').trim() } : {}),
    bookingUrl: (row.bookingUrl || prev?.bookingUrl || '').trim(),
    confirmationRef: String(row.confirmation || '').trim(),
    ...(row.photoUrl || prev?.photoUrl
      ? { photoUrl: (row.photoUrl || prev?.photoUrl || '').trim() }
      : {}),
  }
}

/**
 * Attach orphan booking rows onto the best matching stays.
 * Does not move lodgings the user already placed on a destination.
 */
export function reattachAccommodationsFromBookings(trip: Trip): Trip {
  const rows = trip.bookings?.accommodations || []
  if (!rows.length) return trip

  // Dedupe booking rows by confirmation (keep the newest / richest).
  const byConf = new Map<string, AccommodationBooking>()
  for (const row of rows) {
    const key = String(row.confirmation || '')
      .trim()
      .toLowerCase()
    if (!key) continue
    const prev = byConf.get(key)
    if (!prev || (row.createdAt || 0) >= (prev.createdAt || 0)) byConf.set(key, row)
  }
  const uniqueRows = [...byConf.values()]
  const bookingsChanged = uniqueRows.length !== rows.length

  // Start from whatever is already on stays (including legacy singular).
  const assigned = new Map<string, StopAccommodation[]>()
  const placedConfs = new Set<string>()
  for (const stay of trip.stays || []) {
    const list = stayAccommodations(stay).map((a) => ({ ...a }))
    assigned.set(stay.id, list)
    for (const a of list) {
      const key = a.confirmationRef.trim().toLowerCase()
      if (key) placedConfs.add(key)
    }
  }

  let staysChanged = false
  for (const row of uniqueRows) {
    const key = String(row.confirmation || '')
      .trim()
      .toLowerCase()
    if (!key || placedConfs.has(key)) continue
    const match = findStayForAccommodation(trip, {
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      name: row.name,
      address: row.address,
    })
    if (!match) continue
    const lodging = lodgingFromBookingRow(row)
    assigned.get(match.id)!.push(lodging)
    placedConfs.add(key)
    staysChanged = true
  }

  // Normalize every stay onto accommodations[] (drop legacy singular).
  const stays = (trip.stays || []).map((stay) => {
    const next = assigned.get(stay.id) || []
    const prev = stay.accommodations || []
    const same =
      Array.isArray(stay.accommodations) &&
      prev.length === next.length &&
      prev.every((a, i) => {
        const b = next[i]
        return (
          b &&
          a.id === b.id &&
          a.confirmationRef === b.confirmationRef &&
          a.checkIn === b.checkIn &&
          a.checkOut === b.checkOut &&
          a.name === b.name &&
          a.address === b.address &&
          a.photoUrl === b.photoUrl
        )
      })
    if (same) return stay
    staysChanged = true
    return { ...stay, accommodations: next }
  })

  if (!bookingsChanged && !staysChanged) return trip
  return {
    ...trip,
    stays,
    bookings: {
      ...trip.bookings,
      accommodations: uniqueRows,
    },
  }
}

/** Full rebuild of stay lodgings from booking rows (repair / migration). */
export function rebuildAccommodationsFromBookings(trip: Trip): Trip {
  const rows = trip.bookings?.accommodations || []
  if (!rows.length) {
    return {
      ...trip,
      stays: (trip.stays || []).map((s) => ({ ...s, accommodations: stayAccommodations(s) })),
    }
  }
  const byConf = new Map<string, AccommodationBooking>()
  for (const row of rows) {
    const key = String(row.confirmation || '')
      .trim()
      .toLowerCase()
    if (!key) continue
    const prev = byConf.get(key)
    if (!prev || (row.createdAt || 0) >= (prev.createdAt || 0)) byConf.set(key, row)
  }
  const uniqueRows = [...byConf.values()]
  const existingByConf = new Map<string, StopAccommodation>()
  for (const stay of trip.stays || []) {
    for (const a of stayAccommodations(stay)) {
      const key = a.confirmationRef.trim().toLowerCase()
      if (key && !existingByConf.has(key)) existingByConf.set(key, a)
    }
  }
  const assigned = new Map<string, StopAccommodation[]>()
  for (const stay of trip.stays || []) assigned.set(stay.id, [])
  for (const row of uniqueRows) {
    const match = findStayForAccommodation(trip, {
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      name: row.name,
      address: row.address,
    })
    if (!match) continue
    const key = String(row.confirmation || '')
      .trim()
      .toLowerCase()
    assigned.get(match.id)!.push(lodgingFromBookingRow(row, existingByConf.get(key)))
  }
  return {
    ...trip,
    stays: (trip.stays || []).map((stay) => ({
      ...stay,
      accommodations: assigned.get(stay.id) || [],
    })),
    bookings: { ...trip.bookings, accommodations: uniqueRows },
  }
}

/** Ensure every trip stay has accommodations[] with booking dates filled in when possible. */
export function enrichTripLodgingDates(trip: Trip): Trip {
  const reattached = reattachAccommodationsFromBookings(trip)
  const bookingRows = reattached.bookings?.accommodations || []
  let changed = reattached !== trip
  const stays = (reattached.stays || []).map((stay) => {
    const next = enrichAccommodationsFromBookings(stay.accommodations || [], stay, bookingRows)
    if (
      next.length !== (stay.accommodations || []).length ||
      next.some(
        (a, i) =>
          a.checkIn !== stay.accommodations?.[i]?.checkIn ||
          a.checkOut !== stay.accommodations?.[i]?.checkOut ||
          a.id !== stay.accommodations?.[i]?.id,
      )
    ) {
      changed = true
      return { ...stay, accommodations: next }
    }
    return stay.accommodations ? stay : { ...stay, accommodations: next }
  })
  return changed ? { ...reattached, stays } : reattached
}

/** Prefer IATA pair when valid; otherwise show legacy route text. */
export function buildFlightRouteDisplay(fromIata: string, toIata: string, legacyRoute: string): string {
  const f = fromIata.trim().toUpperCase()
  const t = toIata.trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(f) && /^[A-Z]{3}$/.test(t)) return `${f} → ${t}`
  return legacyRoute.trim()
}

/** Parse stored JSON (localStorage or DB payload) into TripsState. */
export function parseTripsFromUnknown(parsed: unknown): TripsState {
  try {
    const root = parsed as Record<string, unknown> | null
    if (!root || typeof root !== 'object') return { trips: [], selectedTripId: null }
    const tripsRaw = root.trips
    const selectedTripIdRaw = root.selectedTripId

    const trips: Trip[] = Array.isArray(tripsRaw)
      ? tripsRaw
          .map((t: any) => ({
            id: String(t.id ?? ''),
            country: String(t.country ?? '').trim(),
            startDate: String(t.startDate ?? ''),
            endDate: String(t.endDate ?? ''),
            cancelled: Boolean(t.cancelled),
            createdAt: Number(t.createdAt ?? Date.now()),
            clientRev:
              typeof t.clientRev === 'number' && Number.isFinite(t.clientRev)
                ? Math.max(0, Math.floor(t.clientRev))
                : undefined,
            mustDos: Array.isArray(t.mustDos)
              ? t.mustDos
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    text: String(x.text ?? ''),
                    done: Boolean(x.done),
                    createdAt: Number(x.createdAt ?? Date.now()),
                  }))
                  .filter((x: MustDo) => x.id && x.text.trim().length > 0)
              : [],
            packList: Array.isArray(t.packList)
              ? t.packList
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    text: String(x.text ?? '').trim(),
                    category: String(x.category ?? 'Other').trim() || 'Other',
                    done: Boolean(x.done),
                    createdAt: Number(x.createdAt ?? Date.now()),
                  }))
                  .filter((x: PackListItem) => x.id && x.text.length > 0)
              : [],
            visitPlaces: Array.isArray(t.visitPlaces)
              ? t.visitPlaces
                  .map((x: any) => {
                    const name = String(x.name ?? '').trim()
                    const photoUrl = String(x.photoUrl ?? '').trim()
                    const category = String(x.category ?? '').trim()
                    const googleMapsUri = String(x.googleMapsUri ?? '').trim()
                    const notes = String(x.notes ?? '').trim()
                    const cost = String(x.cost ?? '').trim()
                    const wikidataId = String(x.wikidataId ?? '').trim()
                    return {
                      id: String(x.id ?? ''),
                      label: String(x.label ?? '').trim(),
                      ...(name ? { name } : {}),
                      lat: typeof x.lat === 'number' ? x.lat : undefined,
                      lon: typeof x.lon === 'number' ? x.lon : undefined,
                      ...(cost ? { cost } : {}),
                      ...(photoUrl ? { photoUrl } : {}),
                      ...(category ? { category } : {}),
                      ...(googleMapsUri ? { googleMapsUri } : {}),
                      ...(notes ? { notes } : {}),
                      ...(wikidataId ? { wikidataId } : {}),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }
                  })
                  .filter((x: VisitPlace) => x.id && x.label.length > 0)
              : [],
            stays: Array.isArray(t.stays)
              ? t.stays
                  .map((x: any) => {
                    const bookingRows = Array.isArray(t?.bookings?.accommodations)
                      ? t.bookings.accommodations
                      : []
                    const accommodations = enrichAccommodationsFromBookings(
                      parseStopAccommodations(x),
                      {
                        startDate: String(x.startDate ?? ''),
                        endDate: String(x.endDate ?? ''),
                      },
                      bookingRows,
                    )
                    return {
                      id: String(x.id ?? ''),
                      location: String(x.location ?? '').trim(),
                      startDate: String(x.startDate ?? ''),
                      endDate: String(x.endDate ?? ''),
                      activities: Array.isArray(x.activities)
                        ? x.activities
                            .map((a: any) => ({
                              id: String(a.id ?? ''),
                              date: String(a.date ?? ''),
                              name: String(a.name ?? '').trim(),
                              time: String(a.time ?? ''),
                              endTime:
                                typeof a.endTime === 'string' && String(a.endTime).trim()
                                  ? String(a.endTime).trim()
                                  : undefined,
                              calendarTimeLabel:
                                typeof a.calendarTimeLabel === 'string' && a.calendarTimeLabel.trim()
                                  ? String(a.calendarTimeLabel).trim()
                                  : undefined,
                              confirmationRef: String(a.confirmationRef ?? '').trim(),
                              cost: String(a.cost ?? '').trim(),
                              notes: String(a.notes ?? '').trim(),
                              photoUrl: String(a.photoUrl ?? '').trim() || undefined,
                              googleMapsUri: String(a.googleMapsUri ?? '').trim() || undefined,
                              placeLabel: String(a.placeLabel ?? '').trim() || undefined,
                              category: String(a.category ?? '').trim() || undefined,
                              primaryType: String(a.primaryType ?? '').trim() || undefined,
                              types: Array.isArray(a.types) ? a.types.map((y: any) => String(y)).filter(Boolean) : undefined,
                              lat: typeof a.lat === 'number' ? a.lat : undefined,
                              lon: typeof a.lon === 'number' ? a.lon : undefined,
                              createdAt: Number(a.createdAt ?? Date.now()),
                            }))
                            .filter((a: StayActivity) => a.id && a.name && a.date)
                        : [],
                      createdAt: Number(x.createdAt ?? Date.now()),
                      lat: typeof x.lat === 'number' ? x.lat : undefined,
                      lon: typeof x.lon === 'number' ? x.lon : undefined,
                      accommodations,
                    } satisfies Stay
                  })
                  .filter((x: Stay) => x.id && x.location.length > 0 && x.startDate && x.endDate)
              : [],
            bookings: {
              rentalCars: Array.isArray(t?.bookings?.rentalCars)
                ? t.bookings.rentalCars
                    .map((x: any) => ({
                      id: String(x.id ?? ''),
                      company: String(x.company ?? '').trim(),
                      pickupLocation: String(x.pickupLocation ?? '').trim(),
                      dropoffLocation: String(x.dropoffLocation ?? '').trim(),
                      pickupDate: String(x.pickupDate ?? ''),
                      pickupTime: String(x.pickupTime ?? '').trim(),
                      dropoffDate: String(x.dropoffDate ?? ''),
                      dropoffTime: String(x.dropoffTime ?? '').trim(),
                      confirmation: String(x.confirmation ?? '').trim(),
                      price: String(x.price ?? '').trim(),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }))
                    .filter((x: CarBooking) => x.id && x.company.length > 0)
                : [],
              flights: Array.isArray(t?.bookings?.flights)
                ? t.bookings.flights
                    .map((x: any) => {
                      const fromIata = String(x.fromIata ?? '').trim().toUpperCase()
                      const toIata = String(x.toIata ?? '').trim().toUpperCase()
                      const route = String(x.route ?? '').trim()
                      return {
                        id: String(x.id ?? ''),
                        route,
                        fromIata: /^[A-Z]{3}$/.test(fromIata) ? fromIata : '',
                        toIata: /^[A-Z]{3}$/.test(toIata) ? toIata : '',
                        fromLabel: String(x.fromLabel ?? '').trim(),
                        toLabel: String(x.toLabel ?? '').trim(),
                        airline: String(x.airline ?? '').trim(),
                        flightNumber: String(x.flightNumber ?? '').trim(),
                        bookingStatus: String(x.bookingStatus ?? '').trim() || 'Booked',
                        departTerminal: String(x.departTerminal ?? '').trim(),
                        seat: String(x.seat ?? '').trim(),
                        notes: String(x.notes ?? '').trim(),
                        departDate: String(x.departDate ?? ''),
                        departTime: String(x.departTime ?? '').trim(),
                        arriveDate: String(x.arriveDate ?? ''),
                        arriveTime: String(x.arriveTime ?? '').trim(),
                        returnDate: String(x.returnDate ?? ''),
                        checkedBags: Math.min(9, Math.max(0, Math.floor(Number(x.checkedBags ?? 0)) || 0)),
                        carryOnBags: Math.min(9, Math.max(0, Math.floor(Number(x.carryOnBags ?? 0)) || 0)),
                        personalItem: Boolean(x.personalItem),
                        confirmation: String(x.confirmation ?? '').trim(),
                        price: String(x.price ?? '').trim(),
                        createdAt: Number(x.createdAt ?? Date.now()),
                      }
                    })
                    .filter(
                      (x: FlightBooking) =>
                        x.id &&
                        (x.confirmation.length > 0 ||
                          (/^[A-Z]{3}$/.test(x.fromIata) && /^[A-Z]{3}$/.test(x.toIata))) &&
                        buildFlightRouteDisplay(x.fromIata, x.toIata, x.route).length > 0,
                    )
                : [],
              restaurants: Array.isArray(t?.bookings?.restaurants)
                ? t.bookings.restaurants
                    .map((x: any) => ({
                      id: String(x.id ?? ''),
                      name: String(x.name ?? '').trim(),
                      reservationDate: String(x.reservationDate ?? ''),
                      confirmation: String(x.confirmation ?? '').trim(),
                      cost: String(x.cost ?? '').trim(),
                      notes: String(x.notes ?? '').trim(),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }))
                    .filter((x: RestaurantBooking) => x.id && x.name.length > 0)
                : [],
              accommodations: Array.isArray(t?.bookings?.accommodations)
                ? t.bookings.accommodations
                    .map((x: any) => {
                      if (x?.status === 'cancelled') return null
                      return {
                        id: String(x.id ?? ''),
                        name: String(x.name ?? '').trim(),
                        checkIn: String(x.checkIn ?? ''),
                        checkOut: String(x.checkOut ?? ''),
                        confirmation: String(x.confirmation ?? '').trim(),
                        address: String(x.address ?? '').trim() || undefined,
                        price: String(x.price ?? '').trim() || undefined,
                        amountPaid: String(x.amountPaid ?? '').trim() || undefined,
                        amountOwing: String(x.amountOwing ?? '').trim() || undefined,
                        priceOriginal: String(x.priceOriginal ?? '').trim() || undefined,
                        amountPaidOriginal: String(x.amountPaidOriginal ?? '').trim() || undefined,
                        amountOwingOriginal: String(x.amountOwingOriginal ?? '').trim() || undefined,
                        currency: String(x.currency ?? '').trim() || undefined,
                        bookingUrl: String(x.bookingUrl ?? '').trim() || undefined,
                        photoUrl: String(x.photoUrl ?? '').trim() || undefined,
                        checkInTime: String(x.checkInTime ?? '').trim() || undefined,
                        checkOutTime: String(x.checkOutTime ?? '').trim() || undefined,
                        createdAt: Number(x.createdAt ?? Date.now()),
                      }
                    })
                    .filter(
                      (x: AccommodationBooking | null): x is AccommodationBooking =>
                        Boolean(x && x.id && x.name.length > 0 && x.confirmation.length > 0),
                    )
                : [],
            },
            sharing: (() => {
              const sh = t?.sharing
              if (!sh || typeof sh !== 'object') return undefined
              const o = sh as Record<string, unknown>
              const sid = String(o.sharedItineraryId ?? '').trim()
              const src = String(o.sourceTripId ?? '').trim()
              const role = o.role
              if (!sid || !src) return undefined
              if (role !== 'owner' && role !== 'editor' && role !== 'viewer') return undefined
              return { sharedItineraryId: sid, sourceTripId: src, role } as TripSharing
            })(),
          }))
          .filter((trip: Trip) => trip.id && trip.country.length > 0)
          .map((trip: Trip) => enrichTripLodgingDates(trip))
      : []

    const selectedTripId =
      typeof selectedTripIdRaw === 'string' && trips.some((tr) => tr.id === selectedTripIdRaw)
        ? selectedTripIdRaw
        : trips[0]?.id ?? null

    return { trips, selectedTripId }
  } catch {
    return { trips: [], selectedTripId: null }
  }
}

export function loadTripsState(storageKey: string | null): TripsState {
  try {
    if (!storageKey) return { trips: [], selectedTripId: null }
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { trips: [], selectedTripId: null }
    const parsed = JSON.parse(raw) as unknown
    return parseTripsFromUnknown(parsed)
  } catch {
    return { trips: [], selectedTripId: null }
  }
}

export function saveTripsState(state: TripsState, userEmail: string | null) {
  if (!userEmail) return
  const key = tripsStorageKey(userEmail)
  try {
    const prevRaw = localStorage.getItem(key)
    if (prevRaw) {
      // Keep one local backup for recovery if a sync race thins the live key.
      localStorage.setItem(`${key}:bak1`, prevRaw)
    }
  } catch {
    // Ignore quota / private-mode failures; still write primary below.
  }
  localStorage.setItem(key, JSON.stringify(state))
}

/** Total place-stops across all trips (for wipe-guards / merge). */
export function countTripStays(state: TripsState): number {
  return state.trips.reduce((n, t) => n + (t.stays?.length ?? 0), 0)
}

/**
 * When remote comes back empty/thin after a failed deploy, prefer the richer
 * local cache for the same trip ids so stops are not lost.
 */
function stayLocationKey(s: Stay): string {
  const loc = s?.location
  if (typeof loc === 'string') return loc.trim().toLowerCase()
  if (loc && typeof loc === 'object' && 'name' in loc) {
    return String((loc as { name?: string }).name || '')
      .trim()
      .toLowerCase()
  }
  return ''
}

function staysOverlapSamePlace(a: Stay, b: Stay): boolean {
  const la = stayLocationKey(a)
  const lb = stayLocationKey(b)
  if (!la || !lb || la !== lb) return false
  const a0 = a.startDate || ''
  const a1 = a.endDate || a0
  const b0 = b.startDate || ''
  const b1 = b.endDate || b0
  if (!a0 || !b0) return false
  return a0 < b1 && b0 < a1
}

/** Drop same-place overlapping stays (keeps first). Safe for recovery dups. */
export function dedupeOverlappingStays(stays: Stay[]): Stay[] {
  const seen = new Set<string>()
  const out: Stay[] = []
  for (const s of stays) {
    if (!s?.id || seen.has(s.id)) continue
    if (out.some((existing) => staysOverlapSamePlace(existing, s))) continue
    seen.add(s.id)
    out.push(s)
  }
  return out
}

function tripLodgingCount(trip: Trip): number {
  return (trip.stays || []).reduce((n, s) => n + stayAccommodations(s).length, 0)
}

function unionStaysPreferRicherLodging(primary: Stay[], secondary: Stay[]): Stay[] {
  const byId = new Map<string, Stay>()
  for (const s of secondary) byId.set(s.id, s)
  for (const s of primary) {
    const other = byId.get(s.id)
    if (!other) {
      byId.set(s.id, s)
      continue
    }
    const primaryAcc = stayAccommodations(s)
    const otherAcc = stayAccommodations(other)
    const accommodations = unionAccommodationsByConfirmation(primaryAcc, otherAcc)
    // Keep primary stay shell (dates/location) but never drop richer lodging fields.
    byId.set(s.id, { ...other, ...s, accommodations })
  }
  return dedupeOverlappingStays([...byId.values()])
}

function bookingListSize(trip: Trip): number {
  const b = trip.bookings
  if (!b) return 0
  return (
    (b.flights?.length ?? 0) +
    (b.rentalCars?.length ?? 0) +
    (b.restaurants?.length ?? 0) +
    (b.accommodations?.length ?? 0)
  )
}

export function mergeTripsPreferRicherStays(remote: TripsState, local: TripsState): TripsState {
  if (local.trips.length === 0) return remote
  if (remote.trips.length === 0 && local.trips.length > 0) return local
  const localById = new Map(local.trips.map((t) => [t.id, t]))
  const merged = remote.trips.map((rt) => {
    const lt = localById.get(rt.id)
    if (!lt) return rt
    const remoteStays = rt.stays ?? []
    const localStays = lt.stays ?? []
    const localRev = lt.clientRev ?? 0
    const remoteRev = rt.clientRev ?? 0
    const remoteLodgings = tripLodgingCount(rt)
    const localLodgings = tripLodgingCount(lt)
    // Never let a newer-but-empty local wipe restored lodgings from remote.
    const preferLocalDates =
      localStays.length === remoteStays.length && localRev > remoteRev && localLodgings >= remoteLodgings
    const stays = preferLocalDates
      ? unionStaysPreferRicherLodging(localStays, remoteStays)
      : localStays.length > remoteStays.length
        ? unionStaysPreferRicherLodging(localStays, remoteStays)
        : unionStaysPreferRicherLodging(remoteStays, localStays)

    const remoteAcc = rt.bookings?.accommodations || []
    const localAcc = lt.bookings?.accommodations || []
    const accommodations = unionBookingAccommodations(remoteAcc, localAcc)
    const preferLocalBookingsShell =
      bookingListSize(rt) === 0 && bookingListSize(lt) > 0
    const baseBookings = preferLocalBookingsShell ? lt.bookings : rt.bookings
    const bookings = {
      ...baseBookings,
      accommodations,
      flights: preferLocalBookingsShell ? lt.bookings.flights : rt.bookings.flights,
      rentalCars: preferLocalBookingsShell ? lt.bookings.rentalCars : rt.bookings.rentalCars,
      restaurants: preferLocalBookingsShell ? lt.bookings.restaurants : rt.bookings.restaurants,
    }

    return {
      ...rt,
      clientRev: Math.max(localRev, remoteRev),
      stays,
      bookings,
    }
  })
  const remoteIds = new Set(remote.trips.map((t) => t.id))
  for (const lt of local.trips) {
    if (!remoteIds.has(lt.id)) merged.push(lt)
  }
  const selectedTripId =
    remote.selectedTripId && merged.some((t) => t.id === remote.selectedTripId)
      ? remote.selectedTripId
      : local.selectedTripId && merged.some((t) => t.id === local.selectedTripId)
        ? local.selectedTripId
        : merged[0]?.id ?? null
  return { trips: merged, selectedTripId }
}

/**
 * Personal `user_trips` payload.
 * Always include owner trips (stripped of live sharing metadata) so revoking a
 * share cannot fall back to a stale/empty personal copy. Member/viewer copies
 * still live only on `shared_itineraries`.
 */
export function tripsStateForPersonalSave(state: TripsState): TripsState {
  const trips = state.trips
    .filter((t) => {
      const role = t.sharing?.role
      if (role === 'viewer' || role === 'editor') return false
      return true
    })
    .map((t) => stripSharingFromTrip(t))
  return {
    trips,
    selectedTripId: state.selectedTripId,
  }
}

export function parseSingleTripFromUnknown(tripJson: unknown): Trip | null {
  const wrapped = { trips: [tripJson], selectedTripId: null as string | null }
  const { trips } = parseTripsFromUnknown(wrapped as unknown)
  const t = trips[0]
  return t && t.id && t.country.length > 0 ? t : null
}

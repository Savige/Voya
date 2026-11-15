import { getPocketBase, isSupabaseConfigured } from './pocketbaseClient'
import type { BookingImportRecord, BookingImportStatus, ParsedBookingFields } from './bookingEmailTypes'
import {
  convertMoneyString,
  DEFAULT_DISPLAY_CURRENCY,
  loadDisplayCurrency,
} from './currency'
import { findStayForAccommodation } from './lodgingMatch'
import { enrichTripLodgingDates } from './tripStorage'
import type {
  AccommodationBooking,
  CarBooking,
  FlightBooking,
  RestaurantBooking,
  StopAccommodation,
  Trip,
} from './tripTypes'
import { stayAccommodations } from './tripTypes'

export { findStayForAccommodation } from './lodgingMatch'

function uid(): string {
  return crypto.randomUUID()
}

function asImportRecord(row: Record<string, unknown>): BookingImportRecord {
  return {
    id: String(row.id || ''),
    status: (row.status as BookingImportStatus) || 'pending',
    kind: (row.kind as BookingImportRecord['kind']) || 'unknown',
    from_email: typeof row.from_email === 'string' ? row.from_email : undefined,
    subject: typeof row.subject === 'string' ? row.subject : undefined,
    trip_id: typeof row.trip_id === 'string' ? row.trip_id : undefined,
    parsed: (row.parsed as ParsedBookingFields) || { kind: 'unknown', confidence: 0 },
    raw_text: typeof row.raw_text === 'string' ? row.raw_text : undefined,
    error: typeof row.error === 'string' ? row.error : undefined,
    message_id: typeof row.message_id === 'string' ? row.message_id : undefined,
    created: String(row.created || ''),
  }
}

export async function listPendingBookingImports(): Promise<BookingImportRecord[]> {
  if (!isSupabaseConfigured()) return []
  const pb = getPocketBase()
  if (!pb.authStore.isValid) return []
  const rows = await pb.collection('booking_imports').getFullList({
    filter: 'status = "pending"',
    // Collection has no created/updated system columns; id is time-sortable enough.
    sort: '-id',
    requestKey: null,
  })
  return rows.map((r) => asImportRecord(r as unknown as Record<string, unknown>))
}

/** Applied imports still keep `parsed` — used to backfill trip lodging/money. */
export async function listAppliedBookingImports(): Promise<BookingImportRecord[]> {
  if (!isSupabaseConfigured()) return []
  const pb = getPocketBase()
  if (!pb.authStore.isValid) return []
  const rows = await pb.collection('booking_imports').getFullList({
    filter: 'status = "applied"',
    sort: '-id',
    requestKey: null,
  })
  return rows.map((r) => asImportRecord(r as unknown as Record<string, unknown>))
}

/**
 * Copy parsed fields from booking_imports onto the trip without wiping known values.
 * Fixes the gap where Budget reads trip lodgings but money only lived on the import row.
 */
export function enrichTripFromImportParses(trip: Trip, parses: ParsedBookingFields[]): Trip {
  let next = trip
  let dirty = false
  for (const parsed of parses) {
    const confirmation = (parsed.confirmation || '').trim()
    if (!confirmation) continue
    if (parsed.kind === 'accommodation') {
      if (!tripHasConfirmation(next, confirmation)) {
        try {
          next = applyParsedBookingToTrip(next, parsed)
          dirty = true
        } catch {
          // Stay dates may not match yet — leave for manual Apply.
        }
        continue
      }
      const key = confKey(confirmation)
      const prevBooking = next.bookings.accommodations.find((x) => confKey(x.confirmation) === key)
      let prevLodging: StopAccommodation | null = null
      for (const s of next.stays || []) {
        const hit = stayAccommodations(s).find((a) => confKey(a.confirmationRef) === key)
        if (hit) {
          prevLodging = hit
          break
        }
      }
      const lodging = mergeLodgingFromParsed(parsed, confirmation, prevLodging, prevBooking)
      const before = JSON.stringify({
        lodging: prevLodging,
        booking: prevBooking
          ? {
              price: prevBooking.price,
              amountPaid: prevBooking.amountPaid,
              amountOwing: prevBooking.amountOwing,
              photoUrl: prevBooking.photoUrl,
            }
          : null,
      })
      const after = JSON.stringify({
        lodging,
        booking: {
          price: lodging.price,
          amountPaid: lodging.amountPaid,
          amountOwing: lodging.amountOwing,
          photoUrl: lodging.photoUrl,
        },
      })
      if (before === after) continue
      dirty = true
      next = {
        ...next,
        stays: next.stays.map((s) => {
          const list = stayAccommodations(s)
          if (!list.some((a) => confKey(a.confirmationRef) === key)) return s
          return {
            ...s,
            accommodations: list.map((a) => (confKey(a.confirmationRef) === key ? lodging : a)),
          }
        }),
        bookings: {
          ...next.bookings,
          accommodations: upsertByConfirmation(next.bookings.accommodations, {
            id: prevBooking?.id || lodging.id,
            name: lodging.name,
            checkIn: lodging.checkIn,
            checkOut: lodging.checkOut,
            confirmation,
            address: lodging.address,
            price: lodging.price,
            ...(lodging.amountPaid ? { amountPaid: lodging.amountPaid } : {}),
            ...(lodging.amountOwing ? { amountOwing: lodging.amountOwing } : {}),
            ...(lodging.priceOriginal ? { priceOriginal: lodging.priceOriginal } : {}),
            ...(lodging.amountPaidOriginal
              ? { amountPaidOriginal: lodging.amountPaidOriginal }
              : {}),
            ...(lodging.amountOwingOriginal
              ? { amountOwingOriginal: lodging.amountOwingOriginal }
              : {}),
            ...(lodging.currency ? { currency: lodging.currency } : {}),
            bookingUrl: lodging.bookingUrl,
            ...(lodging.photoUrl ? { photoUrl: lodging.photoUrl } : {}),
            checkInTime: lodging.checkInTime,
            checkOutTime: lodging.checkOutTime,
            createdAt: prevBooking?.createdAt || Date.now(),
          }),
        },
      }
      continue
    }
    // Flights / cars / restaurants: only fill if the confirmation already exists.
    if (!tripHasConfirmation(next, confirmation)) continue
    try {
      const updated = applyParsedBookingToTrip(next, parsed)
      if (updated !== next) {
        next = updated
        dirty = true
      }
    } catch {
      /* ignore partial parses */
    }
  }
  return dirty ? enrichTripLodgingDates(next) : trip
}

export async function updateBookingImportStatus(
  id: string,
  status: BookingImportStatus,
  extra?: { trip_id?: string; error?: string },
): Promise<void> {
  if (!isSupabaseConfigured()) return
  const pb = getPocketBase()
  // Dismissed imports are deleted so large raw_text bodies don't linger.
  if (status === 'dismissed') {
    await pb.collection('booking_imports').delete(id)
    return
  }
  await pb.collection('booking_imports').update(id, {
    status,
    ...(extra?.trip_id != null ? { trip_id: extra.trip_id } : {}),
    ...(extra?.error != null ? { error: extra.error } : {}),
  })
}

export async function pasteBookingEmail(input: {
  subject?: string
  text: string
  tripId?: string
}): Promise<{ id: string; parsed: ParsedBookingFields; kind: string }> {
  if (!isSupabaseConfigured()) throw new Error('PocketBase is not configured')
  const pb = getPocketBase()
  if (!pb.authStore.isValid) throw new Error('Sign in to import bookings')
  const res = await pb.send('/api/waypoint/email-paste', {
    method: 'POST',
    body: {
      subject: input.subject || 'Pasted confirmation',
      text: input.text,
      tripId: input.tripId || '',
    },
  })
  return {
    id: String((res as { id?: string }).id || ''),
    parsed: ((res as { parsed?: ParsedBookingFields }).parsed || {
      kind: 'unknown',
      confidence: 0,
    }) as ParsedBookingFields,
    kind: String((res as { kind?: string }).kind || 'unknown'),
  }
}

/** Convert parsed money fields into the user's display currency (default AUD). */
export async function withDisplayCurrency(
  parsed: ParsedBookingFields,
  toCurrency: string = loadDisplayCurrency() || DEFAULT_DISPLAY_CURRENCY,
): Promise<ParsedBookingFields> {
  const [price, paid, owing] = await Promise.all([
    convertMoneyString(parsed.price, toCurrency),
    convertMoneyString(parsed.amountPaid, toCurrency),
    convertMoneyString(parsed.amountOwing, toCurrency),
  ])
  const currency =
    price.currency || paid.currency || owing.currency || parsed.currency || undefined
  return {
    ...parsed,
    price: price.display || parsed.price,
    amountPaid: paid.display || parsed.amountPaid,
    amountOwing: owing.display || parsed.amountOwing,
    priceOriginal: price.original || parsed.priceOriginal,
    amountPaidOriginal: paid.original || parsed.amountPaidOriginal,
    amountOwingOriginal: owing.original || parsed.amountOwingOriginal,
    currency: currency || undefined,
  }
}

/** Prefer the first non-empty trimmed string (re-forwards must not wipe known fields). */
function pickStr(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    const t = String(v ?? '').trim()
    if (t) return t
  }
  return ''
}

function optionalStr(...vals: Array<string | undefined | null>): string | undefined {
  const t = pickStr(...vals)
  return t || undefined
}

/**
 * Build lodging from a parse, filling blanks from the existing stay lodging /
 * bookings mirror so a thinner re-forward never erases money, dates, photo, etc.
 */
function mergeLodgingFromParsed(
  parsed: ParsedBookingFields,
  confirmation: string,
  prevLodging: StopAccommodation | null,
  prevBooking: AccommodationBooking | undefined,
): StopAccommodation {
  const amountPaid = optionalStr(parsed.amountPaid, prevLodging?.amountPaid, prevBooking?.amountPaid)
  const amountOwing = optionalStr(parsed.amountOwing, prevLodging?.amountOwing, prevBooking?.amountOwing)
  const priceOriginal = optionalStr(
    parsed.priceOriginal,
    prevLodging?.priceOriginal,
    prevBooking?.priceOriginal,
  )
  const amountPaidOriginal = optionalStr(
    parsed.amountPaidOriginal,
    prevLodging?.amountPaidOriginal,
    prevBooking?.amountPaidOriginal,
  )
  const amountOwingOriginal = optionalStr(
    parsed.amountOwingOriginal,
    prevLodging?.amountOwingOriginal,
    prevBooking?.amountOwingOriginal,
  )
  const currency = optionalStr(parsed.currency, prevLodging?.currency, prevBooking?.currency)
  const photoUrl = optionalStr(parsed.photoUrl, prevLodging?.photoUrl, prevBooking?.photoUrl)
  return {
    id: prevLodging?.id || uid(),
    name: pickStr(parsed.name, prevLodging?.name, prevBooking?.name, 'Accommodation'),
    address: pickStr(parsed.address, prevLodging?.address, prevBooking?.address),
    checkIn: pickStr(parsed.checkIn, prevLodging?.checkIn, prevBooking?.checkIn),
    checkOut: pickStr(parsed.checkOut, prevLodging?.checkOut, prevBooking?.checkOut),
    checkInTime: pickStr(parsed.checkInTime, prevLodging?.checkInTime, prevBooking?.checkInTime),
    checkOutTime: pickStr(parsed.checkOutTime, prevLodging?.checkOutTime, prevBooking?.checkOutTime),
    price: pickStr(parsed.price, prevLodging?.price, prevBooking?.price),
    ...(amountPaid ? { amountPaid } : {}),
    ...(amountOwing ? { amountOwing } : {}),
    ...(priceOriginal ? { priceOriginal } : {}),
    ...(amountPaidOriginal ? { amountPaidOriginal } : {}),
    ...(amountOwingOriginal ? { amountOwingOriginal } : {}),
    ...(currency ? { currency } : {}),
    bookingUrl: pickStr(parsed.bookingUrl, prevLodging?.bookingUrl, prevBooking?.bookingUrl),
    confirmationRef: confirmation,
    ...(photoUrl ? { photoUrl } : {}),
  }
}

function confKey(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function upsertByConfirmation<T extends { id: string; confirmation: string; createdAt: number }>(
  list: T[],
  next: T,
): T[] {
  const key = confKey(next.confirmation)
  const idx = list.findIndex((x) => confKey(x.confirmation) === key)
  if (idx < 0) return [...list, next]
  const prev = list[idx]
  return list.map((x, i) => (i === idx ? { ...prev, ...next, id: prev.id, createdAt: prev.createdAt } : x))
}

/** True when this confirmation already exists on the trip (re-forward / update). */
export function tripHasConfirmation(trip: Trip, confirmation: string): boolean {
  const key = confKey(confirmation)
  if (!key) return false
  if ((trip.bookings?.flights || []).some((x) => confKey(x.confirmation) === key)) return true
  if ((trip.bookings?.rentalCars || []).some((x) => confKey(x.confirmation) === key)) return true
  if ((trip.bookings?.restaurants || []).some((x) => confKey(x.confirmation) === key)) return true
  if ((trip.bookings?.accommodations || []).some((x) => confKey(x.confirmation) === key)) return true
  return (trip.stays || []).some((s) =>
    (s.accommodations || []).some((a) => confKey(a.confirmationRef) === key),
  )
}

/** Apply a parsed import onto a trip (returns updated trip). Re-forwards upsert by confirmation. */
export function applyParsedBookingToTrip(trip: Trip, parsed: ParsedBookingFields): Trip {
  const confirmation = (parsed.confirmation || '').trim()
  if (!confirmation) {
    throw new Error('Parsed email is missing a confirmation number')
  }
  const createdAt = Date.now()
  const bookings = { ...trip.bookings }
  let stays = trip.stays
  const key = confKey(confirmation)

  if (parsed.kind === 'flight') {
    const fromIata = (parsed.fromIata || '').toUpperCase()
    const toIata = (parsed.toIata || '').toUpperCase()
    const prev = bookings.flights.find((x) => confKey(x.confirmation) === key)
    const flight: FlightBooking = {
      id: prev?.id || uid(),
      route:
        fromIata && toIata
          ? `${fromIata} → ${toIata}`
          : pickStr(prev?.route, 'Flight'),
      fromIata: pickStr(fromIata, prev?.fromIata),
      toIata: pickStr(toIata, prev?.toIata),
      fromLabel: pickStr(parsed.fromLabel, fromIata, prev?.fromLabel),
      toLabel: pickStr(parsed.toLabel, toIata, prev?.toLabel),
      airline: pickStr(parsed.airline, prev?.airline),
      flightNumber: pickStr(prev?.flightNumber),
      bookingStatus: pickStr(prev?.bookingStatus, 'Booked'),
      departTerminal: pickStr(prev?.departTerminal),
      seat: pickStr(prev?.seat),
      notes: pickStr(prev?.notes),
      departDate: pickStr(parsed.departDate, prev?.departDate),
      departTime: pickStr(parsed.departTime, prev?.departTime),
      arriveDate: pickStr(parsed.arriveDate, parsed.departDate, prev?.arriveDate),
      arriveTime: pickStr(parsed.arriveTime, prev?.arriveTime),
      returnDate: pickStr(prev?.returnDate),
      checkedBags: prev?.checkedBags ?? 1,
      carryOnBags: prev?.carryOnBags ?? 1,
      personalItem: prev?.personalItem ?? true,
      confirmation,
      price: pickStr(parsed.price, prev?.price),
      createdAt: prev?.createdAt || createdAt,
    }
    bookings.flights = upsertByConfirmation(bookings.flights, flight)
  } else if (parsed.kind === 'rentalCar') {
    const prev = bookings.rentalCars.find((x) => confKey(x.confirmation) === key)
    const car: CarBooking = {
      id: prev?.id || uid(),
      company: pickStr(parsed.company, prev?.company, 'Rental car'),
      pickupLocation: pickStr(parsed.pickupLocation, prev?.pickupLocation),
      dropoffLocation: pickStr(
        parsed.dropoffLocation,
        parsed.pickupLocation,
        prev?.dropoffLocation,
        prev?.pickupLocation,
      ),
      pickupDate: pickStr(parsed.pickupDate, prev?.pickupDate),
      pickupTime: pickStr(parsed.pickupTime, prev?.pickupTime),
      dropoffDate: pickStr(parsed.dropoffDate, prev?.dropoffDate),
      dropoffTime: pickStr(parsed.dropoffTime, prev?.dropoffTime),
      confirmation,
      price: pickStr(parsed.price, prev?.price),
      createdAt: prev?.createdAt || createdAt,
    }
    bookings.rentalCars = upsertByConfirmation(bookings.rentalCars, car)
  } else if (parsed.kind === 'restaurant') {
    const prev = bookings.restaurants.find((x) => confKey(x.confirmation) === key)
    const noteBits = [parsed.reservationTime, parsed.location, parsed.notes].filter(Boolean)
    const row: RestaurantBooking = {
      id: prev?.id || uid(),
      name: pickStr(parsed.name, prev?.name, 'Reservation'),
      reservationDate: pickStr(parsed.reservationDate, prev?.reservationDate),
      confirmation,
      cost: pickStr(parsed.price, prev?.cost),
      notes: noteBits.length ? noteBits.join(' · ') : pickStr(prev?.notes),
      createdAt: prev?.createdAt || createdAt,
    }
    bookings.restaurants = upsertByConfirmation(bookings.restaurants, row)
  } else if (parsed.kind === 'accommodation') {
    const prevBooking = bookings.accommodations.find((x) => confKey(x.confirmation) === key)
    let prevLodging: StopAccommodation | null = null
    for (const s of trip.stays || []) {
      const hit = (s.accommodations || []).find((a) => confKey(a.confirmationRef) === key)
      if (hit) {
        prevLodging = hit
        break
      }
    }
    const lodging = mergeLodgingFromParsed(parsed, confirmation, prevLodging, prevBooking)
    if (!lodging.address) {
      throw new Error(
        'Parsed email is missing a property address — add it before applying, or re-forward a fuller confirmation',
      )
    }

    const match = findStayForAccommodation(trip, {
      ...parsed,
      checkIn: lodging.checkIn || parsed.checkIn,
      checkOut: lodging.checkOut || parsed.checkOut,
      name: lodging.name || parsed.name,
      address: lodging.address || parsed.address,
    })
    if (!match) {
      throw new Error(
        `No place stop matches ${lodging.checkIn || parsed.checkIn || 'these dates'} — add the town/dates on Planner first, then apply`,
      )
    }

    // Prefer an existing user placement for this confirmation; otherwise use date/name match.
    let targetStayId = match.id
    for (const s of trip.stays || []) {
      if (stayAccommodations(s).some((a) => confKey(a.confirmationRef) === key)) {
        targetStayId = s.id
        break
      }
    }

    // Remove this confirmation from every stay, then attach the updated lodging to the target stop.
    stays = trip.stays.map((s) => {
      const without = stayAccommodations(s).filter((a) => confKey(a.confirmationRef) !== key)
      if (s.id !== targetStayId) return { ...s, accommodations: without }
      return { ...s, accommodations: [...without, lodging] }
    })

    const row: AccommodationBooking = {
      id: prevBooking?.id || uid(),
      name: lodging.name,
      checkIn: lodging.checkIn,
      checkOut: lodging.checkOut,
      confirmation,
      address: lodging.address,
      price: lodging.price,
      ...(lodging.amountPaid ? { amountPaid: lodging.amountPaid } : {}),
      ...(lodging.amountOwing ? { amountOwing: lodging.amountOwing } : {}),
      ...(lodging.priceOriginal ? { priceOriginal: lodging.priceOriginal } : {}),
      ...(lodging.amountPaidOriginal ? { amountPaidOriginal: lodging.amountPaidOriginal } : {}),
      ...(lodging.amountOwingOriginal ? { amountOwingOriginal: lodging.amountOwingOriginal } : {}),
      ...(lodging.currency ? { currency: lodging.currency } : {}),
      bookingUrl: lodging.bookingUrl,
      ...(lodging.photoUrl ? { photoUrl: lodging.photoUrl } : {}),
      checkInTime: lodging.checkInTime,
      checkOutTime: lodging.checkOutTime,
      createdAt: prevBooking?.createdAt || createdAt,
    }
    bookings.accommodations = upsertByConfirmation(bookings.accommodations, row)
  } else {
    throw new Error('Could not detect booking type — edit the email text or add the booking manually')
  }

  return enrichTripLodgingDates({ ...trip, bookings, stays })
}

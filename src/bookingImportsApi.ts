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

function stopAccommodationFromParsed(parsed: ParsedBookingFields, confirmation: string): StopAccommodation {
  return {
    id: uid(),
    name: (parsed.name || 'Accommodation').trim(),
    address: (parsed.address || '').trim(),
    checkIn: (parsed.checkIn || '').trim(),
    checkOut: (parsed.checkOut || '').trim(),
    checkInTime: (parsed.checkInTime || '').trim(),
    checkOutTime: (parsed.checkOutTime || '').trim(),
    price: (parsed.price || '').trim(),
    ...(parsed.amountPaid ? { amountPaid: parsed.amountPaid.trim() } : {}),
    ...(parsed.amountOwing ? { amountOwing: parsed.amountOwing.trim() } : {}),
    ...(parsed.priceOriginal ? { priceOriginal: parsed.priceOriginal.trim() } : {}),
    ...(parsed.amountPaidOriginal ? { amountPaidOriginal: parsed.amountPaidOriginal.trim() } : {}),
    ...(parsed.amountOwingOriginal ? { amountOwingOriginal: parsed.amountOwingOriginal.trim() } : {}),
    ...(parsed.currency ? { currency: parsed.currency.trim() } : {}),
    bookingUrl: (parsed.bookingUrl || '').trim(),
    confirmationRef: confirmation,
    ...(parsed.photoUrl ? { photoUrl: parsed.photoUrl.trim() } : {}),
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
      route: fromIata && toIata ? `${fromIata} → ${toIata}` : prev?.route || 'Flight',
      fromIata: fromIata || prev?.fromIata || '',
      toIata: toIata || prev?.toIata || '',
      fromLabel: parsed.fromLabel || fromIata || prev?.fromLabel || '',
      toLabel: parsed.toLabel || toIata || prev?.toLabel || '',
      airline: parsed.airline || prev?.airline || '',
      flightNumber: prev?.flightNumber || '',
      bookingStatus: prev?.bookingStatus || 'Booked',
      departTerminal: prev?.departTerminal || '',
      seat: prev?.seat || '',
      notes: prev?.notes || '',
      departDate: parsed.departDate || prev?.departDate || '',
      departTime: parsed.departTime || prev?.departTime || '',
      arriveDate: parsed.arriveDate || parsed.departDate || prev?.arriveDate || '',
      arriveTime: parsed.arriveTime || prev?.arriveTime || '',
      returnDate: prev?.returnDate || '',
      checkedBags: prev?.checkedBags ?? 1,
      carryOnBags: prev?.carryOnBags ?? 1,
      personalItem: prev?.personalItem ?? true,
      confirmation,
      price: parsed.price || prev?.price || '',
      createdAt: prev?.createdAt || createdAt,
    }
    bookings.flights = upsertByConfirmation(bookings.flights, flight)
  } else if (parsed.kind === 'rentalCar') {
    const prev = bookings.rentalCars.find((x) => confKey(x.confirmation) === key)
    const car: CarBooking = {
      id: prev?.id || uid(),
      company: parsed.company || prev?.company || 'Rental car',
      pickupLocation: parsed.pickupLocation || prev?.pickupLocation || '',
      dropoffLocation:
        parsed.dropoffLocation || parsed.pickupLocation || prev?.dropoffLocation || prev?.pickupLocation || '',
      pickupDate: parsed.pickupDate || prev?.pickupDate || '',
      pickupTime: parsed.pickupTime || prev?.pickupTime || '',
      dropoffDate: parsed.dropoffDate || prev?.dropoffDate || '',
      dropoffTime: parsed.dropoffTime || prev?.dropoffTime || '',
      confirmation,
      price: parsed.price || prev?.price || '',
      createdAt: prev?.createdAt || createdAt,
    }
    bookings.rentalCars = upsertByConfirmation(bookings.rentalCars, car)
  } else if (parsed.kind === 'restaurant') {
    const prev = bookings.restaurants.find((x) => confKey(x.confirmation) === key)
    const row: RestaurantBooking = {
      id: prev?.id || uid(),
      name: parsed.name || prev?.name || 'Reservation',
      reservationDate: parsed.reservationDate || prev?.reservationDate || '',
      confirmation,
      cost: parsed.price || prev?.cost || '',
      notes:
        [parsed.reservationTime, parsed.location, parsed.notes].filter(Boolean).join(' · ') ||
        prev?.notes ||
        '',
      createdAt: prev?.createdAt || createdAt,
    }
    bookings.restaurants = upsertByConfirmation(bookings.restaurants, row)
  } else if (parsed.kind === 'accommodation') {
    const address = (parsed.address || '').trim()
    if (!address) {
      throw new Error(
        'Parsed email is missing a property address — add it before applying, or re-forward a fuller confirmation',
      )
    }
    const prevBooking = bookings.accommodations.find((x) => confKey(x.confirmation) === key)
    let prevLodging: StopAccommodation | null = null
    for (const s of trip.stays || []) {
      const hit = (s.accommodations || []).find((a) => confKey(a.confirmationRef) === key)
      if (hit) {
        prevLodging = hit
        break
      }
    }
    const lodging = stopAccommodationFromParsed(parsed, confirmation)
    // Keep a good prior photo when the new parse has none / a bad chrome URL.
    if (!lodging.photoUrl && (prevLodging?.photoUrl || prevBooking?.photoUrl)) {
      lodging.photoUrl = prevLodging?.photoUrl || prevBooking?.photoUrl
    }
    if (prevLodging?.id) lodging.id = prevLodging.id

    const match = findStayForAccommodation(trip, parsed)
    if (!match) {
      throw new Error(
        `No place stop matches ${parsed.checkIn || 'these dates'} — add the town/dates on Planner first, then apply`,
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
      name: lodging.name || prevBooking?.name || 'Accommodation',
      checkIn: parsed.checkIn || prevBooking?.checkIn || '',
      checkOut: parsed.checkOut || prevBooking?.checkOut || '',
      confirmation,
      address: address || prevBooking?.address,
      price: lodging.price || prevBooking?.price,
      amountPaid: lodging.amountPaid || prevBooking?.amountPaid,
      amountOwing: lodging.amountOwing || prevBooking?.amountOwing,
      priceOriginal: lodging.priceOriginal || prevBooking?.priceOriginal,
      amountPaidOriginal: lodging.amountPaidOriginal || prevBooking?.amountPaidOriginal,
      amountOwingOriginal: lodging.amountOwingOriginal || prevBooking?.amountOwingOriginal,
      currency: lodging.currency || prevBooking?.currency,
      bookingUrl: lodging.bookingUrl || prevBooking?.bookingUrl,
      photoUrl: lodging.photoUrl || prevBooking?.photoUrl,
      checkInTime: lodging.checkInTime || prevBooking?.checkInTime,
      checkOutTime: lodging.checkOutTime || prevBooking?.checkOutTime,
      createdAt: prevBooking?.createdAt || createdAt,
    }
    bookings.accommodations = upsertByConfirmation(bookings.accommodations, row)
  } else {
    throw new Error('Could not detect booking type — edit the email text or add the booking manually')
  }

  return enrichTripLodgingDates({ ...trip, bookings, stays })
}

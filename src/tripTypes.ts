export type MustDo = {
  id: string
  text: string
  done: boolean
  createdAt: number
}

export type PackListItem = {
  id: string
  text: string
  category: string
  done: boolean
  createdAt: number
}

export type VisitPlace = {
  id: string
  label: string
  lat?: number
  lon?: number
  cost?: string
  createdAt: number
}

/** Optional lodging booked under a place stop. */
export type StopAccommodation = {
  /** Stable id so a destination can hold multiple lodgings. */
  id: string
  name: string
  address: string
  /** ISO date — first night covered (inclusive). */
  checkIn: string
  /** ISO date — morning of departure (exclusive of overnight coverage). */
  checkOut: string
  checkInTime: string
  checkOutTime: string
  price: string
  /** Amount already paid when known (email import / manual). */
  amountPaid?: string
  /** Remaining balance / next charge when known. */
  amountOwing?: string
  /** Original price string before FX (e.g. "NZD 420"). */
  priceOriginal?: string
  amountPaidOriginal?: string
  amountOwingOriginal?: string
  /** ISO currency of the original booking amounts when converted. */
  currency?: string
  bookingUrl: string
  confirmationRef: string
  /** Property photo URL captured from a confirmation email when available. */
  photoUrl?: string
}

/**
 * A place stop on the trip route (town/city for N nights).
 * Lodging is optional via `accommodations` — activities hang off the stop.
 */
export type Stay = {
  id: string
  /** Place name (town, city, region). */
  location: string
  startDate: string
  endDate: string
  activities: StayActivity[]
  createdAt: number
  lat?: number
  lon?: number
  accommodations: StopAccommodation[]
}

/** All lodgings on a stop (confirmed or draft). */
export function stayAccommodations(stay: Stay | null | undefined): StopAccommodation[] {
  if (Array.isArray(stay?.accommodations) && stay!.accommodations.length > 0) {
    return stay!.accommodations
  }
  // Legacy singular field on runtime objects that skipped parse migration.
  const legacy = (stay as { accommodation?: StopAccommodation | null } | null | undefined)?.accommodation
  if (legacy && typeof legacy === 'object') {
    const confirmationRef = String(legacy.confirmationRef ?? '').trim()
    const name = String(legacy.name ?? '').trim()
    if (confirmationRef || name || legacy.address || legacy.bookingUrl) {
      return [
        {
          id: String(legacy.id ?? '').trim() || `legacy_${stay?.id || 'stay'}`,
          name: name || confirmationRef || 'Accommodation',
          address: String(legacy.address ?? '').trim(),
          checkIn: String(legacy.checkIn ?? '').trim(),
          checkOut: String(legacy.checkOut ?? '').trim(),
          checkInTime: String(legacy.checkInTime ?? '').trim(),
          checkOutTime: String(legacy.checkOutTime ?? '').trim(),
          price: String(legacy.price ?? '').trim(),
          ...(legacy.amountPaid ? { amountPaid: String(legacy.amountPaid).trim() } : {}),
          ...(legacy.amountOwing ? { amountOwing: String(legacy.amountOwing).trim() } : {}),
          ...(legacy.priceOriginal ? { priceOriginal: String(legacy.priceOriginal).trim() } : {}),
          ...(legacy.amountPaidOriginal
            ? { amountPaidOriginal: String(legacy.amountPaidOriginal).trim() }
            : {}),
          ...(legacy.amountOwingOriginal
            ? { amountOwingOriginal: String(legacy.amountOwingOriginal).trim() }
            : {}),
          ...(legacy.currency ? { currency: String(legacy.currency).trim() } : {}),
          bookingUrl: String(legacy.bookingUrl ?? '').trim(),
          confirmationRef,
          ...(legacy.photoUrl ? { photoUrl: String(legacy.photoUrl).trim() } : {}),
        },
      ]
    }
  }
  return Array.isArray(stay?.accommodations) ? stay!.accommodations : []
}

/** Confirmed lodgings only. */
export function stayConfirmedAccommodations(stay: Stay | null | undefined): StopAccommodation[] {
  return stayAccommodations(stay).filter((a) => a.confirmationRef.trim().length > 0)
}

/** True when the stop has a real lodging booking (confirmation). */
export function stayHasAccommodation(stay: Stay | null | undefined): boolean {
  return stayConfirmedAccommodations(stay).length > 0
}

/** Primary lodging for labels / map (first confirmed, else first). */
export function stayPrimaryAccommodation(stay: Stay | null | undefined): StopAccommodation | null {
  const confirmed = stayConfirmedAccommodations(stay)
  if (confirmed.length) return confirmed[0]
  const all = stayAccommodations(stay)
  return all[0] || null
}

/** Display name for lodging, or empty if none. */
export function stayAccommodationLabel(stay: Stay | null | undefined): string {
  const list = stayConfirmedAccommodations(stay)
  if (!list.length) return ''
  if (list.length === 1) return (list[0].name || list[0].confirmationRef || '').trim()
  return `${list.length} accommodations`
}

function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** Nights in [start, end) as ISO dates. */
export function nightsInRange(startDate: string, endDate: string): string[] {
  const out: string[] = []
  if (!startDate || !endDate || endDate <= startDate) return out
  let cur = startDate
  let guard = 0
  while (cur < endDate && guard < 400) {
    out.push(cur)
    cur = isoAddDays(cur, 1)
    guard += 1
  }
  return out
}

/** Effective lodging night coverage on a destination (undated legacy = full stay). */
export function lodgingCoverageInterval(
  lodging: StopAccommodation,
  stay: Stay,
): { checkIn: string; checkOut: string } {
  const checkIn = (lodging.checkIn || stay.startDate || '').trim()
  const checkOut = (lodging.checkOut || stay.endDate || '').trim()
  if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut }
  if (checkIn && stay.endDate && stay.endDate > checkIn) return { checkIn, checkOut: stay.endDate }
  return { checkIn: stay.startDate, checkOut: stay.endDate }
}

export type StayLodgingCoverage = {
  totalNights: number
  coveredNights: number
  uncoveredNights: string[]
  /** True when every destination night has at least one confirmed lodging. */
  fullyCovered: boolean
  /** True when some lodging exists but nights remain uncovered. */
  partialCoverage: boolean
}

/** Compare destination dates to confirmed lodging check-in/out ranges. */
export function stayLodgingCoverage(stay: Stay | null | undefined): StayLodgingCoverage {
  const empty: StayLodgingCoverage = {
    totalNights: 0,
    coveredNights: 0,
    uncoveredNights: [],
    fullyCovered: true,
    partialCoverage: false,
  }
  if (!stay?.startDate || !stay?.endDate) return empty
  const nights = nightsInRange(stay.startDate, stay.endDate)
  const confirmed = stayConfirmedAccommodations(stay)
  if (!nights.length) return empty
  if (!confirmed.length) {
    return {
      totalNights: nights.length,
      coveredNights: 0,
      uncoveredNights: nights,
      fullyCovered: false,
      partialCoverage: false,
    }
  }
  const uncovered = nights.filter((night) => {
    return !confirmed.some((a) => {
      const { checkIn, checkOut } = lodgingCoverageInterval(a, stay)
      return night >= checkIn && night < checkOut
    })
  })
  const coveredNights = nights.length - uncovered.length
  return {
    totalNights: nights.length,
    coveredNights,
    uncoveredNights: uncovered,
    fullyCovered: uncovered.length === 0,
    partialCoverage: uncovered.length > 0 && coveredNights > 0,
  }
}

/** Lodging covering a given itinerary day, if any. */
export function stayAccommodationForDate(
  stay: Stay | null | undefined,
  date: string,
): StopAccommodation | null {
  if (!stay || !date) return stayPrimaryAccommodation(stay)
  const confirmed = stayConfirmedAccommodations(stay)
  const hit = confirmed.find((a) => {
    const { checkIn, checkOut } = lodgingCoverageInterval(a, stay)
    return date >= checkIn && date < checkOut
  })
  return hit || stayPrimaryAccommodation(stay)
}

export type StayActivity = {
  id: string
  date: string
  name: string
  time: string
  /** Optional end time (HH:mm). When omitted, calendar uses a default duration after `time`. */
  endTime?: string
  calendarTimeLabel?: string
  confirmationRef: string
  cost: string
  notes: string
  photoUrl?: string
  googleMapsUri?: string
  placeLabel?: string
  category?: string
  primaryType?: string
  types?: string[]
  createdAt: number
  lat?: number
  lon?: number
}

export type CarBooking = {
  id: string
  company: string
  pickupLocation: string
  dropoffLocation: string
  pickupDate: string
  pickupTime: string
  dropoffDate: string
  dropoffTime: string
  confirmation: string
  price: string
  createdAt: number
  pickupLat?: number
  pickupLon?: number
  dropoffLat?: number
  dropoffLon?: number
}

export type FlightBooking = {
  id: string
  route: string
  fromIata: string
  toIata: string
  fromLabel: string
  toLabel: string
  airline: string
  /** Numeric part or full designator digits, e.g. "248". */
  flightNumber: string
  bookingStatus: string
  departTerminal: string
  seat: string
  notes: string
  departDate: string
  departTime: string
  arriveDate: string
  arriveTime: string
  returnDate: string
  checkedBags: number
  carryOnBags: number
  personalItem: boolean
  confirmation: string
  price: string
  createdAt: number
}

export type RestaurantBooking = {
  id: string
  name: string
  reservationDate: string
  confirmation: string
  cost: string
  notes: string
  createdAt: number
  lat?: number
  lon?: number
}

export type AccommodationBooking = {
  id: string
  name: string
  checkIn: string
  checkOut: string
  confirmation: string
  address?: string
  price?: string
  amountPaid?: string
  amountOwing?: string
  priceOriginal?: string
  amountPaidOriginal?: string
  amountOwingOriginal?: string
  currency?: string
  bookingUrl?: string
  photoUrl?: string
  checkInTime?: string
  checkOutTime?: string
  createdAt: number
}

export type TripBookings = {
  rentalCars: CarBooking[]
  flights: FlightBooking[]
  restaurants: RestaurantBooking[]
  accommodations: AccommodationBooking[]
}

export const EMPTY_TRIP_BOOKINGS: TripBookings = {
  rentalCars: [],
  flights: [],
  restaurants: [],
  accommodations: [],
}

export type TripSharing = {
  sharedItineraryId: string
  role: 'owner' | 'editor' | 'viewer'
  sourceTripId: string
}

export type Trip = {
  id: string
  country: string
  startDate: string
  endDate: string
  cancelled?: boolean
  createdAt: number
  /**
   * Monotonic client edit counter persisted in trip_json.
   * Used to ignore stale PocketBase realtime echoes after rapid local edits
   * (e.g. nights +/-), which previously snapped the UI back.
   */
  clientRev?: number
  mustDos: MustDo[]
  packList: PackListItem[]
  visitPlaces: VisitPlace[]
  stays: Stay[]
  bookings: TripBookings
  /** Present when this trip is synced via a shared itinerary row (not stored in trip_json on the server). */
  sharing?: TripSharing
}

export function isTripReadOnly(trip: Trip | null | undefined): boolean {
  return trip?.sharing?.role === 'viewer'
}

export function stripSharingFromTrip(trip: Trip): Trip {
  const { sharing: _removed, ...rest } = trip
  return rest as Trip
}

export type TripsState = {
  trips: Trip[]
  selectedTripId: string | null
}

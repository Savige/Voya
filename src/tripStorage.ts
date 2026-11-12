import { tripsStorageKey } from './auth'
import type {
  AccommodationBooking,
  CarBooking,
  FlightBooking,
  MustDo,
  PackListItem,
  RestaurantBooking,
  Stay,
  StayActivity,
  Trip,
  TripSharing,
  TripsState,
  VisitPlace,
} from './tripTypes'

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
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    label: String(x.label ?? '').trim(),
                    lat: typeof x.lat === 'number' ? x.lat : undefined,
                    lon: typeof x.lon === 'number' ? x.lon : undefined,
                    cost: String(x.cost ?? '').trim(),
                    createdAt: Number(x.createdAt ?? Date.now()),
                  }))
                  .filter((x: VisitPlace) => x.id && x.label.length > 0)
              : [],
            stays: Array.isArray(t.stays)
              ? t.stays
                  .map((x: any) => ({
                    id: String(x.id ?? ''),
                    location: String(x.location ?? '').trim(),
                    address: String(x.address ?? '').trim(),
                    startDate: String(x.startDate ?? ''),
                    endDate: String(x.endDate ?? ''),
                    checkInTime: String(x.checkInTime ?? '').trim(),
                    checkOutTime: String(x.checkOutTime ?? '').trim(),
                    price: String(x.price ?? '').trim(),
                    bookingUrl: String(x.bookingUrl ?? '').trim(),
                    confirmationRef: String(x.confirmationRef ?? '').trim(),
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
                  }))
                  .filter((x: Stay) => x.id && x.location.length > 0 && x.startDate && x.endDate && x.confirmationRef.length > 0)
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
                        x.confirmation.length > 0 &&
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
                    .map((x: any) => ({
                      id: String(x.id ?? ''),
                      name: String(x.name ?? '').trim(),
                      checkIn: String(x.checkIn ?? ''),
                      checkOut: String(x.checkOut ?? ''),
                      confirmation: String(x.confirmation ?? '').trim(),
                      createdAt: Number(x.createdAt ?? Date.now()),
                    }))
                    .filter((x: AccommodationBooking) => x.id && x.name.length > 0 && x.confirmation.length > 0)
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
  localStorage.setItem(tripsStorageKey(userEmail), JSON.stringify(state))
}

/** Personal `user_trips` payload: omit trips that only exist on `shared_itineraries`. */
export function tripsStateForPersonalSave(state: TripsState): TripsState {
  return {
    trips: state.trips.filter((t) => !t.sharing),
    selectedTripId: state.selectedTripId,
  }
}

export function parseSingleTripFromUnknown(tripJson: unknown): Trip | null {
  const wrapped = { trips: [tripJson], selectedTripId: null as string | null }
  const { trips } = parseTripsFromUnknown(wrapped as unknown)
  const t = trips[0]
  return t && t.id && t.country.length > 0 ? t : null
}

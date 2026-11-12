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

export type Stay = {
  id: string
  location: string
  address: string
  startDate: string
  endDate: string
  checkInTime: string
  checkOutTime: string
  price: string
  bookingUrl: string
  confirmationRef: string
  activities: StayActivity[]
  createdAt: number
  lat?: number
  lon?: number
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

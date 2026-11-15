export type BookingImportKind = 'flight' | 'rentalCar' | 'accommodation' | 'restaurant' | 'unknown'

export type BookingImportStatus = 'pending' | 'applied' | 'dismissed' | 'failed'

export type ParsedBookingFields = {
  kind: BookingImportKind
  confidence: number
  confirmation?: string
  /** Total booking price when known (often converted to display currency). */
  price?: string
  /** Amount already paid / charged. */
  amountPaid?: string
  /** Remaining balance / next charge. */
  amountOwing?: string
  /** Pre-FX originals when price was converted (e.g. NZD → AUD). */
  priceOriginal?: string
  amountPaidOriginal?: string
  amountOwingOriginal?: string
  /** Original ISO currency code when different from display currency. */
  currency?: string
  notes?: string
  photoUrl?: string
  bookingUrl?: string
  // flight
  airline?: string
  fromIata?: string
  toIata?: string
  fromLabel?: string
  toLabel?: string
  departDate?: string
  departTime?: string
  arriveDate?: string
  arriveTime?: string
  // car
  company?: string
  pickupLocation?: string
  dropoffLocation?: string
  pickupDate?: string
  pickupTime?: string
  dropoffDate?: string
  dropoffTime?: string
  // stay / restaurant
  name?: string
  location?: string
  address?: string
  checkIn?: string
  checkOut?: string
  checkInTime?: string
  checkOutTime?: string
  reservationDate?: string
  reservationTime?: string
}

export type BookingImportRecord = {
  id: string
  status: BookingImportStatus
  kind: BookingImportKind
  from_email?: string
  subject?: string
  trip_id?: string
  parsed: ParsedBookingFields
  raw_text?: string
  error?: string
  message_id?: string
  created: string
}

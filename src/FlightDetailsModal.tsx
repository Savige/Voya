import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  CircleDollarSign,
  Info,
  Plane,
  Ticket,
  Trash2,
  X,
} from 'lucide-react'
import { getAirportByIata } from './data/airportLookup'
import { localWallTimeToUtcMs, tzForIata } from './airportTz'
import type { FlightBooking, Stay } from './tripTypes'

const BOOKING_STATUSES = ['Booked', 'Hold', 'Standby', 'Cancelled'] as const

const parseIsoDate = (iso?: string) => {
  if (!iso) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

const formatLongDate = (iso?: string) => {
  const d = parseIsoDate(iso)
  if (!d) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const dayOffsetLabel = (departDate: string, arriveDate: string) => {
  const a = parseIsoDate(departDate)
  const b = parseIsoDate(arriveDate)
  if (!a || !b) return ''
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
  if (diff <= 0) return ''
  return `⁺${diff}`
}

const formatDuration = (min: number | null) => {
  if (min == null || min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h <= 0) return `${m} min`
  if (m <= 0) return `${h} hr`
  return `${h} hr ${m} min`
}

function flightDurationMin(f: FlightBooking): number | null {
  const fromTz = tzForIata(f.fromIata)
  const toTz = tzForIata(f.toIata)
  if (!fromTz || !toTz || !f.departDate || !f.departTime || !f.arriveTime) return null
  const arriveDate = f.arriveDate || f.departDate
  const dep = localWallTimeToUtcMs(f.departDate, f.departTime, fromTz)
  const arr = localWallTimeToUtcMs(arriveDate, f.arriveTime, toTz)
  if (dep == null || arr == null || arr <= dep) return null
  return Math.round((arr - dep) / 60000)
}

function tzOffsetHours(fromIata: string, toIata: string, onDate: string): number | null {
  const fromTz = tzForIata(fromIata)
  const toTz = tzForIata(toIata)
  if (!fromTz || !toTz || !onDate) return null
  const noon = `${onDate}T12:00:00`
  const probe = Date.parse(noon)
  if (!Number.isFinite(probe)) return null
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    }).formatToParts(new Date(probe))
  const parseOff = (parts: Intl.DateTimeFormatPart[]) => {
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    const m = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i)
    if (!m) return 0
    const sign = m[1] === '-' ? -1 : 1
    return sign * (Number(m[2]) + Number(m[3] || 0) / 60)
  }
  try {
    return Math.round((parseOff(fmt(toTz)) - parseOff(fmt(fromTz))) * 10) / 10
  } catch {
    return null
  }
}

function cityPairLabel(fromIata: string, toIata: string, fromLabel: string, toLabel: string) {
  const fromAp = getAirportByIata(fromIata)
  const toAp = getAirportByIata(toIata)
  const fromCity = fromAp?.city || fromLabel.split(',')[0] || fromIata
  const toCity = toAp?.city || toLabel.split(',')[0] || toIata
  return `${fromCity} to ${toCity}`
}

function designator(f: FlightBooking) {
  const num = (f.flightNumber || '').trim().replace(/\s+/g, '').toUpperCase()
  if (num) return num
  return f.airline.trim() || 'Flight'
}

function overlapWarning(flight: FlightBooking, stays: Stay[]): string | null {
  if (!flight.departDate) return null
  const hit = stays.find(
    (s) => s.startDate && s.endDate && s.startDate <= flight.departDate && flight.departDate < s.endDate,
  )
  if (!hit) return null
  const toAp = getAirportByIata(flight.toIata)
  const dest = toAp?.city || hit.location
  const when = formatLongDate(flight.departDate)
  if (!dest || !when) return null
  // Same-city arrival into an already-started stop is fine; warn when departing on a stay day.
  if (hit.location.toLowerCase().includes((toAp?.city || '').toLowerCase()) && toAp?.city) return null
  return `Your flight overlaps with your destination ${hit.location} on ${when}.`
}

export type FlightDetailsModalProps = {
  open: boolean
  flight: FlightBooking
  stays?: Stay[]
  readOnly?: boolean
  onClose: () => void
  onSave: (patch: Partial<FlightBooking>) => void
  onDelete: () => void
}

/**
 * Quick overview + edit sheet for an existing flight.
 */
export function FlightDetailsModal({
  open,
  flight,
  stays = [],
  readOnly = false,
  onClose,
  onSave,
  onDelete,
}: FlightDetailsModalProps) {
  const [confirmation, setConfirmation] = useState(flight.confirmation)
  const [bookingStatus, setBookingStatus] = useState(flight.bookingStatus || 'Booked')
  const [departTerminal, setDepartTerminal] = useState(flight.departTerminal || '')
  const [seat, setSeat] = useState(flight.seat || '')
  const [price, setPrice] = useState(flight.price || '')
  const [notes, setNotes] = useState(flight.notes || '')
  const [copied, setCopied] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setConfirmation(flight.confirmation)
    setBookingStatus(flight.bookingStatus || 'Booked')
    setDepartTerminal(flight.departTerminal || '')
    setSeat(flight.seat || '')
    setPrice(flight.price || '')
    setNotes(flight.notes || '')
    setCopied(false)
    setSaveError(null)
  }, [
    open,
    flight.id,
    flight.confirmation,
    flight.bookingStatus,
    flight.departTerminal,
    flight.seat,
    flight.price,
    flight.notes,
  ])

  const fromAp = getAirportByIata(flight.fromIata)
  const toAp = getAirportByIata(flight.toIata)
  const duration = useMemo(() => flightDurationMin(flight), [flight])
  const tzDiff = useMemo(
    () => tzOffsetHours(flight.fromIata, flight.toIata, flight.departDate),
    [flight.fromIata, flight.toIata, flight.departDate],
  )
  const warn = useMemo(() => overlapWarning(flight, stays), [flight, stays])
  const arriveDate = flight.arriveDate || flight.departDate
  const offset = dayOffsetLabel(flight.departDate, arriveDate)

  if (!open) return null

  const handleSave = () => {
    setSaveError(null)
    onSave({
      confirmation: confirmation.trim(),
      bookingStatus: bookingStatus.trim() || 'Booked',
      departTerminal: departTerminal.trim(),
      seat: seat.trim().toUpperCase(),
      price: price.trim(),
      notes: notes.trim(),
    })
    onClose()
  }

  const copyCode = () => {
    const t = confirmation.trim()
    if (!t) return
    void navigator.clipboard?.writeText?.(t).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flight-details flex w-[min(100%,26rem)] max-h-[90vh] flex-col overflow-hidden rounded-3xl border border-slate-600 bg-neutral-950 text-neutral-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flight-details-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-center border-b border-slate-700 px-4 py-4">
          <h2 id="flight-details-title" className="text-lg font-bold text-neutral-100">
            Flight details
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="rounded-2xl border border-slate-600 bg-neutral-900 p-4 shadow-sm">
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-neutral-900">
              {designator(flight)}
            </span>
            <p className="mt-2 text-lg font-bold text-neutral-50">
              {cityPairLabel(flight.fromIata, flight.toIata, flight.fromLabel, flight.toLabel)}
            </p>
            {duration ? (
              <p className="mt-1 text-sm text-neutral-400">
                {[formatDuration(duration), offset ? 'Overnight' : ''].filter(Boolean).join(' • ')}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-bold tracking-wide text-neutral-50">{flight.fromIata}</span>
                <ArrowUpRight size={16} className="shrink-0 text-slate-400" aria-hidden />
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <ArrowDownRight size={16} className="shrink-0 text-slate-400" aria-hidden />
                <span className="text-2xl font-bold tracking-wide text-neutral-50">{flight.toIata}</span>
              </div>

              <p className="mt-2 min-h-[2.75rem] text-xs leading-snug text-neutral-400">
                {fromAp?.name || flight.fromLabel || 'Departure'}
              </p>
              <p className="mt-2 min-h-[2.75rem] text-right text-xs leading-snug text-neutral-400">
                {toAp?.name || flight.toLabel || 'Arrival'}
              </p>

              <p className="mt-1 text-neutral-300">{formatLongDate(flight.departDate)}</p>
              <p className="mt-1 text-right text-neutral-300">{formatLongDate(arriveDate)}</p>

              <p className="text-2xl font-bold tabular-nums leading-none text-neutral-50">
                {(flight.departTime || '').slice(0, 5) || '—'}
              </p>
              <p className="text-right text-2xl font-bold tabular-nums leading-none text-neutral-50">
                {(flight.arriveTime || '').slice(0, 5) || '—'}
                {offset ? <span className="ml-0.5 align-top text-sm font-semibold text-sky-300">{offset}</span> : null}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 text-sm">
            <span className="text-neutral-400">Time zone difference</span>
            <span className="font-semibold text-neutral-100">
              {tzDiff == null ? '—' : tzDiff === 0 ? '0 hr' : `${tzDiff > 0 ? '+' : ''}${tzDiff} hr`}
            </span>
          </div>

          {warn ? (
            <div className="flex gap-2 rounded-xl border border-amber-700/60 bg-amber-950/50 px-3 py-2.5 text-xs leading-relaxed text-amber-100">
              <Info size={16} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
              <p>{warn}</p>
            </div>
          ) : null}

          <div className="flex gap-2 rounded-xl border border-sky-800 bg-sky-950/60 px-3 py-2.5 text-xs leading-relaxed text-slate-200">
            <Info size={16} className="mt-0.5 shrink-0 text-sky-300" aria-hidden />
            <p>
              Flight info won&apos;t update automatically as it&apos;s added manually, so changes like delays
              won&apos;t be reflected here. Always check with your airline before you fly.
            </p>
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
            <Ticket size={16} className="shrink-0 text-neutral-400" aria-hidden />
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={readOnly}
              placeholder="Booking code"
              className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={copyCode}
              disabled={!confirmation.trim()}
              className="shrink-0 text-sm font-semibold text-sky-300 hover:text-sky-200 disabled:opacity-40"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2">
            <span className="text-neutral-500" aria-hidden>
              #
            </span>
            <span className="min-w-0 flex-1 text-sm text-neutral-400">Booking status</span>
            <select
              value={bookingStatus}
              onChange={(e) => setBookingStatus(e.target.value)}
              disabled={readOnly}
              className="rounded-lg border-0 bg-transparent py-1 text-sm font-semibold text-neutral-100 outline-none disabled:opacity-60"
            >
              {BOOKING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="text-neutral-400" aria-hidden />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2">
            <Plane size={16} className="shrink-0 text-neutral-400" aria-hidden />
            <input
              value={departTerminal}
              onChange={(e) => setDepartTerminal(e.target.value)}
              disabled={readOnly}
              placeholder="Departure terminal"
              className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
            <span className="text-sm text-neutral-500" aria-hidden>
              ⌂
            </span>
            <input
              value={seat}
              onChange={(e) => setSeat(e.target.value)}
              disabled={readOnly}
              placeholder="Seat"
              className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
            <CircleDollarSign size={16} className="shrink-0 text-neutral-400" aria-hidden />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={readOnly}
              placeholder="Price (AUD)"
              inputMode="decimal"
              className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60"
            />
          </label>

          <label className="block rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
            <span className="text-[11px] font-medium text-neutral-400">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={readOnly}
              rows={2}
              className="mt-1 w-full resize-none border-0 bg-transparent text-sm text-neutral-100 outline-none disabled:opacity-60"
            />
          </label>

          {saveError ? <p className="text-sm font-medium text-rose-300">{saveError}</p> : null}
        </div>

        <div className="flex items-center gap-3 border-t border-slate-700 px-4 py-3">
          {!readOnly ? (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-2 rounded-full border border-rose-500/50 bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-950/50"
            >
              <Trash2 size={16} aria-hidden />
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={readOnly ? onClose : handleSave}
            className="ml-auto flex-1 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md hover:from-blue-500 hover:to-indigo-500"
          >
            {readOnly ? 'Close' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

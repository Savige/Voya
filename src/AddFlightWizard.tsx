import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  ChevronDown,
  CircleDollarSign,
  Info,
  Plane,
  Ticket,
  X,
} from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { searchAirlines, type AirlineRecord } from './data/airlines'
import { formatAirportOptionLabel, getAirportByIata } from './data/airportLookup'
import { inferArriveDate } from './airportTz'
import { lookupFlight, type FlightLookupResult } from './flightsApi'
import { AirportCombobox } from './AirportCombobox'
import type { AirportRecord } from './data/airports'
import type { FlightBooking } from './tripTypes'

type Step = 'search' | 'number' | 'date' | 'result' | 'details'

const BOOKING_STATUSES = ['Booked', 'Hold', 'Standby', 'Cancelled'] as const

const parseIsoDate = (iso?: string) => {
  if (!iso) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

const toIsoDate = (d?: Date | null) => {
  if (!d) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const formatLongDate = (iso?: string) => {
  const d = parseIsoDate(iso)
  if (!d) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const formatDuration = (min: number | null | undefined) => {
  if (min == null || min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h <= 0) return `${m} min`
  if (m <= 0) return `${h} hr`
  return `${h} hr ${m} min`
}

const dayOffsetLabel = (departDate: string, arriveDate: string) => {
  const a = parseIsoDate(departDate)
  const b = parseIsoDate(arriveDate)
  if (!a || !b) return ''
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
  if (diff <= 0) return ''
  return ` +${diff}`
}

function highlightMatch(text: string, query: string) {
  const q = query.trim()
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <span className="fw-hit">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  )
}

export type AddFlightWizardProps = {
  open: boolean
  defaultDepartDate?: string
  onClose: () => void
  onSave: (flight: Omit<FlightBooking, 'id' | 'createdAt'>) => void
}

export function AddFlightWizard({ open, defaultDepartDate, onClose, onSave }: AddFlightWizardProps) {
  const [step, setStep] = useState<Step>('search')
  const [query, setQuery] = useState('')
  const [airline, setAirline] = useState<AirlineRecord | null>(null)
  const [flightNumber, setFlightNumber] = useState('')
  const [departDate, setDepartDate] = useState(defaultDepartDate || '')
  const [dateOpen, setDateOpen] = useState(false)
  const [calMonth, setCalMonth] = useState<Date>(
    () => parseIsoDate(defaultDepartDate) || new Date(),
  )
  const [lookup, setLookup] = useState<FlightLookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [fromIata, setFromIata] = useState('')
  const [fromLabel, setFromLabel] = useState('')
  const [toIata, setToIata] = useState('')
  const [toLabel, setToLabel] = useState('')
  const [departTime, setDepartTime] = useState('')
  const [arriveDate, setArriveDate] = useState('')
  const [arriveTime, setArriveTime] = useState('')

  const [confirmation, setConfirmation] = useState('')
  const [bookingStatus, setBookingStatus] = useState<string>('Booked')
  const [departTerminal, setDepartTerminal] = useState('')
  const [seat, setSeat] = useState('')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement | null>(null)
  const numberRef = useRef<HTMLInputElement | null>(null)

  const suggestions = useMemo(() => searchAirlines(query, 8), [query])

  useEffect(() => {
    if (!open) return
    setStep('search')
    setQuery('')
    setAirline(null)
    setFlightNumber('')
    setDepartDate(defaultDepartDate || '')
    setCalMonth(parseIsoDate(defaultDepartDate) || new Date())
    setDateOpen(false)
    setLookup(null)
    setLookupError(null)
    setLookupBusy(false)
    setFromIata('')
    setFromLabel('')
    setToIata('')
    setToLabel('')
    setDepartTime('')
    setArriveDate('')
    setArriveTime('')
    setConfirmation('')
    setBookingStatus('Booked')
    setDepartTerminal('')
    setSeat('')
    setPrice('')
    setNotes('')
    setSaveError(null)
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open, defaultDepartDate])

  useEffect(() => {
    if (step === 'number') requestAnimationFrame(() => numberRef.current?.focus())
  }, [step])

  if (!open) return null

  const applyLookup = (f: FlightLookupResult) => {
    setLookup(f)
    setFromIata(f.fromIata)
    setToIata(f.toIata)
    const fromAp = getAirportByIata(f.fromIata)
    const toAp = getAirportByIata(f.toIata)
    setFromLabel(fromAp ? formatAirportOptionLabel(fromAp) : f.fromLabel)
    setToLabel(toAp ? formatAirportOptionLabel(toAp) : f.toLabel)
    setDepartTime(f.departTime)
    setArriveTime(f.arriveTime)
    setDepartTerminal(f.departTerminal || '')
    const inferred = inferArriveDate({
      fromIata: f.fromIata,
      toIata: f.toIata,
      departDate: f.departDate || departDate,
      departTime: f.departTime,
      arriveTime: f.arriveTime,
      preferDate: f.arriveDate || undefined,
    })
    setArriveDate(inferred || f.arriveDate || f.departDate)
  }

  const runLookup = async (dateIso: string) => {
    if (!airline) return
    setLookupBusy(true)
    setLookupError(null)
    try {
      const res = await lookupFlight({
        airlineIata: airline.iata,
        airlineIcao: airline.icao,
        flightNumber: flightNumber.trim(),
        date: dateIso,
      })
      if (!res.flight) {
        setLookup(null)
        setLookupError(
          res.message ||
            'No typical route found. Enter airports and times from your booking.'
        )
        setArriveDate(dateIso)
        setStep('result')
        return
      }
      applyLookup(res.flight)
      setStep('result')
    } catch (err) {
      setLookup(null)
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
      setArriveDate(dateIso)
      setStep('result')
    } finally {
      setLookupBusy(false)
    }
  }

  const pickAirline = (a: AirlineRecord) => {
    setAirline(a)
    setQuery(a.name)
    setStep('number')
  }

  const commitFlightNumber = () => {
    let n = flightNumber.trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    // Strip leading IATA only when it contains a letter (NZ248 / U2… / 3U…).
    // Pure digits like 248 must NOT match — [A-Z0-9]{2} wrongly treated "24" as a code.
    if (/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d/.test(n)) n = n.slice(2)
    if (!/^\d{1,4}[A-Z]?$/.test(n)) return
    setFlightNumber(n)
    setStep('date')
    setDateOpen(true)
  }

  const goBack = () => {
    setSaveError(null)
    if (step === 'number') {
      setStep('search')
      setAirline(null)
      setFlightNumber('')
    } else if (step === 'date') {
      setStep('number')
      setDateOpen(false)
    } else if (step === 'result') {
      setStep('date')
      setDateOpen(true)
    } else if (step === 'details') {
      setStep('result')
    } else {
      onClose()
    }
  }

  const handleSave = () => {
    setSaveError(null)
    const from = fromIata.trim().toUpperCase()
    const to = toIata.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      setSaveError('Select departure and arrival airports.')
      return
    }
    if (!departDate || !departTime) {
      setSaveError('Departure date and time are required.')
      return
    }
    const airlineName = airline?.name || lookup?.airline || ''
    const num = flightNumber.trim()
    const alreadyHasCode = /^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d/i.test(num)
    const designator = airline?.iata && num && !alreadyHasCode ? `${airline.iata}${num}` : num
    const conf = confirmation.trim() || designator || `${from}${to}`
    const route = `${from} → ${to}`
    onSave({
      route,
      fromIata: from,
      toIata: to,
      fromLabel: fromLabel.trim(),
      toLabel: toLabel.trim(),
      airline: airlineName,
      flightNumber: designator,
      bookingStatus: bookingStatus || 'Booked',
      departTerminal: departTerminal.trim(),
      seat: seat.trim(),
      notes: notes.trim(),
      departDate,
      departTime,
      arriveDate:
        arriveDate ||
        inferArriveDate({
          fromIata: from,
          toIata: to,
          departDate,
          departTime,
          arriveTime,
        }) ||
        departDate,
      arriveTime,
      returnDate: '',
      checkedBags: 1,
      carryOnBags: 1,
      personalItem: true,
      confirmation: conf,
      price: price.trim(),
    })
  }

  const cityPair =
    fromIata && toIata
      ? `${getAirportByIata(fromIata)?.city || fromLabel.split(',')[0] || fromIata} to ${
          getAirportByIata(toIata)?.city || toLabel.split(',')[0] || toIata
        }`
      : ''

  const durationLabel = formatDuration(lookup?.durationMin)
  const distanceLabel =
    lookup?.distanceKm != null ? `${lookup.distanceKm.toLocaleString()} km` : ''
  const metaLine = [durationLabel, distanceLabel].filter(Boolean).join(' • ')

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flight-wizard flex w-[min(100%,26rem)] max-h-[90vh] flex-col overflow-hidden rounded-3xl border border-slate-600 bg-neutral-950 text-neutral-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-flight-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-center border-b border-slate-700 px-4 py-4">
          {step !== 'search' ? (
            <button
              type="button"
              onClick={goBack}
              className="absolute left-3 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
              aria-label="Back"
            >
              <ArrowLeft size={18} aria-hidden />
            </button>
          ) : null}
          <h2 id="add-flight-title" className="text-lg font-bold text-neutral-100">
            Add a flight
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {step === 'search' ? (
            <div>
              <label className="relative block">
                <span className="sr-only">Enter airline, flight or airport</span>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter airline, flight or airport"
                  className="w-full rounded-2xl border-2 border-sky-400 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 outline-none placeholder:text-slate-500"
                  autoComplete="off"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      searchRef.current?.focus()
                    }}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
                    aria-label="Clear"
                  >
                    <X size={14} aria-hidden />
                  </button>
                ) : null}
              </label>
              {suggestions.length > 0 ? (
                <ul className="mt-3 space-y-1" role="listbox">
                  {suggestions.map((a) => (
                    <li key={a.iata}>
                      <button
                        type="button"
                        onClick={() => pickAirline(a)}
                        className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-neutral-800"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-neutral-200">
                          <Plane size={16} aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold text-neutral-100">
                            {highlightMatch(a.name, query)}
                          </span>
                          <span className="block text-sm text-slate-400">
                            {a.iata}
                            {a.icao ? ` • ${a.icao}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim().length >= 2 ? (
                <p className="mt-6 text-center text-sm text-slate-400">No airlines match that search.</p>
              ) : (
                <p className="mt-8 text-center text-sm text-slate-500">Search for an airline to continue.</p>
              )}
            </div>
          ) : null}

          {step === 'number' && airline ? (
            <div>
              <div className="flex items-stretch gap-2">
                <div className="flex w-14 shrink-0 items-center justify-center rounded-xl border border-slate-600 bg-neutral-900 text-sm font-bold text-neutral-200">
                  {airline.iata}
                </div>
                <label className="relative min-w-0 flex-1">
                  <span className="pointer-events-none absolute left-3 top-2 text-[11px] font-medium text-slate-500">
                    Flight number
                  </span>
                  <input
                    ref={numberRef}
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value.replace(/[^\dA-Za-z]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitFlightNumber()
                      }
                    }}
                    placeholder="e.g. 248"
                    className="w-full rounded-xl border-2 border-sky-400 bg-neutral-900 px-3 pb-2.5 pt-5 text-sm font-semibold text-neutral-100 outline-none"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                  {flightNumber ? (
                    <button
                      type="button"
                      onClick={() => setFlightNumber('')}
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
                      aria-label="Clear"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  ) : null}
                </label>
              </div>
              {/^\d{1,4}/.test(flightNumber.trim()) ? (
                <button
                  type="button"
                  onClick={commitFlightNumber}
                  className="mt-4 flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-neutral-800"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-neutral-200">
                    <Plane size={16} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-neutral-100">
                      {airline.name} {flightNumber.trim()}
                    </span>
                    <span className="block text-sm text-slate-400">Detected flight number</span>
                  </span>
                </button>
              ) : (
                <div className="mt-4 flex items-center gap-3 px-2 py-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-neutral-200">
                    <Plane size={16} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-neutral-100">{airline.name}</span>
                    <span className="block text-sm text-slate-400">
                      {airline.iata}
                      {airline.icao ? ` • ${airline.icao}` : ''}
                    </span>
                  </span>
                </div>
              )}
            </div>
          ) : null}

          {step === 'date' && airline ? (
            <div>
              <div className="flex items-stretch gap-2">
                <div className="flex w-14 shrink-0 items-center justify-center rounded-xl border border-slate-600 bg-neutral-900 text-sm font-bold text-neutral-200">
                  {airline.iata}
                </div>
                <div className="relative min-w-0 flex-1 rounded-xl border border-slate-600 bg-neutral-900 px-3 pb-2.5 pt-5">
                  <span className="pointer-events-none absolute left-3 top-2 text-[11px] font-medium text-slate-500">
                    Flight number
                  </span>
                  <span className="text-sm font-semibold text-neutral-100">{flightNumber}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDateOpen((v) => {
                    const next = !v
                    if (next) {
                      setCalMonth(parseIsoDate(departDate || defaultDepartDate) || new Date())
                    }
                    return next
                  })
                }}
                className="relative mt-3 flex w-full items-center gap-2 rounded-xl border-2 border-sky-400 bg-neutral-900 px-3 py-3 text-left"
              >
                <Calendar size={18} className="shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-slate-500">Departure date</span>
                  <span className="block text-sm font-semibold text-neutral-100">
                    {departDate ? formatLongDate(departDate) : 'Pick a date'}
                  </span>
                </span>
                {departDate ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDepartDate('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        setDepartDate('')
                      }
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
                    aria-label="Clear date"
                  >
                    <X size={14} aria-hidden />
                  </span>
                ) : null}
              </button>
              {dateOpen ? (
                <div className="mt-3 rounded-2xl border border-slate-600 bg-neutral-900 p-3">
                  <DayPicker
                    mode="single"
                    month={calMonth}
                    onMonthChange={setCalMonth}
                    selected={parseIsoDate(departDate)}
                    captionLayout="label"
                    navLayout="around"
                    numberOfMonths={1}
                    onSelect={(day) => {
                      if (!day) return
                      const iso = toIsoDate(day)
                      setDepartDate(iso)
                      setCalMonth(day)
                      setDateOpen(false)
                      void runLookup(iso)
                    }}
                    classNames={{
                      root: 'rdp-modern mx-auto',
                      month_caption: 'rdp-caption',
                      day: 'rdp-day',
                      day_button: 'rdp-day-button',
                      selected: 'rdp-selected',
                      chevron: 'rdp-chevron',
                    }}
                  />
                </div>
              ) : null}
              {lookupBusy ? (
                <p className="mt-4 text-center text-sm text-slate-400">Looking up schedule…</p>
              ) : null}
              {departDate && !lookupBusy ? (
                <button
                  type="button"
                  onClick={() => void runLookup(departDate)}
                  className="mt-4 w-full rounded-full bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  Look up route
                </button>
              ) : null}
            </div>
          ) : null}

          {step === 'result' ? (
            <div className="space-y-4">
              {lookupError ? (
                <p className="rounded-xl border border-amber-700/50 bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
                  {lookupError}
                </p>
              ) : null}

              {fromIata && toIata ? (
                <div className="w-full rounded-2xl border border-slate-600 bg-neutral-900 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-neutral-200">
                        <Plane size={14} aria-hidden />
                      </span>
                      <span className="text-sm font-semibold text-neutral-100">
                        {airline?.name || lookup?.airline}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-neutral-300">
                      {airline?.iata} {flightNumber}
                    </span>
                  </div>
                  <p className="mt-3 text-base font-bold text-neutral-100">{cityPair}</p>
                  <div className="mt-3 flex items-center gap-4 text-sm font-medium text-neutral-200">
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowUpRight size={14} className="text-slate-500" aria-hidden />
                      {fromIata} {departTime || '—'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowDownRight size={14} className="text-slate-500" aria-hidden />
                      {toIata} {arriveTime || '—'}
                      {dayOffsetLabel(departDate, arriveDate || departDate)}
                    </span>
                  </div>
                </div>
              ) : null}

              {!lookupError && fromIata && toIata ? (
                <div className="flex gap-2 rounded-xl border border-sky-300/40 bg-sky-950/40 px-3 py-2 text-sm text-sky-100">
                  <Info size={16} className="mt-0.5 shrink-0 text-sky-300" aria-hidden />
                  <p>
                    Prefill is the <span className="font-semibold">published schedule</span> from
                    AeroDataBox for this date. Confirm it matches your booking before continuing.
                  </p>
                </div>
              ) : null}

              <div className="space-y-3">
                <p className="text-sm font-semibold text-neutral-200">
                  {fromIata ? 'Confirm airports & times' : 'Enter flight details'}
                </p>
                <AirportCombobox
                  iata={fromIata}
                  labelText={fromLabel}
                  onSelect={(a: AirportRecord) => {
                    setFromIata(a.iata)
                    setFromLabel(formatAirportOptionLabel(a))
                  }}
                  onClear={() => {
                    setFromIata('')
                    setFromLabel('')
                  }}
                />
                <AirportCombobox
                  iata={toIata}
                  labelText={toLabel}
                  onSelect={(a: AirportRecord) => {
                    setToIata(a.iata)
                    setToLabel(formatAirportOptionLabel(a))
                  }}
                  onClear={() => {
                    setToIata('')
                    setToLabel('')
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs font-medium text-slate-400">
                    Depart time
                    <input
                      type="time"
                      value={departTime}
                      onChange={(e) => {
                        const next = e.target.value
                        setDepartTime(next)
                        if (fromIata && toIata && departDate && arriveTime) {
                          setArriveDate(
                            inferArriveDate({
                              fromIata,
                              toIata,
                              departDate,
                              departTime: next,
                              arriveTime,
                            }),
                          )
                        }
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-400">
                    Arrive time
                    <input
                      type="time"
                      value={arriveTime}
                      onChange={(e) => {
                        const next = e.target.value
                        setArriveTime(next)
                        if (fromIata && toIata && departDate && departTime) {
                          setArriveDate(
                            inferArriveDate({
                              fromIata,
                              toIata,
                              departDate,
                              departTime,
                              arriveTime: next,
                            }),
                          )
                        }
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100"
                    />
                  </label>
                </div>
                <label className="block text-xs font-medium text-slate-400">
                  Arrive date
                  <input
                    type="date"
                    value={arriveDate || departDate}
                    onChange={(e) => setArriveDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100"
                  />
                </label>
                <button
                  type="button"
                  disabled={!fromIata || !toIata || !departTime}
                  onClick={() => setStep('details')}
                  className="w-full rounded-full bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  Continue
                </button>
              </div>

              <p className="text-center text-[11px] text-slate-500">
                Data by{' '}
                <a
                  href="https://aerodatabox.com"
                  target="_blank"
                  rel="noreferrer"
                  className="fw-hit underline"
                >
                  AeroDataBox
                </a>
              </p>
            </div>
          ) : null}

          {step === 'details' ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-600 bg-neutral-900 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-neutral-900">
                    {airline?.iata}
                    {flightNumber}
                  </span>
                </div>
                <p className="mt-2 text-lg font-bold text-neutral-100">{cityPair}</p>
                {metaLine ? <p className="mt-1 text-sm text-slate-400">{metaLine}</p> : null}
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="font-semibold text-neutral-100">{fromIata}</p>
                    <p className="text-xs text-slate-400">{fromLabel || 'Departure'}</p>
                    <p className="mt-1 text-neutral-300">
                      {formatLongDate(departDate)}
                      {departTime ? ` at ${departTime}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-neutral-100">{toIata}</p>
                    <p className="text-xs text-slate-400">{toLabel || 'Arrival'}</p>
                    <p className="mt-1 text-neutral-300">
                      {formatLongDate(arriveDate || departDate)}
                      {arriveTime ? ` at ${arriveTime}` : ''}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-600 px-3 py-2 text-sm">
                <span className="text-slate-500">Time zone difference</span>
                <span className="font-semibold text-neutral-100">—</span>
              </div>

              <div className="flex gap-2 rounded-xl border border-sky-700/60 bg-sky-950/50 px-3 py-2.5 text-xs leading-relaxed text-sky-100">
                <Info size={16} className="mt-0.5 shrink-0 text-sky-300" aria-hidden />
                <p>
                  Flight info won&apos;t update automatically as it&apos;s added manually, so changes like
                  delays won&apos;t be reflected here. Always check with your airline before you fly.
                </p>
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
                <Ticket size={16} className="shrink-0 text-slate-400" aria-hidden />
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Booking code"
                  className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.readText?.().then((t) => {
                      if (t) setConfirmation(t.trim())
                    })
                  }}
                  className="shrink-0 text-sm font-semibold text-sky-300 hover:text-sky-200"
                >
                  Paste
                </button>
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2">
                <span className="text-slate-500" aria-hidden>
                  #
                </span>
                <span className="min-w-0 flex-1 text-sm text-slate-400">Booking status</span>
                <select
                  value={bookingStatus}
                  onChange={(e) => setBookingStatus(e.target.value)}
                  className="rounded-lg border-0 bg-transparent py-1 text-sm font-semibold text-neutral-100 outline-none"
                >
                  {BOOKING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="text-slate-400" aria-hidden />
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
                <CircleDollarSign size={16} className="shrink-0 text-slate-400" aria-hidden />
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Price (AUD)"
                  inputMode="decimal"
                  className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-slate-500"
                />
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
                <Plane size={16} className="shrink-0 text-slate-400" aria-hidden />
                <input
                  value={departTerminal}
                  onChange={(e) => setDepartTerminal(e.target.value)}
                  placeholder="Departure terminal"
                  className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-slate-500"
                />
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
                <span className="text-sm text-slate-500" aria-hidden>
                  ⌂
                </span>
                <input
                  value={seat}
                  onChange={(e) => setSeat(e.target.value)}
                  placeholder="Seat"
                  className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-neutral-100 outline-none placeholder:text-slate-500"
                />
              </label>

              <label className="block rounded-xl border border-slate-600 bg-neutral-900 px-3 py-2 focus-within:border-sky-500">
                <span className="text-[11px] font-medium text-slate-400">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-none border-0 bg-transparent text-sm text-neutral-100 outline-none"
                />
              </label>

              {saveError ? <p className="text-sm text-rose-300">{saveError}</p> : null}

              <button
                type="button"
                onClick={handleSave}
                className="w-full rounded-full bg-blue-600 py-3.5 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Save
              </button>
              <p className="pb-2 text-center text-[11px] text-slate-500">Data by AeroDataBox</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

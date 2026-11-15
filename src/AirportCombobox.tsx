import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { AIRPORTS, type AirportRecord } from './data/airports'

function filterAirports(query: string, limit = 30): AirportRecord[] {
  const t = query.trim().toLowerCase()
  if (!t) return []
  const exactIata = t.length === 3 && /^[a-z]{3}$/.test(t) ? t.toUpperCase() : null
  const out: AirportRecord[] = []
  if (exactIata) {
    const hit = AIRPORTS.find((a) => a.iata === exactIata)
    if (hit) out.push(hit)
  }
  for (const a of AIRPORTS) {
    if (out.length >= limit) break
    if (exactIata && a.iata === exactIata) continue
    if (
      a.iata.toLowerCase().includes(t) ||
      a.name.toLowerCase().includes(t) ||
      (a.city && a.city.toLowerCase().includes(t)) ||
      (a.country && a.country.toLowerCase().includes(t))
    ) {
      out.push(a)
    }
  }
  return out.slice(0, limit)
}

export function AirportCombobox({
  iata,
  labelText,
  onSelect,
  onClear,
  disabled,
  placeholder = 'Search airport name or code…',
}: {
  iata: string
  labelText: string
  onSelect: (a: AirportRecord) => void
  onClear: () => void
  disabled?: boolean
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => filterAirports(q), [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const showList = open && q.trim().length > 0 && filtered.length > 0

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="flex items-stretch gap-2">
        {iata ? (
          <span
            className="shrink-0 inline-flex items-center px-2.5 py-2 rounded-xl border border-sky-200 bg-sky-50 text-sm font-bold text-sky-800 tabular-nums dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
            title={labelText || iata}
          >
            {iata}
          </span>
        ) : null}
        <div className="flex-1 min-w-0 relative">
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            disabled={disabled}
            placeholder={iata ? 'Change airport…' : placeholder}
            className={`w-full rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-900 text-sm ${iata ? 'pl-3 pr-10 py-2' : 'px-3 py-2'}`}
            autoComplete="off"
          />
          {iata ? (
            <button
              type="button"
              onClick={() => {
                onClear()
                setQ('')
                setOpen(false)
              }}
              disabled={disabled}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Clear airport"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {labelText && iata ? (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 truncate" title={labelText}>
          {labelText}
        </p>
      ) : null}
      {showList ? (
        <ul
          className="absolute z-[80] mt-1 max-h-56 w-full overflow-auto rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-600 dark:bg-neutral-900 text-sm"
          role="listbox"
        >
          {filtered.map((a) => (
            <li key={a.iata}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800 last:border-0"
                onClick={() => {
                  onSelect(a)
                  setQ('')
                  setOpen(false)
                }}
              >
                <span className="font-semibold text-sky-700 dark:text-sky-300 tabular-nums">{a.iata}</span>
                <span className="text-neutral-700 dark:text-neutral-200"> · {a.name}</span>
                {(a.city || a.country) ? (
                  <span className="block text-xs text-neutral-500 mt-0.5">
                    {[a.city, a.country].filter(Boolean).join(', ')}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

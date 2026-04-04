import { DISPLAY_CURRENCIES } from './currency'

type CurrencySelectProps = {
  value: string
  onChange: (code: string) => void
  className?: string
  /** Matches hero overlay controls (white text on dark image). */
  variant?: 'default' | 'onDark'
}

export function CurrencySelect({ value, onChange, className = '', variant = 'default' }: CurrencySelectProps) {
  const variantClass =
    variant === 'onDark'
      ? 'border-white/40 bg-black/35 backdrop-blur-md text-white shadow-lg [&>option]:bg-neutral-900 [&>option]:text-white'
      : 'border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200'

  return (
    <select
      aria-label="Display currency"
      title="Display currency for amounts"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-sm rounded-xl border px-2 py-1.5 cursor-pointer max-w-[min(100%,7rem)] sm:max-w-[9rem] ${variantClass} ${className}`}
    >
      {DISPLAY_CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code}
        </option>
      ))}
    </select>
  )
}

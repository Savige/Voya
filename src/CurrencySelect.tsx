import { currencyFullName, DISPLAY_CURRENCIES } from './currency'

type CurrencySelectProps = {
  value: string
  onChange: (code: string) => void
  className?: string
  /** Matches hero overlay controls (white text on dark image). */
  variant?: 'default' | 'onDark'
  currencies?: { code: string; label: string }[]
  /** Show full currency names (Google/Brave-style converter). */
  showFullName?: boolean
  'aria-label'?: string
  title?: string
}

export function CurrencySelect({
  value,
  onChange,
  className = '',
  variant = 'default',
  currencies = DISPLAY_CURRENCIES,
  showFullName = false,
  'aria-label': ariaLabel = 'Currency',
  title = 'Currency',
}: CurrencySelectProps) {
  const options = currencies.some((c) => c.code === value)
    ? currencies
    : [{ code: value, label: value }, ...currencies]

  const variantClass =
    variant === 'onDark'
      ? 'border-white/40 bg-black/35 backdrop-blur-md text-white shadow-lg [&>option]:bg-neutral-900 [&>option]:text-white'
      : showFullName
        ? 'border-neutral-200 bg-neutral-50 text-neutral-800 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100'
        : 'border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200'

  return (
    <select
      aria-label={ariaLabel}
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`cursor-pointer border ${
        showFullName
          ? 'min-w-0 truncate rounded-lg px-2.5 py-2 text-sm font-medium'
          : 'rounded-xl px-2 py-2 text-sm font-semibold tabular-nums'
      } ${variantClass} ${className}`}
    >
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {showFullName ? currencyFullName(c.code) : c.code}
        </option>
      ))}
    </select>
  )
}

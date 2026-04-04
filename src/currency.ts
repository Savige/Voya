export const DISPLAY_CURRENCY_STORAGE_KEY = 'waypoint:display-currency:v1'
export const DEFAULT_DISPLAY_CURRENCY = 'USD'

/** Common ISO 4217 codes for the display-currency picker. */
export const DISPLAY_CURRENCIES: { code: string; label: string }[] = [
  { code: 'USD', label: 'USD — US dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British pound' },
  { code: 'CAD', label: 'CAD — Canadian dollar' },
  { code: 'AUD', label: 'AUD — Australian dollar' },
  { code: 'JPY', label: 'JPY — Japanese yen' },
  { code: 'CHF', label: 'CHF — Swiss franc' },
  { code: 'NZD', label: 'NZD — New Zealand dollar' },
  { code: 'INR', label: 'INR — Indian rupee' },
  { code: 'MXN', label: 'MXN — Mexican peso' },
  { code: 'SGD', label: 'SGD — Singapore dollar' },
  { code: 'SEK', label: 'SEK — Swedish krona' },
]

export function loadDisplayCurrency(): string {
  try {
    const raw = localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)?.trim().toUpperCase()
    if (raw && DISPLAY_CURRENCIES.some((c) => c.code === raw)) return raw
  } catch {
    /* ignore */
  }
  return DEFAULT_DISPLAY_CURRENCY
}

export function saveDisplayCurrency(code: string): void {
  try {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, code)
  } catch {
    /* ignore */
  }
}

export function formatMoneyAmount(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: DEFAULT_DISPLAY_CURRENCY,
      maximumFractionDigits: 2,
    }).format(value)
  }
}

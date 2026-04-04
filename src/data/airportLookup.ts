import { AIRPORTS, type AirportRecord } from './airports'

const byIata = new Map<string, AirportRecord>()
for (const a of AIRPORTS) {
  byIata.set(a.iata, a)
}

export function getAirportByIata(iata: string): AirportRecord | undefined {
  const u = iata.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(u)) return undefined
  return byIata.get(u)
}

export function formatAirportOptionLabel(a: AirportRecord): string {
  const loc = [a.city, a.country].filter(Boolean).join(', ')
  return loc ? `${a.name} (${loc})` : a.name
}

export type AirlineRecord = {
  iata: string
  icao?: string
  name: string
  country?: string
}

/** Curated IATA airlines for local autocomplete (no API cost). */
export const AIRLINES: AirlineRecord[] = [
  { iata: 'NZ', icao: 'ANZ', name: 'Air New Zealand', country: 'New Zealand' },
  { iata: 'QF', icao: 'QFA', name: 'Qantas', country: 'Australia' },
  { iata: 'JQ', icao: 'JST', name: 'Jetstar', country: 'Australia' },
  { iata: 'VA', icao: 'VOZ', name: 'Virgin Australia', country: 'Australia' },
  { iata: 'TT', icao: 'TGG', name: 'Tigerair Australia', country: 'Australia' },
  { iata: 'EK', icao: 'UAE', name: 'Emirates', country: 'United Arab Emirates' },
  { iata: 'QR', icao: 'QTR', name: 'Qatar Airways', country: 'Qatar' },
  { iata: 'EY', icao: 'ETD', name: 'Etihad Airways', country: 'United Arab Emirates' },
  { iata: 'SQ', icao: 'SIA', name: 'Singapore Airlines', country: 'Singapore' },
  { iata: 'TR', icao: 'TGW', name: 'Scoot', country: 'Singapore' },
  { iata: 'CX', icao: 'CPA', name: 'Cathay Pacific', country: 'Hong Kong' },
  { iata: 'NH', icao: 'ANA', name: 'All Nippon Airways', country: 'Japan' },
  { iata: 'JL', icao: 'JAL', name: 'Japan Airlines', country: 'Japan' },
  { iata: 'KE', icao: 'KAL', name: 'Korean Air', country: 'South Korea' },
  { iata: 'OZ', icao: 'AAR', name: 'Asiana Airlines', country: 'South Korea' },
  { iata: 'CA', icao: 'CCA', name: 'Air China', country: 'China' },
  { iata: 'MU', icao: 'CES', name: 'China Eastern', country: 'China' },
  { iata: 'CZ', icao: 'CSN', name: 'China Southern', country: 'China' },
  { iata: 'TG', icao: 'THA', name: 'Thai Airways', country: 'Thailand' },
  { iata: 'MH', icao: 'MAS', name: 'Malaysia Airlines', country: 'Malaysia' },
  { iata: 'GA', icao: 'GIA', name: 'Garuda Indonesia', country: 'Indonesia' },
  { iata: 'PR', icao: 'PAL', name: 'Philippine Airlines', country: 'Philippines' },
  { iata: 'VN', icao: 'HVN', name: 'Vietnam Airlines', country: 'Vietnam' },
  { iata: 'AI', icao: 'AIC', name: 'Air India', country: 'India' },
  { iata: 'UK', icao: 'VTI', name: 'Vistara', country: 'India' },
  { iata: '6E', icao: 'IGO', name: 'IndiGo', country: 'India' },
  { iata: 'BA', icao: 'BAW', name: 'British Airways', country: 'United Kingdom' },
  { iata: 'VS', icao: 'VIR', name: 'Virgin Atlantic', country: 'United Kingdom' },
  { iata: 'U2', icao: 'EZY', name: 'easyJet', country: 'United Kingdom' },
  { iata: 'FR', icao: 'RYR', name: 'Ryanair', country: 'Ireland' },
  { iata: 'EI', icao: 'EIN', name: 'Aer Lingus', country: 'Ireland' },
  { iata: 'AF', icao: 'AFR', name: 'Air France', country: 'France' },
  { iata: 'KL', icao: 'KLM', name: 'KLM', country: 'Netherlands' },
  { iata: 'LH', icao: 'DLH', name: 'Lufthansa', country: 'Germany' },
  { iata: 'LX', icao: 'SWR', name: 'Swiss', country: 'Switzerland' },
  { iata: 'OS', icao: 'AUA', name: 'Austrian Airlines', country: 'Austria' },
  { iata: 'SN', icao: 'BEL', name: 'Brussels Airlines', country: 'Belgium' },
  { iata: 'AZ', icao: 'ITY', name: 'ITA Airways', country: 'Italy' },
  { iata: 'IB', icao: 'IBE', name: 'Iberia', country: 'Spain' },
  { iata: 'VY', icao: 'VLG', name: 'Vueling', country: 'Spain' },
  { iata: 'TP', icao: 'TAP', name: 'TAP Air Portugal', country: 'Portugal' },
  { iata: 'SK', icao: 'SAS', name: 'SAS', country: 'Sweden' },
  { iata: 'AY', icao: 'FIN', name: 'Finnair', country: 'Finland' },
  { iata: 'DY', icao: 'NAX', name: 'Norwegian', country: 'Norway' },
  { iata: 'TK', icao: 'THY', name: 'Turkish Airlines', country: 'Turkey' },
  { iata: 'LO', icao: 'LOT', name: 'LOT Polish Airlines', country: 'Poland' },
  { iata: 'SU', icao: 'AFL', name: 'Aeroflot', country: 'Russia' },
  { iata: 'UA', icao: 'UAL', name: 'United Airlines', country: 'United States' },
  { iata: 'AA', icao: 'AAL', name: 'American Airlines', country: 'United States' },
  { iata: 'DL', icao: 'DAL', name: 'Delta Air Lines', country: 'United States' },
  { iata: 'AS', icao: 'ASA', name: 'Alaska Airlines', country: 'United States' },
  { iata: 'B6', icao: 'JBU', name: 'JetBlue', country: 'United States' },
  { iata: 'WN', icao: 'SWA', name: 'Southwest Airlines', country: 'United States' },
  { iata: 'F9', icao: 'FFT', name: 'Frontier Airlines', country: 'United States' },
  { iata: 'NK', icao: 'NKS', name: 'Spirit Airlines', country: 'United States' },
  { iata: 'HA', icao: 'HAL', name: 'Hawaiian Airlines', country: 'United States' },
  { iata: 'AC', icao: 'ACA', name: 'Air Canada', country: 'Canada' },
  { iata: 'WS', icao: 'WJA', name: 'WestJet', country: 'Canada' },
  { iata: 'LA', icao: 'LAN', name: 'LATAM Airlines', country: 'Chile' },
  { iata: 'AV', icao: 'AVA', name: 'Avianca', country: 'Colombia' },
  { iata: 'CM', icao: 'CMP', name: 'Copa Airlines', country: 'Panama' },
  { iata: 'AM', icao: 'AMX', name: 'Aeroméxico', country: 'Mexico' },
  { iata: 'AR', icao: 'ARG', name: 'Aerolíneas Argentinas', country: 'Argentina' },
  { iata: 'G3', icao: 'GLO', name: 'Gol', country: 'Brazil' },
  { iata: 'AD', icao: 'AZU', name: 'Azul', country: 'Brazil' },
  { iata: 'SA', icao: 'SAA', name: 'South African Airways', country: 'South Africa' },
  { iata: 'ET', icao: 'ETH', name: 'Ethiopian Airlines', country: 'Ethiopia' },
  { iata: 'MS', icao: 'MSR', name: 'Egyptair', country: 'Egypt' },
  { iata: 'AT', icao: 'RAM', name: 'Royal Air Maroc', country: 'Morocco' },
  { iata: 'KQ', icao: 'KQA', name: 'Kenya Airways', country: 'Kenya' },
  { iata: 'FJ', icao: 'FJI', name: 'Fiji Airways', country: 'Fiji' },
  { iata: 'PF', icao: 'PBN', name: 'Air Vanuatu', country: 'Vanuatu' },
  { iata: 'SB', icao: 'ACI', name: 'Aircalin', country: 'New Caledonia' },
  { iata: 'PX', icao: 'ANG', name: 'Air Niugini', country: 'Papua New Guinea' },
  { iata: 'IE', icao: 'SOL', name: 'Solomon Airlines', country: 'Solomon Islands' },
  { iata: 'WY', icao: 'OMA', name: 'Oman Air', country: 'Oman' },
  { iata: 'GF', icao: 'GFA', name: 'Gulf Air', country: 'Bahrain' },
  { iata: 'SV', icao: 'SVA', name: 'Saudia', country: 'Saudi Arabia' },
  { iata: 'RJ', icao: 'RJA', name: 'Royal Jordanian', country: 'Jordan' },
  { iata: 'LY', icao: 'ELY', name: 'El Al', country: 'Israel' },
  { iata: 'UL', icao: 'ALK', name: 'SriLankan Airlines', country: 'Sri Lanka' },
  { iata: 'BG', icao: 'BBC', name: 'Biman Bangladesh', country: 'Bangladesh' },
  { iata: 'PK', icao: 'PIA', name: 'Pakistan International', country: 'Pakistan' },
  { iata: 'HY', icao: 'UZB', name: 'Uzbekistan Airways', country: 'Uzbekistan' },
  { iata: 'FZ', icao: 'FDB', name: 'flydubai', country: 'United Arab Emirates' },
  { iata: 'XY', icao: 'KNE', name: 'flynas', country: 'Saudi Arabia' },
  { iata: 'W6', icao: 'WZZ', name: 'Wizz Air', country: 'Hungary' },
  { iata: 'PC', icao: 'PGT', name: 'Pegasus Airlines', country: 'Turkey' },
  { iata: 'A3', icao: 'AEE', name: 'Aegean Airlines', country: 'Greece' },
  { iata: 'OA', icao: 'OAL', name: 'Olympic Air', country: 'Greece' },
  { iata: 'BT', icao: 'BTI', name: 'Air Baltic', country: 'Latvia' },
  { iata: 'FI', icao: 'ICE', name: 'Icelandair', country: 'Iceland' },
  { iata: 'WW', icao: 'WOW', name: 'WOW air', country: 'Iceland' },
  { iata: 'HV', icao: 'TRA', name: 'Transavia', country: 'Netherlands' },
  { iata: 'TO', icao: 'TVF', name: 'Transavia France', country: 'France' },
  { iata: 'LS', icao: 'EXS', name: 'Jet2.com', country: 'United Kingdom' },
  { iata: 'BY', icao: 'TOM', name: 'TUI Airways', country: 'United Kingdom' },
  { iata: 'DE', icao: 'CFG', name: 'Condor', country: 'Germany' },
  { iata: 'EW', icao: 'EWG', name: 'Eurowings', country: 'Germany' },
  { iata: 'X3', icao: 'TUI', name: 'TUI fly', country: 'Germany' },
  { iata: 'WK', icao: 'EDW', name: 'Edelweiss Air', country: 'Switzerland' },
  { iata: 'EN', icao: 'DLA', name: 'Air Dolomiti', country: 'Italy' },
  { iata: 'NT', icao: 'IBB', name: 'Binter Canarias', country: 'Spain' },
  { iata: 'UX', icao: 'AEA', name: 'Air Europa', country: 'Spain' },
  { iata: 'S4', icao: 'RZO', name: 'SATA Azores Airlines', country: 'Portugal' },
  { iata: 'H2', icao: 'SKU', name: 'Sky Airline', country: 'Chile' },
  { iata: 'Y4', icao: 'VOI', name: 'Volaris', country: 'Mexico' },
  { iata: 'VB', icao: 'VIV', name: 'VivaAerobus', country: 'Mexico' },
  { iata: 'F8', icao: 'FLE', name: 'Flair Airlines', country: 'Canada' },
  { iata: 'PD', icao: 'POE', name: 'Porter Airlines', country: 'Canada' },
  { iata: 'SY', icao: 'SCX', name: 'Sun Country Airlines', country: 'United States' },
  { iata: 'XP', icao: 'CXP', name: 'Avelo Airlines', country: 'United States' },
  { iata: 'MX', icao: 'MXA', name: 'Breeze Airways', country: 'United States' },
  { iata: 'JJ', icao: 'TAM', name: 'LATAM Brasil', country: 'Brazil' },
  { iata: 'H1', icao: 'HAH', name: 'Hahn Air Systems', country: 'Germany' },
]

export function searchAirlines(query: string, limit = 8): AirlineRecord[] {
  const q = query.trim().toLowerCase()
  if (q.length < 1) return []
  const scored: { a: AirlineRecord; score: number }[] = []
  for (const a of AIRLINES) {
    const name = a.name.toLowerCase()
    const iata = a.iata.toLowerCase()
    const icao = (a.icao || '').toLowerCase()
    let score = 0
    if (iata === q || icao === q) score = 100
    else if (iata.startsWith(q) || icao.startsWith(q)) score = 90
    else if (name.startsWith(q)) score = 80
    else if (name.includes(q)) score = 60
    else if (`${iata} ${name}`.includes(q)) score = 50
    if (score > 0) scored.push({ a, score })
  }
  scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name))
  return scored.slice(0, limit).map((x) => x.a)
}

export function getAirlineByIata(iata: string): AirlineRecord | undefined {
  const u = iata.trim().toUpperCase()
  return AIRLINES.find((a) => a.iata === u)
}

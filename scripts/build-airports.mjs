import fs from 'fs'
import readline from 'readline'

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQ = !inQ
      continue
    }
    if (!inQ && c === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

const rl = readline.createInterface({
  input: fs.createReadStream('airports_raw.csv', { encoding: 'utf8' }),
  crlfDelay: Infinity,
})

let header = true
const rows = []
for await (const line of rl) {
  if (header) {
    header = false
    continue
  }
  const cols = parseCsvLine(line)
  const type = cols[2] || ''
  if (type !== 'large_airport' && type !== 'medium_airport') continue
  const iata = (cols[13] || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(iata)) continue
  const name = (cols[3] || '').trim()
  const city = (cols[10] || '').trim()
  const country = (cols[8] || '').trim()
  const lat = Number(cols[4])
  const lon = Number(cols[5])
  const row = { iata, name, city, country }
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    row.lat = lat
    row.lon = lon
  }
  rows.push(row)
}

rows.sort((a, b) => a.iata.localeCompare(b.iata))

const body = `export type AirportRecord = { iata: string; name: string; city: string; country: string; lat?: number; lon?: number }

/** Filtered from OurAirports (large + medium, valid IATA). Do not edit by hand — regenerate with \`node scripts/build-airports.mjs\`. */
export const AIRPORTS: AirportRecord[] = ${JSON.stringify(rows)}
`

fs.mkdirSync('src/data', { recursive: true })
fs.writeFileSync('src/data/airports.ts', body, 'utf8')
console.log('Wrote', rows.length, 'airports to src/data/airports.ts')

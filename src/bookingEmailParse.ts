import type { BookingImportKind, ParsedBookingFields } from './bookingEmailTypes'

function norm(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re)
  return m?.[1]?.trim() || undefined
}

function allMatches(text: string, re: RegExp): string[] {
  const out: string[] = []
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let m: RegExpExecArray | null
  while ((m = r.exec(text))) {
    if (m[1]) out.push(m[1].trim())
  }
  return out
}

/** Best-effort ISO-ish date: YYYY-MM-DD when possible. */
export function normalizeBookingDate(raw?: string): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const ymd = s.match(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})/)
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
  const dmy = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const months: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  }
  const named = s.match(
    /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b/,
  )
  if (named) {
    if (named[1] && named[2] && named[3]) {
      const mo = months[named[1].toLowerCase()]
      if (mo) return `${named[3]}-${mo}-${named[2].padStart(2, '0')}`
    }
    if (named[4] && named[5] && named[6]) {
      const mo = months[named[5].toLowerCase()]
      if (mo) return `${named[6]}-${mo}-${named[4].padStart(2, '0')}`
    }
  }
  return undefined
}

function normalizeTime(raw?: string): string | undefined {
  if (!raw) return undefined
  const m = raw.trim().match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
  if (!m) return undefined
  let h = Number(m[1])
  const min = m[2]
  const ap = (m[3] || '').toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${min}`
}

function extractConfirmation(text: string): string | undefined {
  return (
    firstMatch(text, /(?:confirmation(?:\s*(?:number|#|no\.?|code))?|booking\s*(?:ref(?:erence)?|id)|record\s*locator|PNR)\s*[:#]?\s*([A-Z0-9-]{5,20})/i) ||
    firstMatch(text, /\b(?:conf(?:irmation)?|ref(?:erence)?)\s*[:#]\s*([A-Z0-9-]{5,20})\b/i)
  )
}

function extractPrice(text: string): string | undefined {
  return (
    firstMatch(text, /(?:total|amount|paid|price|fare)\s*[:.]?\s*((?:USD|AUD|NZD|EUR|GBP|\$|A\$|NZ\$)\s?[\d,.]+)/i) ||
    firstMatch(text, /((?:USD|AUD|NZD|EUR|GBP)\s?[\d,.]+)/i) ||
    firstMatch(text, /(\$\s?[\d,]+\.\d{2})/)
  )
}

function scoreKind(text: string, subject: string): { kind: BookingImportKind; score: number } {
  const blob = `${subject}\n${text}`.toLowerCase()
  const scores: Record<BookingImportKind, number> = {
    flight: 0,
    rentalCar: 0,
    accommodation: 0,
    restaurant: 0,
    unknown: 0,
  }

  if (/\b(flight|boarding\s*pass|e-?ticket|airline|departure|arrival|gate\s*[A-Z0-9])\b/.test(blob)) scores.flight += 3
  if (/\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/.test(`${subject}\n${text}`)) scores.flight += 4
  if (/\b(qantas|jetstar|air\s*nz|united|delta|american\s*airlines|emirates|qatar|lufthansa|singapore\s*airlines|virgin\s*australia)\b/.test(blob))
    scores.flight += 3

  if (/\b(rental\s*car|car\s*hire|vehicle\s*rental|pick-?up|drop-?off)\b/.test(blob)) scores.rentalCar += 3
  if (/\b(hertz|avis|enterprise|budget|sixt|europcar|thrifty|dollar\s*rent)\b/.test(blob)) scores.rentalCar += 4

  if (/\b(hotel|motel|airbnb|booking\.com|check-?\s*in|check-?\s*out|accommodation|lodging|hostel)\b/.test(blob))
    scores.accommodation += 3
  if (/\b(marriott|hilton|hyatt|ihg|accor|expedia)\b/.test(blob)) scores.accommodation += 2

  if (/\b(restaurant|dinner|lunch|reservation|opentable|table\s*for)\b/.test(blob)) scores.restaurant += 3
  if (/\b(opentable|resy|thefork)\b/.test(blob)) scores.restaurant += 3

  let best: BookingImportKind = 'unknown'
  let bestScore = 0
  for (const k of Object.keys(scores) as BookingImportKind[]) {
    if (k === 'unknown') continue
    if (scores[k] > bestScore) {
      best = k
      bestScore = scores[k]
    }
  }
  if (bestScore < 2) return { kind: 'unknown', score: bestScore }
  return { kind: best, score: bestScore }
}

function parseFlight(text: string, subject: string): Partial<ParsedBookingFields> {
  const route =
    firstMatch(`${subject}\n${text}`, /\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/) != null
      ? null
      : null
  const routeMatch = `${subject}\n${text}`.match(/\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/)
  const airline =
    firstMatch(text, /(?:airline|operated by|carrier)\s*[:.]?\s*([A-Za-z0-9 &.-]{2,40})/i) ||
    firstMatch(
      `${subject}\n${text}`,
      /\b(Qantas|Jetstar|Air New Zealand|United|Delta|American Airlines|Emirates|Qatar Airways|Lufthansa|Singapore Airlines|Virgin Australia)\b/i,
    )
  const departDate =
    normalizeBookingDate(
      firstMatch(text, /(?:depart(?:ure)?|outbound)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i),
    ) || normalizeBookingDate(firstMatch(text, /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/))
  const arriveDate = normalizeBookingDate(
    firstMatch(text, /(?:arriv(?:al|e)|inbound)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i),
  )
  return {
    airline: airline?.trim(),
    fromIata: routeMatch?.[1],
    toIata: routeMatch?.[2],
    departDate,
    departTime: normalizeTime(firstMatch(text, /(?:depart(?:ure)?)\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)),
    arriveDate,
    arriveTime: normalizeTime(firstMatch(text, /(?:arriv(?:al|e))\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)),
    notes: route ? undefined : undefined,
  }
}

function parseCar(text: string): Partial<ParsedBookingFields> {
  const company =
    firstMatch(text, /(?:rental\s*(?:company|provider)|supplier|vendor)\s*[:.]?\s*([A-Za-z0-9 &.-]{2,40})/i) ||
    firstMatch(text, /\b(Hertz|Avis|Enterprise|Budget|Sixt|Europcar|Thrifty|Dollar)\b/i)
  return {
    company: company?.trim(),
    pickupLocation: firstMatch(text, /(?:pick-?\s*up(?:\s*location)?)\s*[:.]?\s*(.+)$/im)?.slice(0, 120),
    dropoffLocation: firstMatch(text, /(?:drop-?\s*off(?:\s*location)?)\s*[:.]?\s*(.+)$/im)?.slice(0, 120),
    pickupDate: normalizeBookingDate(firstMatch(text, /(?:pick-?\s*up(?:\s*date)?)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i)),
    pickupTime: normalizeTime(firstMatch(text, /(?:pick-?\s*up(?:\s*time)?)\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)),
    dropoffDate: normalizeBookingDate(firstMatch(text, /(?:drop-?\s*off(?:\s*date)?)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i)),
    dropoffTime: normalizeTime(firstMatch(text, /(?:drop-?\s*off(?:\s*time)?)\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)),
  }
}

function parseStay(text: string, subject: string): Partial<ParsedBookingFields> {
  const name =
    firstMatch(text, /(?:property|hotel|listing|accommodation)\s*(?:name)?\s*[:.]?\s*(.+)$/im)?.slice(0, 120) ||
    firstMatch(subject, /(?:confirmation|booking|reservation)\s*(?:at|for|:)\s*(.+)$/i)?.slice(0, 120)
  return {
    name: name?.trim(),
    location: firstMatch(text, /(?:address|location)\s*[:.]?\s*(.+)$/im)?.slice(0, 160),
    checkIn: normalizeBookingDate(firstMatch(text, /(?:check-?\s*in)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i)),
    checkOut: normalizeBookingDate(firstMatch(text, /(?:check-?\s*out)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i)),
    checkInTime: normalizeTime(firstMatch(text, /(?:check-?\s*in)\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)),
    checkOutTime: normalizeTime(firstMatch(text, /(?:check-?\s*out)\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)),
  }
}

function parseRestaurant(text: string, subject: string): Partial<ParsedBookingFields> {
  const name =
    firstMatch(text, /(?:restaurant|venue|dining)\s*[:.]?\s*(.+)$/im)?.slice(0, 120) ||
    firstMatch(subject, /(?:reservation|table)\s*(?:at|for|:)\s*(.+)$/i)?.slice(0, 120)
  return {
    name: name?.trim(),
    reservationDate: normalizeBookingDate(
      firstMatch(text, /(?:date|reservation)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i),
    ),
    reservationTime: normalizeTime(firstMatch(text, /(?:time)\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)),
    location: firstMatch(text, /(?:address|location)\s*[:.]?\s*(.+)$/im)?.slice(0, 160),
  }
}

/**
 * Heuristic parser for booking confirmation emails / pasted text.
 * Confidence is 0–1; low-confidence results are still returned as `unknown` or weak kinds.
 */
export function parseBookingEmail(input: {
  subject?: string
  text?: string
  html?: string
}): ParsedBookingFields {
  const subject = norm(input.subject || '')
  let text = norm(input.text || '')
  if (!text && input.html) {
    text = norm(
      String(input.html)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&'),
    )
  }
  const blob = `${subject}\n${text}`
  const { kind, score } = scoreKind(text, subject)
  const confirmation = extractConfirmation(blob)
  const price = extractPrice(blob)

  let fields: Partial<ParsedBookingFields> = {}
  if (kind === 'flight') fields = parseFlight(text, subject)
  else if (kind === 'rentalCar') fields = parseCar(text)
  else if (kind === 'accommodation') fields = parseStay(text, subject)
  else if (kind === 'restaurant') fields = parseRestaurant(text, subject)
  else {
    // Try a light pass for anything useful
    fields = {
      ...parseFlight(text, subject),
      ...parseCar(text),
      ...parseStay(text, subject),
    }
  }

  const confidence = Math.min(1, (score + (confirmation ? 2 : 0) + (price ? 0.5 : 0)) / 8)

  return {
    confidence,
    confirmation,
    price,
    notes: subject || undefined,
    ...fields,
    kind, // scored kind wins over any field merge
  }
}

export function suggestTripIdForParsed(
  parsed: ParsedBookingFields,
  trips: Array<{ id: string; startDate?: string; endDate?: string; cancelled?: boolean }>,
): string | undefined {
  const date =
    parsed.departDate || parsed.pickupDate || parsed.checkIn || parsed.reservationDate || undefined
  if (!date) return undefined
  for (const t of trips) {
    if (t.cancelled) continue
    if (!t.startDate || !t.endDate) continue
    if (date >= t.startDate && date <= t.endDate) return t.id
  }
  return undefined
}

/** Strip HTML to plain text for paste fallback. */
export function htmlToPlainText(html: string): string {
  return norm(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&'),
  )
}

// silence unused in some tree-shakes
void allMatches

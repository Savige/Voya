/**
 * Cloudflare Email Worker → Waypoint PocketBase inbound webhook.
 *
 * Secrets:
 *   WAYPOINT_EMAIL_WEBHOOK_URL
 *   WAYPOINT_EMAIL_WEBHOOK_SECRET
 */

function decodeQuotedPrintable(input) {
  return String(input || '')
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function decodeBase64Utf8(input) {
  const compact = String(input || '').replace(/\s+/g, '')
  if (!compact) return ''
  const bin = atob(compact)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function looksLikeBase64(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  if (compact.length < 64 || compact.length % 4 !== 0) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false
  return true
}

function decodeTransferBody(partHeaders, body) {
  const cte = (String(partHeaders || '').match(/Content-Transfer-Encoding:\s*([^\s;]+)/i) || [])[1] || ''
  let text = String(body || '').replace(/\r\n/g, '\n')
  try {
    if (/base64/i.test(cte) || (!cte && looksLikeBase64(text))) {
      text = decodeBase64Utf8(text)
    } else if (/quoted-printable/i.test(cte)) {
      text = decodeQuotedPrintable(text)
    }
  } catch (_) {
    /* keep original */
  }
  return text.trim()
}

function extractMimePart(rawText, contentType) {
  const re = new RegExp(
    `(Content-Type:\\s*${contentType}[^\\r\\n]*(?:\\r?\\n[^\\r\\n]+)*)\\r?\\n\\r?\\n([\\s\\S]*?)(?=\\r?\\n--[\\w"'+=_-]+|\\r?\\nContent-Type:|$)`,
    'i',
  )
  const m = String(rawText || '').match(re)
  if (!m) return ''
  return decodeTransferBody(m[1], m[2])
}

/** All decoded MIME parts of a content-type (nested forwards often bury the vendor HTML). */
function extractAllMimeParts(rawText, contentType) {
  const re = new RegExp(
    `(Content-Type:\\s*${contentType}[^\\r\\n]*(?:\\r?\\n[^\\r\\n]+)*)\\r?\\n\\r?\\n([\\s\\S]*?)(?=\\r?\\n--[\\w"'+=_-]+|\\r?\\nContent-Type:|$)`,
    'gi',
  )
  const out = []
  let m
  const raw = String(rawText || '')
  while ((m = re.exec(raw))) {
    const decoded = decodeTransferBody(m[1], m[2])
    if (decoded) out.push(decoded)
  }
  return out
}

function isBadPhotoUrl(src) {
  const s = String(src || '').toLowerCase()
  if (!s || !/^https?:\/\//i.test(s)) return true
  if (/pixel|spacer|tracking|1x1|open\.|beacon|logo|icon|avatar|badge|sprite|favicon|checkmark|tick[_-]?mark|success[_-]?img/i.test(s)) return true
  // Booking.com email chrome / FB share tiles / flags — not the property photo.
  if (/\/static\/img\//i.test(s) || /\/fb\//i.test(s) || /bstatic\.com\/static\//i.test(s)) return true
  if (/design-assets|images-flags|flag@|ava-[a-z]\.png/i.test(s)) return true
  // OTA chrome (Super.com / SnapTravel check glyphs).
  if (/cdn\.snaptravel\.com\/(?:checkmark|badge|icon)/i.test(s)) return true
  // Airbnb chrome / truncated hosting stubs (Proton often breaks muscache URLs).
  if (/airbnbplatformassets/i.test(s)) return true
  if (/muscache\.com\/ac\//i.test(s)) return true
  if (/muscache\.com/i.test(s) && !/\/im\/pictures\//i.test(s)) return true
  if (/muscache\.com.*hosting-[a-z0-9+/=_-]+\/?$/i.test(s) && !/\/original\//i.test(s)) return true
  if (/muscache\.com/i.test(s) && /=\s*$/.test(String(src || '').trim()) && !/\.(jpe?g|png|webp)(\?|$)/i.test(s)) {
    return true
  }
  return false
}

function scorePhotoUrl(src) {
  const s = String(src || '').toLowerCase()
  if (!s || isBadPhotoUrl(s) || /^cid:/i.test(s)) return -99
  let score = 0
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(s)) score += 3
  if (/\/xdata\/|\/images\/|hotelimages|max\d+|cloudinary|akamai/i.test(s)) score += 5
  if (/muscache\.com\/im\/pictures\//i.test(s)) score += 6
  if (/\/original\//i.test(s)) score += 2
  if (/hero|property|listing|hotel|room|photo/i.test(s)) score += 3
  if (/bstatic\.com\/(?:xdata|images)\//i.test(s)) score += 4
  if (/max1024|max1280|max2048|im_w=720|im_w=1200|im_w=1440/i.test(s)) score += 2
  if (src.length > 40) score += 1
  return score
}

/** Prefer likely property/hero photos from HTML (vendor-agnostic). */
function extractPhotoUrl(html) {
  if (!html) return ''
  const srcs = []
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let m
  while ((m = re.exec(html))) {
    const src = m[1]
    if (!src || scorePhotoUrl(src) < 0) continue
    srcs.push(src)
  }
  // Markdown / bare CDN links (Proton text forwards).
  const md = html.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)
  for (const row of md) if (scorePhotoUrl(row[1]) >= 0) srcs.push(row[1])
  const bare = html.matchAll(
    /(https?:\/\/[^\s\]"'<>]+(?:bstatic\.com\/xdata|muscache\.com|cloudinary\.com)[^\s\]"'<>]*)/gi,
  )
  for (const row of bare) if (scorePhotoUrl(row[1]) >= 0) srcs.push(row[1].replace(/[),>.]+$/, ''))
  if (srcs.length === 0) return ''
  const scored = srcs.map((src) => ({ src, score: scorePhotoUrl(src) }))
  scored.sort((a, b) => b.score - a.score)
  return scored[0].score > 0 ? scored[0].src : ''
}

/** Prefer bare listing pages (query noise / WAF tokens break og fetch). */
function cleanListingUrlForPhoto(u) {
  const url = String(u || '').replace(/&amp;/g, '&').trim()
  if (!url) return ''
  const booking = url.match(/^(https?:\/\/(?:www\.)?booking\.com\/hotel\/[^?#]+)/i)
  if (booking) return booking[1]
  const airbnb = url.match(/^(https?:\/\/(?:www\.)?airbnb\.[^/]+\/rooms\/\d+)/i)
  if (airbnb) return airbnb[1]
  return url.split('#')[0]
}

/** Listing/property page URLs from plain text (Proton often strips real <img src>). */
function extractListingUrls(text, html) {
  const blob = `${text || ''}\n${html || ''}`
  const urls = []
  const re = /\(?(https?:\/\/[^\s)\]"'<>]+)\)?/gi
  let m
  while ((m = re.exec(blob))) {
    let u = m[1]
    if (!u) continue
    u = u.replace(/&amp;/g, '&').replace(/[>,.]+$/, '')
    const s = u.toLowerCase()
    // Skip pay/help/social noise; keep listing/property pages.
    if (/\/(pay|help|inbox|interstitial|login|signup)\b/.test(s)) continue
    if (/instagram|tiktok|youtube|twitter|facebook/.test(s)) continue
    if (/secure\.booking\.com\/(?:confirmation|apps|myreservations)/i.test(s)) continue
    let score = 0
    if (/hero_image|hero-image|property.?image|listing.?image/i.test(s)) score += 8
    if (/\/rooms\/\d+|\/hotel\/|\/hotels\/|\/listings?\/|\/property\//i.test(s)) score += 6
    if (/airbnb\.|booking\.|vrbo\.|agoda\.|expedia\.|hotels\./i.test(s)) score += 2
    if (score > 0) urls.push({ url: cleanListingUrlForPhoto(u) || u, score })
  }
  urls.sort((a, b) => b.score - a.score)
  const seen = new Set()
  const out = []
  for (const row of urls) {
    const key = row.url.split('?')[0]
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row.url)
  }
  return out.slice(0, 3)
}

function pickBestPhotoFromBlob(blob) {
  if (!blob) return ''
  const fromHtml = extractPhotoUrl(blob)
  if (fromHtml) return fromHtml
  const candidates = []
  const re =
    /(https?:\/\/[^\s\]"'<>]+(?:bstatic\.com\/xdata\/images\/hotel|muscache\.com\/im\/pictures)[^\s\]"'<>]*)/gi
  let m
  while ((m = re.exec(blob))) {
    const src = m[1].replace(/&amp;/g, '&').replace(/[),>.]+$/, '')
    const score = scorePhotoUrl(src)
    if (score > 0) candidates.push({ src, score })
  }
  if (!candidates.length) return ''
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].src
}

async function resolveOgImage(pageUrl) {
  const clean = cleanListingUrlForPhoto(pageUrl) || String(pageUrl || '').replace(/&amp;/g, '&')
  if (!/^https?:\/\//i.test(clean)) return ''

  const tryParse = (html) => {
    if (!html) return ''
    const og =
      html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
      html.match(/property=["']og:image:url["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/twitter:image[^>]*content=["']([^"']+)["']/i)
    const src = og && og[1] ? og[1].trim().replace(/&amp;/g, '&') : ''
    if (src && !isBadPhotoUrl(src)) return src
    return pickBestPhotoFromBlob(html)
  }

  const browserHeaders = {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'en-GB,en;q=0.9',
  }

  // Try the cleaned URL, then a .com Airbnb mirror when a country TLD is blocked/thin.
  const candidates = [clean]
  const airbnbMirror = clean.match(/^(https?:\/\/(?:www\.)?)airbnb\.[^/]+(\/rooms\/\d+)/i)
  if (airbnbMirror) {
    const mirror = `${airbnbMirror[1]}airbnb.com${airbnbMirror[2]}`
    if (mirror !== clean) candidates.push(mirror)
  }

  for (const url of candidates) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: browserHeaders })
      if (res.ok) {
        const html = await res.text()
        // Booking.com WAF challenge pages are tiny (~4KB) with no property media.
        if (html.length > 8000) {
          const found = tryParse(html)
          if (found) return found
        }
      }
    } catch (_) {
      /* try next */
    }
  }

  // Reader proxy bypasses many OTA bot walls and returns markdown with CDN image URLs.
  for (const url of candidates) {
    try {
      const proxy = `https://r.jina.ai/${url}`
      const res = await fetch(proxy, {
        redirect: 'follow',
        headers: { accept: 'text/plain', 'user-agent': 'WaypointEmailBot/1.0' },
      })
      if (!res.ok) continue
      const text = await res.text()
      const found = tryParse(text)
      if (found) return found
    } catch (_) {
      /* try next */
    }
  }
  return ''
}

export default {
  async email(message, env) {
    const url = env.WAYPOINT_EMAIL_WEBHOOK_URL
    const secret = env.WAYPOINT_EMAIL_WEBHOOK_SECRET
    if (!url || !secret) {
      message.setReject('Waypoint email webhook is not configured')
      return
    }

    const raw = await new Response(message.raw).arrayBuffer()
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(raw)

    const htmlParts = extractAllMimeParts(rawText, 'text\\/html')
    const textParts = extractAllMimeParts(rawText, 'text\\/plain')
    let text = textParts[0] || extractMimePart(rawText, 'text\\/plain')
    const htmlRaw = htmlParts.join('\n') || extractMimePart(rawText, 'text\\/html')
    if (!text && htmlRaw) {
      text = htmlRaw
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
    if (!text) {
      text = rawText.slice(0, 50000)
      if (looksLikeBase64(text)) {
        try {
          text = decodeBase64Utf8(text)
        } catch (_) {
          /* keep */
        }
      }
    }

    // Prefer CDN URLs embedded in any MIME part / raw (Proton often nests the vendor HTML).
    let photoUrl =
      extractPhotoUrl(htmlRaw) ||
      pickBestPhotoFromBlob(rawText) ||
      pickBestPhotoFromBlob(text)
    if (photoUrl && isBadPhotoUrl(photoUrl)) photoUrl = ''
    // Listing page fallback when forwards drop <img> but keep the hotel/Airbnb URL.
    if (!photoUrl) {
      const listingUrls = extractListingUrls(text, htmlRaw)
      for (const listingUrl of listingUrls) {
        photoUrl = await resolveOgImage(listingUrl)
        if (photoUrl) break
      }
    }

    const subject = message.headers.get('subject') || ''
    const messageId = message.headers.get('message-id') || ''
    const from = message.from || message.headers.get('from') || ''
    const to = message.to || message.headers.get('to') || ''

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text: text.slice(0, 50000),
        html: htmlRaw ? htmlRaw.slice(0, 100000) : '',
        photoUrl: photoUrl || undefined,
        messageId,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      message.setReject(`Waypoint ingest failed (${res.status}): ${body.slice(0, 200)}`)
    }
  },
}

// Booking email inbound + authenticated paste → booking_imports.
// Env: BOOKING_EMAIL_WEBHOOK_SECRET (required for /email-inbound)
// PocketBase JSVM: helpers must be declared inside each routerAdd callback.

routerAdd('POST', '/api/waypoint/email-inbound', function (e) {

  function norm(s) {
    return String(s || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()
  }
  function first(text, re) {
    var m = String(text || '').match(re)
    return m && m[1] ? String(m[1]).trim() : ''
  }
  function decodeRfc2047(raw) {
    var s = String(raw || '')
    return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g, function (_m, _cs, enc, data) {
      try {
        if (String(enc).toLowerCase() === 'b') {
          return base64DecodeUtf8(String(data))
        }
        var qp = String(data).replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, function (__m, hex) {
          return String.fromCharCode(parseInt(hex, 16))
        })
        return qp
      } catch (ignore) { return raw }
    })
  }
  function base64DecodeUtf8(b64) {
    var s = String(b64 || '').replace(/\s+/g, '')
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    var bytes = []
    var i = 0
    while (i < s.length) {
      var c1 = alphabet.indexOf(s.charAt(i++))
      var c2 = alphabet.indexOf(s.charAt(i++))
      var c3 = alphabet.indexOf(s.charAt(i++))
      var c4 = alphabet.indexOf(s.charAt(i++))
      if (c1 < 0 || c2 < 0) break
      var n = (c1 << 18) | (c2 << 12) | ((c3 < 0 ? 0 : c3) << 6) | (c4 < 0 ? 0 : c4)
      bytes.push((n >> 16) & 255)
      if (c3 >= 0) bytes.push((n >> 8) & 255)
      if (c4 >= 0) bytes.push(n & 255)
    }
    // UTF-8 decode
    var out = ''
    for (var j = 0; j < bytes.length; ) {
      var b = bytes[j++]
      if (b < 128) out += String.fromCharCode(b)
      else if (b >= 192 && b < 224 && j < bytes.length) {
        out += String.fromCharCode(((b & 31) << 6) | (bytes[j++] & 63))
      } else if (b >= 224 && b < 240 && j + 1 < bytes.length) {
        out += String.fromCharCode(((b & 15) << 12) | ((bytes[j++] & 63) << 6) | (bytes[j++] & 63))
      } else if (b >= 240 && j + 2 < bytes.length) {
        var cp = ((b & 7) << 18) | ((bytes[j++] & 63) << 12) | ((bytes[j++] & 63) << 6) | (bytes[j++] & 63)
        cp -= 0x10000
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      }
    }
    return out
  }
  function looksLikeBase64(text) {
    var compact = String(text || '').replace(/\s+/g, '')
    if (compact.length < 64 || compact.length % 4 !== 0) return false
    return /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  }
  function maybeDecodeBase64(text) {
    var s = String(text || '')
    if (!looksLikeBase64(s)) return s
    try {
      var decoded = base64DecodeUtf8(s)
      if (decoded && /[A-Za-z]{3,}/.test(decoded)) return decoded
    } catch (ignore) {}
    return s
  }
  function unwrapQuoted(text) {
    return String(text || '').replace(/^[>\s]+/gm, '')
  }
  function monthNum(name) {
    var m = String(name || '').toLowerCase().slice(0, 3)
    var map = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
    return map[m] || 0
  }
  function normDate(raw, yearHint) {
    if (!raw) return ''
    var s = String(raw).trim()
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3]
    var ymd = s.match(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})/)
    if (ymd) return ymd[1] + '-' + ('0' + ymd[2]).slice(-2) + '-' + ('0' + ymd[3]).slice(-2)
    var dmy = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
    if (dmy) return dmy[3] + '-' + ('0' + dmy[2]).slice(-2) + '-' + ('0' + dmy[1]).slice(-2)
    // Sunday, 13 December 2026
    var dmyNamed = s.match(/([A-Za-z]{3,9}),?\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/)
    if (dmyNamed) {
      var mo2 = monthNum(dmyNamed[3])
      if (mo2) return dmyNamed[4] + '-' + ('0' + mo2).slice(-2) + '-' + ('0' + dmyNamed[2]).slice(-2)
    }
    var named = s.match(/(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?/)
    if (named) {
      var mo = monthNum(named[1])
      if (mo) {
        var year = named[3] || yearHint || ''
        if (!year) {
          var now = new Date()
          year = String(now.getFullYear())
          if (mo < (now.getMonth() + 1) - 6) year = String(now.getFullYear() + 1)
        }
        return year + '-' + ('0' + mo).slice(-2) + '-' + ('0' + named[2]).slice(-2)
      }
    }
    return ''
  }
  function normTime(raw) {
    if (!raw) return ''
    var s = String(raw).trim()
    var m = s.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
    if (!m) {
      m = s.match(/\b(\d{1,2})\s*(am|pm)\b/i)
      if (!m) return ''
      m = [m[0], m[1], '00', m[2]]
    }
    var h = Number(m[1])
    var min = m[2]
    var ap = (m[3] || '').toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return ('0' + h).slice(-2) + ':' + min
  }
  function moneyRe() {
    return /((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,]+(?:\.\d{2})?)/i
  }
  function firstMoney(text, re) {
    var m = String(text || '').match(re)
    if (!m) return ''
    var raw = m[1] || m[0]
    var mm = String(raw).match(moneyRe())
    return mm ? mm[1].replace(/\s+/g, ' ').trim() : String(raw).replace(/\s+/g, ' ').trim()
  }
  function moneyAfterLabel(blob, labelRe) {
    // Label then amount on the same or following line (common in receipts).
    var m = String(blob || '').match(labelRe)
    if (!m || m.index == null) return ''
    var window = String(blob).slice(m.index + m[0].length, m.index + m[0].length + 160)
    var mm = window.match(moneyRe())
    return mm && mm[1] ? String(mm[1]).replace(/\s+/g, ' ').trim() : ''
  }
  function extractPropertyAddress(text) {
    var t = String(text || '')
    // Prefer street lines from maps / directions markdown (Super.com, Gmail, etc.).
    var a = first(t, /\[(\d{1,5}\s+[^\]]{5,120})\]\(https?:\/\/[^)]*(?:google\.com\/maps|maps\.google|maps\.apple|apple\.com\/maps)/i)
      || first(t, /(?:^|\n)\s*(?:property\s+)?address\s*[:：]?\s*\n+(?:[^\n]+\n+)?\[(\d{1,5}\s+[^\]]{5,120})\]\(/i)
      || first(t, /(?:^|\n)\s*(?:property\s+)?address\s*[:：]?\s*\n+\s*([^\n]{8,160})/i)
      || first(t, /(?:^|\n)\s*(?:property\s+)?address\s*[:：]\s*([^\n]{8,160})/i)
      || first(t, /(?:^|\n)\s*location\s*[:：\t]\s*([^\n]{8,160})/i)
      || first(t, /(?:located\s+at|property\s+location|hotel\s+address)\s*[:：]?\s*([^\n]{8,160})/i)
      // Booking.com often puts the street on its own line before "Show directions" / Phone.
      || first(t, /(?:^|\n)\s*(\d{1,5}\s+[^\n]{5,120}?)\s+-\s*\[Show directions\]/i)
      || first(t, /(?:^|\n)\s*(\d{1,5}\s+[A-Za-z0-9 .'-]+,\s*[^\n]{5,100}(?:New Zealand|Australia|United Kingdom|USA|United States|Canada)[^\n]*)/i)
    if (!a) return ''
    a = a.replace(/\s+/g, ' ').replace(/\[.*?\]\(.*?\)/g, '').replace(/\s+-\s*$/, '').trim()
    if (/^(guests?|check|payment|total|taxes|house\s*rules|phone|contact)/i.test(a)) return ''
    // Hotel name alone after "Address:" — upgrade via nearby maps link when present.
    if (a && !/\d/.test(a)) {
      var street = first(t, /\[(\d{1,5}\s+[^\]]{5,120})\]\(https?:\/\/[^)]*maps/i)
      if (street) a = street.replace(/\s+/g, ' ').trim()
    }
    return a.slice(0, 200)
  }
  function isBadPhotoUrl(src) {
    var s = String(src || '').toLowerCase()
    if (!s || !/^https?:\/\//i.test(s)) return true
    if (/pixel|spacer|tracking|1x1|beacon|logo|icon|avatar|sprite|favicon|checkmark|badge|tick[_-]?mark|success[_-]?img/i.test(s)) return true
    // Booking.com email chrome / social share tiles — not the property.
    if (/\/static\/img\//i.test(s) || /\/fb\//i.test(s) || /bstatic\.com\/static\//i.test(s)) return true
    if (/design-assets|images-flags|flag@|ava-[a-z]\.png/i.test(s)) return true
    // OTA chrome (Super.com / SnapTravel check glyphs, app buttons).
    if (/cdn\.snaptravel\.com\/(?:checkmark|badge|icon)/i.test(s)) return true
    // Airbnb chrome / truncated hosting stubs (Proton often breaks muscache URLs).
    if (/airbnbplatformassets/i.test(s)) return true
    if (/muscache\.com\/ac\//i.test(s)) return true
    if (/muscache\.com/i.test(s) && !/\/im\/pictures\//i.test(s)) return true
    if (/muscache\.com.*hosting-[a-z0-9+/=_-]+\/?$/i.test(s) && !/\/original\//i.test(s)) return true
    if (/muscache\.com/i.test(s) && /=\s*$/.test(String(src || '').trim()) && !/\.(jpe?g|png|webp)(\?|$)/i.test(s)) return true
    return false
  }
  function scorePhotoUrl(src) {
    var s = String(src || '').toLowerCase()
    if (!s || isBadPhotoUrl(s) || /^cid:/i.test(s)) return -99
    var score = 0
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
  function pickBestPhotoFromBlob(blob) {
    var text = String(blob || '')
    if (!text) return ''
    var candidates = []
    var imgs = text.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi) || []
    for (var i = 0; i < imgs.length; i++) {
      var sm = imgs[i].match(/src=["']([^"']+)["']/i)
      if (!sm) continue
      var sc = scorePhotoUrl(sm[1])
      if (sc > 0) candidates.push({ src: sm[1], score: sc })
    }
    var mdRe = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi
    var md
    while ((md = mdRe.exec(text))) {
      var msc = scorePhotoUrl(md[1])
      if (msc > 0) candidates.push({ src: md[1], score: msc })
    }
    var bareRe = /(https?:\/\/[^\s\]"'<>]+(?:bstatic\.com\/xdata\/images\/hotel|muscache\.com\/im\/pictures)[^\s\]"'<>]*)/gi
    var bm
    while ((bm = bareRe.exec(text))) {
      var src = String(bm[1]).replace(/&amp;/g, '&').replace(/[),>.]+$/, '')
      var bsc = scorePhotoUrl(src)
      if (bsc > 0) candidates.push({ src: src, score: bsc })
    }
    if (!candidates.length) return ''
    candidates.sort(function (a, b) { return b.score - a.score })
    return candidates[0].src
  }
  function extractPhotoFromContent(html, text, explicit) {
    var hint = String(explicit || '').trim().replace(/[),>.]+$/, '')
    if (hint && /^https?:\/\//i.test(hint) && !isBadPhotoUrl(hint)) return hint
    var fromHtml = pickBestPhotoFromBlob(html)
    if (fromHtml) return fromHtml
    var fromText = pickBestPhotoFromBlob(text)
    if (fromText) return fromText
    return ''
  }
  function cleanListingUrlForPhoto(u) {
    var url = String(u || '').replace(/&amp;/g, '&').trim()
    if (!url) return ''
    var booking = url.match(/^(https?:\/\/(?:www\.)?booking\.com\/hotel\/[^?#]+)/i)
    if (booking) return booking[1]
    var airbnb = url.match(/^(https?:\/\/(?:www\.)?airbnb\.[^\/]+\/rooms\/\d+)/i)
    if (airbnb) return airbnb[1]
    var vrbo = url.match(/^(https?:\/\/(?:www\.)?(?:vrbo|expedia|hotels|agoda)\.[^?#]+)/i)
    if (vrbo) return vrbo[1].replace(/\/$/, '')
    return url.split('#')[0]
  }
  function extractOgImage(html) {
    var raw = String(html || '')
    if (!raw) return ''
    var og =
      raw.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      raw.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
      raw.match(/property=["']og:image:url["'][^>]*content=["']([^"']+)["']/i) ||
      raw.match(/twitter:image[^>]*content=["']([^"']+)["']/i)
    var src = og && og[1] ? String(og[1]).trim().replace(/&amp;/g, '&') : ''
    if (src && !isBadPhotoUrl(src)) return src
    return pickBestPhotoFromBlob(raw)
  }
  // Proton forwards strip <img>; resolve hero photo from the listing page.
  // Prefer a direct fetch (Airbnb works; Booking often WAF-blocks), then Jina Reader.
  function resolveListingPhoto(listingUrl) {
    var clean = cleanListingUrlForPhoto(listingUrl)
    if (!clean || !/^https?:\/\//i.test(clean)) return ''
    var browserHeaders = {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.9',
    }
    var candidates = [clean]
    var airbnbMirror = clean.match(/^(https?:\/\/(?:www\.)?)airbnb\.[^\/]+(\/rooms\/\d+)/i)
    if (airbnbMirror) {
      var mirror = airbnbMirror[1] + 'airbnb.com' + airbnbMirror[2]
      if (mirror !== clean) candidates.push(mirror)
    }
    for (var ci = 0; ci < candidates.length; ci++) {
      try {
        var direct = $http.send({
          url: candidates[ci],
          method: 'GET',
          headers: browserHeaders,
          timeout: 25,
        })
        if (direct && direct.statusCode >= 200 && direct.statusCode < 300) {
          var html = String(direct.raw || '')
          if (html.length > 8000) {
            var fromDirect = extractOgImage(html)
            if (fromDirect) return fromDirect
          }
        }
      } catch (errDirect) {
        console.log('[waypoint] resolveListingPhoto direct failed: ' + errDirect)
      }
    }
    for (var ji = 0; ji < candidates.length; ji++) {
      try {
        var res = $http.send({
          url: 'https://r.jina.ai/' + candidates[ji],
          method: 'GET',
          headers: { Accept: 'text/plain', 'User-Agent': 'WaypointEmailBot/1.0' },
          timeout: 35,
        })
        if (!res || res.statusCode < 200 || res.statusCode >= 300) continue
        var fromJina = extractOgImage(String(res.raw || ''))
        if (fromJina) return fromJina
      } catch (err) {
        console.log('[waypoint] resolveListingPhoto jina failed: ' + err)
      }
    }
    return ''
  }
  function ensurePhotoUrl(parsed) {
    if (!parsed) return parsed
    if (parsed.photoUrl && isBadPhotoUrl(parsed.photoUrl)) parsed.photoUrl = undefined
    if (parsed.photoUrl && !isBadPhotoUrl(parsed.photoUrl)) return parsed
    if (parsed.bookingUrl) {
      var resolved = resolveListingPhoto(parsed.bookingUrl)
      if (resolved) parsed.photoUrl = resolved
    }
    return parsed
  }
  function normalizeHttpUrl(u) {
    return String(u || '').replace(/&amp;/g, '&').trim()
  }
  function unwrapTrackingUrl(u) {
    var url = normalizeHttpUrl(u)
    var m = String(url).match(/\/e\/c\/([A-Za-z0-9_=-]+)\//)
    if (!m) return url
    try {
      var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
      while (b64.length % 4) b64 += '='
      var data = JSON.parse(base64DecodeUtf8(b64))
      if (data && data.href) return normalizeHttpUrl(data.href)
    } catch (ignore) {}
    return url
  }
  function extractBookingUrl(text, html) {
    var blob = String(text || '') + '\n' + String(html || '')
    var candidates = []
    var reMd = /\[([^\]]*(?:view\s+reservation|reservation\s+online|manage\s+(?:your\s+)?booking|booking\s+details|confirmation)[^\]]*)\]\((https?:\/\/[^)]+)\)/gi
    var mm
    while ((mm = reMd.exec(blob))) {
      candidates.push(unwrapTrackingUrl(mm[2]))
    }
    // Prefer deep listing / confirmation links over bare homepages.
    var direct = first(blob, /\((https?:\/\/(?:www\.)?super\.com\/travel\/bookings\/[^)\s]+)\)/i)
      || first(blob, /\((https?:\/\/(?:www\.)?booking\.com\/hotel\/[^)\s]+)\)/i)
      || first(blob, /\((https?:\/\/(?:www\.)?airbnb\.[^)\s]*\/rooms\/[^)\s]+)\)/i)
      || first(blob, /\((https?:\/\/(?:www\.)?(?:hotels|expedia|vrbo|agoda)\.[^)\s]+)\)/i)
      || first(blob, /(https?:\/\/(?:www\.)?super\.com\/travel\/bookings\/[^\s"'<>]+)/i)
      || first(blob, /(https?:\/\/(?:www\.)?booking\.com\/hotel\/[^\s"'<>]+)/i)
      || first(blob, /(https?:\/\/(?:www\.)?airbnb\.[^\s"'<>]*\/rooms\/[^\s"'<>]+)/i)
      || first(blob, /(https?:\/\/(?:www\.)?(?:hotels|expedia|vrbo|agoda)\.[^\s"'<>]+)/i)
      || ''
    if (direct) candidates.unshift(unwrapTrackingUrl(direct))
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i]
      if (!c) continue
      if (/\/(?:bookings?|confirmation|hotel\/|rooms\/)/i.test(c) && !/(?:help\.|\/legal|\/search|\/support)/i.test(c)) return c
    }
    return candidates.length ? candidates[0] : ''
  }
  function scoreKind(text, subject) {
    var blob = (subject + '\n' + text).toLowerCase()
    var scores = { accommodation: 0, rentalCar: 0, restaurant: 0, flight: 0 }
    // Strong vendor / product signals first (avoid ties with weak flight words like "arrival").
    if (/\b(airbnb|booking\.com|vrbo|agoda|expedia|hotels\.com|hostelworld|super\.com|snaptravel)\b/.test(blob)) scores.accommodation += 8
    if (/\b(hotel|motel|hostel|cabin|resort|inn|apartment|villa|lodge|accommodation|property)\b/.test(blob)) scores.accommodation += 3
    if (/\bcheck-?\s*in\b/.test(blob) && /\bcheck-?\s*out\b|\bcheckout\b/.test(blob)) scores.accommodation += 4
    else if (/\b(check-?\s*in|check-?\s*out|checkout|stay\s+at)\b/.test(blob)) scores.accommodation += 2
    if (/booking\.com\/hotel\//i.test(subject + '\n' + text)) scores.accommodation += 6
    if (/airbnb\.[^/\s]+\/rooms\//i.test(subject + '\n' + text)) scores.accommodation += 6

    if (/\b(flight|boarding\s*pass|e-?ticket|airline|gate\s*\d+)\b/.test(blob)) scores.flight += 3
    if (/\b(depart(?:ure|s|ing)|outbound\s+flight|arrives?\s+at|arrival\s+(?:time|airport|terminal|gate))\b/.test(blob)) scores.flight += 2
    if (/\b([A-Z]{3})\s*(?:→|->|to)\s*([A-Z]{3})\b/.test(subject + '\n' + text)) scores.flight += 4
    if (/\b(qantas|jetstar|air\s*nz|united|delta|emirates|qatar|virgin\s*australia)\b/.test(blob)) scores.flight += 3

    if (/\b(rental\s*car|car\s*hire)\b/.test(blob)) scores.rentalCar += 3
    if (/\b(pick-?\s*up|drop-?\s*off)\b/.test(blob) && /\b(car|vehicle|rental)\b/.test(blob)) scores.rentalCar += 3
    if (/\b(hertz|avis|enterprise|budget|sixt|europcar|thrifty)\b/.test(blob)) scores.rentalCar += 4

    if (/\b(opentable|table\s*for|restaurant\s+reservation)\b/.test(blob)) scores.restaurant += 4
    else if (/\b(restaurant|dinner|lunch)\b/.test(blob) && !/\b(hotel|airbnb|booking\.com|cabin)\b/.test(blob)) scores.restaurant += 2

    // Prefer lodging when both check-in/out exist even if a weak flight word appeared.
    if (scores.accommodation >= 4 && scores.flight > 0 && scores.flight <= scores.accommodation) {
      scores.flight = Math.max(0, scores.flight - 3)
    }

    var best = 'unknown'
    var bestScore = 0
    var order = ['accommodation', 'rentalCar', 'restaurant', 'flight']
    for (var i = 0; i < order.length; i++) {
      var k = order[i]
      if (scores[k] > bestScore) { best = k; bestScore = scores[k] }
    }
    if (bestScore < 2) return { kind: 'unknown', score: bestScore }
    return { kind: best, score: bestScore }
  }
  function parseEmail(subjectRaw, textRaw, htmlRaw, photoHint) {
    var subject = norm(decodeRfc2047(subjectRaw))
    var text = unwrapQuoted(norm(maybeDecodeBase64(textRaw)))
    var html = String(htmlRaw || '')
    if (!text && html) {
      text = unwrapQuoted(norm(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')))
    }
    var blob = subject + '\n' + text
    var yearHint = first(blob, /\b(20\d{2})\b/)
    var scored = scoreKind(text, subject)
    var kind = scored.kind
    var confirmation = first(blob, /confirmation\s*(?:number|#|no\.?|code)\s*[:#]\s*([A-Z0-9_-]{4,24})\b/i)
      || first(blob, /(?:booking\s*(?:ref(?:erence)?|id)|record\s*locator|PNR|itinerary\s*(?:number|#))\s*[:#]?\s*([A-Z0-9_-]{5,24})\b/i)
      || first(blob, /\b(?:conf(?:irmation)?|ref(?:erence)?)\s*[:#]\s*([A-Z0-9_-]{5,24})\b/i)
      || first(blob, /reservation-details\/(?:[^/\s?"']+\/){2,}([A-Z0-9]{8,16})(?:[?/"'\s]|$)/i)
      || first(blob, /(?:confirmation|booking)[=/]([A-Z0-9_-]{6,24})/i)
    if (confirmation && /^(number|code|details|online|here|confirmation|booking|reservation)$/i.test(confirmation)) confirmation = ''

    // Vendor-agnostic money: total, paid so far, remaining/next charge.
    // Prefer explicit totals; avoid cancellation-fee lines ("until …: AUD 0").
    var price = moneyAfterLabel(blob, /total\s*cost/i)
      || moneyAfterLabel(blob, /total\s*scheduled\s*payments?/i)
      || moneyAfterLabel(blob, /total(?:\s*\([A-Z]{3}\))?/i)
      || firstMoney(blob, /(?:grand\s*)?total(?:\s*(?:cost|price|amount))?\s*[:.\t]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
      || firstMoney(blob, /(?:amount|fare|price)\s*[:.]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
    var amountPaid = moneyAfterLabel(blob, /total\s*paid/i)
      || moneyAfterLabel(blob, /(?:amount\s+)?(?:already\s+)?paid(?:\s*(?:to\s+date|so\s+far))?/i)
      || moneyAfterLabel(blob, /paid\s+[A-Za-z]{3}\s+\d{1,2}/i)
      || firstMoney(blob, /(?:paid|payment\s+received)\s*[:.\t]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
    var amountOwing = moneyAfterLabel(blob, /total\s*scheduled\s*payments?/i)
      || moneyAfterLabel(blob, /(?:balance|amount)\s*(?:due|owing|remaining)|(?:remaining|outstanding)\s*(?:balance|amount)|amount\s+still\s+due/i)
      || moneyAfterLabel(blob, /charge\s+on\s+[A-Za-z]{3}\s+\d{1,2}/i)
      || firstMoney(blob, /(?:due|owing|balance|remaining)\s*[:.]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
    // If still unpaid in full, owing ≈ total when paid is 0/empty.
    if (price && !amountOwing && (!amountPaid || /^[A-Z$]*\s*0(?:\.0+)?$/i.test(amountPaid.replace(/,/g, '')))) {
      amountOwing = price
    }
    if (amountOwing && price && amountOwing === price && amountPaid && !/^[A-Z$]*\s*0(?:\.0+)?$/i.test(amountPaid.replace(/,/g, ''))) {
      // keep both; UI shows paid + owing separately
    }

    var address = extractPropertyAddress(text)
    var photoUrl = extractPhotoFromContent(html, text, photoHint)
    var bookingUrl = extractBookingUrl(text, html)

    var parsed = {
      kind: kind,
      confidence: Math.min(1, (scored.score + (confirmation ? 2 : 0) + (price ? 0.5 : 0) + (address ? 0.5 : 0)) / 8),
      confirmation: confirmation || undefined,
      price: price || undefined,
      amountPaid: amountPaid || undefined,
      amountOwing: amountOwing || undefined,
      address: address || undefined,
      photoUrl: photoUrl || undefined,
      bookingUrl: bookingUrl || undefined,
      notes: subject || undefined,
    }
    if (kind === 'flight' || kind === 'unknown') {
      var route = (subject + '\n' + text).match(/\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/)
      if (route) { parsed.fromIata = route[1]; parsed.toIata = route[2] }
      parsed.airline = first(text, /(?:airline|operated by|carrier)\s*[:.]?\s*([A-Za-z0-9 &.-]{2,40})/i) || first(subject + '\n' + text, /\b(Qantas|Jetstar|Air New Zealand|United|Delta|Emirates|Qatar Airways|Virgin Australia)\b/i) || undefined
      parsed.departDate = normDate(first(text, /(?:depart(?:ure)?|outbound)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.departTime = normTime(first(text, /(?:depart(?:ure)?)\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)) || undefined
      parsed.arriveDate = normDate(first(text, /(?:arriv(?:al|e)|inbound)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.arriveTime = normTime(first(text, /(?:arriv(?:al|e))\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)) || undefined
    }
    if (kind === 'rentalCar' || kind === 'unknown') {
      parsed.company = first(text, /(?:rental\s*(?:company|provider)|supplier)\s*[:.]?\s*([A-Za-z0-9 &.-]{2,40})/i) || first(text, /\b(Hertz|Avis|Enterprise|Budget|Sixt|Europcar|Thrifty|Dollar)\b/i) || undefined
      var pu = first(text, /(?:pick-?\s*up(?:\s*location)?)\s*[:.]?\s*(.+)$/im)
      if (pu) parsed.pickupLocation = pu.slice(0, 120)
      var dro = first(text, /(?:drop-?\s*off(?:\s*location)?)\s*[:.]?\s*(.+)$/im)
      if (dro) parsed.dropoffLocation = dro.slice(0, 120)
      parsed.pickupDate = normDate(first(text, /(?:pick-?\s*up(?:\s*date)?)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.dropoffDate = normDate(first(text, /(?:drop-?\s*off(?:\s*date)?)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
    }
    if (kind === 'accommodation' || kind === 'unknown') {
      var name = first(subject, /(?:booking\s+)?confirmation\s+for\s+(.+)$/i)
        || first(text, /your\s+booking\s+at\s+(.+?)\s+in\s+[A-Za-z][\w\s'-]*\s+is\s+confirmed/i)
        || first(subject, /(?:confirmation|booking|reservation)\s+at\s+(.+)$/i)
        || first(subject, /confirmed\s+at\s+(.+)$/i)
        || first(text, /\[([^\]]{5,100})\]\(https?:\/\/[^)]*(?:rooms|hotel|property|listing)/i)
        || first(text, /(?:property|hotel|listing|accommodation)\s+name\s*[:.]?\s*(.+)$/im)
        || first(text, /(?:you(?:'|\u2019)?re\s+all\s+set\s+for|welcome\s+to)\s+([^\n<]{3,80}?)(?=\s*(?:\n|http|check-?\s*in|confirmation|pin\b|$))/i)
      if (name) {
        name = name.replace(/\s+/g, ' ').trim()
        if (/(?:%|\boff\b|come back|best deals|find a hotel|download app|through us|versus anywhere)/i.test(name)) name = ''
      }
      if (name) parsed.name = name.slice(0, 120)
      if (!parsed.location) {
        var loc = first(text, /booking\s+in\s+([A-Za-z][A-Za-z'-]*)(?=\s+is\s+confirmed)/i)
          || first(text, /your\s+booking\s+at\s+.+?\s+in\s+([A-Za-z][A-Za-z\s'-]{1,40}?)\s+is\s+confirmed/i)
          || first(text, /you(?:'|)re\s+all\s+set\s+for\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})(?=\s*[.!\n]|$)/i)
          || first(text, /(?:destination|city)\s*[:.]?\s*([A-Za-z][A-Za-z\s-]{2,40})/i)
        if (loc) parsed.location = loc.replace(/\s+/g, ' ').slice(0, 80)
      }
      var dateBit = '([A-Za-z]{3,9},?\\s+\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4}|[A-Za-z]{3},?\\s+[A-Za-z]{3,9}\\s+\\d{1,2}(?:,?\\s*\\d{4})?|\\d{4}[/. -]\\d{1,2}[/. -]\\d{1,2}|\\d{1,2}[/. -]\\d{1,2}[/. -]\\d{4})'
      parsed.checkIn = normDate(first(text, new RegExp('(?:check-?\\s*in)\\b[\\s:>|\\t-]*' + dateBit, 'i')), yearHint) || undefined
      parsed.checkOut = normDate(first(text, new RegExp('(?:check-?\\s*out|checkout)\\b[\\s:>|\\t-]*' + dateBit, 'i')), yearHint) || undefined
      // Prefer start of check-in window; end of check-out window when given as (HH:MM - HH:MM).
      var ciWin = text.match(/(?:check-?\s*in)\b[\s\S]{0,80}?\((\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\)/i)
      var coWin = text.match(/(?:check-?\s*out|checkout)\b[\s\S]{0,80}?\((\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\)/i)
      var ciParen = text.match(/(?:check-?\s*in)\b[^\n]{0,90}\((?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
      var coParen = text.match(/(?:check-?\s*out|checkout)\b[^\n]{0,90}\((\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
      parsed.checkInTime = normTime(ciWin ? ciWin[1] : (ciParen ? ciParen[1] : first(text, /(?:check-?\s*in)\b[\s\S]{0,100}?(?:after|from|at)?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i))) || undefined
      parsed.checkOutTime = normTime(coWin ? coWin[2] : (coParen ? coParen[1] : first(text, /(?:check-?\s*out|checkout)\b[\s\S]{0,100}?(?:by|before|until|at)?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i))) || undefined
    }
    if (kind === 'restaurant') {
      var rname = first(text, /(?:restaurant|venue|dining)\s*[:.]?\s*(.+)$/im) || first(subject, /(?:reservation|table)\s*(?:at|for|:)\s*(.+)$/i)
      if (rname) parsed.name = rname.slice(0, 120)
      parsed.reservationDate = normDate(first(text, /(?:date|reservation)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.reservationTime = normTime(first(text, /(?:time)\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)) || undefined
    }
    parsed.kind = kind
    return parsed
  }

  function extractAddress(value) {
    var s = String(value || '')
    var m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    return m ? m[0].toLowerCase() : ''
  }
  function splitEmails(value) {
    return String(value || '')
      .toLowerCase()
      .split(/[,;\s]+/)
      .map(function (s) { return s.trim() })
      .filter(function (s) { return s.indexOf('@') > 0 })
  }
  function findUser(app, body) {
    var to = String(body.to || body.recipient || '')
    var plus = to.match(/\+([a-z0-9]{10,20})@/i)
    if (plus) {
      try { return app.findRecordById('users', plus[1]) } catch (ignore) {}
    }
    var from = extractAddress(body.from || body.sender || '')
    if (from) {
      var safe = from.replace(/"/g, '')
      // Exact single-value match (legacy)
      try { return app.findFirstRecordByFilter('users', 'booking_from_email="' + safe + '"') } catch (ignorePref) {}
      // Comma/space-separated aliases: "a@x.com, b@y.com"
      try {
        var rows = app.findRecordsByFilter('users', 'booking_from_email != ""', '-created', 200, 0)
        for (var i = 0; i < rows.length; i++) {
          var aliases = splitEmails(rows[i].get('booking_from_email'))
          if (aliases.indexOf(safe) >= 0) return rows[i]
        }
      } catch (ignoreList) {}
      try { return app.findFirstRecordByFilter('users', 'email="' + safe + '"') } catch (ignore2) {}
    }
    return null
  }
  function saveImport(app, user, body, parsed) {
    var col = app.findCollectionByNameOrId('booking_imports')
    var messageId = String(body.messageId || body.message_id || '').trim()
    if (messageId) {
      try {
        var existing = app.findFirstRecordByFilter('booking_imports', 'message_id="' + messageId.replace(/"/g, '') + '"')
        if (existing) return existing
      } catch (ignore) {}
    }
    var rec = new Record(col)
    rec.set('user', user.id)
    rec.set('status', 'pending')
    rec.set('kind', parsed.kind || 'unknown')
    rec.set('from_email', extractAddress(body.from || body.sender || ''))
    rec.set('subject', decodeRfc2047(String(body.subject || '')).slice(0, 300))
    rec.set('trip_id', String(body.tripId || body.trip_id || ''))
    rec.set('parsed', parsed)
    rec.set('raw_text', unwrapQuoted(norm(maybeDecodeBase64(String(body.text || '')))).slice(0, 100000))
    rec.set('error', '')
    rec.set('message_id', messageId)
    app.save(rec)
    return rec
  }

  try {
    var secret = ''
    try { secret = String($os.getenv('BOOKING_EMAIL_WEBHOOK_SECRET') || '') } catch (ignore) { secret = '' }
    if (!secret) return e.json(503, { message: 'BOOKING_EMAIL_WEBHOOK_SECRET is not configured', status: 503 })
    var info = e.requestInfo()
    var headers = info.headers || {}
    var authHdr = String(headers['authorization'] || headers['Authorization'] || '')
    var hdr = String(headers['x-waypoint-email-secret'] || headers['X-Waypoint-Email-Secret'] || '')
    var bearer = ''
    var m = authHdr.match(/^Bearer\s+(.+)$/i)
    if (m) bearer = m[1].trim()
    if (bearer !== secret && hdr !== secret) return e.json(401, { message: 'Unauthorized', status: 401 })

    var body = info.body || {}
    var user = findUser(e.app, body)
    if (!user) {
      return e.json(404, {
        message: 'No Waypoint user matched this email (from address or +userId plus-address)',
        status: 404,
      })
    }

    var parsed = ensurePhotoUrl(parseEmail(body.subject, body.text, body.html, body.photoUrl || body.photo_url))
    var rec = saveImport(e.app, user, body, parsed)
    return e.json(200, {
      ok: true,
      id: rec.id,
      kind: rec.get('kind'),
      status: rec.get('status'),
      confirmation: (parsed && parsed.confirmation) || null,
    })
  } catch (err) {
    console.log('[waypoint] email-inbound error ' + err)
    return e.json(400, {
      message: String(err && err.message ? err.message : err),
      status: 400,
    })
  }
})

routerAdd('POST', '/api/waypoint/email-paste', function (e) {

  function norm(s) {
    return String(s || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()
  }
  function first(text, re) {
    var m = String(text || '').match(re)
    return m && m[1] ? String(m[1]).trim() : ''
  }
  function decodeRfc2047(raw) {
    var s = String(raw || '')
    return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g, function (_m, _cs, enc, data) {
      try {
        if (String(enc).toLowerCase() === 'b') {
          return base64DecodeUtf8(String(data))
        }
        var qp = String(data).replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, function (__m, hex) {
          return String.fromCharCode(parseInt(hex, 16))
        })
        return qp
      } catch (ignore) { return raw }
    })
  }
  function base64DecodeUtf8(b64) {
    var s = String(b64 || '').replace(/\s+/g, '')
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    var bytes = []
    var i = 0
    while (i < s.length) {
      var c1 = alphabet.indexOf(s.charAt(i++))
      var c2 = alphabet.indexOf(s.charAt(i++))
      var c3 = alphabet.indexOf(s.charAt(i++))
      var c4 = alphabet.indexOf(s.charAt(i++))
      if (c1 < 0 || c2 < 0) break
      var n = (c1 << 18) | (c2 << 12) | ((c3 < 0 ? 0 : c3) << 6) | (c4 < 0 ? 0 : c4)
      bytes.push((n >> 16) & 255)
      if (c3 >= 0) bytes.push((n >> 8) & 255)
      if (c4 >= 0) bytes.push(n & 255)
    }
    // UTF-8 decode
    var out = ''
    for (var j = 0; j < bytes.length; ) {
      var b = bytes[j++]
      if (b < 128) out += String.fromCharCode(b)
      else if (b >= 192 && b < 224 && j < bytes.length) {
        out += String.fromCharCode(((b & 31) << 6) | (bytes[j++] & 63))
      } else if (b >= 224 && b < 240 && j + 1 < bytes.length) {
        out += String.fromCharCode(((b & 15) << 12) | ((bytes[j++] & 63) << 6) | (bytes[j++] & 63))
      } else if (b >= 240 && j + 2 < bytes.length) {
        var cp = ((b & 7) << 18) | ((bytes[j++] & 63) << 12) | ((bytes[j++] & 63) << 6) | (bytes[j++] & 63)
        cp -= 0x10000
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      }
    }
    return out
  }
  function looksLikeBase64(text) {
    var compact = String(text || '').replace(/\s+/g, '')
    if (compact.length < 64 || compact.length % 4 !== 0) return false
    return /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  }
  function maybeDecodeBase64(text) {
    var s = String(text || '')
    if (!looksLikeBase64(s)) return s
    try {
      var decoded = base64DecodeUtf8(s)
      if (decoded && /[A-Za-z]{3,}/.test(decoded)) return decoded
    } catch (ignore) {}
    return s
  }
  function unwrapQuoted(text) {
    return String(text || '').replace(/^[>\s]+/gm, '')
  }
  function monthNum(name) {
    var m = String(name || '').toLowerCase().slice(0, 3)
    var map = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
    return map[m] || 0
  }
  function normDate(raw, yearHint) {
    if (!raw) return ''
    var s = String(raw).trim()
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3]
    var ymd = s.match(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})/)
    if (ymd) return ymd[1] + '-' + ('0' + ymd[2]).slice(-2) + '-' + ('0' + ymd[3]).slice(-2)
    var dmy = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
    if (dmy) return dmy[3] + '-' + ('0' + dmy[2]).slice(-2) + '-' + ('0' + dmy[1]).slice(-2)
    // Sunday, 13 December 2026
    var dmyNamed = s.match(/([A-Za-z]{3,9}),?\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/)
    if (dmyNamed) {
      var mo2 = monthNum(dmyNamed[3])
      if (mo2) return dmyNamed[4] + '-' + ('0' + mo2).slice(-2) + '-' + ('0' + dmyNamed[2]).slice(-2)
    }
    var named = s.match(/(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?/)
    if (named) {
      var mo = monthNum(named[1])
      if (mo) {
        var year = named[3] || yearHint || ''
        if (!year) {
          var now = new Date()
          year = String(now.getFullYear())
          if (mo < (now.getMonth() + 1) - 6) year = String(now.getFullYear() + 1)
        }
        return year + '-' + ('0' + mo).slice(-2) + '-' + ('0' + named[2]).slice(-2)
      }
    }
    return ''
  }
  function normTime(raw) {
    if (!raw) return ''
    var s = String(raw).trim()
    var m = s.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
    if (!m) {
      m = s.match(/\b(\d{1,2})\s*(am|pm)\b/i)
      if (!m) return ''
      m = [m[0], m[1], '00', m[2]]
    }
    var h = Number(m[1])
    var min = m[2]
    var ap = (m[3] || '').toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return ('0' + h).slice(-2) + ':' + min
  }
  function moneyRe() {
    return /((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,]+(?:\.\d{2})?)/i
  }
  function firstMoney(text, re) {
    var m = String(text || '').match(re)
    if (!m) return ''
    var raw = m[1] || m[0]
    var mm = String(raw).match(moneyRe())
    return mm ? mm[1].replace(/\s+/g, ' ').trim() : String(raw).replace(/\s+/g, ' ').trim()
  }
  function moneyAfterLabel(blob, labelRe) {
    // Label then amount on the same or following line (common in receipts).
    var m = String(blob || '').match(labelRe)
    if (!m || m.index == null) return ''
    var window = String(blob).slice(m.index + m[0].length, m.index + m[0].length + 160)
    var mm = window.match(moneyRe())
    return mm && mm[1] ? String(mm[1]).replace(/\s+/g, ' ').trim() : ''
  }
  function extractPropertyAddress(text) {
    var t = String(text || '')
    // Prefer street lines from maps / directions markdown (Super.com, Gmail, etc.).
    var a = first(t, /\[(\d{1,5}\s+[^\]]{5,120})\]\(https?:\/\/[^)]*(?:google\.com\/maps|maps\.google|maps\.apple|apple\.com\/maps)/i)
      || first(t, /(?:^|\n)\s*(?:property\s+)?address\s*[:：]?\s*\n+(?:[^\n]+\n+)?\[(\d{1,5}\s+[^\]]{5,120})\]\(/i)
      || first(t, /(?:^|\n)\s*(?:property\s+)?address\s*[:：]?\s*\n+\s*([^\n]{8,160})/i)
      || first(t, /(?:^|\n)\s*(?:property\s+)?address\s*[:：]\s*([^\n]{8,160})/i)
      || first(t, /(?:^|\n)\s*location\s*[:：\t]\s*([^\n]{8,160})/i)
      || first(t, /(?:located\s+at|property\s+location|hotel\s+address)\s*[:：]?\s*([^\n]{8,160})/i)
      // Booking.com often puts the street on its own line before "Show directions" / Phone.
      || first(t, /(?:^|\n)\s*(\d{1,5}\s+[^\n]{5,120}?)\s+-\s*\[Show directions\]/i)
      || first(t, /(?:^|\n)\s*(\d{1,5}\s+[A-Za-z0-9 .'-]+,\s*[^\n]{5,100}(?:New Zealand|Australia|United Kingdom|USA|United States|Canada)[^\n]*)/i)
    if (!a) return ''
    a = a.replace(/\s+/g, ' ').replace(/\[.*?\]\(.*?\)/g, '').replace(/\s+-\s*$/, '').trim()
    if (/^(guests?|check|payment|total|taxes|house\s*rules|phone|contact)/i.test(a)) return ''
    // Hotel name alone after "Address:" — upgrade via nearby maps link when present.
    if (a && !/\d/.test(a)) {
      var street = first(t, /\[(\d{1,5}\s+[^\]]{5,120})\]\(https?:\/\/[^)]*maps/i)
      if (street) a = street.replace(/\s+/g, ' ').trim()
    }
    return a.slice(0, 200)
  }
  function isBadPhotoUrl(src) {
    var s = String(src || '').toLowerCase()
    if (!s || !/^https?:\/\//i.test(s)) return true
    if (/pixel|spacer|tracking|1x1|beacon|logo|icon|avatar|sprite|favicon|checkmark|badge|tick[_-]?mark|success[_-]?img/i.test(s)) return true
    // Booking.com email chrome / social share tiles — not the property.
    if (/\/static\/img\//i.test(s) || /\/fb\//i.test(s) || /bstatic\.com\/static\//i.test(s)) return true
    if (/design-assets|images-flags|flag@|ava-[a-z]\.png/i.test(s)) return true
    // OTA chrome (Super.com / SnapTravel check glyphs, app buttons).
    if (/cdn\.snaptravel\.com\/(?:checkmark|badge|icon)/i.test(s)) return true
    // Airbnb chrome / truncated hosting stubs (Proton often breaks muscache URLs).
    if (/airbnbplatformassets/i.test(s)) return true
    if (/muscache\.com\/ac\//i.test(s)) return true
    if (/muscache\.com/i.test(s) && !/\/im\/pictures\//i.test(s)) return true
    if (/muscache\.com.*hosting-[a-z0-9+/=_-]+\/?$/i.test(s) && !/\/original\//i.test(s)) return true
    if (/muscache\.com/i.test(s) && /=\s*$/.test(String(src || '').trim()) && !/\.(jpe?g|png|webp)(\?|$)/i.test(s)) return true
    return false
  }
  function scorePhotoUrl(src) {
    var s = String(src || '').toLowerCase()
    if (!s || isBadPhotoUrl(s) || /^cid:/i.test(s)) return -99
    var score = 0
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
  function pickBestPhotoFromBlob(blob) {
    var text = String(blob || '')
    if (!text) return ''
    var candidates = []
    var imgs = text.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi) || []
    for (var i = 0; i < imgs.length; i++) {
      var sm = imgs[i].match(/src=["']([^"']+)["']/i)
      if (!sm) continue
      var sc = scorePhotoUrl(sm[1])
      if (sc > 0) candidates.push({ src: sm[1], score: sc })
    }
    var mdRe = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi
    var md
    while ((md = mdRe.exec(text))) {
      var msc = scorePhotoUrl(md[1])
      if (msc > 0) candidates.push({ src: md[1], score: msc })
    }
    var bareRe = /(https?:\/\/[^\s\]"'<>]+(?:bstatic\.com\/xdata\/images\/hotel|muscache\.com\/im\/pictures)[^\s\]"'<>]*)/gi
    var bm
    while ((bm = bareRe.exec(text))) {
      var src = String(bm[1]).replace(/&amp;/g, '&').replace(/[),>.]+$/, '')
      var bsc = scorePhotoUrl(src)
      if (bsc > 0) candidates.push({ src: src, score: bsc })
    }
    if (!candidates.length) return ''
    candidates.sort(function (a, b) { return b.score - a.score })
    return candidates[0].src
  }
  function extractPhotoFromContent(html, text, explicit) {
    var hint = String(explicit || '').trim().replace(/[),>.]+$/, '')
    if (hint && /^https?:\/\//i.test(hint) && !isBadPhotoUrl(hint)) return hint
    var fromHtml = pickBestPhotoFromBlob(html)
    if (fromHtml) return fromHtml
    var fromText = pickBestPhotoFromBlob(text)
    if (fromText) return fromText
    return ''
  }
  function cleanListingUrlForPhoto(u) {
    var url = String(u || '').replace(/&amp;/g, '&').trim()
    if (!url) return ''
    var booking = url.match(/^(https?:\/\/(?:www\.)?booking\.com\/hotel\/[^?#]+)/i)
    if (booking) return booking[1]
    var airbnb = url.match(/^(https?:\/\/(?:www\.)?airbnb\.[^\/]+\/rooms\/\d+)/i)
    if (airbnb) return airbnb[1]
    var vrbo = url.match(/^(https?:\/\/(?:www\.)?(?:vrbo|expedia|hotels|agoda)\.[^?#]+)/i)
    if (vrbo) return vrbo[1].replace(/\/$/, '')
    return url.split('#')[0]
  }
  function extractOgImage(html) {
    var raw = String(html || '')
    if (!raw) return ''
    var og =
      raw.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      raw.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
      raw.match(/property=["']og:image:url["'][^>]*content=["']([^"']+)["']/i) ||
      raw.match(/twitter:image[^>]*content=["']([^"']+)["']/i)
    var src = og && og[1] ? String(og[1]).trim().replace(/&amp;/g, '&') : ''
    if (src && !isBadPhotoUrl(src)) return src
    return pickBestPhotoFromBlob(raw)
  }
  // Proton forwards strip <img>; resolve hero photo from the listing page.
  // Prefer a direct fetch (Airbnb works; Booking often WAF-blocks), then Jina Reader.
  function resolveListingPhoto(listingUrl) {
    var clean = cleanListingUrlForPhoto(listingUrl)
    if (!clean || !/^https?:\/\//i.test(clean)) return ''
    var browserHeaders = {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.9',
    }
    var candidates = [clean]
    var airbnbMirror = clean.match(/^(https?:\/\/(?:www\.)?)airbnb\.[^\/]+(\/rooms\/\d+)/i)
    if (airbnbMirror) {
      var mirror = airbnbMirror[1] + 'airbnb.com' + airbnbMirror[2]
      if (mirror !== clean) candidates.push(mirror)
    }
    for (var ci = 0; ci < candidates.length; ci++) {
      try {
        var direct = $http.send({
          url: candidates[ci],
          method: 'GET',
          headers: browserHeaders,
          timeout: 25,
        })
        if (direct && direct.statusCode >= 200 && direct.statusCode < 300) {
          var html = String(direct.raw || '')
          if (html.length > 8000) {
            var fromDirect = extractOgImage(html)
            if (fromDirect) return fromDirect
          }
        }
      } catch (errDirect) {
        console.log('[waypoint] resolveListingPhoto direct failed: ' + errDirect)
      }
    }
    for (var ji = 0; ji < candidates.length; ji++) {
      try {
        var res = $http.send({
          url: 'https://r.jina.ai/' + candidates[ji],
          method: 'GET',
          headers: { Accept: 'text/plain', 'User-Agent': 'WaypointEmailBot/1.0' },
          timeout: 35,
        })
        if (!res || res.statusCode < 200 || res.statusCode >= 300) continue
        var fromJina = extractOgImage(String(res.raw || ''))
        if (fromJina) return fromJina
      } catch (err) {
        console.log('[waypoint] resolveListingPhoto jina failed: ' + err)
      }
    }
    return ''
  }
  function ensurePhotoUrl(parsed) {
    if (!parsed) return parsed
    if (parsed.photoUrl && isBadPhotoUrl(parsed.photoUrl)) parsed.photoUrl = undefined
    if (parsed.photoUrl && !isBadPhotoUrl(parsed.photoUrl)) return parsed
    if (parsed.bookingUrl) {
      var resolved = resolveListingPhoto(parsed.bookingUrl)
      if (resolved) parsed.photoUrl = resolved
    }
    return parsed
  }
  function normalizeHttpUrl(u) {
    return String(u || '').replace(/&amp;/g, '&').trim()
  }
  function unwrapTrackingUrl(u) {
    var url = normalizeHttpUrl(u)
    var m = String(url).match(/\/e\/c\/([A-Za-z0-9_=-]+)\//)
    if (!m) return url
    try {
      var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
      while (b64.length % 4) b64 += '='
      var data = JSON.parse(base64DecodeUtf8(b64))
      if (data && data.href) return normalizeHttpUrl(data.href)
    } catch (ignore) {}
    return url
  }
  function extractBookingUrl(text, html) {
    var blob = String(text || '') + '\n' + String(html || '')
    var candidates = []
    var reMd = /\[([^\]]*(?:view\s+reservation|reservation\s+online|manage\s+(?:your\s+)?booking|booking\s+details|confirmation)[^\]]*)\]\((https?:\/\/[^)]+)\)/gi
    var mm
    while ((mm = reMd.exec(blob))) {
      candidates.push(unwrapTrackingUrl(mm[2]))
    }
    // Prefer deep listing / confirmation links over bare homepages.
    var direct = first(blob, /\((https?:\/\/(?:www\.)?super\.com\/travel\/bookings\/[^)\s]+)\)/i)
      || first(blob, /\((https?:\/\/(?:www\.)?booking\.com\/hotel\/[^)\s]+)\)/i)
      || first(blob, /\((https?:\/\/(?:www\.)?airbnb\.[^)\s]*\/rooms\/[^)\s]+)\)/i)
      || first(blob, /\((https?:\/\/(?:www\.)?(?:hotels|expedia|vrbo|agoda)\.[^)\s]+)\)/i)
      || first(blob, /(https?:\/\/(?:www\.)?super\.com\/travel\/bookings\/[^\s"'<>]+)/i)
      || first(blob, /(https?:\/\/(?:www\.)?booking\.com\/hotel\/[^\s"'<>]+)/i)
      || first(blob, /(https?:\/\/(?:www\.)?airbnb\.[^\s"'<>]*\/rooms\/[^\s"'<>]+)/i)
      || first(blob, /(https?:\/\/(?:www\.)?(?:hotels|expedia|vrbo|agoda)\.[^\s"'<>]+)/i)
      || ''
    if (direct) candidates.unshift(unwrapTrackingUrl(direct))
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i]
      if (!c) continue
      if (/\/(?:bookings?|confirmation|hotel\/|rooms\/)/i.test(c) && !/(?:help\.|\/legal|\/search|\/support)/i.test(c)) return c
    }
    return candidates.length ? candidates[0] : ''
  }
  function scoreKind(text, subject) {
    var blob = (subject + '\n' + text).toLowerCase()
    var scores = { accommodation: 0, rentalCar: 0, restaurant: 0, flight: 0 }
    // Strong vendor / product signals first (avoid ties with weak flight words like "arrival").
    if (/\b(airbnb|booking\.com|vrbo|agoda|expedia|hotels\.com|hostelworld|super\.com|snaptravel)\b/.test(blob)) scores.accommodation += 8
    if (/\b(hotel|motel|hostel|cabin|resort|inn|apartment|villa|lodge|accommodation|property)\b/.test(blob)) scores.accommodation += 3
    if (/\bcheck-?\s*in\b/.test(blob) && /\bcheck-?\s*out\b|\bcheckout\b/.test(blob)) scores.accommodation += 4
    else if (/\b(check-?\s*in|check-?\s*out|checkout|stay\s+at)\b/.test(blob)) scores.accommodation += 2
    if (/booking\.com\/hotel\//i.test(subject + '\n' + text)) scores.accommodation += 6
    if (/airbnb\.[^/\s]+\/rooms\//i.test(subject + '\n' + text)) scores.accommodation += 6

    if (/\b(flight|boarding\s*pass|e-?ticket|airline|gate\s*\d+)\b/.test(blob)) scores.flight += 3
    if (/\b(depart(?:ure|s|ing)|outbound\s+flight|arrives?\s+at|arrival\s+(?:time|airport|terminal|gate))\b/.test(blob)) scores.flight += 2
    if (/\b([A-Z]{3})\s*(?:→|->|to)\s*([A-Z]{3})\b/.test(subject + '\n' + text)) scores.flight += 4
    if (/\b(qantas|jetstar|air\s*nz|united|delta|emirates|qatar|virgin\s*australia)\b/.test(blob)) scores.flight += 3

    if (/\b(rental\s*car|car\s*hire)\b/.test(blob)) scores.rentalCar += 3
    if (/\b(pick-?\s*up|drop-?\s*off)\b/.test(blob) && /\b(car|vehicle|rental)\b/.test(blob)) scores.rentalCar += 3
    if (/\b(hertz|avis|enterprise|budget|sixt|europcar|thrifty)\b/.test(blob)) scores.rentalCar += 4

    if (/\b(opentable|table\s*for|restaurant\s+reservation)\b/.test(blob)) scores.restaurant += 4
    else if (/\b(restaurant|dinner|lunch)\b/.test(blob) && !/\b(hotel|airbnb|booking\.com|cabin)\b/.test(blob)) scores.restaurant += 2

    // Prefer lodging when both check-in/out exist even if a weak flight word appeared.
    if (scores.accommodation >= 4 && scores.flight > 0 && scores.flight <= scores.accommodation) {
      scores.flight = Math.max(0, scores.flight - 3)
    }

    var best = 'unknown'
    var bestScore = 0
    var order = ['accommodation', 'rentalCar', 'restaurant', 'flight']
    for (var i = 0; i < order.length; i++) {
      var k = order[i]
      if (scores[k] > bestScore) { best = k; bestScore = scores[k] }
    }
    if (bestScore < 2) return { kind: 'unknown', score: bestScore }
    return { kind: best, score: bestScore }
  }
  function parseEmail(subjectRaw, textRaw, htmlRaw, photoHint) {
    var subject = norm(decodeRfc2047(subjectRaw))
    var text = unwrapQuoted(norm(maybeDecodeBase64(textRaw)))
    var html = String(htmlRaw || '')
    if (!text && html) {
      text = unwrapQuoted(norm(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')))
    }
    var blob = subject + '\n' + text
    var yearHint = first(blob, /\b(20\d{2})\b/)
    var scored = scoreKind(text, subject)
    var kind = scored.kind
    var confirmation = first(blob, /confirmation\s*(?:number|#|no\.?|code)\s*[:#]\s*([A-Z0-9_-]{4,24})\b/i)
      || first(blob, /(?:booking\s*(?:ref(?:erence)?|id)|record\s*locator|PNR|itinerary\s*(?:number|#))\s*[:#]?\s*([A-Z0-9_-]{5,24})\b/i)
      || first(blob, /\b(?:conf(?:irmation)?|ref(?:erence)?)\s*[:#]\s*([A-Z0-9_-]{5,24})\b/i)
      || first(blob, /reservation-details\/(?:[^/\s?"']+\/){2,}([A-Z0-9]{8,16})(?:[?/"'\s]|$)/i)
      || first(blob, /(?:confirmation|booking)[=/]([A-Z0-9_-]{6,24})/i)
    if (confirmation && /^(number|code|details|online|here|confirmation|booking|reservation)$/i.test(confirmation)) confirmation = ''

    // Vendor-agnostic money: total, paid so far, remaining/next charge.
    // Prefer explicit totals; avoid cancellation-fee lines ("until …: AUD 0").
    var price = moneyAfterLabel(blob, /total\s*cost/i)
      || moneyAfterLabel(blob, /total\s*scheduled\s*payments?/i)
      || moneyAfterLabel(blob, /total(?:\s*\([A-Z]{3}\))?/i)
      || firstMoney(blob, /(?:grand\s*)?total(?:\s*(?:cost|price|amount))?\s*[:.\t]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
      || firstMoney(blob, /(?:amount|fare|price)\s*[:.]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
    var amountPaid = moneyAfterLabel(blob, /total\s*paid/i)
      || moneyAfterLabel(blob, /(?:amount\s+)?(?:already\s+)?paid(?:\s*(?:to\s+date|so\s+far))?/i)
      || moneyAfterLabel(blob, /paid\s+[A-Za-z]{3}\s+\d{1,2}/i)
      || firstMoney(blob, /(?:paid|payment\s+received)\s*[:.\t]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
    var amountOwing = moneyAfterLabel(blob, /total\s*scheduled\s*payments?/i)
      || moneyAfterLabel(blob, /(?:balance|amount)\s*(?:due|owing|remaining)|(?:remaining|outstanding)\s*(?:balance|amount)|amount\s+still\s+due/i)
      || moneyAfterLabel(blob, /charge\s+on\s+[A-Za-z]{3}\s+\d{1,2}/i)
      || firstMoney(blob, /(?:due|owing|balance|remaining)\s*[:.]?\s*((?:USD|AUD|NZD|EUR|GBP|A\$|NZ\$|\$)\s?[\d,.]+)/i)
    // If still unpaid in full, owing ≈ total when paid is 0/empty.
    if (price && !amountOwing && (!amountPaid || /^[A-Z$]*\s*0(?:\.0+)?$/i.test(amountPaid.replace(/,/g, '')))) {
      amountOwing = price
    }
    if (amountOwing && price && amountOwing === price && amountPaid && !/^[A-Z$]*\s*0(?:\.0+)?$/i.test(amountPaid.replace(/,/g, ''))) {
      // keep both; UI shows paid + owing separately
    }

    var address = extractPropertyAddress(text)
    var photoUrl = extractPhotoFromContent(html, text, photoHint)
    var bookingUrl = extractBookingUrl(text, html)

    var parsed = {
      kind: kind,
      confidence: Math.min(1, (scored.score + (confirmation ? 2 : 0) + (price ? 0.5 : 0) + (address ? 0.5 : 0)) / 8),
      confirmation: confirmation || undefined,
      price: price || undefined,
      amountPaid: amountPaid || undefined,
      amountOwing: amountOwing || undefined,
      address: address || undefined,
      photoUrl: photoUrl || undefined,
      bookingUrl: bookingUrl || undefined,
      notes: subject || undefined,
    }
    if (kind === 'flight' || kind === 'unknown') {
      var route = (subject + '\n' + text).match(/\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/)
      if (route) { parsed.fromIata = route[1]; parsed.toIata = route[2] }
      parsed.airline = first(text, /(?:airline|operated by|carrier)\s*[:.]?\s*([A-Za-z0-9 &.-]{2,40})/i) || first(subject + '\n' + text, /\b(Qantas|Jetstar|Air New Zealand|United|Delta|Emirates|Qatar Airways|Virgin Australia)\b/i) || undefined
      parsed.departDate = normDate(first(text, /(?:depart(?:ure)?|outbound)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.departTime = normTime(first(text, /(?:depart(?:ure)?)\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)) || undefined
      parsed.arriveDate = normDate(first(text, /(?:arriv(?:al|e)|inbound)\s*(?:date)?\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.arriveTime = normTime(first(text, /(?:arriv(?:al|e))\s*(?:time)?\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)) || undefined
    }
    if (kind === 'rentalCar' || kind === 'unknown') {
      parsed.company = first(text, /(?:rental\s*(?:company|provider)|supplier)\s*[:.]?\s*([A-Za-z0-9 &.-]{2,40})/i) || first(text, /\b(Hertz|Avis|Enterprise|Budget|Sixt|Europcar|Thrifty|Dollar)\b/i) || undefined
      var pu = first(text, /(?:pick-?\s*up(?:\s*location)?)\s*[:.]?\s*(.+)$/im)
      if (pu) parsed.pickupLocation = pu.slice(0, 120)
      var dro = first(text, /(?:drop-?\s*off(?:\s*location)?)\s*[:.]?\s*(.+)$/im)
      if (dro) parsed.dropoffLocation = dro.slice(0, 120)
      parsed.pickupDate = normDate(first(text, /(?:pick-?\s*up(?:\s*date)?)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.dropoffDate = normDate(first(text, /(?:drop-?\s*off(?:\s*date)?)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
    }
    if (kind === 'accommodation' || kind === 'unknown') {
      var name = first(subject, /(?:booking\s+)?confirmation\s+for\s+(.+)$/i)
        || first(text, /your\s+booking\s+at\s+(.+?)\s+in\s+[A-Za-z][\w\s'-]*\s+is\s+confirmed/i)
        || first(subject, /(?:confirmation|booking|reservation)\s+at\s+(.+)$/i)
        || first(subject, /confirmed\s+at\s+(.+)$/i)
        || first(text, /\[([^\]]{5,100})\]\(https?:\/\/[^)]*(?:rooms|hotel|property|listing)/i)
        || first(text, /(?:property|hotel|listing|accommodation)\s+name\s*[:.]?\s*(.+)$/im)
        || first(text, /(?:you(?:'|\u2019)?re\s+all\s+set\s+for|welcome\s+to)\s+([^\n<]{3,80}?)(?=\s*(?:\n|http|check-?\s*in|confirmation|pin\b|$))/i)
      if (name) {
        name = name.replace(/\s+/g, ' ').trim()
        if (/(?:%|\boff\b|come back|best deals|find a hotel|download app|through us|versus anywhere)/i.test(name)) name = ''
      }
      if (name) parsed.name = name.slice(0, 120)
      if (!parsed.location) {
        var loc = first(text, /booking\s+in\s+([A-Za-z][A-Za-z'-]*)(?=\s+is\s+confirmed)/i)
          || first(text, /your\s+booking\s+at\s+.+?\s+in\s+([A-Za-z][A-Za-z\s'-]{1,40}?)\s+is\s+confirmed/i)
          || first(text, /you(?:'|)re\s+all\s+set\s+for\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})(?=\s*[.!\n]|$)/i)
          || first(text, /(?:destination|city)\s*[:.]?\s*([A-Za-z][A-Za-z\s-]{2,40})/i)
        if (loc) parsed.location = loc.replace(/\s+/g, ' ').slice(0, 80)
      }
      var dateBit = '([A-Za-z]{3,9},?\\s+\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4}|[A-Za-z]{3},?\\s+[A-Za-z]{3,9}\\s+\\d{1,2}(?:,?\\s*\\d{4})?|\\d{4}[/. -]\\d{1,2}[/. -]\\d{1,2}|\\d{1,2}[/. -]\\d{1,2}[/. -]\\d{4})'
      parsed.checkIn = normDate(first(text, new RegExp('(?:check-?\\s*in)\\b[\\s:>|\\t-]*' + dateBit, 'i')), yearHint) || undefined
      parsed.checkOut = normDate(first(text, new RegExp('(?:check-?\\s*out|checkout)\\b[\\s:>|\\t-]*' + dateBit, 'i')), yearHint) || undefined
      // Prefer start of check-in window; end of check-out window when given as (HH:MM - HH:MM).
      var ciWin = text.match(/(?:check-?\s*in)\b[\s\S]{0,80}?\((\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\)/i)
      var coWin = text.match(/(?:check-?\s*out|checkout)\b[\s\S]{0,80}?\((\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\)/i)
      var ciParen = text.match(/(?:check-?\s*in)\b[^\n]{0,90}\((?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
      var coParen = text.match(/(?:check-?\s*out|checkout)\b[^\n]{0,90}\((\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
      parsed.checkInTime = normTime(ciWin ? ciWin[1] : (ciParen ? ciParen[1] : first(text, /(?:check-?\s*in)\b[\s\S]{0,100}?(?:after|from|at)?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i))) || undefined
      parsed.checkOutTime = normTime(coWin ? coWin[2] : (coParen ? coParen[1] : first(text, /(?:check-?\s*out|checkout)\b[\s\S]{0,100}?(?:by|before|until|at)?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i))) || undefined
    }
    if (kind === 'restaurant') {
      var rname = first(text, /(?:restaurant|venue|dining)\s*[:.]?\s*(.+)$/im) || first(subject, /(?:reservation|table)\s*(?:at|for|:)\s*(.+)$/i)
      if (rname) parsed.name = rname.slice(0, 120)
      parsed.reservationDate = normDate(first(text, /(?:date|reservation)\s*[:.]?\s*([A-Za-z0-9,/\-. ]{6,30})/i), yearHint) || undefined
      parsed.reservationTime = normTime(first(text, /(?:time)\s*[:.]?\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)) || undefined
    }
    parsed.kind = kind
    return parsed
  }

  function extractAddress(value) {
    var s = String(value || '')
    var m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    return m ? m[0].toLowerCase() : ''
  }
  function splitEmails(value) {
    return String(value || '')
      .toLowerCase()
      .split(/[,;\s]+/)
      .map(function (s) { return s.trim() })
      .filter(function (s) { return s.indexOf('@') > 0 })
  }
  function findUser(app, body) {
    var to = String(body.to || body.recipient || '')
    var plus = to.match(/\+([a-z0-9]{10,20})@/i)
    if (plus) {
      try { return app.findRecordById('users', plus[1]) } catch (ignore) {}
    }
    var from = extractAddress(body.from || body.sender || '')
    if (from) {
      var safe = from.replace(/"/g, '')
      // Exact single-value match (legacy)
      try { return app.findFirstRecordByFilter('users', 'booking_from_email="' + safe + '"') } catch (ignorePref) {}
      // Comma/space-separated aliases: "a@x.com, b@y.com"
      try {
        var rows = app.findRecordsByFilter('users', 'booking_from_email != ""', '-created', 200, 0)
        for (var i = 0; i < rows.length; i++) {
          var aliases = splitEmails(rows[i].get('booking_from_email'))
          if (aliases.indexOf(safe) >= 0) return rows[i]
        }
      } catch (ignoreList) {}
      try { return app.findFirstRecordByFilter('users', 'email="' + safe + '"') } catch (ignore2) {}
    }
    return null
  }
  function saveImport(app, user, body, parsed) {
    var col = app.findCollectionByNameOrId('booking_imports')
    var messageId = String(body.messageId || body.message_id || '').trim()
    if (messageId) {
      try {
        var existing = app.findFirstRecordByFilter('booking_imports', 'message_id="' + messageId.replace(/"/g, '') + '"')
        if (existing) return existing
      } catch (ignore) {}
    }
    var rec = new Record(col)
    rec.set('user', user.id)
    rec.set('status', 'pending')
    rec.set('kind', parsed.kind || 'unknown')
    rec.set('from_email', extractAddress(body.from || body.sender || ''))
    rec.set('subject', decodeRfc2047(String(body.subject || '')).slice(0, 300))
    rec.set('trip_id', String(body.tripId || body.trip_id || ''))
    rec.set('parsed', parsed)
    rec.set('raw_text', unwrapQuoted(norm(maybeDecodeBase64(String(body.text || '')))).slice(0, 100000))
    rec.set('error', '')
    rec.set('message_id', messageId)
    app.save(rec)
    return rec
  }

  try {
    var auth = e.auth
    if (!auth) {
      try {
        var info = e.requestInfo()
        var token = String((info.headers || {})['authorization'] || '').replace(/^Bearer\s+/i, '')
        if (token) auth = e.app.findAuthRecordByToken(token, 'users')
      } catch (ignore) {}
    }
    if (!auth) return e.json(401, { message: 'Authentication required', status: 401 })

    var body = e.requestInfo().body || {}
    var parsed = ensurePhotoUrl(parseEmail(body.subject, body.text, body.html, body.photoUrl || body.photo_url))
    var wrapped = {
      from: auth.get('email') || '',
      subject: body.subject || 'Pasted confirmation',
      text: body.text || '',
      html: body.html || '',
      messageId: body.messageId || '',
      tripId: body.tripId || '',
    }
    var rec = saveImport(e.app, auth, wrapped, parsed)
    return e.json(200, {
      ok: true,
      id: rec.id,
      kind: rec.get('kind'),
      status: rec.get('status'),
      parsed: parsed,
    })
  } catch (err) {
    console.log('[waypoint] email-paste error ' + err)
    return e.json(400, {
      message: String(err && err.message ? err.message : err),
      status: 400,
    })
  }
})

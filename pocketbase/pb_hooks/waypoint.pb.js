// Waypoint place APIs (PocketBase 0.25+: $http.send returns { json, raw, statusCode, headers }).
// Keep helpers inside each route — file-level bindings are not visible to router callbacks.

routerAdd('GET', '/api/waypoint/ping', function (e) {
  return e.json(200, { ok: true })
})

function parseJsonField(value) {
  if (value == null) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) || {}
    } catch (err) {
      return {}
    }
  }
  if (typeof value === 'object') return value
  return {}
}

routerAdd('POST', '/api/waypoint/search', function (e) {
  try {
    var NOMINATIM = 'https://nominatim.openstreetmap.org'
    var USER_AGENT = 'WaypointTravelPlanner/1.0 (personal; contact: local-nas)'
    var body = e.requestInfo().body || {}
    var query = String(body.query || '').trim()
    var limit = Math.min(Number(body.limit) || 9, 12)
    if (query.length < 2) return e.json(200, { suggestions: [] })

    var cacheKey = 'search:v2:' + query.toLowerCase()
    try {
      var cached = e.app.findFirstRecordByFilter(
        'place_cache',
        'cache_key="' + cacheKey.replace(/"/g, '') + '"'
      )
      if (cached) {
        var payload = parseJsonField(cached.get('payload'))
        var cachedSuggestions = payload.suggestions || []
        // Never serve a poisoned empty cache — fall through to Nominatim.
        if (Array.isArray(cachedSuggestions) && cachedSuggestions.length > 0) {
          return e.json(200, {
            suggestions: cachedSuggestions,
            cached: true
          })
        }
      }
    } catch (ignore) {}

    var url =
      NOMINATIM +
      '/search?format=jsonv2&addressdetails=1&accept-language=en&limit=' +
      encodeURIComponent(String(limit)) +
      '&q=' +
      encodeURIComponent(query)
    var res = $http.send({
      url: url,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeout: 25
    })
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error('Nominatim search failed (' + res.statusCode + ')')
    }

    var hits = res.json
    if (!Array.isArray(hits)) {
      try {
        hits = JSON.parse(res.raw || '[]')
      } catch (parseErr) {
        hits = []
      }
    }

    var suggestions = []
    for (var i = 0; i < hits.length; i++) {
      var item = hits[i]
      var lat = Number(item.lat)
      var lon = Number(item.lon)
      var label = String(item.display_name || item.name || '').trim()
      if (!label) continue
      var addr = item.address && typeof item.address === 'object' ? item.address : {}
      var placeName = String(
        item.name ||
          addr.city ||
          addr.town ||
          addr.village ||
          addr.hamlet ||
          addr.municipality ||
          addr.suburb ||
          addr.county ||
          ''
      ).trim()
      if (!placeName) {
        placeName = label.split(',')[0].trim()
      }
      var country = String(addr.country || '').trim()
      var countryCode = String(addr.country_code || '').trim().toLowerCase()
      if (!country) {
        var labelParts = label.split(',').map(function (p) {
          return p.trim()
        })
        if (labelParts.length > 1) country = labelParts[labelParts.length - 1]
      }
      var regionBits = []
      ;[
        addr.suburb,
        addr.city_district,
        addr.district,
        addr.county,
        addr.state_district,
        addr.state,
        addr.region
      ].forEach(function (bit) {
        var t = String(bit || '').trim()
        if (!t) return
        if (t === placeName || t === country) return
        if (regionBits.indexOf(t) >= 0) return
        regionBits.push(t)
      })
      if (regionBits.length === 0) {
        var mid = label
          .split(',')
          .map(function (p) {
            return p.trim()
          })
          .slice(1, -1)
          .filter(Boolean)
        regionBits = mid
      }
      var s = {
        key: String(item.place_id || item.osm_id || lat + ',' + lon + ',' + i),
        label: label,
        name: placeName
      }
      if (country) s.country = country
      if (countryCode) s.countryCode = countryCode
      if (regionBits.length > 0) s.region = regionBits.join(', ')
      if (!isNaN(lat) && isFinite(lat)) s.lat = lat
      if (!isNaN(lon) && isFinite(lon)) s.lon = lon
      if (s.lat != null && s.lon != null) {
        s.googleMapsUri =
          'https://www.openstreetmap.org/?mlat=' +
          s.lat +
          '&mlon=' +
          s.lon +
          '#map=14/' +
          s.lat +
          '/' +
          s.lon
      }
      var cat = item.type || item['class']
      if (cat) s.category = cat
      if (item.type) s.primaryType = item.type
      suggestions.push(s)
    }

    // Only cache successful non-empty results.
    if (suggestions.length > 0) {
      try {
        var col = e.app.findCollectionByNameOrId('place_cache')
        var rec
        try {
          rec = e.app.findFirstRecordByFilter(
            'place_cache',
            'cache_key="' + cacheKey.replace(/"/g, '') + '"'
          )
        } catch (ignore2) {
          rec = new Record(col)
        }
        rec.set('cache_key', cacheKey)
        rec.set('kind', 'search')
        rec.set('payload', { suggestions: suggestions })
        rec.set('source', 'nominatim')
        rec.set('fetched_at', new Date().toISOString())
        rec.set('ttl_days', 180)
        e.app.save(rec)
      } catch (cacheErr) {
        console.log('[waypoint] cache save failed ' + cacheErr)
      }
    }

    return e.json(200, { suggestions: suggestions, cached: false })
  } catch (err) {
    console.log('[waypoint] search error ' + err)
    return e.json(400, {
      data: {},
      message: String(err && err.message ? err.message : err),
      status: 400
    })
  }
})

routerAdd('POST', '/api/waypoint/geocode', function (e) {
  try {
    var NOMINATIM = 'https://nominatim.openstreetmap.org'
    var USER_AGENT = 'WaypointTravelPlanner/1.0 (personal; contact: local-nas)'
    var body = e.requestInfo().body || {}
    var query = String(body.query || '').trim()
    if (!query) return e.json(200, { result: null })

    var cacheKey = 'geocode:v1:' + query.toLowerCase()
    try {
      var cached = e.app.findFirstRecordByFilter(
        'place_cache',
        'cache_key="' + cacheKey.replace(/"/g, '') + '"'
      )
      if (cached) {
        var payload = parseJsonField(cached.get('payload'))
        if (payload.result) {
          return e.json(200, { result: payload.result, cached: true })
        }
      }
    } catch (ignore) {}

    var url =
      NOMINATIM +
      '/search?format=jsonv2&addressdetails=0&accept-language=en&limit=1&q=' +
      encodeURIComponent(query)
    var res = $http.send({
      url: url,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeout: 25
    })
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error('Nominatim geocode failed (' + res.statusCode + ')')
    }
    var hits = Array.isArray(res.json) ? res.json : []
    var result = null
    if (hits.length) {
      var lat = Number(hits[0].lat)
      var lon = Number(hits[0].lon)
      var label = String(hits[0].display_name || hits[0].name || '').trim()
      if (!isNaN(lat) && isFinite(lat) && !isNaN(lon) && isFinite(lon)) {
        result = { lat: lat, lon: lon, label: label }
      }
    }

    if (result) {
      try {
        var col = e.app.findCollectionByNameOrId('place_cache')
        var rec
        try {
          rec = e.app.findFirstRecordByFilter(
            'place_cache',
            'cache_key="' + cacheKey.replace(/"/g, '') + '"'
          )
        } catch (ignore2) {
          rec = new Record(col)
        }
        rec.set('cache_key', cacheKey)
        rec.set('kind', 'geocode')
        rec.set('payload', { result: result })
        rec.set('source', 'nominatim')
        rec.set('fetched_at', new Date().toISOString())
        rec.set('ttl_days', 180)
        e.app.save(rec)
      } catch (cacheErr) {
        console.log('[waypoint] geocode cache failed ' + cacheErr)
      }
    }

    return e.json(200, { result: result, cached: false })
  } catch (err) {
    console.log('[waypoint] geocode error ' + err)
    return e.json(400, {
      data: {},
      message: String(err && err.message ? err.message : err),
      status: 400
    })
  }
})

routerAdd('GET', '/api/waypoint/recommendations', function (e) {
  try {
    var key = String((e.requestInfo().query || {}).key || '').trim()
    if (!key) {
      return e.json(400, { data: {}, message: 'Missing key', status: 400 })
    }
    var cached = null
    try {
      cached = e.app.findFirstRecordByFilter(
        'place_cache',
        'cache_key="' + key.replace(/"/g, '') + '"'
      )
    } catch (ignore) {}
    if (!cached) return e.json(404, { suggestions: [], fetchedAt: null, source: null })
    var payload = parseJsonField(cached.get('payload'))
    return e.json(200, {
      suggestions: payload.suggestions || [],
      fetchedAt: cached.get('fetched_at') || null,
      source: cached.get('source') || null
    })
  } catch (err) {
    console.log('[waypoint] recs error ' + err)
    return e.json(400, {
      data: {},
      message: String(err && err.message ? err.message : err),
      status: 400
    })
  }
})

routerAdd('POST', '/api/waypoint/recommendations/refresh', function (e) {
  try {
    var NOMINATIM = 'https://nominatim.openstreetmap.org'
    var OVERPASS = 'https://overpass-api.de/api/interpreter'
    var USER_AGENT = 'WaypointTravelPlanner/1.0 (personal; contact: local-nas)'
    var body = e.requestInfo().body || {}
    var cacheKey = String(body.cacheKey || '').trim()
    var country = String(body.country || '').trim()
    var seeds = []
    if (Array.isArray(body.seeds)) {
      for (var i = 0; i < body.seeds.length && seeds.length < 4; i++) {
        var s = String(body.seeds[i] || '').trim()
        if (s) seeds.push(s)
      }
    }
    if (!cacheKey) throw new Error('Missing cacheKey')
    if (seeds.length === 0 && country) seeds = [country]
    if (seeds.length === 0) throw new Error('No seeds')

    function geocodeOne(q) {
      var url =
        NOMINATIM +
        '/search?format=jsonv2&addressdetails=0&limit=1&q=' +
        encodeURIComponent(q)
      var res = $http.send({
        url: url,
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: 25
      })
      if (res.statusCode < 200 || res.statusCode >= 300) return null
      var hits = Array.isArray(res.json) ? res.json : []
      if (!hits.length) return null
      var lat = Number(hits[0].lat)
      var lon = Number(hits[0].lon)
      if (isNaN(lat) || !isFinite(lat) || isNaN(lon) || !isFinite(lon)) return null
      return { lat: lat, lon: lon, label: String(hits[0].display_name || '') }
    }

    function overpassAround(lat, lon, radiusM) {
      var q =
        '[out:json][timeout:25];(' +
        'node["tourism"~"attraction|museum|viewpoint|zoo|theme_park|artwork"](around:' +
        radiusM + ',' + lat + ',' + lon + ');' +
        'node["leisure"~"park|nature_reserve"](around:' +
        radiusM + ',' + lat + ',' + lon + ');' +
        'node["amenity"~"restaurant|cafe|place_of_worship"](around:' +
        Math.min(radiusM, 8000) + ',' + lat + ',' + lon + ');' +
        ');out body 50;'
      var res = $http.send({
        url: OVERPASS,
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'data=' + encodeURIComponent(q),
        timeout: 45
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error('Overpass failed (' + res.statusCode + ')')
      }
      var data = res.json && typeof res.json === 'object' ? res.json : {}
      var elements = Array.isArray(data.elements) ? data.elements : []
      var out = []
      var seen = {}
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i]
        var tags = el.tags || {}
        var name = String(tags.name || '').trim()
        if (!name) continue
        var k = name.toLowerCase()
        if (seen[k]) continue
        seen[k] = 1
        var plat = Number(el.lat)
        var plon = Number(el.lon)
        var kind = tags.tourism || tags.leisure || tags.amenity || 'place'
        var row = {
          key: 'osm:' + (el.type || 'node') + ':' + el.id,
          label: name,
          category: kind,
          primaryType: kind,
          types: [kind]
        }
        if (!isNaN(plat) && isFinite(plat)) row.lat = plat
        if (!isNaN(plon) && isFinite(plon)) row.lon = plon
        if (row.lat != null && row.lon != null) {
          row.googleMapsUri =
            'https://www.openstreetmap.org/?mlat=' +
            row.lat +
            '&mlon=' +
            row.lon +
            '#map=14/' +
            row.lat +
            '/' +
            row.lon
        }
        out.push(row)
        if (out.length >= 24) break
      }
      return out
    }

    var suggestions = []
    var seen = {}
    for (var i2 = 0; i2 < seeds.length; i2++) {
      var seed = country ? seeds[i2] + ', ' + country : seeds[i2]
      var geo = geocodeOne(seed)
      if (!geo) continue
      var pois = overpassAround(geo.lat, geo.lon, 15000)
      for (var j = 0; j < pois.length; j++) {
        var p = pois[j]
        var kk = p.label.toLowerCase()
        if (seen[kk]) continue
        seen[kk] = 1
        p.seedLabel = seeds[i2]
        suggestions.push(p)
      }
    }

    var fetchedAt = new Date().toISOString()
    try {
      var col = e.app.findCollectionByNameOrId('place_cache')
      var rec
      try {
        rec = e.app.findFirstRecordByFilter(
          'place_cache',
          'cache_key="' + cacheKey.replace(/"/g, '') + '"'
        )
      } catch (ignore2) {
        rec = new Record(col)
      }
      rec.set('cache_key', cacheKey)
      rec.set('kind', 'recs')
      rec.set('payload', { suggestions: suggestions })
      rec.set('source', 'overpass')
      rec.set('fetched_at', fetchedAt)
      rec.set('ttl_days', 180)
      e.app.save(rec)
    } catch (cacheErr) {
      console.log('[waypoint] recs cache failed ' + cacheErr)
    }

    return e.json(200, { suggestions: suggestions, fetchedAt: fetchedAt, source: 'overpass' })
  } catch (err) {
    console.log('[waypoint] refresh error ' + err)
    return e.json(400, {
      data: {},
      message: String(err && err.message ? err.message : err),
      status: 400
    })
  }
})

/**
 * AeroDataBox via RapidAPI — published schedule/status by flight number + local date.
 * Env: AERODATABOX_RAPIDAPI_KEY (Basic $0 plan is fine for household use; show attribution).
 */
routerAdd('POST', '/api/waypoint/flights/lookup', function (e) {
  try {
    var apiKey = ''
    try {
      apiKey = String($os.getenv('AERODATABOX_RAPIDAPI_KEY') || '').trim()
    } catch (ignore) {
      apiKey = ''
    }
    if (!apiKey) {
      return e.json(503, {
        message: 'AERODATABOX_RAPIDAPI_KEY is not configured on PocketBase',
        status: 503
      })
    }

    var body = e.requestInfo().body || {}
    var airlineIata = String(body.airlineIata || '')
      .trim()
      .toUpperCase()
    var flightNumber = String(body.flightNumber || '')
      .trim()
      .replace(/\s+/g, '')
    var date = String(body.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return e.json(400, { message: 'date must be YYYY-MM-DD', status: 400 })
    }

    var numOnly = String(flightNumber).replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    // Strip leading IATA only when it contains a letter (NZ248 / U2…); never "248" → "8".
    if (airlineIata && numOnly.indexOf(airlineIata) === 0 && numOnly.length > airlineIata.length) {
      numOnly = numOnly.slice(airlineIata.length)
    } else if (/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d/.test(numOnly)) {
      if (!airlineIata) airlineIata = numOnly.slice(0, 2)
      numOnly = numOnly.slice(2)
    }
    if (!airlineIata || !/^\d{1,4}[A-Z]?$/.test(numOnly)) {
      return e.json(400, {
        message: 'Provide airline IATA and flight number (e.g. NZ + 248)',
        status: 400
      })
    }

    var combined = airlineIata + numOnly
    var url =
      'https://aerodatabox.p.rapidapi.com/flights/Number/' +
      encodeURIComponent(combined) +
      '/' +
      encodeURIComponent(date) +
      '?dateLocalRole=Departure&withAircraftImage=false&withLocation=false'

    var res = $http.send({
      url: url,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com'
      },
      timeout: 30
    })

    if (res.statusCode === 204 || res.statusCode === 404) {
      return e.json(200, {
        flight: null,
        message: 'No schedule found for that flight/date — enter details from your booking'
      })
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      var errMsg = 'AeroDataBox lookup failed (' + res.statusCode + ')'
      try {
        var errBody = res.json
        if (errBody && errBody.message) errMsg = String(errBody.message)
      } catch (ignore2) {}
      throw new Error(errMsg)
    }

    var rows = res.json
    if (!Array.isArray(rows)) {
      try {
        rows = JSON.parse(res.raw || '[]')
      } catch (parseErr) {
        rows = []
      }
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return e.json(200, {
        flight: null,
        message: 'No schedule found for that flight/date — enter details from your booking'
      })
    }

    function localTimeString(block) {
      if (!block || typeof block !== 'object') return ''
      // New shape: { scheduledTime: { local: "2026-11-30 18:15+11:00", utc: "..." } }
      var st = block.scheduledTime
      if (st && typeof st === 'object' && st.local) return String(st.local)
      if (typeof st === 'string') return st
      if (block.scheduledTimeLocal) return String(block.scheduledTimeLocal)
      if (block.predictedTime && typeof block.predictedTime === 'object' && block.predictedTime.local) {
        return String(block.predictedTime.local)
      }
      return ''
    }

    var pick = rows[0]
    for (var i = 0; i < rows.length; i++) {
      var dep = rows[i] && rows[i].departure
      var local = localTimeString(dep)
      if (local && String(local).indexOf(date) === 0) {
        pick = rows[i]
        break
      }
    }

    function parseLocal(ts) {
      // "2026-11-30 18:15+11:00" or "2026-11-30 18:15"
      var s = String(ts || '').trim()
      var m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/)
      if (!m) return { date: '', time: '' }
      return { date: m[1], time: m[2] + ':' + m[3] }
    }

    function iata3(airport) {
      if (!airport) return ''
      var iata = String(airport.iata || '')
        .trim()
        .toUpperCase()
      if (/^[A-Z]{3}$/.test(iata)) return iata
      return ''
    }

    var departure = pick.departure || {}
    var arrival = pick.arrival || {}
    var depAirport = departure.airport || {}
    var arrAirport = arrival.airport || {}
    var depParsed = parseLocal(localTimeString(departure))
    var arrParsed = parseLocal(localTimeString(arrival))
    var airlineObj = pick.airline || {}
    var airlineName = String(airlineObj.name || airlineObj.iata || airlineIata || '').trim()
    var airlineCode = String(airlineObj.iata || airlineIata || '')
      .trim()
      .toUpperCase()
    var respNum = String(pick.number || combined)
      .replace(/\s+/g, '')
      .toUpperCase()
    var respDigits = respNum
    if (airlineCode && respDigits.indexOf(airlineCode) === 0) {
      respDigits = respDigits.slice(airlineCode.length)
    } else if (/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d/.test(respDigits)) {
      respDigits = respDigits.slice(2)
    }

    var distanceKm = null
    if (pick.greatCircleDistance && typeof pick.greatCircleDistance.km === 'number') {
      distanceKm = Math.round(pick.greatCircleDistance.km)
    } else if (typeof pick.greatCircleDistanceInKm === 'number') {
      distanceKm = Math.round(pick.greatCircleDistanceInKm)
    }

    var durationMin = null
    if (typeof pick.flightTime === 'number') {
      durationMin = Math.round(pick.flightTime)
    } else if (depParsed.date && depParsed.time && arrParsed.date && arrParsed.time) {
      try {
        var depMs = Date.parse(depParsed.date + 'T' + depParsed.time + ':00Z')
        var arrMs = Date.parse(arrParsed.date + 'T' + arrParsed.time + ':00Z')
        // Local wall clocks without offsets — duration only as rough fallback
        if (!isNaN(depMs) && !isNaN(arrMs)) {
          var mins = Math.round((arrMs - depMs) / 60000)
          if (mins < 0) mins += 24 * 60
          if (mins > 0 && mins < 24 * 60) durationMin = mins
        }
      } catch (ignore3) {}
    }

    return e.json(200, {
      flight: {
        airline: airlineName,
        airlineIata: airlineCode,
        flightNumber: respDigits || numOnly,
        fromIata: iata3(depAirport),
        toIata: iata3(arrAirport),
        fromLabel: String(depAirport.name || depAirport.municipalityName || depAirport.iata || '').trim(),
        toLabel: String(arrAirport.name || arrAirport.municipalityName || arrAirport.iata || '').trim(),
        departDate: depParsed.date || date,
        departTime: depParsed.time,
        arriveDate: arrParsed.date || depParsed.date || date,
        arriveTime: arrParsed.time,
        departTerminal: String(departure.terminal || '').trim(),
        arriveTerminal: String(arrival.terminal || '').trim(),
        durationMin: durationMin,
        distanceKm: distanceKm,
        attribution: 'AeroDataBox'
      }
    })
  } catch (err) {
    console.log('[waypoint] flights/lookup error ' + err)
    return e.json(400, {
      data: {},
      message: String(err && err.message ? err.message : err),
      status: 400
    })
  }
})

// Waypoint place APIs (PocketBase 0.25+: $http.send returns { json, raw, statusCode, headers }).
// Keep helpers inside each route — file-level bindings are not visible to router callbacks.

routerAdd('GET', '/api/waypoint/ping', function (e) {
  return e.json(200, { ok: true })
})

routerAdd('POST', '/api/waypoint/search', function (e) {
  try {
    var NOMINATIM = 'https://nominatim.openstreetmap.org'
    var USER_AGENT = 'WaypointTravelPlanner/1.0 (personal; contact: local-nas)'
    var body = e.requestInfo().body || {}
    var query = String(body.query || '').trim()
    var limit = Math.min(Number(body.limit) || 9, 12)
    if (query.length < 2) return e.json(200, { suggestions: [] })

    var cacheKey = 'search:v1:' + query.toLowerCase()
    try {
      var cached = e.app.findFirstRecordByFilter(
        'place_cache',
        'cache_key="' + cacheKey.replace(/"/g, '') + '"'
      )
      if (cached) {
        var payload = cached.get('payload') || {}
        return e.json(200, {
          suggestions: payload.suggestions || [],
          cached: true
        })
      }
    } catch (ignore) {}

    var url =
      NOMINATIM +
      '/search?format=jsonv2&addressdetails=0&limit=' +
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
      var s = {
        key: String(item.place_id || item.osm_id || lat + ',' + lon + ',' + i),
        label: label
      }
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
        var payload = cached.get('payload') || {}
        return e.json(200, { result: payload.result || null, cached: true })
      }
    } catch (ignore) {}

    var url =
      NOMINATIM +
      '/search?format=jsonv2&addressdetails=0&limit=1&q=' +
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
    var payload = cached.get('payload') || {}
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

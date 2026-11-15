// Collapse same-place overlapping stays on user_trips writes (recovery merges
// can invent new ids for the same stop; clients may keep re-saving them).

onRecordCreate(function (e) {
  try {
    var payload = e.record.get('payload')
    var cleaned = (function dedupePayload(payload) {
      function stayLoc(s) {
        var loc = s && s.location
        if (typeof loc === 'string') return loc.trim().toLowerCase()
        if (loc && typeof loc === 'object' && loc.name) return String(loc.name).trim().toLowerCase()
        return ''
      }
      function overlaps(a, b) {
        var la = stayLoc(a)
        var lb = stayLoc(b)
        if (!la || !lb || la !== lb) return false
        var a0 = a.startDate || ''
        var a1 = a.endDate || a0
        var b0 = b.startDate || ''
        var b1 = b.endDate || b0
        if (!a0 || !b0) return false
        return a0 < b1 && b0 < a1
      }
      function dedupeStays(stays) {
        if (!Array.isArray(stays)) return stays
        var out = []
        var seenIds = {}
        for (var i = 0; i < stays.length; i++) {
          var s = stays[i]
          if (!s || typeof s !== 'object') continue
          if (s.id && seenIds[s.id]) continue
          var dup = false
          for (var j = 0; j < out.length; j++) {
            if (overlaps(out[j], s)) { dup = true; break }
          }
          if (dup) continue
          if (s.id) seenIds[s.id] = true
          out.push(s)
        }
        return out
      }
      if (!payload || typeof payload !== 'object') return payload
      var trips = payload.trips
      if (!Array.isArray(trips)) return payload
      var changed = false
      var nextTrips = []
      for (var i = 0; i < trips.length; i++) {
        var t = trips[i]
        if (!t || typeof t !== 'object') { nextTrips.push(t); continue }
        var before = Array.isArray(t.stays) ? t.stays.length : 0
        var stays = dedupeStays(t.stays)
        if (stays.length !== before) changed = true
        var copy = {}
        for (var k in t) copy[k] = t[k]
        copy.stays = stays
        nextTrips.push(copy)
      }
      if (!changed) return payload
      var out = {}
      for (var k2 in payload) out[k2] = payload[k2]
      out.trips = nextTrips
      return out
    })(payload)
    if (cleaned !== payload) e.record.set('payload', cleaned)
  } catch (err) {
    console.log('[waypoint] user_trips dedupe create: ' + err)
  }
  e.next()
}, 'user_trips')

onRecordUpdate(function (e) {
  try {
    var payload = e.record.get('payload')
    var cleaned = (function dedupePayload(payload) {
      function stayLoc(s) {
        var loc = s && s.location
        if (typeof loc === 'string') return loc.trim().toLowerCase()
        if (loc && typeof loc === 'object' && loc.name) return String(loc.name).trim().toLowerCase()
        return ''
      }
      function overlaps(a, b) {
        var la = stayLoc(a)
        var lb = stayLoc(b)
        if (!la || !lb || la !== lb) return false
        var a0 = a.startDate || ''
        var a1 = a.endDate || a0
        var b0 = b.startDate || ''
        var b1 = b.endDate || b0
        if (!a0 || !b0) return false
        return a0 < b1 && b0 < a1
      }
      function dedupeStays(stays) {
        if (!Array.isArray(stays)) return stays
        var out = []
        var seenIds = {}
        for (var i = 0; i < stays.length; i++) {
          var s = stays[i]
          if (!s || typeof s !== 'object') continue
          if (s.id && seenIds[s.id]) continue
          var dup = false
          for (var j = 0; j < out.length; j++) {
            if (overlaps(out[j], s)) { dup = true; break }
          }
          if (dup) continue
          if (s.id) seenIds[s.id] = true
          out.push(s)
        }
        return out
      }
      if (!payload || typeof payload !== 'object') return payload
      var trips = payload.trips
      if (!Array.isArray(trips)) return payload
      var changed = false
      var nextTrips = []
      for (var i = 0; i < trips.length; i++) {
        var t = trips[i]
        if (!t || typeof t !== 'object') { nextTrips.push(t); continue }
        var before = Array.isArray(t.stays) ? t.stays.length : 0
        var stays = dedupeStays(t.stays)
        if (stays.length !== before) changed = true
        var copy = {}
        for (var k in t) copy[k] = t[k]
        copy.stays = stays
        nextTrips.push(copy)
      }
      if (!changed) return payload
      var out = {}
      for (var k2 in payload) out[k2] = payload[k2]
      out.trips = nextTrips
      return out
    })(payload)
    if (cleaned !== payload) e.record.set('payload', cleaned)
  } catch (err) {
    console.log('[waypoint] user_trips dedupe update: ' + err)
  }
  e.next()
}, 'user_trips')

import { normalizeEmail } from './auth'
import { getSupabase } from './supabaseClient'
import type { Trip, TripsState } from './tripTypes'
import { stripSharingFromTrip } from './tripTypes'
import { parseSingleTripFromUnknown, parseTripsFromUnknown } from './tripStorage'

export async function fetchUserTripsState(): Promise<TripsState> {
  const supabase = getSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { trips: [], selectedTripId: null }

  const { data, error } = await supabase.from('user_trips').select('payload').eq('user_id', user.id).maybeSingle()

  if (error || data == null || data.payload == null) return { trips: [], selectedTripId: null }
  return parseTripsFromUnknown(data.payload as unknown)
}

type SharedItineraryRow = {
  id: string
  source_trip_id: string
  trip_json: unknown
  owner_user_id: string
  default_permission: string
  revoked_at?: string | null
}

type MemberRow = {
  role: string
  shared_itinerary_id: string
  shared_itineraries: SharedItineraryRow | SharedItineraryRow[] | null
}

function mergePersonalAndShared(
  personal: TripsState,
  ownedRows: SharedItineraryRow[],
  memberRows: MemberRow[],
  preferredSelectedId: string | null,
): TripsState {
  const ownedSourceIds = new Set(ownedRows.map((r) => r.source_trip_id))
  const personalTripsFiltered = personal.trips.filter((t) => !ownedSourceIds.has(t.id))

  const fromShared: Trip[] = []

  for (const row of ownedRows) {
    const parsed = parseSingleTripFromUnknown(row.trip_json)
    if (!parsed) continue
    fromShared.push({
      ...parsed,
      sharing: {
        sharedItineraryId: row.id,
        sourceTripId: row.source_trip_id,
        role: 'owner',
      },
    })
  }

  for (const row of memberRows) {
    const si = row.shared_itineraries
    const share = Array.isArray(si) ? si[0] : si
    if (!share || share.owner_user_id == null) continue
    if (share.revoked_at != null) continue
    const r = row.role === 'viewer' || row.role === 'editor' ? row.role : 'viewer'
    const parsed = parseSingleTripFromUnknown(share.trip_json)
    if (!parsed) continue
    fromShared.push({
      ...parsed,
      sharing: {
        sharedItineraryId: share.id,
        sourceTripId: share.source_trip_id,
        role: r,
      },
    })
  }

  const trips = [...fromShared, ...personalTripsFiltered]
  const pick =
    preferredSelectedId && trips.some((t) => t.id === preferredSelectedId)
      ? preferredSelectedId
      : personal.selectedTripId && trips.some((t) => t.id === personal.selectedTripId)
        ? personal.selectedTripId
        : trips[0]?.id ?? null

  return { trips, selectedTripId: pick }
}

/** Load `user_trips` plus shared rows and merge (Supabase accounts). */
export async function fetchMergedTripsState(): Promise<TripsState> {
  const supabase = getSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { trips: [], selectedTripId: null }

  const [{ data: ut, error: utError }, { data: owned, error: ownedError }, { data: members, error: memError }] =
    await Promise.all([
      supabase.from('user_trips').select('payload').eq('user_id', user.id).maybeSingle(),
      supabase
        .from('shared_itineraries')
        .select('id, source_trip_id, trip_json, owner_user_id, default_permission, revoked_at')
        .eq('owner_user_id', user.id)
        .is('revoked_at', null),
      supabase
        .from('shared_itinerary_members')
        .select(
          'role, shared_itinerary_id, shared_itineraries ( id, source_trip_id, trip_json, owner_user_id, revoked_at, default_permission )',
        )
        .eq('user_id', user.id)
        .is('revoked_at', null),
    ])

  if (utError) console.warn('user_trips fetch', utError.message)
  if (ownedError) console.warn('shared_itineraries owned fetch', ownedError.message)
  if (memError) console.warn('shared_itinerary_members fetch', memError.message)

  const payload = ut?.payload
  const personal =
    payload == null ? { trips: [], selectedTripId: null } : parseTripsFromUnknown(payload as unknown)

  const rawSel =
    payload != null && typeof payload === 'object' && payload !== null && 'selectedTripId' in payload
      ? (payload as { selectedTripId?: unknown }).selectedTripId
      : null
  const preferredSelectedId = typeof rawSel === 'string' ? rawSel : null

  const ownedRows = (owned ?? []).filter((r) => r.revoked_at == null) as SharedItineraryRow[]
  const memberRows = (members ?? []) as MemberRow[]

  return mergePersonalAndShared(personal, ownedRows, memberRows, preferredSelectedId)
}

export async function upsertUserTrips(payload: TripsState): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }

    const { error } = await supabase.from('user_trips').upsert(
      {
        user_id: user.id,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Save failed.'
    return { ok: false, error: msg }
  }
}

export function generateShareToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export async function upsertSharedItineraryTrip(
  sharedItineraryId: string,
  trip: Trip,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }

    const bare = stripSharingFromTrip(trip)
    const { error } = await supabase
      .from('shared_itineraries')
      .update({
        trip_json: bare as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sharedItineraryId)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Save failed.'
    return { ok: false, error: msg }
  }
}

export async function createSharedItinerary(params: {
  sourceTripId: string
  trip: Trip
  defaultPermission: 'viewer' | 'editor'
}): Promise<{ ok: true; shareToken: string; sharedItineraryId: string } | { ok: false; error: string }> {
  try {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }

    const bare = stripSharingFromTrip(params.trip)
    const token = generateShareToken()

    const { data: existing, error: exErr } = await supabase
      .from('shared_itineraries')
      .select('id, share_token')
      .eq('owner_user_id', user.id)
      .eq('source_trip_id', params.sourceTripId)
      .is('revoked_at', null)
      .maybeSingle()

    if (exErr) return { ok: false, error: exErr.message }

    if (existing) {
      const { error } = await supabase
        .from('shared_itineraries')
        .update({
          trip_json: bare as unknown as Record<string, unknown>,
          default_permission: params.defaultPermission,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) return { ok: false, error: error.message }
      return { ok: true, shareToken: existing.share_token, sharedItineraryId: existing.id }
    }

    const { data: inserted, error } = await supabase
      .from('shared_itineraries')
      .insert({
        share_token: token,
        owner_user_id: user.id,
        source_trip_id: params.sourceTripId,
        trip_json: bare as unknown as Record<string, unknown>,
        default_permission: params.defaultPermission,
        updated_at: new Date().toISOString(),
      })
      .select('id, share_token')
      .single()

    if (error || !inserted) return { ok: false, error: error?.message ?? 'Insert failed.' }
    return { ok: true, shareToken: inserted.share_token, sharedItineraryId: inserted.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Save failed.'
    return { ok: false, error: msg }
  }
}

export async function updateSharedItineraryDefaultPermission(
  sharedItineraryId: string,
  defaultPermission: 'viewer' | 'editor',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('shared_itineraries')
    .update({ default_permission: defaultPermission, updated_at: new Date().toISOString() })
    .eq('id', sharedItineraryId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function updateSharedMemberRole(
  sharedItineraryId: string,
  memberUserId: string,
  role: 'viewer' | 'editor',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('shared_itinerary_members')
    .update({ role })
    .eq('shared_itinerary_id', sharedItineraryId)
    .eq('user_id', memberUserId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function revokeSharedItineraryMember(
  sharedItineraryId: string,
  memberUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('shared_itinerary_members')
    .update({ revoked_at: new Date().toISOString() })
    .eq('shared_itinerary_id', sharedItineraryId)
    .eq('user_id', memberUserId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function revokeSharedItineraryEntire(
  sharedItineraryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('shared_itineraries')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sharedItineraryId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export type SharedMemberListItem = {
  userId: string
  role: 'viewer' | 'editor'
  joinedAt: string
  displayName: string | null
}

export async function fetchSharedItineraryMeta(
  sharedItineraryId: string,
): Promise<
  | { ok: true; defaultPermission: 'viewer' | 'editor'; shareToken: string; sourceTripId: string }
  | { ok: false; error: string }
> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('shared_itineraries')
    .select('default_permission, share_token, source_trip_id')
    .eq('id', sharedItineraryId)
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Not found.' }
  const dp = data.default_permission === 'editor' ? 'editor' : 'viewer'
  return {
    ok: true,
    defaultPermission: dp,
    shareToken: data.share_token,
    sourceTripId: data.source_trip_id,
  }
}

export async function fetchSharedItineraryMembers(
  sharedItineraryId: string,
): Promise<{ ok: true; members: SharedMemberListItem[] } | { ok: false; error: string }> {
  const supabase = getSupabase()
  const { data: rows, error } = await supabase
    .from('shared_itinerary_members')
    .select('user_id, role, joined_at')
    .eq('shared_itinerary_id', sharedItineraryId)
    .is('revoked_at', null)

  if (error) return { ok: false, error: error.message }
  const ids = (rows ?? []).map((r) => r.user_id)
  let names = new Map<string, string | null>()
  if (ids.length > 0) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', ids)
    for (const p of profs ?? []) {
      names.set(p.id, p.display_name ?? null)
    }
  }

  const members: SharedMemberListItem[] = (rows ?? []).map((r) => ({
    userId: r.user_id,
    role: r.role === 'editor' ? 'editor' : 'viewer',
    joinedAt: r.joined_at,
    displayName: names.get(r.user_id) ?? null,
  }))

  return { ok: true, members }
}

export async function acceptSharedItinerary(
  shareToken: string,
): Promise<
  { ok: true; sharedItineraryId: string; sourceTripId: string } | { ok: false; error: string }
> {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('accept_shared_itinerary', { p_token: shareToken })
  if (error) return { ok: false, error: error.message }
  const row = data as { ok?: boolean; error?: string; shared_itinerary_id?: string; source_trip_id?: string }
  if (!row || row.ok !== true) return { ok: false, error: typeof row?.error === 'string' ? row.error : 'Accept failed.' }
  const sid = row.shared_itinerary_id
  const src = row.source_trip_id
  if (typeof sid !== 'string' || typeof src !== 'string') return { ok: false, error: 'Unexpected response.' }
  return { ok: true, sharedItineraryId: sid, sourceTripId: src }
}

/** Insert or update profile display name (optional). */
export async function upsertProfileDisplayName(displayName: string): Promise<void> {
  const supabase = getSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('profiles').upsert(
    { id: user.id, display_name: displayName.trim() || null, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
}

export function authSessionFromSupabaseUser(user: {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
} | null): { email: string; name: string } | null {
  if (!user) return null
  const emailRaw = user.email ?? ''
  const email = normalizeEmail(emailRaw)
  if (!email) return null
  const meta = user.user_metadata ?? {}
  const fromMeta =
    typeof meta.display_name === 'string'
      ? meta.display_name.trim()
      : typeof meta.full_name === 'string'
        ? meta.full_name.trim()
        : typeof meta.name === 'string'
          ? meta.name.trim()
          : ''
  const name = fromMeta || email.split('@')[0] || 'Traveler'
  return { email, name }
}

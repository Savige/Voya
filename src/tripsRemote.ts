import { normalizeEmail } from './auth'
import { getPocketBase } from './pocketbaseClient'
import type { Trip, TripsState } from './tripTypes'
import { stripSharingFromTrip } from './tripTypes'
import { parseSingleTripFromUnknown, parseTripsFromUnknown } from './tripStorage'

type UserTripsRow = {
  id: string
  user: string
  payload: unknown
}

type SharedItineraryRow = {
  id: string
  source_trip_id: string
  trip_json: unknown
  owner: string
  default_permission: string
  share_token: string
  revoked_at?: string | null
}

type MemberRow = {
  id: string
  role: string
  user: string
  shared_itinerary: string
  joined_at?: string
  revoked_at?: string | null
  expand?: {
    shared_itinerary?: SharedItineraryRow
  }
}

function requireUserId(): string {
  const pb = getPocketBase()
  const id = pb.authStore.record?.id
  if (!id) throw new Error('Not signed in.')
  return id
}

export async function fetchUserTripsState(): Promise<TripsState> {
  const pb = getPocketBase()
  const userId = pb.authStore.record?.id
  if (!userId) return { trips: [], selectedTripId: null }

  try {
    const row = await pb.collection('user_trips').getFirstListItem<UserTripsRow>(`user="${userId}"`)
    if (row.payload == null) return { trips: [], selectedTripId: null }
    return parseTripsFromUnknown(row.payload)
  } catch {
    return { trips: [], selectedTripId: null }
  }
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
    const share = row.expand?.shared_itinerary
    if (!share || share.owner == null) continue
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
        : (trips[0]?.id ?? null)

  return { trips, selectedTripId: pick }
}

export async function fetchMergedTripsState(): Promise<TripsState> {
  const pb = getPocketBase()
  const userId = pb.authStore.record?.id
  if (!userId) return { trips: [], selectedTripId: null }

  let personal: TripsState = { trips: [], selectedTripId: null }
  let preferredSelectedId: string | null = null
  try {
    const ut = await pb.collection('user_trips').getFirstListItem<UserTripsRow>(`user="${userId}"`)
    if (ut.payload != null) {
      personal = parseTripsFromUnknown(ut.payload)
      if (typeof ut.payload === 'object' && ut.payload !== null && 'selectedTripId' in ut.payload) {
        const raw = (ut.payload as { selectedTripId?: unknown }).selectedTripId
        preferredSelectedId = typeof raw === 'string' ? raw : null
      }
    }
  } catch {
    // no personal row yet
  }

  let ownedRows: SharedItineraryRow[] = []
  try {
    const owned = await pb.collection('shared_itineraries').getFullList<SharedItineraryRow>({
      filter: `owner="${userId}" && revoked_at=""`,
    })
    ownedRows = owned.filter((r) => !r.revoked_at)
  } catch (e) {
    console.warn('shared_itineraries owned fetch', e)
  }

  let memberRows: MemberRow[] = []
  try {
    const members = await pb.collection('shared_itinerary_members').getFullList<MemberRow>({
      filter: `user="${userId}" && revoked_at=""`,
      expand: 'shared_itinerary',
    })
    memberRows = members.filter((r) => !r.revoked_at)
  } catch (e) {
    console.warn('shared_itinerary_members fetch', e)
  }

  return mergePersonalAndShared(personal, ownedRows, memberRows, preferredSelectedId)
}

export async function upsertUserTrips(payload: TripsState): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pb = getPocketBase()
    const userId = requireUserId()
    try {
      const existing = await pb.collection('user_trips').getFirstListItem<UserTripsRow>(`user="${userId}"`)
      await pb.collection('user_trips').update(existing.id, { payload })
    } catch {
      await pb.collection('user_trips').create({ user: userId, payload })
    }
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
    const pb = getPocketBase()
    requireUserId()
    const bare = stripSharingFromTrip(trip)
    await pb.collection('shared_itineraries').update(sharedItineraryId, { trip_json: bare })
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
    const pb = getPocketBase()
    const userId = requireUserId()
    const bare = stripSharingFromTrip(params.trip)
    const token = generateShareToken()

    try {
      const existing = await pb.collection('shared_itineraries').getFirstListItem<SharedItineraryRow>(
        `owner="${userId}" && source_trip_id="${params.sourceTripId}" && revoked_at=""`,
      )
      await pb.collection('shared_itineraries').update(existing.id, {
        trip_json: bare,
        default_permission: params.defaultPermission,
      })
      return { ok: true, shareToken: existing.share_token, sharedItineraryId: existing.id }
    } catch {
      // create new
    }

    const inserted = await pb.collection('shared_itineraries').create<SharedItineraryRow>({
      share_token: token,
      owner: userId,
      source_trip_id: params.sourceTripId,
      trip_json: bare,
      default_permission: params.defaultPermission,
    })
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
  try {
    const pb = getPocketBase()
    await pb.collection('shared_itineraries').update(sharedItineraryId, {
      default_permission: defaultPermission,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed.' }
  }
}

export async function updateSharedMemberRole(
  sharedItineraryId: string,
  memberUserId: string,
  role: 'viewer' | 'editor',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pb = getPocketBase()
    const row = await pb.collection('shared_itinerary_members').getFirstListItem<{ id: string }>(
      `shared_itinerary="${sharedItineraryId}" && user="${memberUserId}" && revoked_at=""`,
    )
    await pb.collection('shared_itinerary_members').update(row.id, { role })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed.' }
  }
}

export async function revokeSharedItineraryMember(
  sharedItineraryId: string,
  memberUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pb = getPocketBase()
    const row = await pb.collection('shared_itinerary_members').getFirstListItem<{ id: string }>(
      `shared_itinerary="${sharedItineraryId}" && user="${memberUserId}" && revoked_at=""`,
    )
    await pb.collection('shared_itinerary_members').update(row.id, {
      revoked_at: new Date().toISOString(),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Revoke failed.' }
  }
}

export async function revokeSharedItineraryEntire(
  sharedItineraryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pb = getPocketBase()
    await pb.collection('shared_itineraries').update(sharedItineraryId, {
      revoked_at: new Date().toISOString(),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Revoke failed.' }
  }
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
  try {
    const pb = getPocketBase()
    const data = await pb.collection('shared_itineraries').getOne<SharedItineraryRow>(sharedItineraryId)
    const dp = data.default_permission === 'editor' ? 'editor' : 'viewer'
    return {
      ok: true,
      defaultPermission: dp,
      shareToken: data.share_token,
      sourceTripId: data.source_trip_id,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not found.' }
  }
}

export async function fetchSharedItineraryMembers(
  sharedItineraryId: string,
): Promise<{ ok: true; members: SharedMemberListItem[] } | { ok: false; error: string }> {
  try {
    const pb = getPocketBase()
    const rows = await pb.collection('shared_itinerary_members').getFullList<{
      user: string
      role: string
      joined_at?: string
      expand?: { user?: { name?: string; email?: string } }
    }>({
      filter: `shared_itinerary="${sharedItineraryId}" && revoked_at=""`,
      expand: 'user',
    })
    const members: SharedMemberListItem[] = rows.map((r) => ({
      userId: r.user,
      role: r.role === 'editor' ? 'editor' : 'viewer',
      joinedAt: r.joined_at ?? '',
      displayName: r.expand?.user?.name?.trim() || r.expand?.user?.email || null,
    }))
    return { ok: true, members }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Load failed.' }
  }
}

export async function acceptSharedItinerary(
  shareToken: string,
): Promise<
  { ok: true; sharedItineraryId: string; sourceTripId: string } | { ok: false; error: string }
> {
  try {
    const pb = getPocketBase()
    const userId = requireUserId()
    const token = shareToken.trim()
    if (!token) return { ok: false, error: 'Missing share token.' }

    const share = await pb.collection('shared_itineraries').getFirstListItem<SharedItineraryRow>(
      `share_token="${token}" && revoked_at=""`,
    )
    if (share.owner === userId) {
      return { ok: true, sharedItineraryId: share.id, sourceTripId: share.source_trip_id }
    }

    try {
      const existing = await pb.collection('shared_itinerary_members').getFirstListItem<{ id: string; revoked_at?: string }>(
        `shared_itinerary="${share.id}" && user="${userId}"`,
      )
      if (existing.revoked_at) {
        await pb.collection('shared_itinerary_members').update(existing.id, {
          revoked_at: null,
          role: share.default_permission === 'editor' ? 'editor' : 'viewer',
          joined_at: new Date().toISOString(),
        })
      }
    } catch {
      await pb.collection('shared_itinerary_members').create({
        shared_itinerary: share.id,
        user: userId,
        role: share.default_permission === 'editor' ? 'editor' : 'viewer',
        joined_at: new Date().toISOString(),
      })
    }

    return { ok: true, sharedItineraryId: share.id, sourceTripId: share.source_trip_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Accept failed.' }
  }
}

export async function upsertProfileDisplayName(displayName: string): Promise<void> {
  try {
    const pb = getPocketBase()
    const userId = pb.authStore.record?.id
    if (!userId) return
    await pb.collection('users').update(userId, { name: displayName.trim() || '' })
  } catch {
    // optional
  }
}

export function authSessionFromPocketBaseUser(user: {
  id: string
  email?: string | null
  name?: string | null
} | null): { email: string; name: string } | null {
  if (!user) return null
  const email = normalizeEmail(user.email ?? '')
  if (!email) return null
  const name = (user.name ?? '').trim() || email.split('@')[0] || 'Traveler'
  return { email, name }
}

/** @deprecated Use authSessionFromPocketBaseUser */
export function authSessionFromSupabaseUser(user: {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
} | null): { email: string; name: string } | null {
  if (!user) return null
  const meta = user.user_metadata ?? {}
  const fromMeta =
    typeof meta.display_name === 'string'
      ? meta.display_name.trim()
      : typeof meta.name === 'string'
        ? meta.name.trim()
        : ''
  return authSessionFromPocketBaseUser({
    id: user.id,
    email: user.email,
    name: fromMeta,
  })
}

import { normalizeEmail } from './auth'
import { getSupabase } from './supabaseClient'
import type { TripsState } from './tripTypes'
import { parseTripsFromUnknown } from './tripStorage'

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

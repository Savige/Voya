import type { AuthSession } from './auth'

/** Fixed session when bypassing Supabase login in dev (localStorage key for trips). */
export const DEV_BYPASS_SESSION: AuthSession = {
  email: 'dev@local.waypoint',
  name: 'Dev',
}

/**
 * Skip Supabase login on the dev server and use local trip storage (same as no Supabase).
 *
 * - In production (`import.meta.env.DEV` false): never bypasses.
 * - On localhost / 127.0.0.1 in dev: bypasses by default so you do not need an env flag.
 * - Set `VITE_DEV_AUTH_BYPASS=0` (or `false`) to test real Supabase sign-in on localhost.
 * - Set `VITE_DEV_AUTH_BYPASS=1` to force bypass when not on localhost (e.g. LAN IP).
 */
export function isDevAuthBypass(): boolean {
  if (!import.meta.env.DEV) return false

  const raw = import.meta.env.VITE_DEV_AUTH_BYPASS?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true

  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (h === 'localhost' || h === '127.0.0.1') return true
  }

  return false
}

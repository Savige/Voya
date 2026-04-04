/** Local-only auth (no server). Passwords are SHA-256 hashed before storage. */

import { validateRegistrationPassword } from './passwordPolicy'

export const AUTH_SESSION_KEY = 'itinerary:auth:v1'
export const USERS_DB_KEY = 'itinerary:users:v1'
export const LEGACY_TRIPS_KEY = 'trips:v1'
export const LEGACY_MIGRATED_KEY = 'itinerary:legacy-trips-migrated:v1'

export type AuthSession = {
  email: string
  name: string
}

type UserRecord = {
  passwordHash: string
  name: string
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function tripsStorageKey(email: string): string {
  return `trips:user:${normalizeEmail(email)}`
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashPassword(password: string): Promise<string> {
  return sha256Hex(password + '|itinerary-local-salt')
}

export function loadAuthSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { email?: string; name?: string }
    const email = normalizeEmail(String(p.email ?? ''))
    const name = String(p.name ?? '').trim()
    if (!email || !name) return null
    return { email, name }
  } catch {
    return null
  }
}

export function saveAuthSession(session: AuthSession): void {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
}

export function clearAuthSession(): void {
  localStorage.removeItem(AUTH_SESSION_KEY)
}

function loadUsersDb(): Record<string, UserRecord> {
  try {
    const raw = localStorage.getItem(USERS_DB_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as Record<string, UserRecord>
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

function saveUsersDb(db: Record<string, UserRecord>): void {
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(db))
}

export async function registerUser(emailRaw: string, password: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeEmail(emailRaw)
  const displayName = name.trim()
  if (!email.includes('@')) return { ok: false, error: 'Enter a valid email address.' }
  const pw = validateRegistrationPassword(password)
  if (!pw.ok) return { ok: false, error: pw.message }
  if (!displayName) return { ok: false, error: 'Enter your name.' }

  const db = loadUsersDb()
  if (db[email]) return { ok: false, error: 'An account with this email already exists.' }

  const passwordHash = await hashPassword(password)
  db[email] = { passwordHash, name: displayName }
  saveUsersDb(db)
  saveAuthSession({ email, name: displayName })
  return { ok: true }
}

/** Same generic message for unknown user and wrong password to reduce account enumeration. */
export const LOGIN_FAILED_MESSAGE = 'Invalid email or password.'

export async function loginUser(emailRaw: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeEmail(emailRaw)
  const db = loadUsersDb()
  const rec = db[email]
  if (!rec) return { ok: false, error: LOGIN_FAILED_MESSAGE }
  const h = await hashPassword(password)
  if (h !== rec.passwordHash) return { ok: false, error: LOGIN_FAILED_MESSAGE }
  saveAuthSession({ email, name: rec.name })
  return { ok: true }
}

/** Copy legacy `trips:v1` into the signed-in user's key once, then clear legacy. */
export function migrateLegacyTripsIfNeeded(userEmail: string): void {
  const email = normalizeEmail(userEmail)
  const legacy = localStorage.getItem(LEGACY_TRIPS_KEY)
  if (!legacy) return
  if (localStorage.getItem(LEGACY_MIGRATED_KEY)) return

  const userKey = tripsStorageKey(email)
  if (!localStorage.getItem(userKey)) {
    localStorage.setItem(userKey, legacy)
  }
  localStorage.removeItem(LEGACY_TRIPS_KEY)
  localStorage.setItem(LEGACY_MIGRATED_KEY, '1')
}

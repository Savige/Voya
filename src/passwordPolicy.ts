/**
 * Client-side password rules for new accounts (registration).
 * Supabase Auth still enforces server policy; this aligns the UI and local-only auth.
 * See OWASP Authentication Cheat Sheet (length + complexity for higher assurance).
 */

export const PASSWORD_RULES_SUMMARY =
  'At least 12 characters, with uppercase, lowercase, a number, and a symbol.'

const MAX_PASSWORD_LENGTH = 128

export function validateRegistrationPassword(
  password: string,
): { ok: true } | { ok: false; message: string } {
  if (password.length < 12) {
    return { ok: false, message: 'Use at least 12 characters.' }
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: 'Password is too long.' }
  }
  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasDigit = /\d/.test(password)
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)
  if (!hasLower || !hasUpper || !hasDigit) {
    return { ok: false, message: 'Include uppercase, lowercase, and a number.' }
  }
  if (!hasSpecial) {
    return { ok: false, message: 'Include at least one symbol (e.g. ! @ # $).' }
  }
  return { ok: true }
}

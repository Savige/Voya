/**
 * Map Supabase Auth errors to safe, user-facing messages.
 * Avoid echoing raw API text where it could aid enumeration or leak internals.
 */

export function mapSupabaseAuthError(message: string): string {
  const m = message.toLowerCase()

  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'Invalid email or password.'
  }
  if (m.includes('email not confirmed') || m.includes('confirm your email')) {
    return 'Confirm your email before signing in.'
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'An account with this email already exists.'
  }
  if (m.includes('rate limit') || m.includes('too many') || m.includes('only request this once')) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }
  if (m.includes('password') && (m.includes('least') || m.includes('weak') || m.includes('short'))) {
    return 'Password does not meet security requirements. Use a stronger password.'
  }

  return 'Something went wrong. Please try again.'
}

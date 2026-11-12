/**
 * Map Supabase Auth errors to safe, user-facing messages.
 * Avoid echoing raw API text where it could aid enumeration or leak internals.
 *
 * Prefer `code` from the Auth API when present — many failures use generic messages.
 */

export function mapAuthError(message: string, code?: string | null): string {
  const c = (code ?? '').trim().toLowerCase()
  if (c) {
    switch (c) {
      case 'signup_disabled':
        return 'Account creation is disabled. Contact the site administrator.'
      case 'email_provider_disabled':
      case 'provider_disabled':
        return 'Email sign-in is disabled for this project.'
      case 'user_already_exists':
      case 'email_exists':
        return 'An account with this email already exists.'
      case 'weak_password':
        return 'Password does not meet security requirements. Use a stronger password.'
      case 'email_address_invalid':
        return 'Enter a valid email address.'
      case 'email_address_not_authorized':
        return 'This email address is not allowed to sign up.'
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
      case 'over_sms_send_rate_limit':
        return 'Too many attempts. Please wait a few minutes and try again.'
      case 'invalid_credentials':
        return 'Invalid email or password.'
      case 'email_not_confirmed':
        return 'Confirm your email before signing in.'
      case 'bad_jwt':
        return 'The app could not talk to the account service. Check the Supabase URL and anon key, then reload.'
      case 'captcha_failed':
        return 'Verification failed. Try again.'
    }
  }

  const m = message.toLowerCase()

  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'Invalid email or password.'
  }
  if (m.includes('email not confirmed') || m.includes('confirm your email')) {
    return 'Confirm your email before signing in.'
  }
  if (
    m.includes('user already registered') ||
    m.includes('already been registered') ||
    m.includes('user already exists')
  ) {
    return 'An account with this email already exists.'
  }
  if (
    m.includes('rate limit') ||
    m.includes('too many') ||
    m.includes('only request this once') ||
    m.includes('email rate limit')
  ) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }
  if (m.includes('password') && (m.includes('least') || m.includes('weak') || m.includes('short') || m.includes('pwned'))) {
    return 'Password does not meet security requirements. Use a stronger password.'
  }
  if (
    (m.includes('redirect') && (m.includes('allow') || m.includes('invalid') || m.includes('not'))) ||
    m.includes('redirect_uri') ||
    m.includes('redirect url')
  ) {
    return 'Add this site’s URL (including https) to Supabase Auth → URL Configuration → Redirect URLs, then try again.'
  }
  if (m.includes('database error') || m.includes('saving new user') || m.includes('error creating user')) {
    return 'Could not create the account (database error). Check Supabase logs and Auth triggers.'
  }
  if (
    m.includes('confirmation email') ||
    m.includes('sending email') ||
    m.includes('smtp') ||
    m.includes('mailer') ||
    (m.includes('email') && m.includes('send') && m.includes('fail'))
  ) {
    return 'Could not send the confirmation email. Configure SMTP or a mail hook in Supabase, or disable “Confirm email” for testing.'
  }
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed') || m.includes('networkerror')) {
    return 'Could not reach the account service. Check your connection, CORS, and that the API URL is correct.'
  }

  if (import.meta.env.DEV && (message || code)) {
    console.warn('[auth]', code ?? '(no code)', message || '(empty message)')
  }

  return 'Something went wrong. Please try again.'
}

/** @deprecated Use mapAuthError */
export const mapSupabaseAuthError = mapAuthError

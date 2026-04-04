/** Where GoTrue redirects after the user clicks the email confirmation link (must be in Supabase Auth redirect allow list). */
export function getAuthEmailRedirectTo(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/`
}

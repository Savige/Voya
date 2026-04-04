/** Product name and tab-title helpers (see also index.html default &lt;title&gt;). */

export const BRAND_NAME = 'Waypoint'

export function formatDocumentTitle(page: string): string {
  return `${BRAND_NAME} | ${page}`
}

export const BRAND_HOME_KICKER = 'Your journeys'
export const BRAND_HOME_HEADLINE = 'Navigate every leg of your trip'
export const BRAND_HOME_SUBTEXT =
  'Sign in to save trips on this device, then add destinations, stays, and bookings in one place.'

export const BRAND_DASHBOARD_SUBTITLE = 'Stays, flights, and days in one place.'
export const BRAND_FOOTER_TAGLINE = 'Waypoint — local-first travel planning'

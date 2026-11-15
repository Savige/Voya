export type PlaceSuggestion = {
  key: string
  label: string
  /** Short place title (city / locality). */
  name?: string
  country?: string
  /** ISO 3166-1 alpha-2, lowercase when from Nominatim. */
  countryCode?: string
  /** Region / district line under the country. */
  region?: string
  lat?: number
  lon?: number
  googleMapsUri?: string
  photoUrl?: string
  seedLabel?: string
  category?: string
  primaryType?: string
  types?: string[]
}

export type GeocodeResult = {
  lat: number
  lon: number
  label: string
}

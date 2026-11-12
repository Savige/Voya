export type PlaceSuggestion = {
  key: string
  label: string
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

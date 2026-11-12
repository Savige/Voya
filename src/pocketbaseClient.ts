import PocketBase from 'pocketbase'

let client: PocketBase | null = null

export function isPocketBaseConfigured(): boolean {
  const url = import.meta.env.VITE_POCKETBASE_URL?.trim() ?? ''
  return Boolean(url)
}

/** @deprecated Use isPocketBaseConfigured — kept as alias during migration. */
export function isSupabaseConfigured(): boolean {
  return isPocketBaseConfigured()
}

export function getPocketBase(): PocketBase {
  const url = import.meta.env.VITE_POCKETBASE_URL?.trim() ?? ''
  if (!url) {
    throw new Error('PocketBase is not configured (set VITE_POCKETBASE_URL).')
  }
  if (!client) {
    client = new PocketBase(url)
    client.autoCancellation(false)
  }
  return client
}

export function pocketBaseApiUrl(path: string): string {
  const base = (import.meta.env.VITE_POCKETBASE_URL?.trim() ?? '').replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

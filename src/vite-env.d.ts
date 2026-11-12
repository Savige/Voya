/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BUILD: string
  /** Public PocketBase URL (browser). */
  readonly VITE_POCKETBASE_URL?: string
  /** Set to "1" in dev to skip PocketBase login on localhost (see .env.example). */
  readonly VITE_DEV_AUTH_BYPASS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

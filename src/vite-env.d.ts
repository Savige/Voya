/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BUILD: string
  /** Set to "1" in dev to skip Supabase login on localhost (see .env.example). */
  readonly VITE_DEV_AUTH_BYPASS?: string
}

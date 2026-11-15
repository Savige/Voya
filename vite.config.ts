import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// DEV_HMR_HOST — when set (e.g. waypoint.savige.me), HMR uses wss:443 behind NPM + HTTPS.
// See deploy/DEV_REMOTE.md

/** Bottom-right build label; recomputed on every `vite build` / dev server start. Not taken from .env files (avoids a stale pinned string). */
function resolveAppBuildLabel(): string {
  const explicit = process.env.VITE_APP_BUILD?.trim()
  if (explicit) return explicit

  const buildNum =
    process.env.GITHUB_RUN_NUMBER?.trim() ||
    process.env.CI_PIPELINE_IID?.trim() ||
    process.env.CI_BUILD_NUMBER?.trim() ||
    process.env.BUILD_NUMBER?.trim() ||
    String(Date.now())

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  return `#${buildNum} · ${stamp}`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devHmrHost = env.DEV_HMR_HOST?.trim()
  const buildId = resolveAppBuildLabel()

  return {
    define: {
      'import.meta.env.VITE_APP_BUILD': JSON.stringify(buildId),
    },
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        // Browser → same-origin → public OSRM (avoids flaky CORS / tracker blocks).
        '/osrm': {
          target: 'https://router.project-osrm.org',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/osrm/, ''),
        },
      },
      ...(devHmrHost
        ? {
            allowedHosts: true,
            hmr: {
              protocol: 'wss',
              host: devHmrHost,
              clientPort: 443,
            },
          }
        : {}),
    },
  }
})


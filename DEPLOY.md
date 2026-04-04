# Deploying Waypoint (Vite + Supabase)

## Prerequisites

1. **Supabase**
   - Create a project at [supabase.com](https://supabase.com/).
   - In **SQL Editor**, run the migration file `supabase/migrations/001_user_trips_and_profiles.sql` (creates `user_trips`, `profiles`, and RLS policies).
   - Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.

2. **Google Maps** (existing app requirement)
   - Keep `VITE_GOOGLE_MAPS_API_KEY` and optional `VITE_GOOGLE_MAPS_MAP_ID` as today.
   - In Google Cloud Console, restrict the key by HTTP referrer to your production URL and `http://localhost:*` for development.

## Environment variables

Set these in your host’s dashboard (e.g. Vercel → Project → Settings → Environment Variables):

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | If using cloud sync | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | If using cloud sync | Supabase **anon** key (not `service_role`) |
| `VITE_GOOGLE_MAPS_API_KEY` | Yes | Maps / Places key |
| `VITE_GOOGLE_MAPS_MAP_ID` | No | Map ID if you use cloud-based map styling |

If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, the app falls back to **local-only** auth and `localStorage` for trips (same behavior as before Supabase).

## Vercel

1. Connect the Git repository to Vercel.
2. Framework preset: **Vite** (or Other with build `npm run build` and output directory `dist`).
3. Add the environment variables above for **Production** (and **Preview** if you want previews to talk to Supabase).
4. Deploy.

### Supabase Auth URL configuration

In Supabase: **Authentication → URL Configuration**, add your production site URL (e.g. `https://your-app.vercel.app`) to **Redirect URLs** if you use email confirmation or OAuth later.

## Build verification

From the repo root:

```bash
npm ci
npm run build
```

## Security reminders

- Use only the **anon** key in the browser bundle. Never commit or expose the **service_role** key in Vite env vars.
- RLS on `user_trips` and `profiles` ensures each user only reads/writes their own rows.

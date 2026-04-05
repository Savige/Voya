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

## Self-hosted on Proxmox (or Linux VM)

Run the **official Supabase Docker stack** on the VM (Postgres, Auth, Kong, etc.). This app is not compatible with “Postgres only” without replacing Supabase Auth and the REST API. See [`deploy/SUPABASE.md`](deploy/SUPABASE.md) for clone paths, `.env` variables, and links to [Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker).

### 1. Provision the VM

- **OS:** Ubuntu 22.04 LTS (or similar) with Docker and Docker Compose v2.
- **Resources:** Plan for **at least 4 GB RAM** for Supabase; more helps if you build the frontend on the same VM.
- **Network:** Assign a **static IP** (LAN or public). For HTTPS and Google Maps referrer restrictions, point DNS **A/AAAA** records at the server for your hostnames (e.g. `waypoint.ryansavige.com` for the SPA, `api.ryansavige.com` for Kong, `cc.ryansavige.com` for other apps).

### 2. Deploy Supabase

Follow [`deploy/SUPABASE.md`](deploy/SUPABASE.md): clone `supabase/supabase`, configure `docker/.env`, start `docker compose up -d`, and set public URLs (`SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`, redirect allow list) to match your HTTPS API and app origins.

### 3. Apply the Waypoint database migration

With the stack healthy, create tables and RLS policies. From the repo root (after cloning Waypoint on the server or copying files):

```bash
export SUPABASE_DOCKER_DIR=/opt/supabase/docker   # your `docker` directory
./deploy/apply-migration.sh
```

Alternatively, paste `supabase/migrations/001_user_trips_and_profiles.sql` into Supabase Studio SQL editor and run it.

### 4. Build and run the frontend

**Option A — Docker (recommended)**

```bash
cp deploy/.env.production.example deploy/.env
# Set VITE_SUPABASE_URL to your public API URL (e.g. https://api.ryansavige.com)
# Set VITE_SUPABASE_ANON_KEY from ANON_KEY in Supabase docker/.env
# Set Google Maps variables as in .env.example

docker compose -f deploy/docker-compose.yml up -d --build
```

Compose loads **`deploy/.env`** automatically (next to `deploy/docker-compose.yml`). It does **not** load `deploy/.env.production` unless you add `--env-file deploy/.env.production`.

Whenever you change `deploy/.env` or any `VITE_*` value, run that `docker compose ... up -d --build` again (or `build --no-cache` then `up -d` if the bundle still looks stale). The static bundle is produced at build time.

The container serves the `dist` assets on **port 8081** on the host (see [`deploy/docker-compose.yml`](deploy/docker-compose.yml)). Put a reverse proxy in front for TLS and a public hostname.

**Option B — Manual**

```bash
npm ci
npm run build
sudo mkdir -p /var/www/waypoint
sudo rsync -a dist/ /var/www/waypoint/
```

`VITE_*` variables must be set **at build time** (see Environment variables above).

### 5. Reverse proxy and TLS

- Use **Nginx Proxy Manager** (or another reverse proxy) on **80/443** with HTTPS (Let’s Encrypt). Do not run a second proxy on the same ports for the same names.
- **Waypoint:** add a Proxy Host for `waypoint.ryansavige.com` → `http://127.0.0.1:8081` (NPM on the host) or **`http://172.17.0.1:8081`** (NPM in Docker on Linux), or serve static files from `/var/www/waypoint` if you built without Docker. See [`deploy/NPM.md`](deploy/NPM.md).
- **Supabase API:** Kong usually listens on `127.0.0.1:8000` — expose it as `https://api.ryansavige.com` and use that URL as `VITE_SUPABASE_URL` when rebuilding the client. Enable **Websockets** in NPM for the API host.

Step-by-step: [`deploy/NPM.md`](deploy/NPM.md). Manual Nginx without NPM: [`deploy/nginx.site.example.conf`](deploy/nginx.site.example.conf). More detail in [`deploy/README.md`](deploy/README.md).

### 6. Supabase Auth URL configuration (self-hosted)

In **Studio → Authentication → URL Configuration**, set **Site URL** to your app origin (e.g. `https://waypoint.ryansavige.com`) and add the same (and any preview URLs) to **Redirect URLs** if you use email confirmation or OAuth.

### 7. Google Maps

In Google Cloud Console, restrict the Maps key by **HTTP referrer** to your production URL and `http://localhost:*` for development (same as cloud deployment).

### 8. Firewall

Allow **80** and **443** to the reverse proxy. Do not expose Postgres **5432** publicly unless you have a strong reason and network controls.

## Build verification

From the repo root:

```bash
npm ci
npm run build
```

## Security reminders

- Use only the **anon** key in the browser bundle. Never commit or expose the **service_role** key in Vite env vars.
- RLS on `user_trips` and `profiles` ensures each user only reads/writes their own rows.

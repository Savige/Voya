# Cutover checklist: `*.ryansavige.com` → `*.savige.me`

Email booking import is **paused**. This checklist is for app hostnames only.

## 1. DNS

**Cloudflare** (`savige.me`, DNS-only / grey cloud):

- A `*` → `192.168.1.165`
- Optional explicit: `waypoint`, `pocketbase`, `docs`, `finance`, `nas`, …

**UniFi:** DNS Host (A) `*.savige.me` → `192.168.1.165`

Leave `*.ryansavige.com` up temporarily for bookmarks.

## 2. TLS — done

Let’s Encrypt `*.savige.me` (+ apex) is in `/volume1/docker/acme/config/savige.me_ecc` and wired into Synology ReverseProxy cert dirs.

## 3. Reverse proxy — done (Waypoint / PocketBase)

Applied via `deploy/scripts/apply-savige-me-proxy.py` + `nginx -s reload`. Verified:

- `https://waypoint.savige.me` → `:8081` (SPA 200, cert `*.savige.me`)
- `https://pocketbase.savige.me` → `:8090` (`/api/health` 200)
- `https://docs.savige.me` → `:6875` (BookStack 302, cert `*.savige.me`)
- `https://finance.savige.me` → `:8787` (200, cert `*.savige.me`)

Legacy `*.ryansavige.com` reverse-proxy rules remain during cutover.

## 4. Rebuild Waypoint with new API URL

`deploy/.env.production` should have:

```bash
VITE_POCKETBASE_URL=https://pocketbase.savige.me
```

Then rebuild the SPA (only when you approve a Synology deploy):

```bash
docker-compose -f deploy/docker-compose.yml --project-name waypoint up -d --build waypoint
```

## 5. After apps work on savige.me

1. Move any remaining Google Workspace mail → Proton (`@savige.me`)
2. Cancel Google Workspace
3. Optional: redirect or park `ryansavige.com`
4. Later: resume booking email on `inbound.savige.me` (not apex MX)

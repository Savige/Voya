# Waypoint — household travel planner

**Waypoint** (formerly Voya) is a private travel planner: multi-day trips, place stops, day activities, a route planner, and cached place recommendations. It runs on the NAS for the household — no Google Maps/Places bill.

## What it’s for

- **Planner** — build the route: ordered **places** (town/city for N nights), optional lodging under each stop, flights/drives between them
- **Itinerary** — plan each day: activities under the stop that covers that date (hotel booking not required)
- **Tips** — pack list (moved out of Planner so the route tab stays route-only)
- Sync the same trips across Mac, PC, and phone (login required)
- See the route on an offline-friendly **MapLibre** map (OpenStreetMap tiles)
- Pull **recommendations** seeded by **place** names (not hotel confirmation)

Local-only mode still works if PocketBase isn’t configured (browser `localStorage`), but multi-device sync needs the API.

### Planner vs Itinerary (model)

| Concept | Meaning | Required? |
| --- | --- | --- |
| **Stop** (`stays` in storage) | Place + date range / nights | Yes for route |
| **Accommodation** | Nested lodging on a stop (name, address, conf #, times, price, URL) | Optional |
| **Activity** | Timed thing on a day, stored on the covering stop | Itinerary |
| **Transport** | Flight / drive legs between stops | Between stops |

Legacy flat stay lodging fields migrate into nested `accommodation` on load.

## How we use it

| Role | URL / path |
| --- | --- |
| App | **https://waypoint.savige.me** |
| Backend | **https://pocketbase.savige.me** |
| NAS compose | `/volume1/docker/waypoint` |
| Containers | `waypoint` (nginx SPA on **8081**), `waypoint-pocketbase` (**8090**) |
| Mac source | `~/Voya` |
| Dev preview | Vite on NAS under `/volume1/docker/waypoint` (sync `src/` via tar\|ssh) |

Typical flow:

1. Open the app → sign up / log in (PocketBase auth).
2. Create a trip → **Planner**: add places (then lodging when ready) + flights/drives.
3. **Itinerary**: open a day covered by a place → add activities / use recommendations.
4. Open the **Map** tab for the chronological route.
5. **Tips** for the pack list.

## Architecture (short)

```text
Browser (React / Vite SPA)
    │  HTTPS
    ▼
waypoint.savige.me  ──►  nginx :8081  (static build)
    │
    │  VITE_POCKETBASE_URL
    ▼
pocketbase.savige.me ──►  PocketBase :8090
                                   ├─ SQLite (trips, users, caches)
                                   └─ hooks /api/waypoint/*
```

- **No Google keys** in production.
- Vite **inlines** `VITE_POCKETBASE_URL` at **build** time — changing the API host requires a rebuild of the `waypoint` image.

## Configure

### Production env (NAS)

File: `/volume1/docker/waypoint/deploy/.env.production`

```bash
VITE_POCKETBASE_URL=https://pocketbase.savige.me
VITE_APP_BUILD=synology

# Flight schedule lookup (Add a flight wizard)
# RapidAPI → subscribe to AeroDataBox Basic ($0). Pass into PocketBase as AERODATABOX_RAPIDAPI_KEY.
AERODATABOX_RAPIDAPI_KEY=
```

Copied into the PocketBase container env (compose or `docker run -e`). Never expose the key to the browser.

### Add a flight wizard

Planner **+ → Add a flight** opens a multi-step wizard: local airline search → flight number → departure date → **AeroDataBox** schedule lookup → confirm/edit airports & times → booking extras → Save.

**Schedule data:** [AeroDataBox](https://aerodatabox.com) via RapidAPI (`GET /flights/Number/{flight}/{date}`). Basic free tier (~400 units/mo) is enough for household lookups; show “Data by AeroDataBox” in the wizard. If the key is missing or lookup fails, airports/times can still be entered manually.

### Local Mac dev

`.env` / `.env.local` in the project root:

```bash
VITE_POCKETBASE_URL=http://127.0.0.1:8090
# or point at the NAS PocketBase:
# VITE_POCKETBASE_URL=https://pocketbase.savige.me
```

```bash
npm install
npm run dev
```

### Reverse proxy + DNS

Live on the NAS (2026-11-12): Let’s Encrypt `*.savige.me` + nginx reverse proxy.

| Host | Backend |
| --- | --- |
| `waypoint.savige.me` | `127.0.0.1:8081` |
| `pocketbase.savige.me` | `127.0.0.1:8090` |

Re-apply if needed (admin / root):

```bash
cd /volume1/docker/waypoint
sudo bash deploy/install-synology-proxy.sh
# or without sudo: deploy/scripts/apply-savige-me-proxy.py via rootful docker mounts, then:
#   nsenter -t "$(pidof nginx | awk '{print $1}')" -m -- /usr/bin/nginx -s reload
```

Cloudflare DNS-only A records (or `*.savige.me` wildcard) → `192.168.1.165`. Prefer a **UniFi local DNS wildcard** `*.savige.me` → `192.168.1.165` so new app hostnames resolve on the LAN without editing UniFi each time (see the DNS page in this wiki).

**Note:** the SPA image may still be built with the old PocketBase URL until an approved Synology rebuild with `VITE_POCKETBASE_URL=https://pocketbase.savige.me`.

## Setup / deploy (Synology)

**Manual only** — not deployed via GitHub Actions. From the Mac on the LAN:

```bash
cd ~/Voya   # or wherever the repo lives
./deploy/deploy-nas.sh
```

That syncs to `/volume1/docker/waypoint`, rebuilds Docker images, recreates `waypoint` (SPA) and a fresh `waypoint-pb*` PocketBase container (Synology btrfs often leaves old PB names stuck in “Removal In Progress”). Does not touch `pocketbase/pb_data` or `deploy/.env.production` on the NAS.

First-time proxy / env:

```bash
# after sync, on NAS or via SSH:
cd /volume1/docker/waypoint
cp deploy/.env.production.example deploy/.env.production
# edit VITE_POCKETBASE_URL if needed
docker-compose -f deploy/docker-compose.yml up -d --build
sudo bash deploy/install-synology-proxy.sh
```

Then:

1. PocketBase admin: https://pocketbase.savige.me/_/ (first boot)
2. Disable email verification for household accounts if you aren’t running SMTP
3. Open https://waypoint.savige.me and create a user
4. Create a trip and confirm it appears after refresh / another device

Strip macOS `._*` files from `pocketbase/pb_migrations` before build if you sync from Finder/rsync without filters.

## Backup

| What | Where |
| --- | --- |
| Trip/auth data | `pocketbase/pb_data/` |
| App is disposable | rebuild SPA image anytime |

Prefer Hyper Backup or a scheduled tar of `pb_data/`.

## Branding

- Product name: **Waypoint** (repo folder may still be `Voya`)
- Logo: map pin mark in-app (`BrandLogo`) and favicon

## Email → booking imports (live)

Forward airline/hotel/car confirmations to **`bookings@inbound.savige.me`**. Cloudflare Email Routing on the **`inbound`** subdomain delivers to Worker **`waypoint-email-inbound`**, which POSTs to PocketBase `/api/waypoint/email-inbound`. Matching uses the user’s saved **send-from** address (Planner → Email imports), not the `bookings@inbound…` destination.

| Piece | Detail |
| --- | --- |
| Inbox | `bookings@inbound.savige.me` |
| Apex MX | Still **Proton** (`mail.protonmail.ch` / `mailsec.protonmail.ch`) — do not point `@` at Cloudflare |
| Inbound MX | `inbound.savige.me` → Cloudflare Email Routing (`route*.mx.cloudflare.net`) |
| Worker | `waypoint-email-inbound` → `https://pb-inbound.savige.me/api/waypoint/email-inbound` |
| Tunnel | `cloudflared-waypoint` on NAS; path-limited to that webhook only (Bearer secret required) |
| App | Planner **Email imports** — set **send-from** to your Proton address (e.g. `ryan@savige.me`) |

Code: `workers/cloudflare-email-inbound/`, `pocketbase/pb_hooks/booking_email.pb.js`, `src/bookingEmailParse.ts`.

**Property photos:** Proton forwards usually strip `<img>` tags. The Cloudflare worker still scans MIME/CDN URLs, but PocketBase is the reliable path: after parse, if `photoUrl` is empty and `bookingUrl` is a Booking/Airbnb listing, the hook fetches the listing via Jina Reader (`r.jina.ai`) and picks the best hotel `xdata` / muscache image. Chrome URLs (`design-assets`, flags, logos, static/fb tiles) are rejected. Re-forwarding the same confirmation **updates** the existing booking (matched by confirmation code) instead of duplicating it. Airbnb photos resolve from the listing `og:image` (direct fetch); truncated Proton muscache stubs are rejected.

## Related

- PocketBase page in this wiki — admin, hooks, backup
- `DEPLOY.md` / `deploy/SYNOLOGY.md` in the project
- Cloudflare worker README under `workers/cloudflare-email-inbound/`

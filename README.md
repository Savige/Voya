# Waypoint

Private household travel planner — multi-day trips, destinations, lodging, flights, day stops, budget, and a MapLibre globe. Runs as a Vite/React SPA with **PocketBase** for auth and sync.

**Live:** [waypoint.savige.me](https://waypoint.savige.me) · **API:** [pocketbase.savige.me](https://pocketbase.savige.me)

> Repo folder may still be named `Voya`; the product is **Waypoint**.

## Features

| Tab | Purpose |
| --- | --- |
| **Planner** | Ordered destinations (nights), lodging, flights/drives between stays |
| **Itinerary** | Destinations journey view + calendar; day stops along the path |
| **Budget** | Trip spend rollup with currency conversion |
| **Tips** | Pack list and trip tips |
| **Map** | Chronological route on a globe/flat MapLibre map with starfield chrome |

Also: shared trips, optional email → booking import, flight schedule lookup (AeroDataBox), place search without a Google Maps billing key.

Without PocketBase configured, the app still works in **local-only** mode (`localStorage`).

## Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind, MapLibre GL, dnd-kit, lucide-react
- **Backend:** PocketBase (SQLite + JS hooks under `pocketbase/`)
- **Deploy:** Docker Compose on Synology NAS + nginx reverse proxy (`*.savige.me`)

## Quick start (local)

```bash
cp .env.example .env
# VITE_POCKETBASE_URL=http://127.0.0.1:8090

npm install
npm run dev
```

Open the Vite URL (default `http://localhost:5173`).

Optional: run PocketBase locally (see `pocketbase/`) or point `.env` at the NAS API:

```bash
VITE_POCKETBASE_URL=https://pocketbase.savige.me
```

```bash
npm run build    # typecheck + production bundle
npm run preview  # serve the build locally
```

`VITE_*` values are **inlined at build time** — change the API host → rebuild.

## Environment

| Variable | Where | Notes |
| --- | --- | --- |
| `VITE_POCKETBASE_URL` | `.env` / `deploy/.env.production` | PocketBase base URL (required for sync) |
| `VITE_DEV_AUTH_BYPASS` | local `.env` | Dev-only auth shortcut |
| `AERODATABOX_RAPIDAPI_KEY` | PocketBase / deploy env | Flight schedule lookup (server-side) |
| `BOOKING_EMAIL_WEBHOOK_SECRET` | PocketBase / worker | Email inbound webhook auth |

Examples: [`.env.example`](.env.example), [`deploy/.env.production.example`](deploy/.env.production.example).

## Repo layout

```text
src/                 React app (Planner, Itinerary, Map, Budget, …)
pocketbase/          Dockerfile, migrations, hooks (trips, bookings, …)
deploy/              Compose, nginx, Synology proxy, savige.me cutover scripts
workers/             Cloudflare Email Routing → inbound booking worker
Projects/bookstack/  Household wiki notes for Waypoint
public/              Static assets (favicon, planet textures for the map sky)
```

## Deploy (NAS)

Production overview: **[DEPLOY.md](DEPLOY.md)** · Synology detail: **[deploy/SYNOLOGY.md](deploy/SYNOLOGY.md)** · compose notes: **[deploy/README.md](deploy/README.md)**

```bash
cp deploy/.env.production.example deploy/.env.production
# edit VITE_POCKETBASE_URL=https://pocketbase.savige.me

docker compose -f deploy/docker-compose.yml up -d --build
sudo bash deploy/install-synology-proxy.sh
```

| Host | Backend |
| --- | --- |
| `waypoint.savige.me` | nginx SPA (:8081) |
| `pocketbase.savige.me` | PocketBase (:8090) |

Hostname cutover notes: [`deploy/SAVIGE-ME-CUTOVER.md`](deploy/SAVIGE-ME-CUTOVER.md).

## Data model (short)

| Concept | Meaning |
| --- | --- |
| **Trip** | Country/dates container |
| **Stay / destination** | Place + date range on the route |
| **Accommodation** | Optional lodging nested on a stay |
| **Activity / stop** | Day item on the covering stay (Itinerary) |
| **Transport** | Flight or drive leg between stays |

## Related docs

- Household wiki draft: [`Projects/bookstack/docs/waypoint.md`](Projects/bookstack/docs/waypoint.md)
- Email inbound worker: [`workers/cloudflare-email-inbound/README.md`](workers/cloudflare-email-inbound/README.md)
- Reverse proxy / NPM: [`deploy/NPM.md`](deploy/NPM.md)

## License

Private / household use — not published as an open-source product.

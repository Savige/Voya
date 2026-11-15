# Deploying Waypoint

Production host: **https://waypoint.savige.me**  
API (PocketBase): **https://pocketbase.savige.me**

Hosted on the Synology NAS (LAN). **No GitHub Actions deploy** — update from this Mac over SSH.

## Usual update (from Mac)

```bash
./deploy/deploy-nas.sh
```

That syncs the repo to `/volume1/docker/waypoint`, rebuilds images, recreates the SPA (`waypoint`) and PocketBase (`waypoint-pb17`). Leaves `pb_data` and `deploy/.env.production` on the NAS untouched.

## First-time / proxy

See **[deploy/SYNOLOGY.md](deploy/SYNOLOGY.md)**.

```bash
cp deploy/.env.production.example deploy/.env.production
# on NAS after sync:
docker-compose -f deploy/docker-compose.yml up -d --build
sudo bash deploy/install-synology-proxy.sh
```

| Variable | Required? | Notes |
|----------|-----------|--------|
| `VITE_POCKETBASE_URL` | Yes for sync | `https://pocketbase.savige.me` |

No Google Maps/Places keys. Missing PocketBase URL → local-only browser storage.

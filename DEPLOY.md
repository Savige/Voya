# Deploying Waypoint

Production host: **https://waypoint.savige.me**  
API (PocketBase): **https://pocketbase.savige.me**

See **[deploy/SYNOLOGY.md](deploy/SYNOLOGY.md)**.

```bash
cp deploy/.env.production.example deploy/.env.production
docker-compose -f deploy/docker-compose.yml up -d --build
sudo bash deploy/install-synology-proxy.sh
```

| Variable | Required? | Notes |
|----------|-----------|--------|
| `VITE_POCKETBASE_URL` | Yes for sync | `https://pocketbase.savige.me` |

No Google Maps/Places keys. Missing PocketBase URL → local-only browser storage.

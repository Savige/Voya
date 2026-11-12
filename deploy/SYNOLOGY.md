# Deploy Waypoint on Synology

- App: https://waypoint.ryansavige.com → container port **8081**
- API: https://pocketbase.ryansavige.com → PocketBase **8090**

## Quick start

```bash
# On NAS, as rsavige (or sync from Mac)
cd /volume1/docker/waypoint
cp deploy/.env.production.example deploy/.env.production
# VITE_POCKETBASE_URL=https://pocketbase.ryansavige.com

docker-compose -f deploy/docker-compose.yml up -d --build
sudo bash deploy/install-synology-proxy.sh
```

Create the first PocketBase admin at https://pocketbase.ryansavige.com/_/  
Turn off email verification for personal use.

## Backup

`pocketbase/pb_data/` — Hyper Backup or copy regularly.

# Waypoint deployment (Proxmox / Linux VM)

| File | Purpose |
|------|---------|
| [SUPABASE.md](SUPABASE.md) | Clone and run official Supabase Docker stack; env and security |
| [SERVER_SETUP.md](SERVER_SETUP.md) | This server’s Supabase path, ports, and compose command (if present) |
| [NPM.md](NPM.md) | **Nginx Proxy Manager** — HTTPS, Proxy Hosts, ports |
| [apply-migration.sh](apply-migration.sh) | Run `001_user_trips_and_profiles.sql` against the `db` container |
| [docker-compose.yml](docker-compose.yml) | Build and run the static site (nginx on port 8081) |
| [nginx.site.example.conf](nginx.site.example.conf) | Manual Nginx + certbot (only if you do not use NPM) |
| [.env.production.example](.env.production.example) | Template for `deploy/.env.production` (build args) |
| [deploy.sh](deploy.sh) | Server script: `git pull` + rebuild Waypoint Docker image |
| [DEPLOY_CI.md](DEPLOY_CI.md) | GitHub Actions deploy on push to `main` (SSH secrets) |

Quick start (after Supabase is up and `.env` is configured):

```bash
cp deploy/.env.production.example deploy/.env.production
# Edit deploy/.env.production — VITE_* must match your public API URL and anon key

docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production up -d --build
```

The app listens on **port `8081`** on the host. Put **Nginx Proxy Manager** in front for TLS and public hostnames — use **`172.17.0.1:8081`** as the upstream if NPM runs in Docker (see [NPM.md](NPM.md)).

See the **Self-hosted on Proxmox** section in [DEPLOY.md](../DEPLOY.md) for the full checklist.

### Deploy after every `git push` (optional)

Configure GitHub Actions secrets and use [DEPLOY_CI.md](DEPLOY_CI.md). On the server you can always run `./deploy/deploy.sh` from the repo root.

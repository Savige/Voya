# Self-hosted Supabase on this server

Paths and commands used when configuring the stack on this machine.

## Location

- **Supabase Docker:** `/home/ryan/supabase/docker`
- **Env file:** `/home/ryan/supabase/docker/.env` (secrets — do not commit)

## Start / stop

```bash
cd /home/ryan/supabase/docker
docker compose -f docker-compose.yml -f docker-compose.mail.yml up -d
docker compose -f docker-compose.yml -f docker-compose.mail.yml down   # stop
```

The extra **`docker-compose.mail.yml`** runs **Inbucket** so GoTrue can send signup/confirmation emails to a local catcher (no real SMTP required for testing).

## Ports

| Service | Port | Notes |
|---------|------|--------|
| Kong (HTTP) | **8000** | NPM should proxy `api.ryansavige.com` → `172.17.0.1:8000` |
| Kong (HTTPS) | **8444** | Default 8443 was in use by another container; changed in `.env` |
| Inbucket web UI | **9000** | `http://127.0.0.1:9000` — read confirmation emails in dev |
| Inbucket SMTP | **2500** | Used by `auth`; hostname `supabase-mail` on Docker network |

## URLs in `.env`

Set for `ryansavige.com`:

- `SUPABASE_PUBLIC_URL=https://api.ryansavige.com`
- `API_EXTERNAL_URL=https://api.ryansavige.com`
- `SITE_URL=https://waypoint.ryansavige.com`
- `ADDITIONAL_REDIRECT_URLS` includes the waypoint app origin
- `ENABLE_EMAIL_AUTOCONFIRM=false` (confirm via email)

## Waypoint build

`deploy/.env` should contain `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from this stack’s `.env` (Compose auto-loads `deploy/.env`; see [README](README.md)). Rebuild after changing keys:

```bash
cd /home/ryan/Voya
docker compose -f deploy/docker-compose.yml up -d --build
```

## Production email

Replace Inbucket with a real SMTP provider: edit `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` in `/home/ryan/supabase/docker/.env`, then `docker compose ... up -d` again. You can drop `docker-compose.mail.yml` once real SMTP works.

See [SUPABASE.md](SUPABASE.md) for general documentation.

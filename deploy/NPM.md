# Nginx Proxy Manager (HTTPS)

Use **Nginx Proxy Manager** (NPM) as the single reverse proxy on **80/443**. Do not run another proxy (e.g. Caddy) on the same ports for the same hostnames.

## Admin UI

Open **`http://YOUR_SERVER_IP:81`** (default NPM admin port). First login is often **admin@example.com** / **changeme** — change the password when prompted.

## DNS

Before requesting Let’s Encrypt certificates, create **A** (or **CNAME**) records so each hostname resolves to this server:

- `waypoint.ryansavige.com`
- `api.ryansavige.com`
- `cc.ryansavige.com` (if used)

## Proxy Hosts

**Hosts → Proxy Hosts → Add Proxy Host**

| Domain names | Scheme | Forward hostname | Forward port | Websockets |
|--------------|--------|------------------|--------------|------------|
| `waypoint.ryansavige.com` | HTTP | see below | `8081` | Optional (enable if you see connection issues) |
| `api.ryansavige.com` | HTTP | see below | `8000` | **On** (Supabase Auth / Realtime) |
| `cc.ryansavige.com` | HTTP | see below | *your app port* | As needed |

**Forward hostname:** If NPM runs **on the host** (not in Docker), use **`127.0.0.1`**. If NPM runs **inside Docker** (common), use **`172.17.0.1`** on Linux so the container reaches the host — **`127.0.0.1` inside the NPM container is not your host** and will 502. Do **not** use a public DDNS name (e.g. `ryan.1260.me`) as the forward target.

- **8081** — Waypoint from [`docker-compose.yml`](docker-compose.yml) (published on the host so Docker can reach it; firewall **8081** from the WAN if you do not want it public).
- **8000** — Supabase Kong; confirm `KONG_HTTP_PORT` in Supabase `docker/.env`.

**SSL tab:** Request a Let’s Encrypt certificate after DNS works. Enable **Force SSL**.

## “Congratulations” default page

You see that page when the hostname you open is **not** listed on any Proxy Host, or DNS does not point here yet. Add the Proxy Host for that exact name and wait for DNS propagation.

## Supabase and Waypoint

- Rebuild Waypoint with `VITE_SUPABASE_URL=https://api.ryansavige.com` (see [`.env.production.example`](.env.production.example)).
- In Supabase `docker/.env`, set public URLs to `https://api.ryansavige.com` and site URL to `https://waypoint.ryansavige.com` as in [SUPABASE.md](SUPABASE.md).

## Firewall

Allow **80**, **443**, and **81** (admin) to this host as appropriate. Do not expose Postgres **5432** publicly.

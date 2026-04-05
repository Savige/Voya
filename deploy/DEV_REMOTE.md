# Instant reload at waypoint (like localhost)

Production uses Docker on **port 8081**. For **hot module replacement** at `https://waypoint.ryansavige.com`, run the **Vite dev server** on **port 5173** and point Nginx Proxy Manager (NPM) at that port instead.

## 1. One-time: dev env on the machine that runs `npm run dev`

Create **`.env.development.local`** in the repo root (gitignored). Copy Supabase values from `deploy/.env.production` on the server or from `deploy/.env.production.example`:

```bash
# Required for the app
VITE_SUPABASE_URL=https://api.ryansavige.com
VITE_SUPABASE_ANON_KEY=your_anon_key

# Optional Google Maps (same as production if you use maps)
VITE_GOOGLE_MAPS_API_KEY=
VITE_GOOGLE_MAPS_MAP_ID=

# Required when the site is opened at this hostname (HTTPS + NPM)
DEV_HMR_HOST=waypoint.ryansavige.com
```

`DEV_HMR_HOST` makes Vite’s HMR WebSocket use `wss://` on port **443** so it works behind NPM’s SSL.

## 2. Nginx Proxy Manager

**Hosts →** your `waypoint.ryansavige.com` proxy:

| Setting | Value |
|--------|--------|
| Forward hostname | `172.17.0.1` (NPM in Docker; use `127.0.0.1` if NPM is on the host) |
| Forward port | **`5173`** (dev) instead of `8081` (Docker) |
| Websockets | **On** |

Switch back to **8081** when you want the static Docker build again.

## 3. Run the dev server (same host as NPM)

On the server (SSH), from the repo:

```bash
cd /path/to/Voya
npm install   # once
npm run dev
```

Vite listens on **0.0.0.0:5173** (see `vite.config.ts`). Open `https://waypoint.ryansavige.com` — edits on **that machine** reload immediately.

## 4. Edit on your laptop, see waypoint (SSH reverse tunnel)

If the repo lives on your **laptop** but NPM runs on the **VM**, forward the laptop’s dev server to the VM:

1. On the **VM** `sshd_config`, allow remote binds (e.g. `GatewayPorts clientspecified` or `yes`). Reload `sshd`.
2. Terminal A (laptop): `npm run dev` with `.env.development.local` including `DEV_HMR_HOST=waypoint.ryansavige.com`.
3. Terminal B (laptop):  
   `./deploy/dev-tunnel.sh user@your-vm`

NPM still forwards `waypoint → 172.17.0.1:5173`. The tunnel makes **host:5173** on the VM reach **your laptop’s** Vite process.

## Firewall

If you expose **5173** only through NPM on 443, you do not need to open 5173 on the public firewall. If anything connects to 5173 on the host directly, restrict it (e.g. firewall / SSH only).

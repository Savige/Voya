# Cloudflare Email Routing → Waypoint

Apex `@savige.me` mail stays on **Proton**. Inbound booking mail uses subdomain routing only.

## Flow

1. Forward confirmations to **`bookings@inbound.savige.me`**
2. Cloudflare Email Routing (MX on `inbound.savige.me` only) → Worker **`waypoint-email-inbound`**
3. Worker POSTs to **`https://pb-inbound.savige.me/api/waypoint/email-inbound`** (Cloudflare Tunnel)
4. PocketBase stores `booking_imports` for the matched user

## Security

- Tunnel hostname **`pb-inbound.savige.me`** is path-limited to **`/api/waypoint/email-inbound`** only (other paths 404)
- Origin is LAN PocketBase; not the full admin UI
- Webhook requires Bearer **`WAYPOINT_EMAIL_WEBHOOK_SECRET`** (same as NAS `BOOKING_EMAIL_WEBHOOK_SECRET`)
- `booking_imports` rows are per-user (PocketBase rules); not a public mailbox
- Do **not** point apex MX at Cloudflare

## Secrets (Worker)

- `WAYPOINT_EMAIL_WEBHOOK_URL` = `https://pb-inbound.savige.me/api/waypoint/email-inbound`
- `WAYPOINT_EMAIL_WEBHOOK_SECRET` = match NAS `BOOKING_EMAIL_WEBHOOK_SECRET`

## Tunnel (NAS)

- Container: `cloudflared-waypoint` (`--network host`, token in `/volume1/docker/cloudflared-waypoint/token.txt`)
- Tunnel id: `b8115fde-4652-4f05-abbf-860e0bfd430b`
- DNS: proxied CNAME `pb-inbound` → `{tunnel-id}.cfargotunnel.com`

## App

In Planner → **Email imports**, set **send-from** to the Proton address you forward with (e.g. `ryan@savige.me`).

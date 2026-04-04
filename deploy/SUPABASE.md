# Self-hosted Supabase (Docker)

Waypoint expects the full Supabase stack (Postgres, Auth, PostgREST, Kong, etc.). Use the **official** Docker Compose setup; do not vendor a fork of their compose files in this repo.

## 1. Clone and configure

1. Install Git and Docker (and the Compose plugin) on the VM.
2. Clone [Supabase](https://github.com/supabase/supabase) and work in the `docker` directory:

   ```bash
   sudo git clone --depth 1 https://github.com/supabase/supabase.git /opt/supabase
   cd /opt/supabase/docker
   ```

3. Copy `.env.example` to `.env` and follow **[Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)** to:
   - Change default passwords and secrets.
   - Generate JWT settings and keys as documented.
   - Set `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`, and `ADDITIONAL_REDIRECT_URLS` to match how browsers will reach your instance (e.g. `https://api.ryansavige.com` for the API and `https://waypoint.ryansavige.com` for the app).

4. Start the stack (from the `docker` directory):

   ```bash
   docker compose up -d
   ```

   Optional: add a local mail catcher for development (Inbucket) so confirmation emails can be read without real SMTP:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.mail.yml up -d
   ```

   (See [SERVER_SETUP.md](SERVER_SETUP.md) if this repo documents a specific server layout.)

5. Confirm Kong is reachable (default HTTP port from `.env`: often `8000`). The **Project URL** you pass to the frontend is this API URL (e.g. `https://api.ryansavige.com` behind a reverse proxy).

6. From `.env`, copy `ANON_KEY` (and optionally verify in Studio) for `VITE_SUPABASE_ANON_KEY` when building Waypoint.

### Email confirmation (signup link)

Waypoint sends users to a **“Confirm your email”** screen and uses `emailRedirectTo` (your app origin) after they click the link in the email. For that to work:

1. **SMTP** — Configure GoTrue mail settings in `docker/.env` (see [Auth emails](https://supabase.com/docs/guides/self-hosting/docker#configuring-auth-emails) / `GOTRUE_SMTP_*` in the official `.env.example`).
2. **Do not auto-confirm** — Set **`ENABLE_EMAIL_AUTOCONFIRM=false`** (or `GOTRUE_MAILER_AUTOCONFIRM=false` depending on your stack version) so new users must click the link before they can sign in.
3. **Redirect URLs** — In Studio **Authentication → URL Configuration**, add your app URL (e.g. `https://waypoint.ryansavige.com` and `https://waypoint.ryansavige.com/**`) to **Redirect URLs** so the confirmation link can return users to the app.

If email is not configured, sign-up may still create users (depending on settings) but no message will arrive until SMTP is set.

## 2. Apply Waypoint schema

After Postgres is healthy, apply the migration that creates `user_trips` and `profiles`:

```bash
export SUPABASE_DOCKER_DIR=/opt/supabase/docker   # adjust if different
/path/to/Voya/deploy/apply-migration.sh
```

Or run the SQL manually in Studio (**SQL** → new query) using the contents of `supabase/migrations/001_user_trips_and_profiles.sql`.

## 3. Security

- Do not expose Postgres port `5432` to the public internet unless required and locked down.
- Prefer TLS on `api.ryansavige.com` via Nginx Proxy Manager (or Nginx) in front of Kong.
- Review [Configuring and securing Supabase](https://supabase.com/docs/guides/self-hosting/docker#configuring-and-securing-supabase).

## 4. Updates

Follow upstream [docker/README.md](https://github.com/supabase/supabase/blob/master/docker/README.md): backup the database, review changelog, pull images, and restart.

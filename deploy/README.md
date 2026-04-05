# Waypoint deployment

## Env file

- **Edit:** `deploy/.env.production` (gitignored secrets).
- **Compose** reads `deploy/.env` next to `docker-compose.yml`. In this repo, `deploy/.env` should be a **symlink** to `.env.production`:
  ```bash
  cd deploy && ln -sf .env.production .env
  ```
  Then you do **not** need `--env-file` when the path would be wrong for your shell cwd.

## Wrong path `deploy/deploy/.env.production`

That happens if your **current directory** is already `deploy/` and you pass `--env-file deploy/.env.production` (the path is resolved under `deploy/` twice). From **inside** `deploy/`, use:
`--env-file .env.production`

Or run compose from the **repo root** with `--env-file deploy/.env.production`.

## Build and run

From repo root:

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

### Live image should match local `npm run build`

Local production builds read **`.env.production`** in the repo root (and `deploy/.env.production` is the usual source of truth for deploy). The Docker **builder** now copies **`deploy/.env.production` into the build** when that file exists on the machine running `docker compose build`, so inlined `VITE_*` values match a local `npm run build` after you sync env.

- Keep **`deploy/.env`** (symlink to `.env.production`) filled out; Compose still passes those values as build-args and they **override** the file if both set.
- If the live site still looks wrong vs **localhost**, you are often comparing **`npm run dev`** (dev auth bypass, HMR) to production — use **`npm run build && npm run preview`** to compare apples to apples.
- After changing env, rebuild with **`--no-cache`** once so layers do not reuse an old build:  
  `docker compose -f deploy/docker-compose.yml build --no-cache`

### Build label (bottom-right)

Each **`npm run build`** and each **Docker image build** embeds a fresh **`#buildNumber · YYYY-MM-DD HH:MM:SS UTC`** string (see `resolveAppBuildLabel` in `vite.config.ts`). It is **not** read from `.env` files, so it cannot go stale there. Optional overrides: shell **`VITE_APP_BUILD`** (full label), **`BUILD_NUMBER`** / CI vars (`GITHUB_RUN_NUMBER`, etc.). Docker sets **`BUILD_NUMBER`** to **`yyyymmddHHMMSS` (UTC)** when not passed.

More detail: [SUPABASE.md](SUPABASE.md), [NPM.md](NPM.md), [DEPLOY.md](../DEPLOY.md).

# Deploy Waypoint from GitHub Actions

Synology (`192.168.1.165`) is LAN-only. GitHub-hosted `ubuntu-latest` runners cannot SSH to it, so deploy uses a **self-hosted runner on the home Mac**.

## One-time: register the runner

On the Mac that can reach the NAS (same LAN as `192.168.1.165`):

1. In GitHub: **Savige/Voya → Settings → Actions → Runners → New self-hosted runner** → macOS arm64.
2. Or install under `~/actions-runners/voya-waypoint`:

```bash
mkdir -p ~/actions-runners/voya-waypoint && cd ~/actions-runners/voya-waypoint
curl -o actions-runner-osx-arm64-2.338.2.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-osx-arm64-2.338.2.tar.gz
tar xzf ./actions-runner-osx-arm64-2.338.2.tar.gz
# Get a registration token from the New runner page, then:
./config.sh --url https://github.com/Savige/Voya --token <TOKEN> \
  --name voya-mac-lan --labels synology-lan --work _work
./svc.sh install && ./svc.sh start
```

Labels required by `.github/workflows/deploy.yml`: `self-hosted`, `macOS`, `synology-lan`.

## What the workflow does

On every push to `main` (and `workflow_dispatch`):

1. Checkout on the Mac runner
2. Run `deploy/ci-deploy-nas.sh`:
   - `rsync` the repo to `/volume1/docker/waypoint` (skips `pb_data` and `deploy/.env.production`)
   - `docker compose build` on the NAS
   - Recreate the `waypoint` SPA container
   - Recreate `waypoint-pb17` with the same volume mounts and `deploy/.env.production`

## Secrets / keys

No GitHub deploy secrets are required if the runner Mac already has:

- SSH key: `~/.ssh/id_ed25519_nas` (user `rsavige` on the NAS)
- Optional repo/org vars: `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_REMOTE_DIR`

Keep `deploy/.env.production` **only on the NAS** (never commit it).

## Manual deploy (same script)

```bash
./deploy/ci-deploy-nas.sh
```

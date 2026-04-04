# CI: deploy on push to `main`

The workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) SSHs into your server and runs [`deploy.sh`](deploy.sh).

## GitHub repository secrets

Create these under **Settings → Secrets and variables → Actions**:

| Secret | Example | Description |
|--------|---------|-------------|
| `DEPLOY_HOST` | `203.0.113.50` or `ssh.example.com` | Hostname or IP **reachable from the public internet** on port 22 |
| `DEPLOY_USER` | `ryan` | SSH login user |
| `DEPLOY_SSH_KEY` | *(private key PEM)* | Private key whose **public** key is in `~/.ssh/authorized_keys` on the server |
| `DEPLOY_PATH` | `/home/ryan/Voya` | Absolute path to the git clone on the server |

**Network requirement:** GitHub-hosted runners cannot SSH to a **private LAN-only** address. If your VM has no public SSH:

- Install a **[self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners)** on the VM and change the workflow to `runs-on: self-hosted` with no SSH step (run `./deploy/deploy.sh` directly), or  
- Use a **webhook** or **Tailscale**/VPN so CI can reach the host, or  
- Port-forward SSH on your router to the VM (restrict by firewall to known IPs if possible).

## Server one-time setup

1. **Clone** this repo on the server (not a tarball): `git clone … /home/ryan/Voya`
2. Copy **`deploy/.env.production`** from the example and fill in keys (file is gitignored).
3. If Git complains about `dubious ownership`, run:  
   `git config --global --add safe.directory /home/ryan/Voya`
4. Test manually:  
   `cd /home/ryan/Voya && ./deploy/deploy.sh`

## Manual deploy

Any time, on the server:

```bash
cd /path/to/Voya
./deploy/deploy.sh
```

Optional: `DEPLOY_BRANCH=other-branch ./deploy/deploy.sh`  
Optional: `ENV_FILE=deploy/.env.production ./deploy/deploy.sh` (default).

## What gets deployed

Only the **Waypoint** stack from [`docker-compose.yml`](docker-compose.yml). The self-hosted **Supabase** compose (if any) is separate; update that stack by hand or add another workflow later.

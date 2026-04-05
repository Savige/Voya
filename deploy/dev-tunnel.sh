#!/usr/bin/env bash
# Forward this machine's Vite dev server (127.0.0.1:5173) to the remote host on 0.0.0.0:5173
# so Nginx Proxy Manager can reach 172.17.0.1:5173. Requires sshd GatewayPorts — see deploy/DEV_REMOTE.md
set -euo pipefail
if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 user@host"
  exit 1
fi
exec ssh -N \
  -o ServerAliveInterval=60 \
  -o ExitOnForwardFailure=yes \
  -R 0.0.0.0:5173:127.0.0.1:5173 \
  "$@"

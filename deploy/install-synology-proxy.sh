#!/bin/bash
# Install Synology reverse proxies:
#   https://waypoint.savige.me     ->  http://127.0.0.1:8081  (SPA)
#   https://pocketbase.savige.me   ->  http://127.0.0.1:8090  (PocketBase)
# Run on the NAS as admin:  sudo bash deploy/install-synology-proxy.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo."
  exit 1
fi

RP_JSON="/usr/syno/etc/www/ReverseProxy.json"
BACKUP="${RP_JSON}.bak.$(date +%Y%m%d%H%M%S)"
cp -a "$RP_JSON" "$BACKUP"
echo "Backed up ReverseProxy.json -> $BACKUP"

APP_RP_ID="$(cat /proc/sys/kernel/random/uuid)"
API_RP_ID="$(cat /proc/sys/kernel/random/uuid)"
APP_SITE_ID="$(cat /proc/sys/kernel/random/uuid)"
API_SITE_ID="$(cat /proc/sys/kernel/random/uuid)"
APP_SITE_CONF="/usr/local/etc/nginx/sites-available/${APP_SITE_ID}.w3conf"
API_SITE_CONF="/usr/local/etc/nginx/sites-available/${API_SITE_ID}.w3conf"
APP_LINK="/usr/local/etc/nginx/sites-enabled/server.waypoint-app.conf"
API_LINK="/usr/local/etc/nginx/sites-enabled/server.pocketbase.conf"

python3 - "$RP_JSON" "$APP_RP_ID" "$API_RP_ID" <<'PY'
import json, sys
path, app_id, api_id = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)

for key, rule in list(data.items()):
    if key == "version" or not isinstance(rule, dict):
        continue
    frontend = rule.get("frontend") or {}
    if frontend.get("fqdn") in (
        "waypoint.savige.me",
        "pocketbase.savige.me",
        "waypoint-api.savige.me",
        "voya.savige.me",
        "voya-api.savige.me",
        # legacy ryansavige.com hosts (remove on cutover)
        "waypoint.ryansavige.com",
        "pocketbase.ryansavige.com",
        "waypoint-api.ryansavige.com",
        "voya.ryansavige.com",
        "voya-api.ryansavige.com",
    ):
        del data[key]

def rule(rid, fqdn, port, desc):
    return {
        "_key": rid,
        "description": desc,
        "frontend": {
            "acl": None,
            "fqdn": fqdn,
            "https": {"hsts": False},
            "port": 443,
            "protocol": 1,
        },
        "backend": {
            "fqdn": "127.0.0.1",
            "port": port,
            "protocol": 0,
        },
        "customize_headers": [
            {"name": "Upgrade", "value": "$http_upgrade"},
            {"name": "Connection", "value": "$connection_upgrade"},
        ],
        "proxy_connect_timeout": 60,
        "proxy_http_version": 1,
        "proxy_intercept_errors": False,
        "proxy_read_timeout": 60,
        "proxy_send_timeout": 60,
    }

data[app_id] = rule(app_id, "waypoint.savige.me", 8081, "Waypoint app")
data[api_id] = rule(api_id, "pocketbase.savige.me", 8090, "PocketBase (Waypoint)")
with open(path, "w") as f:
    json.dump(data, f, indent="\t")
    f.write("\n")
print("Wrote ReverseProxy rules", app_id, api_id)
PY

CERT_INCLUDE=""
TLS_PROFILE=""
for conf in /usr/syno/etc/www/certificate/*/cert.conf; do
  [[ -f "$conf" ]] || continue
  if grep -q "savige.me" "$conf" 2>/dev/null; then
    dir=$(dirname "$conf")
    base=$(basename "$dir")
    CERT_INCLUDE="include /usr/syno/etc/www/certificate/${base}/cert.conf*;"
    TLS_PROFILE="include /usr/syno/etc/security-profile/tls-profile/config/${base}.conf*;"
    break
  fi
done
# Temporary fallback while *.savige.me cert is being issued
if [[ -z "${CERT_INCLUDE}" ]]; then
  for conf in /usr/syno/etc/www/certificate/*/cert.conf; do
    [[ -f "$conf" ]] || continue
    if grep -q "ryansavige.com" "$conf" 2>/dev/null; then
      dir=$(dirname "$conf")
      base=$(basename "$dir")
      CERT_INCLUDE="include /usr/syno/etc/www/certificate/${base}/cert.conf*;"
      TLS_PROFILE="include /usr/syno/etc/security-profile/tls-profile/config/${base}.conf*;"
      break
    fi
  done
fi

if [[ -z "${CERT_INCLUDE}" ]]; then
  CERT_DIR="/usr/syno/etc/certificate/ReverseProxy/${APP_RP_ID}"
  WWW_CERT_DIR="/usr/syno/etc/www/certificate/ReverseProxy_${APP_RP_ID}"
  ACME_DIR=""
  for d in /volume1/docker/acme/config/*.savige.me_ecc /volume1/docker/acme/config/*.ryansavige.com_ecc; do
    [[ -d "$d" ]] || continue
    ACME_DIR="$d"
    break
  done
  if [[ -z "$ACME_DIR" ]]; then
    echo "No ACME cert dir found under /volume1/docker/acme/config for savige.me (or legacy ryansavige.com)."
    exit 1
  fi
  mkdir -p "$CERT_DIR" "$WWW_CERT_DIR"
  cp -f "$ACME_DIR/fullchain.cer" "$CERT_DIR/fullchain.pem"
  cp -f "$ACME_DIR/fullchain.cer" "$CERT_DIR/cert.pem"
  KEY_FILE=$(ls "$ACME_DIR"/*.key 2>/dev/null | head -1)
  cp -f "$KEY_FILE" "$CERT_DIR/privkey.pem"
  cp -f "$ACME_DIR/ca.cer" "$CERT_DIR/chain.pem"
  chmod 400 "$CERT_DIR"/*
  cat > "$WWW_CERT_DIR/cert.conf" <<EOF
ssl_certificate     /usr/syno/etc/certificate/ReverseProxy/${APP_RP_ID}/fullchain.pem;
ssl_certificate_key /usr/syno/etc/certificate/ReverseProxy/${APP_RP_ID}/privkey.pem;
EOF
  CERT_INCLUDE="include /usr/syno/etc/www/certificate/ReverseProxy_${APP_RP_ID}/cert.conf*;"
  TLS_PROFILE=""
fi

write_site() {
  local conf="$1" host="$2" backend="$3"
  cat > "$conf" <<EOF

server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name ${host} ;

    if ( \$host !~ "(^${host}\$)" ) { return 404; }

    ${CERT_INCLUDE}
    ${TLS_PROFILE}

    proxy_ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_connect_timeout 60;
        proxy_read_timeout 60;
        proxy_send_timeout 60;
        proxy_intercept_errors off;
        proxy_http_version 1.1;
        proxy_set_header        Upgrade            \$http_upgrade;
        proxy_set_header        Connection         \$connection_upgrade;
        proxy_set_header        Host               \$http_host;
        proxy_set_header        X-Real-IP          \$remote_addr;
        proxy_set_header        X-Forwarded-For    \$proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto  \$scheme;
        proxy_pass ${backend};
    }

    error_page 403 404 500 502 503 504 /error_page;

    location /error_page {
        internal;
        root /usr/syno/share/nginx;
        rewrite (.*) /error.html break;
        allow all;
    }
}
EOF
}

write_site "$APP_SITE_CONF" "waypoint.savige.me" "http://127.0.0.1:8081"
write_site "$API_SITE_CONF" "pocketbase.savige.me" "http://127.0.0.1:8090"

# Drop old enabled links if re-running
rm -f /usr/local/etc/nginx/sites-enabled/server.waypoint-app.conf \
      /usr/local/etc/nginx/sites-enabled/server.waypoint-api.conf \
      /usr/local/etc/nginx/sites-enabled/server.pocketbase.conf \
      /usr/local/etc/nginx/sites-enabled/server.voya-app.conf \
      /usr/local/etc/nginx/sites-enabled/server.voya-api.conf

ln -sfn "$APP_SITE_CONF" "$APP_LINK"
ln -sfn "$API_SITE_CONF" "$API_LINK"

if nginx -t 2>/dev/null; then
  if command -v synoservicectl >/dev/null 2>&1; then
    synoservicectl --reload nginx || nginx -s reload
  elif command -v synoservice >/dev/null 2>&1; then
    synoservice --reload nginx || nginx -s reload
  else
    nginx -s reload
  fi
  echo "Reverse proxy enabled:"
  echo "  https://waypoint.savige.me    -> :8081"
  echo "  https://pocketbase.savige.me  -> :8090"
else
  echo "nginx -t failed; restore backup if needed: $BACKUP"
  exit 1
fi

echo
echo "DNS (Cloudflare DNS-only / grey cloud):"
echo "  A  waypoint    192.168.1.165"
echo "  A  pocketbase  192.168.1.165"
echo "  (or a *.savige.me wildcard covering both)"
echo
echo "DSM: Control Panel → Security → Certificate → assign *.savige.me to these reverse proxies if TLS looks wrong."

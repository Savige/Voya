#!/usr/bin/env python3
"""Restore pocketbase.ryansavige.com reverse proxy (cutover bridge).

Uses existing *.ryansavige.com ReverseProxy cert materials.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

RP_JSON = Path("/host/usr/syno/etc/www/ReverseProxy.json")
SITES_AVAIL = Path("/host/usr/local/etc/nginx/sites-available")
SITES_ENABLED = Path("/host/usr/local/etc/nginx/sites-enabled")
CERT_ROOT = Path("/host/usr/syno/etc/certificate/ReverseProxy")
WWW_CERT = Path("/host/usr/syno/etc/www/certificate")
TLS_ROOT = Path("/host/usr/syno/etc/security-profile/tls-profile/config")
ACME_ROOT = Path("/acme")
HOST_SITES_AVAIL = Path("/usr/local/etc/nginx/sites-available")
FQDN = "pocketbase.ryansavige.com"
LINK = "server.pocketbase-legacy.conf"


def install_ry_cert(cert_id: str) -> None:
    # Directory name literally starts with *
    acme = ACME_ROOT / "*.ryansavige.com_ecc"
    if not acme.is_dir():
        raise SystemExit(f"missing ACME dir {acme}")
    key = next(acme.glob("*.key"))
    cert_dir = CERT_ROOT / cert_id
    www_dir = WWW_CERT / f"ReverseProxy_{cert_id}"
    cert_dir.mkdir(parents=True, exist_ok=True)
    www_dir.mkdir(parents=True, exist_ok=True)
    TLS_ROOT.mkdir(parents=True, exist_ok=True)
    import shutil
    import os

    shutil.copy2(acme / "fullchain.cer", cert_dir / "fullchain.pem")
    shutil.copy2(acme / "fullchain.cer", cert_dir / "cert.pem")
    shutil.copy2(key, cert_dir / "privkey.pem")
    shutil.copy2(acme / "ca.cer", cert_dir / "chain.pem")
    for p in cert_dir.iterdir():
        os.chmod(p, 0o400)
    (www_dir / "cert.conf").write_text(
        f"ssl_certificate     /usr/syno/etc/certificate/ReverseProxy/{cert_id}/fullchain.pem;\n"
        f"ssl_certificate_key /usr/syno/etc/certificate/ReverseProxy/{cert_id}/privkey.pem;\n"
    )
    (TLS_ROOT / f"ReverseProxy_{cert_id}.conf").touch()
    print("installed ryansavige cert", cert_id)


def main() -> None:
    data = json.loads(RP_JSON.read_text())
    for key, rule in list(data.items()):
        if isinstance(rule, dict) and (rule.get("frontend") or {}).get("fqdn") == FQDN:
            del data[key]

    rid = str(uuid.uuid4())
    install_ry_cert(rid)
    data[rid] = {
        "_key": rid,
        "description": "PocketBase (legacy ryansavige.com)",
        "frontend": {
            "acl": None,
            "fqdn": FQDN,
            "https": {"hsts": False},
            "port": 443,
            "protocol": 1,
        },
        "backend": {"fqdn": "127.0.0.1", "port": 8090, "protocol": 0},
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
    RP_JSON.write_text(json.dumps(data, indent="\t") + "\n")

    cert_include = f"include /usr/syno/etc/www/certificate/ReverseProxy_{rid}/cert.conf*;"
    tls_include = (
        f"include /usr/syno/etc/security-profile/tls-profile/config/ReverseProxy_{rid}.conf*;"
    )
    site_id = str(uuid.uuid4())
    conf = SITES_AVAIL / f"{site_id}.w3conf"
    conf.write_text(
        f"""
server {{
    listen 80;
    listen [::]:80;
    server_name {FQDN};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name {FQDN} ;

    if ( $host !~ "(^{FQDN}$)" ) {{ return 404; }}

    {cert_include}
    {tls_include}

    proxy_ssl_protocols TLSv1.2 TLSv1.3;

    location / {{
        proxy_connect_timeout 60;
        proxy_read_timeout 60;
        proxy_send_timeout 60;
        proxy_intercept_errors off;
        proxy_http_version 1.1;
        proxy_set_header        Upgrade            $http_upgrade;
        proxy_set_header        Connection         $connection_upgrade;
        proxy_set_header        Host               $http_host;
        proxy_set_header        X-Real-IP          $remote_addr;
        proxy_set_header        X-Forwarded-For    $proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto  $scheme;
        proxy_pass http://127.0.0.1:8090;
    }}

    error_page 403 404 500 502 503 504 /error_page;

    location /error_page {{
        internal;
        root /usr/syno/share/nginx;
        rewrite (.*) /error.html break;
        allow all;
    }}
}}
"""
    )
    link = SITES_ENABLED / LINK
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(HOST_SITES_AVAIL / conf.name)
    print("wrote", conf.name, "->", LINK, "rp", rid)


if __name__ == "__main__":
    main()

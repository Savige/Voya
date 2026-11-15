#!/usr/bin/env python3
"""Configure Synology reverse proxy for *.savige.me household apps.

Runs inside a root docker container with host paths mounted under /host.
Keeps existing *.ryansavige.com rules during cutover.
"""
from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path

RP_JSON = Path("/host/usr/syno/etc/www/ReverseProxy.json")
SITES_AVAIL = Path("/host/usr/local/etc/nginx/sites-available")
SITES_ENABLED = Path("/host/usr/local/etc/nginx/sites-enabled")
WWW_CERT = Path("/host/usr/syno/etc/www/certificate")
CERT_ROOT = Path("/host/usr/syno/etc/certificate")
TLS_ROOT = Path("/host/usr/syno/etc/security-profile/tls-profile/config")
ACME = Path("/acme/savige.me_ecc")
HOST_SITES_AVAIL = Path("/usr/local/etc/nginx/sites-available")

# host, port, description, sites-enabled link, extra nginx snippets
HOSTS = [
    {
        "host": "waypoint.savige.me",
        "port": 8081,
        "desc": "Waypoint app",
        "link": "server.waypoint-app.conf",
        "read_timeout": 60,
        "send_timeout": 60,
        "body_size": None,
        "hsts": False,
        "extra_headers": [],
    },
    {
        "host": "pocketbase.savige.me",
        "port": 8090,
        "desc": "PocketBase (Waypoint)",
        "link": "server.pocketbase.conf",
        "read_timeout": 60,
        "send_timeout": 60,
        "body_size": None,
        "hsts": False,
        "extra_headers": [],
    },
    {
        "host": "docs.savige.me",
        "port": 6875,
        "desc": "BookStack docs",
        "link": "server.bookstack-docs.conf",
        "read_timeout": 120,
        "send_timeout": 120,
        "body_size": "100m",
        "hsts": True,
        "extra_headers": [
            {"name": "X-Forwarded-Proto", "value": "https"},
        ],
        "http_redirect_link": "server.bookstack-docs-http-redirect.conf",
    },
    {
        "host": "finance.savige.me",
        "port": 8787,
        "desc": "Budget planner",
        "link": "server.finance-app.conf",
        "read_timeout": 60,
        "send_timeout": 60,
        "body_size": None,
        "hsts": False,
        "extra_headers": [],
    },
]

# Only remove prior *.savige.me copies of these hosts (idempotent re-run).
REPLACE_FQDNS = {h["host"] for h in HOSTS}


def write_site(
    conf: Path,
    host: str,
    backend: str,
    cert_include: str,
    tls_profile: str,
    *,
    read_timeout: int,
    send_timeout: int,
    body_size: str | None,
    hsts: bool,
) -> None:
    body = f"\n    client_max_body_size {body_size};\n" if body_size else ""
    hsts_line = (
        '\n        add_header Strict-Transport-Security "max-age=15768000; includeSubDomains" always;'
        if hsts
        else ""
    )
    conf.write_text(
        f"""
server {{
    listen 80;
    listen [::]:80;
    server_name {host};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name {host} ;

    if ( $host !~ "(^{host}$)" ) {{ return 404; }}

    {cert_include}
    {tls_profile}

    proxy_ssl_protocols TLSv1.2 TLSv1.3;
{body}
    location / {{
        proxy_connect_timeout 60;
        proxy_read_timeout {read_timeout};
        proxy_send_timeout {send_timeout};
        proxy_intercept_errors off;
        proxy_http_version 1.1;
        proxy_set_header        Upgrade            $http_upgrade;
        proxy_set_header        Connection         $connection_upgrade;
        proxy_set_header        Host               $http_host;
        proxy_set_header        X-Real-IP          $remote_addr;
        proxy_set_header        X-Forwarded-For    $proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto  $scheme;
        proxy_pass {backend};{hsts_line}
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


def install_cert(cert_id: str) -> tuple[str, str]:
    cert_dir = CERT_ROOT / "ReverseProxy" / cert_id
    www_cert_dir = WWW_CERT / f"ReverseProxy_{cert_id}"
    cert_dir.mkdir(parents=True, exist_ok=True)
    www_cert_dir.mkdir(parents=True, exist_ok=True)
    TLS_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ACME / "fullchain.cer", cert_dir / "fullchain.pem")
    shutil.copy2(ACME / "fullchain.cer", cert_dir / "cert.pem")
    shutil.copy2(ACME / "savige.me.key", cert_dir / "privkey.pem")
    shutil.copy2(ACME / "ca.cer", cert_dir / "chain.pem")
    for p in cert_dir.iterdir():
        os.chmod(p, 0o400)
    (www_cert_dir / "cert.conf").write_text(
        f"ssl_certificate     /usr/syno/etc/certificate/ReverseProxy/{cert_id}/fullchain.pem;\n"
        f"ssl_certificate_key /usr/syno/etc/certificate/ReverseProxy/{cert_id}/privkey.pem;\n"
    )
    (TLS_ROOT / f"ReverseProxy_{cert_id}.conf").touch()
    print(f"installed cert -> ReverseProxy/{cert_id}")
    cert_include = f"include /usr/syno/etc/www/certificate/ReverseProxy_{cert_id}/cert.conf*;"
    tls_include = (
        f"include /usr/syno/etc/security-profile/tls-profile/config/ReverseProxy_{cert_id}.conf*;"
    )
    return cert_include, tls_include


def main() -> None:
    backup = RP_JSON.with_suffix(RP_JSON.suffix + f".bak.{os.getpid()}")
    shutil.copy2(RP_JSON, backup)
    print(f"backed up {backup}")

    data = json.loads(RP_JSON.read_text())
    for key, rule in list(data.items()):
        if key == "version" or not isinstance(rule, dict):
            continue
        fqdn = (rule.get("frontend") or {}).get("fqdn")
        if fqdn in REPLACE_FQDNS:
            del data[key]

    def rule(rid: str, fqdn: str, port: int, desc: str, extra_headers: list, hsts: bool) -> dict:
        headers = [
            {"name": "Upgrade", "value": "$http_upgrade"},
            {"name": "Connection", "value": "$connection_upgrade"},
            *extra_headers,
        ]
        return {
            "_key": rid,
            "description": desc,
            "frontend": {
                "acl": None,
                "fqdn": fqdn,
                "https": {"hsts": hsts},
                "port": 443,
                "protocol": 1,
            },
            "backend": {"fqdn": "127.0.0.1", "port": port, "protocol": 0},
            "customize_headers": headers,
            "proxy_connect_timeout": 60,
            "proxy_http_version": 1,
            "proxy_intercept_errors": False,
            "proxy_read_timeout": 120 if fqdn.startswith("docs.") else 60,
            "proxy_send_timeout": 120 if fqdn.startswith("docs.") else 60,
        }

    SITES_AVAIL.mkdir(parents=True, exist_ok=True)
    SITES_ENABLED.mkdir(parents=True, exist_ok=True)

    for h in HOSTS:
        rid = str(uuid.uuid4())
        data[rid] = rule(
            rid,
            h["host"],
            h["port"],
            h["desc"],
            h["extra_headers"],
            h["hsts"],
        )
        cert_include, tls_include = install_cert(rid)
        site_id = str(uuid.uuid4())
        conf = SITES_AVAIL / f"{site_id}.w3conf"
        write_site(
            conf,
            h["host"],
            f"http://127.0.0.1:{h['port']}",
            cert_include,
            tls_include,
            read_timeout=h["read_timeout"],
            send_timeout=h["send_timeout"],
            body_size=h["body_size"],
            hsts=h["hsts"],
        )
        link = SITES_ENABLED / h["link"]
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(HOST_SITES_AVAIL / conf.name)
        print(f"site {h['host']} -> :{h['port']} ({h['link']})")

        # BookStack had a separate http-redirect link; our write_site already
        # includes :80 → https, so drop the old dedicated redirect if present.
        redirect_link = h.get("http_redirect_link")
        if redirect_link:
            p = SITES_ENABLED / redirect_link
            if p.exists() or p.is_symlink():
                p.unlink()
                print(f"removed stale {redirect_link}")

    RP_JSON.write_text(json.dumps(data, indent="\t") + "\n")
    print("wrote ReverseProxy.json")
    print("DONE")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Upsert DNS-only A records for *.savige.me → NAS (192.168.1.165).

Reads CF_Token from /volume1/docker/acme/docker-compose.yml on the NAS.
Does not print the token.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

COMPOSE = Path("/volume1/docker/acme/docker-compose.yml")
ZONE_NAME = "savige.me"
IP = "192.168.1.165"
# Wildcard + household app hosts used today
NAMES = ["*", "waypoint", "pocketbase", "docs", "finance", "nas", "budget"]


def load_token() -> str:
    text = COMPOSE.read_text()
    m = re.search(r"CF_Token=([^\s\"']+)", text)
    if not m:
        raise SystemExit("CF_Token not found in acme docker-compose.yml")
    return m.group(1).strip()


def api(token: str, method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"HTTP {e.code} {method} {path}: {err}") from e


def main() -> None:
    token = load_token()
    verify = api(token, "GET", "/user/tokens/verify")
    if not verify.get("success"):
        raise SystemExit(f"token verify failed: {verify}")

    zones = api(token, "GET", f"/zones?name={ZONE_NAME}")
    results = zones.get("result") or []
    if not results:
        raise SystemExit(f"zone not found: {ZONE_NAME}")
    zone_id = results[0]["id"]
    print(f"zone {ZONE_NAME} = {zone_id}")

    existing = api(token, "GET", f"/zones/{zone_id}/dns_records?per_page=100&type=A")
    by_name = {r["name"]: r for r in (existing.get("result") or [])}

    created, updated, skipped = [], [], []
    for n in NAMES:
        rec_name = f"{n}.{ZONE_NAME}" if n != "*" else f"*.{ZONE_NAME}"
        payload = {
            "type": "A",
            "name": n,
            "content": IP,
            "ttl": 1,
            "proxied": False,
        }
        cur = by_name.get(rec_name)
        if cur and cur.get("content") == IP and cur.get("proxied") is False:
            skipped.append(rec_name)
            continue
        if cur:
            out = api(token, "PUT", f"/zones/{zone_id}/dns_records/{cur['id']}", payload)
            if not out.get("success"):
                raise SystemExit(f"update failed {rec_name}: {out}")
            updated.append(rec_name)
        else:
            out = api(token, "POST", f"/zones/{zone_id}/dns_records", payload)
            if not out.get("success"):
                raise SystemExit(f"create failed {rec_name}: {out}")
            created.append(rec_name)

    print("created:", ", ".join(created) or "(none)")
    print("updated:", ", ".join(updated) or "(none)")
    print("unchanged:", ", ".join(skipped) or "(none)")

    # Final listing
    final = api(token, "GET", f"/zones/{zone_id}/dns_records?per_page=100&type=A")
    print("--- A records ---")
    for r in sorted(final.get("result") or [], key=lambda x: x["name"]):
        prox = "orange" if r.get("proxied") else "dns-only"
        print(f"{r['name']:28} {r['content']:15} {prox}")


if __name__ == "__main__":
    main()
    sys.exit(0)

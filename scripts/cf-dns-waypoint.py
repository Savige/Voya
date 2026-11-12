#!/usr/bin/env python3
"""Create/update Cloudflare A records for waypoint + pocketbase (DNS-only)."""
import re
import json
import urllib.request
import ssl

conf = open("/volume1/docker/acme/config/account.conf").read()
m = re.search(r"""SAVED_CF_Token='"([^"]+)"'""", conf)
if not m:
    m = re.search(r"SAVED_CF_Token=(.+)", conf)
raw = m.group(1).strip().strip("'").strip('"').strip("'")
token = raw.strip('"')
print("token_len", len(token))

ctx = ssl.create_default_context()


def cf(method, path, data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        data=body,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, context=ctx) as resp:
        return json.load(resp)


zones = cf("GET", "/zones?name=ryansavige.com")
if not zones.get("success"):
    print(zones)
    raise SystemExit(1)
zone_id = zones["result"][0]["id"]
print("zone", zone_id)

for name in ("waypoint", "pocketbase"):
    fqdn = name + ".ryansavige.com"
    existing = cf(
        "GET", "/zones/%s/dns_records?name=%s&type=A" % (zone_id, fqdn)
    )
    recs = existing.get("result") or []
    payload = {
        "type": "A",
        "name": fqdn,
        "content": "192.168.1.165",
        "ttl": 1,
        "proxied": False,
    }
    if recs:
        rid = recs[0]["id"]
        out = cf("PUT", "/zones/%s/dns_records/%s" % (zone_id, rid), payload)
        print(
            "updated",
            fqdn,
            out.get("success"),
            out.get("result", {}).get("content"),
            "proxied=",
            out.get("result", {}).get("proxied"),
        )
    else:
        out = cf("POST", "/zones/%s/dns_records" % zone_id, payload)
        print(
            "created",
            fqdn,
            out.get("success"),
            out.get("errors"),
            (out.get("result") or {}).get("id"),
        )

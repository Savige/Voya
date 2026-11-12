#!/bin/bash
set -euo pipefail
export PATH=/usr/local/bin:$PATH
cd /volume1/docker/waypoint

python3 <<'PY'
from pathlib import Path
import re
p = Path("pocketbase/pb_hooks/waypoint.pb.js")
text = p.read_text()
text2 = re.sub(r',\s*\$apis\.requireAuth\(\)\s*', '', text)
p.write_text(text2)
print("middleware left:", text2.count("$apis.requireAuth"))
PY

docker-compose -f deploy/docker-compose.yml --project-name waypoint up -d --build pocketbase
sleep 2

python3 <<'PY'
import json, urllib.request, random
base = "http://127.0.0.1:8090"

def call(method, path, data=None, token=None):
    body = None if data is None else json.dumps(data).encode()
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = token
    req = urllib.request.Request(base + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

email = "hooktest5-%s@example.com" % random.randint(1000, 9999)
pw = "TestPassword123!"
call(
    "POST",
    "/api/collections/users/records",
    {"email": email, "password": pw, "passwordConfirm": pw, "name": "Hook Test"},
)
token = json.loads(
    call(
        "POST",
        "/api/collections/users/auth-with-password",
        {"identity": email, "password": pw},
    )[1]
)["token"]
print("noauth", call("POST", "/api/waypoint/search", {"query": "Christchurch", "limit": 3}))
print("auth", call("POST", "/api/waypoint/search", {"query": "Christchurch", "limit": 3}, token=token))
print("recs", call("GET", "/api/waypoint/recommendations?key=x", token=token))
PY

docker logs waypoint-pocketbase --tail 40

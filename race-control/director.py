#!/usr/bin/env python3
"""Race director CLI. Keep the token secret; never place it in the AC client."""
import argparse
import json
import os
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["GREEN", "VSC", "RED"])
parser.add_argument("--speed", type=int, default=80)
parser.add_argument("--message", default="")
parser.add_argument("--url", default="http://127.0.0.1:8765/api/control")
args = parser.parse_args()
token = os.environ.get("RL_RC_ADMIN_TOKEN")
if not token:
    raise SystemExit("Set RL_RC_ADMIN_TOKEN")
payload = json.dumps({"mode": args.mode, "vsc_speed_kmh": args.speed, "message": args.message}).encode("utf-8")
request = urllib.request.Request(args.url, data=payload, method="POST", headers={
    "Content-Type": "application/json", "Authorization": "Bearer " + token
})
with urllib.request.urlopen(request, timeout=5) as response:
    print(response.read().decode("utf-8"))

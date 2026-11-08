#!/usr/bin/env python3
"""Rookie League race control MVP. Advisory flags, not native AC session control."""
import argparse
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATE_FILE = Path(os.environ.get("RL_RC_STATE_FILE", "race-control-state.json"))
TOKEN = os.environ.get("RL_RC_ADMIN_TOKEN", "")
LOCK = threading.Lock()
VALID = {"GREEN", "VSC", "RED"}
STATE = {"mode": "GREEN", "message": "Pista liberada", "vsc_speed_kmh": 80,
         "version": 0, "updated_at": 0}

def save():
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(STATE), encoding="utf-8")
    tmp.replace(STATE_FILE)

def load():
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if data.get("mode") in VALID:
                STATE.update({k: data[k] for k in STATE if k in data})
        except (OSError, ValueError, TypeError):
            pass

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path != "/api/state":
            return self.reply(404, {"error": "Not found"})
        with LOCK:
            self.reply(200, dict(STATE))

    def do_POST(self):
        if self.path != "/api/control":
            return self.reply(404, {"error": "Not found"})
        provided = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(provided, "Bearer " + TOKEN):
            return self.reply(403, {"error": "Unauthorized"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 2048:
                return self.reply(413, {"error": "Invalid payload size"})
            data = json.loads(self.rfile.read(size))
            mode = data.get("mode")
            if mode not in VALID:
                return self.reply(400, {"error": "Invalid mode"})
            message = data.get("message", "")
            if not isinstance(message, str) or len(message) > 180:
                return self.reply(400, {"error": "Invalid message"})
            speed = data.get("vsc_speed_kmh", 80)
            if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not 30 <= speed <= 150:
                return self.reply(400, {"error": "Invalid VSC speed"})
            with LOCK:
                STATE.update(mode=mode, message=message or {
                    "GREEN": "Pista liberada",
                    "VSC": "VSC ativo: mantenha velocidade controlada e nao ultrapasse",
                    "RED": "BANDEIRA VERMELHA: siga orientacoes da direcao de prova"
                }[mode], vsc_speed_kmh=int(speed), updated_at=int(time.time()),
                    version=STATE["version"] + 1)
                save()
                self.reply(200, dict(STATE))
        except (ValueError, TypeError, json.JSONDecodeError):
            self.reply(400, {"error": "Invalid JSON"})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not TOKEN:
        raise SystemExit("Configure RL_RC_ADMIN_TOKEN before starting.")
    load()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("Rookie Race Control on http://%s:%d" % (args.host, args.port))
    server.serve_forever()

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Local-only HTTPS bridge for Assetto Corsa Python runtimes without SSL support."""
import json
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "https://lxformxabgtgafykvhkw.supabase.co/functions/v1/race-control-flags"
BIND = ("127.0.0.1", 8766)
POLL_SECONDS = 2
STALE_AFTER_SECONDS = 12
lock = threading.Lock()
latest = {"mode": "OFFLINE", "version": -1, "error": "Aguardando Supabase"}
last_ok = 0.0

def poll():
    global latest, last_ok
    while True:
        try:
            req = urllib.request.Request(UPSTREAM, headers={"Accept": "application/json", "User-Agent": "RookieFlagsBridge/1.0"})
            with urllib.request.urlopen(req, timeout=5) as response:
                payload = json.load(response)
            if payload.get("mode") not in ("RED", "VSC", "GREEN"):
                raise ValueError("Estado inesperado")
            with lock:
                latest = {"mode": payload["mode"], "version": int(payload.get("version", 0))}
                last_ok = time.monotonic()
        except Exception as exc:
            with lock:
                latest = {"mode": "OFFLINE", "version": -1, "error": str(exc)[:100]}
        time.sleep(POLL_SECONDS)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/state":
            self.send_error(404)
            return
        with lock:
            payload = dict(latest)
            if time.monotonic() - last_ok > STALE_AFTER_SECONDS:
                payload = {"mode": "OFFLINE", "version": -1, "error": "Sem atualizacao recente do Supabase"}
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def main():
    thread = threading.Thread(target=poll, daemon=True)
    thread.start()
    server = ThreadingHTTPServer(BIND, Handler)
    print("Rookie Flags Bridge iniciado em http://127.0.0.1:8766/api/state")
    print("Mantenha esta janela aberta enquanto estiver no Assetto Corsa.")
    server.serve_forever()

if __name__ == "__main__":
    main()

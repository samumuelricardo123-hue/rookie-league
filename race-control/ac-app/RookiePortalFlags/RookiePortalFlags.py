"""Rookie League: flags from the portal inside Assetto Corsa (Python app)."""
import ac
import configparser
import json
import os
import threading
import time
try:
    from urllib.request import urlopen, Request
except ImportError:
    from urllib2 import urlopen, Request

APP_NAME = "Rookie Flags"
state_url = "https://lxformxabgtgafykvhkw.supabase.co/functions/v1/race-control-flags"
poll_seconds = 2.0
state = {"mode": "OFFLINE", "version": -1}
lock = threading.Lock()
running = True
app = None
title = None
subtitle = None
last_mode = None
last_version = None
last_update = 0

def fetch_loop():
    global state
    while running:
        try:
            req = Request(state_url, headers={"Accept": "application/json", "User-Agent": "RookieFlags/1.0"})
            response = urlopen(req, timeout=5)
            try:
                data = json.loads(response.read().decode("utf-8"))
            finally:
                response.close()
            if data.get("mode") not in ("GREEN", "VSC", "RED"):
                raise ValueError("Invalid flag")
            with lock:
                state = {"mode": data["mode"], "version": data.get("version", 0)}
        except Exception:
            with lock:
                state = {"mode": "OFFLINE", "version": -1}
        time.sleep(poll_seconds)

def acMain(ac_version):
    global app, title, subtitle, state_url, poll_seconds
    config = configparser.ConfigParser()
    config.read(os.path.join(os.path.dirname(__file__), "config.ini"))
    state_url = config.get("CONTROL", "state_url", fallback=state_url)
    poll_seconds = max(1.0, config.getfloat("CONTROL", "poll_seconds", fallback=2.0))
    app = ac.newApp(APP_NAME)
    ac.setSize(app, 390, 130)
    title = ac.addLabel(app, "ROOKIE LEAGUE | CONECTANDO")
    ac.setPosition(title, 15, 20)
    ac.setFontSize(title, 21)
    subtitle = ac.addLabel(app, "Sincronizando com o portal...")
    ac.setPosition(subtitle, 15, 70)
    ac.setFontSize(subtitle, 13)
    thread = threading.Thread(target=fetch_loop)
    thread.daemon = True
    thread.start()
    return APP_NAME

def acUpdate(delta_t):
    global last_mode, last_version, last_update
    with lock:
        snapshot = dict(state)
    mode = snapshot.get("mode", "OFFLINE")
    version = snapshot.get("version")
    if mode == last_mode and version == last_version:
        return
    last_mode, last_version = mode, version
    if mode == "RED":
        heading, detail, color = "BANDEIRA VERMELHA", "Corrida interrompida. Aguarde instrucoes.", (1.0, 0.2, 0.2, 1)
    elif mode == "VSC":
        heading, detail, color = "VSC ATIVO", "Reduza a velocidade. Nao ultrapasse.", (1.0, 0.85, 0.1, 1)
    elif mode == "GREEN":
        heading, detail, color = "BANDEIRA VERDE", "Pista liberada. Corrida retomada.", (0.65, 1.0, 0.1, 1)
    else:
        heading, detail, color = "SEM CONEXAO", "Nao foi possivel consultar o portal.", (0.75, 0.75, 0.75, 1)
    ac.setText(title, heading)
    ac.setFontColor(title, *color)
    ac.setText(subtitle, detail)

def acShutdown():
    global running
    running = False

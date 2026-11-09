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
state = {"mode": "OFFLINE", "version": -1, "error": "Aguardando resposta"}
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
            if data.get("mode") not in ("GREEN", "VSC", "RED", "YELLOW", "START", "VSC_END"):
                raise ValueError("Resposta inesperada: " + str(data.get("error", data.get("mode", "sem modo"))))
            with lock:
                state = {"mode": data["mode"], "version": data.get("version", 0), "remaining_seconds": data.get("remaining_seconds", 0), "lights_total": data.get("lights_total", 0), "lights_on": data.get("lights_on", 0), "message": data.get("message", "")}
        except Exception as exc:
            reason = str(exc)[:150] or type(exc).__name__
            try:
                ac.log("[RookiePortalFlags] Consulta falhou: " + reason)
            except Exception:
                pass
            with lock:
                state = {"mode": "OFFLINE", "version": -1, "error": reason}
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
    phase = (mode, version, snapshot.get("remaining_seconds"), snapshot.get("lights_on"))
    if phase == getattr(acUpdate, "_last_phase", None) and (mode != "OFFLINE" or snapshot.get("error") == getattr(acUpdate, "_last_error", None)):
        return
    acUpdate._last_phase = phase
    acUpdate._last_error = snapshot.get("error")
    last_mode, last_version = mode, version
    if mode == "RED":
        heading, detail, color = "BANDEIRA VERMELHA", "Corrida interrompida. Aguarde instrucoes.", (1.0, 0.2, 0.2, 1)
    elif mode == "YELLOW":
        heading, detail, color = "BANDEIRA AMARELA", "Procedimento de relargada. Nao ultrapasse.", (1.0, 0.85, 0.1, 1)
    elif mode == "START":
        heading, detail, color = "LUZES DE RELARGADA", "Luzes: %s de 5. Aguarde apagar." % snapshot.get("lights_on", 0), (1.0, 0.2, 0.2, 1)
    elif mode == "VSC_END":
        heading, detail, color = "FINAL DO VSC", "Luzes acesas: %s de 3. Aguarde verde." % snapshot.get("lights_on", 0), (1.0, 0.85, 0.1, 1)
    elif mode == "VSC":
        heading, detail, color = "VSC ATIVO", "Reduza a velocidade. Nao ultrapasse.", (1.0, 0.85, 0.1, 1)
    elif mode == "GREEN":
        heading, detail, color = "BANDEIRA VERDE", "Pista liberada. Corrida retomada.", (0.65, 1.0, 0.1, 1)
    else:
        heading, detail, color = "SEM CONEXAO", "Erro: " + str(snapshot.get("error", "Sem resposta"))[:60], (0.75, 0.75, 0.75, 1)
    remaining = int(snapshot.get("remaining_seconds") or 0)
    if remaining > 0:
        heading += "  %02d:%02d" % (remaining // 60, remaining % 60)
    ac.setText(title, heading)
    ac.setFontColor(title, *color)
    ac.setText(subtitle, detail)

def acShutdown():
    global running
    running = False

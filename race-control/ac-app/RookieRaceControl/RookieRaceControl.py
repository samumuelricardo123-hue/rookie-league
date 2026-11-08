"""Assetto Corsa Python app: advisory RED/VSC/GREEN notifications."""
import ac
import configparser
import json
import os
import threading
import time
import urllib.request

APP_NAME = "Rookie Race Control"
app = 0
label = 0
details = 0
last_version = -1
current = {"mode": "OFFLINE", "message": "Aguardando direcao de prova", "vsc_speed_kmh": 80}
lock = threading.Lock()
running = True
url = "http://127.0.0.1:8765/api/state"
poll_seconds = 2.0

def worker():
    global current
    while running:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "RookieRaceControl/0.1"})
            with urllib.request.urlopen(request, timeout=3) as response:
                data = json.loads(response.read().decode("utf-8"))
            if data.get("mode") in ("GREEN", "VSC", "RED"):
                with lock:
                    current = data
        except Exception:
            with lock:
                current = {"mode": "OFFLINE", "message": "Sem comunicacao com a direcao de prova"}
        time.sleep(poll_seconds)

def acMain(ac_version):
    global app, label, details, url, poll_seconds
    config = configparser.ConfigParser()
    config.read(os.path.join(os.path.dirname(__file__), "config.ini"))
    url = config.get("CONTROL", "state_url", fallback=url)
    poll_seconds = max(1.0, config.getfloat("CONTROL", "poll_seconds", fallback=2.0))
    app = ac.newApp(APP_NAME)
    ac.setSize(app, 410, 150)
    label = ac.addLabel(app, "ROOKIE LEAGUE | AGUARDANDO")
    ac.setPosition(label, 15, 20)
    ac.setFontSize(label, 19)
    details = ac.addLabel(app, "Conectando ao controle de corrida...")
    ac.setPosition(details, 15, 65)
    ac.setFontSize(details, 13)
    t = threading.Thread(target=worker)
    t.daemon = True
    t.start()
    return APP_NAME

def acUpdate(delta_t):
    global last_version
    with lock:
        data = dict(current)
    mode = data.get("mode", "OFFLINE")
    version = data.get("version", -1)
    if version == last_version and mode != "OFFLINE":
        return
    last_version = version
    if mode == "RED":
        heading, color = "BANDEIRA VERMELHA", (1, 0.18, 0.18, 1)
    elif mode == "VSC":
        heading, color = "VSC ATIVO", (1, 0.85, 0.1, 1)
    elif mode == "GREEN":
        heading, color = "PISTA LIBERADA", (0.5, 1, 0.2, 1)
    else:
        heading, color = "SEM CONEXAO", (0.7, 0.7, 0.7, 1)
    ac.setText(label, heading)
    ac.setFontColor(label, *color)
    message = str(data.get("message", ""))[:100]
    if mode == "VSC":
        message += " | Referencia: %s km/h" % data.get("vsc_speed_kmh", 80)
    ac.setText(details, message)

def acShutdown():
    global running
    running = False

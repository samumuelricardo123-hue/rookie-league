const { app, BrowserWindow, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');

const PORTAL_URL = 'https://samumuelricardo123-hue.github.io/rookie-league/';
const PORTAL_ORIGIN = new URL(PORTAL_URL).origin;
let telemetryProcess = null;
let telemetryStatus = 'aguardando';
let telemetryLastData = null;
const telemetryWindows = new Set();
// V132: limite defensivo do IPC; o gravador local continua em taxa integral.
const TELEMETRY_MIN_PUSH_MS = 1000;
let telemetryLastPushAt = 0;
let telemetrySamplesSkipped = 0;
let telemetryLastSessionKey = null;

// Ponte local de bandeiras: HTTPS verificado pelo Node/Electron, HTTP apenas em loopback.
const FLAGS_SOURCE = 'https://lxformxabgtgafykvhkw.supabase.co/functions/v1/race-control-flags';
const FLAGS_HOST = '127.0.0.1';
const FLAGS_PORT = 8766;
let flagsServer = null;
let flagsTimer = null;
let flagsFetching = false;
let flagsState = { mode: 'OFFLINE', version: 0, error: 'Aguardando primeira consulta' };
let flagsLastOk = 0;
let flagsSampleAt = 0;
// O servidor e a unica fonte de verdade para os tempos. A ponte nao inicia cronometros.
const FLAG_MODES = new Set(['RED', 'YELLOW', 'VSC', 'GREEN']);
const FLAG_PHASES = new Set(['RED_HOLD', 'RESTART_YELLOW', 'START_LIGHTS', 'YELLOW', 'VSC_HOLD', 'VSC_LIGHTS', 'GREEN']);
function normalizedFlagState(data) {
  if (!data || !FLAG_MODES.has(data.mode)) throw new Error('Bandeira desconhecida');
  const state = {
    mode: data.mode,
    version: Number.isSafeInteger(data.version) ? data.version : 0,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : null
  };
  // Metadados opcionais: mantem compatibilidade com a API antiga.
  if (typeof data.phase === 'string' && FLAG_PHASES.has(data.phase)) state.phase = data.phase;
  for (const key of ['phase_started_at', 'phase_ends_at', 'server_time']) {
    if (typeof data[key] === 'string' && Number.isFinite(Date.parse(data[key]))) state[key] = data[key];
  }
  if (typeof data.synchronized === 'boolean') state.synchronized = data.synchronized;
  if (typeof data.remaining_ms === 'number' && Number.isFinite(data.remaining_ms) && data.remaining_ms >= 0) state.remaining_ms = data.remaining_ms;
  if (typeof data.message === 'string') state.message = data.message.slice(0, 240);
  if (typeof data.race_id === 'string') state.race_id = data.race_id.slice(0, 100);
  if (typeof data.start_type === 'string' && ['STANDING', 'ROLLING'].includes(data.start_type)) state.start_type = data.start_type;
  if (Number.isInteger(data.lights_total) && data.lights_total >= 0 && data.lights_total <= 5) state.lights_total = data.lights_total;
  if (Number.isInteger(data.lights_on) && data.lights_on >= 0 && data.lights_on <= (state.lights_total ?? 5)) state.lights_on = data.lights_on;
  return state;
}

function fetchFlags() {
  if (flagsFetching) return;
  flagsFetching = true;
  const request = https.get(FLAGS_SOURCE, { timeout: 7000 }, response => {
    let body = '';
    if (response.statusCode !== 200) {
      response.resume();
      flagsState = { mode: 'OFFLINE', error: `HTTP ${response.statusCode}` };
      flagsFetching = false;
      return;
    }
    response.setEncoding('utf8');
    response.on('data', chunk => {
      body += chunk;
      if (body.length > 32768) response.destroy(new Error('Resposta grande demais'));
    });
    response.on('end', () => {
      try {
        const data = JSON.parse(body);
        flagsState = normalizedFlagState(data);
        flagsLastOk = Date.now();
        flagsSampleAt = flagsLastOk;
      } catch (error) {
        flagsState = { mode: 'OFFLINE', error: error.message };
      }
      flagsFetching = false;
    });
    response.on('error', error => {
      flagsState = { mode: 'OFFLINE', error: error.message };
      flagsFetching = false;
    });
  });
  request.on('timeout', () => request.destroy(new Error('Tempo esgotado')));
  request.on('error', error => {
    flagsState = { mode: 'OFFLINE', error: error.message };
    flagsFetching = false;
  });
}

function startFlagsBridge() {
  if (flagsServer) return;
  flagsServer = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/api/state') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Nao encontrado' }));
      return;
    }
    const stale = !flagsLastOk || Date.now() - flagsLastOk > 12000;
    const state = stale && flagsState.mode !== 'OFFLINE'
      ? { mode: 'OFFLINE', error: 'Dados de bandeira desatualizados' }
      : flagsState;
    const outgoing = { ...state };
    if (outgoing.synchronized === true && Number.isFinite(outgoing.remaining_ms)) {
      outgoing.remaining_ms = Math.max(0, outgoing.remaining_ms - (Date.now() - flagsSampleAt));
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(outgoing));
  });
  flagsServer.on('error', error => {
    console.warn('Nao foi possivel iniciar ponte de bandeiras:', error.message);
    flagsServer = null;
    if (flagsTimer) clearInterval(flagsTimer);
    flagsTimer = null;
  });
  flagsServer.listen(FLAGS_PORT, FLAGS_HOST, () => {
    console.log(`Bandeiras Rookie League disponiveis em http://${FLAGS_HOST}:${FLAGS_PORT}/api/state`);
    fetchFlags();
    flagsTimer = setInterval(fetchFlags, 2000);
  });
}

function stopFlagsBridge() {
  if (flagsTimer) clearInterval(flagsTimer);
  flagsTimer = null;
  if (flagsServer) flagsServer.close();
  flagsServer = null;
}

// Diagnostico e reinicio do agente no aplicativo instalado.
let telemetryRestartTimer = null;
let telemetryStopping = false;
let telemetryAttempts = 0;
function telemetryLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log('[telemetria]', message);
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'telemetry-agent.log'), line + '\n', 'utf8');
  } catch (error) { console.warn('Falha ao gravar log:', error.message); }
}
function scheduleTelemetryRestart() {
  if (telemetryStopping || telemetryRestartTimer || telemetryProcess) return;
  const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(telemetryAttempts++, 4)));
  telemetryLog(`Nova tentativa em ${delay / 1000}s`);
  telemetryRestartTimer = setTimeout(() => {
    telemetryRestartTimer = null;
    startTelemetryAgent();
  }, delay);
}
function startTelemetryAgent() {
  if (process.platform !== 'win32' || telemetryProcess || telemetryStopping) return;
  const script = path.join(__dirname, 'telemetry-agent', 'RookieTelemetry.ps1');
  if (!fs.existsSync(script)) {
    telemetryStatus = 'agente-nao-encontrado';
    telemetryLog(`Arquivo ausente: ${script}`);
    return;
  }
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32',
    'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let child;
  try {
    child = spawn(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script
    ], { windowsHide: true, cwd: path.dirname(script), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    telemetryStatus = 'erro';
    telemetryLog(`Falha ao iniciar: ${error.message}`);
    scheduleTelemetryRestart();
    return;
  }
  telemetryProcess = child;
  telemetryStatus = 'iniciando';
  telemetryLog(`Iniciando agente PID ${child.pid || 'indisponivel'}: ${script}`);
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) {
      buffer = '';
      telemetryLog('Buffer de telemetria excedeu o limite');
      return;
    }
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.type === 'status') telemetryStatus = message.status;
        if (message.type === 'sample') {
          telemetryStatus = 'conectado';
          telemetryLastData = message.data;
          telemetryAttempts = 0;
          const now = Date.now();
          const sessionType = Number(message.data?.session_type);
          const sessionKey = Number.isFinite(sessionType) ? String(sessionType) : 'unknown';
          const sessionChanged = sessionKey !== telemetryLastSessionKey;
          if (sessionChanged) telemetryLastSessionKey = sessionKey;
          // Fora do treino: encaminha apenas a primeira amostra da troca de modo,
          // para o portal atualizar o status; depois bloqueia todas as amostras.
          if (sessionKey !== '0' && !sessionChanged) {
            telemetrySamplesSkipped++;
            continue;
          }
          // No treino livre, no máximo uma amostra por segundo.
          if (sessionKey === '0' && now - telemetryLastPushAt < TELEMETRY_MIN_PUSH_MS) {
            telemetrySamplesSkipped++;
            continue;
          }
          if (sessionKey === '0') telemetryLastPushAt = now;
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('rookie:telemetry:event', message);
        }
      } catch (error) {
        telemetryLog(`Linha invalida: ${line.slice(0, 180)}`);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => telemetryLog(`PowerShell: ${String(data).trim().slice(0, 2000)}`));
  child.on('error', error => {
    telemetryStatus = 'erro';
    telemetryLog(`Erro do processo: ${error.message}`);
  });
  child.on('close', (code, signal) => {
    if (telemetryProcess === child) telemetryProcess = null;
    telemetryStatus = 'parado';
    telemetryLog(`Agente encerrado: codigo=${code}, sinal=${signal}`);
    scheduleTelemetryRestart();
  });
}


function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: 'Rookie League', autoHideMenuBar: true,
    backgroundColor: '#080d0a',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadURL(PORTAL_URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' && target.origin !== PORTAL_ORIGIN) shell.openExternal(url);
    } catch (error) { console.error('Link externo inválido:', error); }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      if (target.origin !== PORTAL_ORIGIN) {
        event.preventDefault();
        if (target.protocol === 'https:') shell.openExternal(url);
      }
    } catch (error) { event.preventDefault(); }
  });
  return win;
}

ipcMain.on('rookie:notification', (event, data) => {
  try {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl || new URL(senderUrl).origin !== PORTAL_ORIGIN) return;
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: String(data?.title || 'Rookie League').slice(0, 120),
      body: String(data?.body || '').slice(0, 500)
    });
    notification.on('click', () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show(); win.focus();
      }
    });
    notification.show();
  } catch (error) { console.error('Falha na notificação:', error); }
});

ipcMain.handle('rookie:telemetry:get-status', event => {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || new URL(senderUrl).origin !== PORTAL_ORIGIN) return { status: 'indisponivel' };
  return { status: telemetryStatus, data: telemetryLastData, optimization: { sample_interval_ms: TELEMETRY_MIN_PUSH_MS, skipped_samples: telemetrySamplesSkipped } };
});

app.whenReady().then(async () => {
  startTelemetryAgent();
  startFlagsBridge();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('before-quit', () => {
  telemetryStopping = true;
  if (telemetryRestartTimer) clearTimeout(telemetryRestartTimer);
  if (telemetryProcess) telemetryProcess.kill();
  stopFlagsBridge();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

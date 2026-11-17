const { app, BrowserWindow, shell, ipcMain, Notification, safeStorage, autoUpdater, dialog } = require('electron');
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
const SUPABASE_BASE = 'https://lxformxabgtgafykvhkw.supabase.co';
const PUBLIC_KEY = 'sb_publishable_eRVk8_-1vNP3XyMA_02d4w_OF03caaA';
let adminSession=null, autoVscArmed=false, autoVscBusy=false, adminWindow=null;
// V125: selecao manual, nao persistida. Reiniciar sempre em treino/qualy.
let raceSessionEnabled=false;
// V124: persistencia somente do refresh token, criptografado pela protecao do Windows.
// Nunca embarcar email, senha ou token no executavel.
let adminEmail='';
function sessionFile(){return path.join(app.getPath('userData'),'rookie-flags-admin-session.dat');}
function clearSavedSession(){try{fs.rmSync(sessionFile(),{force:true});}catch(e){console.warn('Sessao local:',e.message);}}
function canStoreSession(){return process.platform==='win32' && safeStorage.isEncryptionAvailable();}
function saveAdminSession(){
 if(!canStoreSession())return false;
 const payload=JSON.stringify({refreshToken:adminSession.refreshToken,email:adminEmail,autoArm:true});
 const encrypted=safeStorage.encryptString(payload);
 fs.writeFileSync(sessionFile(),encrypted,{mode:0o600});
 return true;
}
async function validateAdmin(token){
 const user=await apiCall(SUPABASE_BASE+'/auth/v1/user','GET',null,token);
 const profile=await apiCall(SUPABASE_BASE+'/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&select=is_admin','GET',null,token);
 if(!Array.isArray(profile)||profile[0]?.is_admin!==true)throw Error('Conta sem permissao ADM');
 return user;
}
async function restoreAdminSession(){
 try{
  if(!canStoreSession()||!fs.existsSync(sessionFile()))return;
  const encrypted=fs.readFileSync(sessionFile());
  const saved=JSON.parse(safeStorage.decryptString(encrypted));
  if(!saved.refreshToken||saved.autoArm!==true)throw Error('Sessao invalida');
  const d=await apiCall(SUPABASE_BASE+'/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:saved.refreshToken});
  const user=await validateAdmin(d.access_token);
  adminSession={accessToken:d.access_token,refreshToken:d.refresh_token,expiresAt:Date.now()+d.expires_in*1000};
  adminEmail=user.email||'';autoVscArmed=true;saveAdminSession();
  console.log('[Rookie Flags] ADM restaurado com autorizacao automatica');
 }catch(error){adminSession=null;autoVscArmed=false;clearSavedSession();console.warn('[Rookie Flags] Novo login necessario:',error.message);}
}


let flagsServer = null;
let flagsTimer = null;
let flagsFetching = false;
let flagsState = { mode: 'OFFLINE', version: 0, error: 'Aguardando primeira consulta' };
// V121: solicitações locais recebidas do plugin; não são comandos administrativos.
let pendingAutoVsc = null;
let lastAutoVscAt = 0;
const AUTO_VSC_COOLDOWN_MS = 60000;
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

function apiCall(url,method='GET',body=null,token=null){
 return new Promise((resolve,reject)=>{
  const raw=body?JSON.stringify(body):null;
  const headers={apikey:PUBLIC_KEY,'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(raw)headers['Content-Length']=Buffer.byteLength(raw);
  const req=https.request(url,{method,headers,timeout:9000},res=>{
   let data='';res.setEncoding('utf8');
   res.on('data',c=>{data+=c;if(data.length>32768)req.destroy(Error('Resposta grande demais'));});
   res.on('end',()=>{
    let result;try{result=JSON.parse(data)}catch{result={error:'Resposta invalida'}}
    if(res.statusCode<200||res.statusCode>=300)reject(Error(result.error_description||result.message||result.error||'HTTP '+res.statusCode));else resolve(result);
   });
  });req.on('timeout',()=>req.destroy(Error('Tempo esgotado')));req.on('error',reject);
  if(raw)req.write(raw);req.end();
 });
}
async function getAdminToken(){
 if(!adminSession)throw Error('Entre como ADM');
 if(Date.now()>adminSession.expiresAt-60000){
  const d=await apiCall(SUPABASE_BASE+'/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:adminSession.refreshToken});
  adminSession={accessToken:d.access_token,refreshToken:d.refresh_token,expiresAt:Date.now()+d.expires_in*1000};
  if(fs.existsSync(sessionFile()))saveAdminSession();
 }
 return adminSession.accessToken;
}
async function sendAutomaticVsc(){
 if(!raceSessionEnabled||!autoVscArmed||!adminSession||autoVscBusy||!pendingAutoVsc)return;
 autoVscBusy=true;
 try{
  const token=await getAdminToken();
  if(!raceSessionEnabled)throw Error('Modo Corrida desativado');
  const current=await apiCall(FLAGS_SOURCE);
  if(!['GREEN','YELLOW'].includes(current.mode))throw Error('Estado oficial nao permite VSC: '+current.mode);
  if(!Number.isSafeInteger(current.version))throw Error('Versao oficial invalida');
  if(!raceSessionEnabled)throw Error('Modo Corrida desativado antes do envio');
  await apiCall(FLAGS_SOURCE,'POST',{mode:'VSC',expected_version:current.version},token);
  pendingAutoVsc.status='VSC_SENT';pendingAutoVsc.forwarded_at=new Date().toISOString();fetchFlags();
 }catch(error){
  pendingAutoVsc.status='ERROR';pendingAutoVsc.error=error.message;
  console.warn('[Rookie Flags] Auto VSC falhou:',error.message);
  if(/invalid|expired|refresh|JWT|sessao/i.test(error.message)){autoVscArmed=false;adminSession=null;clearSavedSession();}
 }finally{autoVscBusy=false;}
}
function createAdminWindow(){
 if(adminWindow&&!adminWindow.isDestroyed()){adminWindow.show();adminWindow.focus();return;}
 adminWindow=new BrowserWindow({width:540,height:680,minWidth:460,minHeight:560,title:'Rookie Flags — ADM',autoHideMenuBar:true,backgroundColor:'#0b1511',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.js')}});
 adminWindow.loadFile(path.join(__dirname,'rookie-flags-admin.html'));
 adminWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 adminWindow.webContents.on('will-navigate',e=>e.preventDefault());
 adminWindow.on('closed',()=>adminWindow=null);
}
function adminSender(event){
 return !!adminWindow && event.sender===adminWindow.webContents && event.senderFrame?.url.startsWith('file:') && event.senderFrame.url.endsWith('/rookie-flags-admin.html');
}
ipcMain.handle('rookie:flags:login',async(event,creds)=>{
 if(!adminSender(event))throw Error('Origem nao autorizada');
 if(typeof creds?.email!=='string'||typeof creds?.password!=='string'||creds.password.length>256)throw Error('Credenciais invalidas');
 const d=await apiCall(SUPABASE_BASE+'/auth/v1/token?grant_type=password','POST',{email:creds.email,password:creds.password});
 const user=await validateAdmin(d.access_token);
 adminSession={accessToken:d.access_token,refreshToken:d.refresh_token,expiresAt:Date.now()+d.expires_in*1000};adminEmail=user.email||'';autoVscArmed=false;
 return {email:user.email};
});
ipcMain.handle('rookie:flags:arm',async(event,armed)=>{
 if(!adminSender(event))throw Error('Origem nao autorizada');
 if(armed){await getAdminToken();autoVscArmed=true;if(!saveAdminSession()){autoVscArmed=false;throw Error('Protecao de credenciais do Windows indisponivel');}}else{autoVscArmed=false;clearSavedSession();}
 return {armed:autoVscArmed};
});
ipcMain.handle('rookie:flags:race-mode',async(event,enabled)=>{
 if(!adminSender(event))throw Error('Origem nao autorizada');
 if(typeof enabled!=='boolean')throw Error('Valor invalido');
 if(enabled){await getAdminToken();await validateAdmin(await getAdminToken());}
 raceSessionEnabled=enabled;
 if(!enabled&&pendingAutoVsc?.status==='PENDING_AUTHORIZATION')pendingAutoVsc.status='BLOCKED_NON_RACE';
 return {raceSessionEnabled};
});
ipcMain.handle('rookie:flags:set-mode',async(event,mode)=>{
 if(!adminSender(event))throw Error('Origem nao autorizada');
 if(!['GREEN','YELLOW','VSC','RED'].includes(mode))throw Error('Bandeira invalida');
 const token=await getAdminToken();
 await validateAdmin(token);
 const current=await apiCall(FLAGS_SOURCE);
 if(!Number.isSafeInteger(current.version))throw Error('Versao oficial invalida');
 const result=await apiCall(FLAGS_SOURCE,'POST',{mode,expected_version:current.version},token);
 fetchFlags();
 return {mode:result.mode||mode,version:result.version??current.version+1};
});
ipcMain.handle('rookie:flags:status',event=>{
 if(!adminSender(event))throw Error('Origem nao autorizada');
 return {loggedIn:!!adminSession,armed:autoVscArmed,email:adminEmail,pending:pendingAutoVsc,mode:flagsState.mode,raceSessionEnabled};
});
ipcMain.handle('rookie:flags:logout',event=>{
 if(!adminSender(event))throw Error('Origem nao autorizada');
 adminSession=null;autoVscArmed=false;adminEmail='';raceSessionEnabled=false;clearSavedSession();return {loggedIn:false};
});
function startFlagsBridge() {
  if (flagsServer) return;
  flagsServer = http.createServer((request, response) => {
    // Endpoint somente local: registra a solicitação, sem alterar a bandeira central.
    if (request.method === 'POST' && request.url === '/api/yellow-vsc-request') {
      const peer = request.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Acesso apenas local' }));
        return;
      }
      let raw = '';
      request.on('data', chunk => {
        raw += chunk.toString('utf8');
        if (raw.length > 2048) request.destroy();
      });
      request.on('end', () => {
        let data;
        try { data = JSON.parse(raw); } catch (_) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'JSON invalido' }));
          return;
        }
        if (!data || data.source !== 'assetto-corsa') {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Origem invalida' }));
          return;
        }
        if (!raceSessionEnabled) {
          response.writeHead(409, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'VSC automatico bloqueado: selecione Corrida na janela ADM' }));
          return;
        }
        if (flagsState.mode !== 'GREEN' && flagsState.mode !== 'YELLOW') {
          response.writeHead(409, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Estado central nao permite solicitar VSC', mode: flagsState.mode }));
          return;
        }
        const now = Date.now();
        if (now - lastAutoVscAt < AUTO_VSC_COOLDOWN_MS) {
          response.writeHead(429, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Solicitacao recente', pending: !!pendingAutoVsc }));
          return;
        }
        lastAutoVscAt = now;
        pendingAutoVsc = { source: 'assetto-corsa', type: 'VSC_REQUEST', received_at: new Date(now).toISOString(), status: autoVscArmed && raceSessionEnabled ? 'FORWARDING' : 'PENDING_AUTHORIZATION' };
        if(autoVscArmed && raceSessionEnabled)sendAutomaticVsc();
        console.log('[Rookie Flags] Solicitacao de VSC recebida do simulador:', pendingAutoVsc);
        response.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ accepted: true, forwarded: false, request: pendingAutoVsc }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/auto-vsc-status') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ request: pendingAutoVsc, forwarded: pendingAutoVsc?.status === 'VSC_SENT', armed: autoVscArmed, raceSessionEnabled, note: pendingAutoVsc?.status || 'Sem solicitacoes' }));
      return;
    }
    if (request.method !== 'GET' || request.url !== '/api/state') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Nao encontrado' }));
      return;
    }
    const stale = !flagsLastOk || Date.now() - flagsLastOk > 12000;
    const state = stale && flagsState.mode !== 'OFFLINE'
      ? { mode: 'OFFLINE', error: 'Dados de bandeira desatualizados' }
      : flagsState;
    // Compensate the age of the latest server sample before delivering it to the plugin.
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
    console.log(`Bandeiras disponiveis em http://${FLAGS_HOST}:${FLAGS_PORT}/api/state`);
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

// Atualizacao automatica pelo feed oficial do Electron para GitHub Releases/Squirrel.Windows.
let updateCheckStarted = false;
function startGitHubAutoUpdate() {
  if (!app.isPackaged || process.platform !== 'win32' || updateCheckStarted) return;
  // Squirrel bloqueia verificacoes durante o primeiro arranque apos instalar.
  if (process.argv.some(arg => arg.startsWith('--squirrel-'))) return;
  updateCheckStarted = true;
  const owner = 'samumuelricardo123-hue';
  const repo = 'rookie-league';
  const feed = `https://update.electronjs.org/${owner}/${repo}/win32-${process.arch}/${app.getVersion()}/RELEASES`;
  autoUpdater.setFeedURL({ url: feed });
  autoUpdater.on('error', error => console.warn('[Atualizacao] Verificacao falhou:', error.message));
  autoUpdater.on('update-available', () => console.log('[Atualizacao] Nova versao encontrada; baixando em segundo plano.'));
  autoUpdater.on('update-not-available', () => console.log('[Atualizacao] Aplicativo ja esta atualizado.'));
  autoUpdater.on('update-downloaded', async () => {
    const choice = await dialog.showMessageBox({
      type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1,
      title: 'Atualizacao Rookie League pronta',
      message: 'Uma nova versao foi baixada.',
      detail: 'Reinicie o aplicativo para concluir a atualizacao.'
    });
    if (choice.response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(error => console.warn('[Atualizacao] Erro:', error.message));
  setTimeout(check, 12000);
  setInterval(check, 60 * 60 * 1000);
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
  await restoreAdminSession();
  startGitHubAutoUpdate();
  startTelemetryAgent();
  startFlagsBridge();
  createWindow();
  createAdminWindow();
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

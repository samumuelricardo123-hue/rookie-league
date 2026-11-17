const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rookieNotifications', {
  show: (title, body) => ipcRenderer.send('rookie:notification', {
    title: String(title || 'Rookie League'),
    body: String(body || '')
  })
});

// Informações da instalação para confirmação de versão no portal.
contextBridge.exposeInMainWorld('rookieApp', {
  getInfo: () => ipcRenderer.invoke('rookie:app:get-info')
});

// API somente de leitura para o portal: status e eventos da telemetria.
contextBridge.exposeInMainWorld('rookieTelemetry', {
  getStatus: () => ipcRenderer.invoke('rookie:telemetry:get-status'),
  onUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('rookie:telemetry:event', listener);
    return () => ipcRenderer.removeListener('rookie:telemetry:event', listener);
  }
});

contextBridge.exposeInMainWorld('rookieFlagsAdmin', {
 login: credentials => ipcRenderer.invoke('rookie:flags:login', credentials),
 arm: armed => ipcRenderer.invoke('rookie:flags:arm', armed),
 raceMode: enabled => ipcRenderer.invoke('rookie:flags:race-mode', enabled),
 setMode: mode => ipcRenderer.invoke('rookie:flags:set-mode', mode),
 status: () => ipcRenderer.invoke('rookie:flags:status'),
 logout: () => ipcRenderer.invoke('rookie:flags:logout')
});

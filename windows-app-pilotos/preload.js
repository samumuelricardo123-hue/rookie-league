const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rookieNotifications', {
  show: (title, body) => ipcRenderer.send('rookie:notification', {
    title: String(title || 'Rookie League'),
    body: String(body || '')
  })
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

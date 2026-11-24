const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    close: () => ipcRenderer.invoke('window:close'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
    isAlwaysOnTop: () => ipcRenderer.invoke('window:isAlwaysOnTop'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onWindowStateChange: (callback) => subscribe('window:state-changed', callback),
    onFullScreenChange: (callback) => subscribe('window:fullscreen-changed', callback)
  },

  resolveStream: ({ url, preferredQuality, slotId }) =>
    ipcRenderer.invoke('streamlink:resolve', { url, preferredQuality, slotId }),

  changeQuality: ({ slotId, url, quality }) =>
    ipcRenderer.invoke('streamlink:changeQuality', { slotId, url, quality }),

  stopStreamServer: (slotId) =>
    ipcRenderer.invoke('streamlink:stopServer', { slotId }),

  onServerClosed: (callback) => subscribe('stream:server-closed', callback),

  onWebviewNewWindow: (callback) => subscribe('webview:new-window', callback),

  checkEnv: () => ipcRenderer.invoke('env:check'),

  getYouTubeMeta: (url) => ipcRenderer.invoke('youtube:getMeta', url),

  openInVlc: (options) => ipcRenderer.invoke('vlc:open', options),

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  loadConfig: () => ipcRenderer.invoke('config:load')
});

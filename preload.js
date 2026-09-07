const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 視窗控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    close: () => ipcRenderer.invoke('window:close'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
    isAlwaysOnTop: () => ipcRenderer.invoke('window:isAlwaysOnTop'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onWindowStateChange: (callback) => {
      ipcRenderer.on('window:state-changed', (event, state) => callback(state));
    },
    onFullScreenChange: (callback) => {
      ipcRenderer.on('window:fullscreen-changed', (event, state) => callback(state));
    }
  },

  // Streamlink 解析 (包含 direct HLS 與 本機 MPEG-TS 伺服器)
  resolveStream: ({ url, preferredQuality, slotId }) =>
    ipcRenderer.invoke('streamlink:resolve', { url, preferredQuality, slotId }),

  // 伺服器模式切換畫質
  changeQuality: ({ slotId, url, quality }) =>
    ipcRenderer.invoke('streamlink:changeQuality', { slotId, url, quality }),

  // 停止槽位伺服器
  stopStreamServer: (slotId) => ipcRenderer.invoke('streamlink:stopServer', { slotId }),

  // 伺服器非預期關閉通知
  onServerClosed: (callback) => {
    ipcRenderer.on('stream:server-closed', (event, data) => callback(data));
  },

  // 環境檢測
  checkEnv: () => ipcRenderer.invoke('env:check'),

  // YouTube 資訊解析
  getYouTubeMeta: (url) => ipcRenderer.invoke('youtube:getMeta', url),

  // 外部 VLC 播放
  openInVlc: (options) => ipcRenderer.invoke('vlc:open', options),

  // 設定持久化 (userData JSON 檔案儲存)
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  loadConfig: () => ipcRenderer.invoke('config:load')
});

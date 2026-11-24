const { ipcMain, net, shell } = require('electron');
const binaryResolver = require('./services/binaryResolver');
const { openInVlc } = require('./services/vlcService');
const { getYouTubeMeta } = require('./services/youtubeService');
const { isSafeHttpUrl } = require('./constants');

function registerIpcHandlers({ getMainWindow, configStore, streamService }) {
  // ==================== 視窗控制 ====================
  ipcMain.handle('window:minimize', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.handle('window:toggleMaximize', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });

  ipcMain.handle('window:close', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle('window:toggleAlwaysOnTop', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;
    const next = !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next, 'screen-saver');
    return next;
  });

  ipcMain.handle('window:isAlwaysOnTop', () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win.isAlwaysOnTop() : false;
  });

  ipcMain.handle('window:isMaximized', () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win.isMaximized() : false;
  });

  ipcMain.handle('window:toggleFullScreen', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return next;
  });

  ipcMain.handle('window:isFullScreen', () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win.isFullScreen() : false;
  });

  // ==================== 設定儲存與讀取 ====================
  ipcMain.handle('config:save', (event, data) => configStore.save(data));
  ipcMain.handle('config:load', () => configStore.load());

  // ==================== Streamlink 解析與本機伺服器 ====================
  ipcMain.handle('streamlink:resolve', (event, payload = {}) =>
    streamService.resolveStream(payload)
  );

  ipcMain.handle('streamlink:changeQuality', (event, { slotId, url, quality } = {}) =>
    streamService.startSlotServer(slotId, url, quality)
  );

  ipcMain.handle('streamlink:stopServer', (event, { slotId } = {}) => {
    streamService.stopSlot(slotId);
    return { success: true };
  });

  // ==================== 外部環境、VLC、YouTube 與外部連結 ====================
  ipcMain.handle('env:check', () => binaryResolver.checkEnvironment());

  ipcMain.handle('vlc:open', (event, options = {}) => openInVlc(options));

  ipcMain.handle('youtube:getMeta', (event, url) =>
    getYouTubeMeta(url, (target, init) => net.fetch(target, init))
  );

  ipcMain.handle('shell:openExternal', async (event, url) => {
    if (isSafeHttpUrl(url)) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: '不合法的外部網址' };
  });
}

module.exports = {
  registerIpcHandlers
};

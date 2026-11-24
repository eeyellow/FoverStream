const { app, BrowserWindow } = require('electron');
const { createMainWindow, registerWebContentsSecurityGuards } = require('./window');
const { registerIpcHandlers } = require('./ipc');
const { createConfigStore } = require('./services/configStore');
const { createStreamService } = require('./services/streamService');

// ==================== 硬體加速與背景播放開關 ====================
// 注意：在 NVIDIA 560+ 驅動下，強制指定 use-angle=d3d11 與 ignore-gpu-blocklist
// 可能導致 Chromium ANGLE 繪圖核心崩潰黑畫面；如欲排查問題可傳入 --disable-gpu
if (process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 鎖定單一實例，避免重複開啟造成 GPUCache 鎖定衝突
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
const getMainWindow = () => mainWindow;

const streamService = createStreamService({
  onServerClosed: ({ slotId }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stream:server-closed', { slotId });
    }
  }
});

app.whenReady().then(() => {
  const configStore = createConfigStore({
    userDataDir: app.getPath('userData')
  });

  registerWebContentsSecurityGuards(getMainWindow);
  registerIpcHandlers({
    getMainWindow,
    configStore,
    streamService
  });

  mainWindow = createMainWindow(getMainWindow);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(getMainWindow);
    }
  });
});

app.on('before-quit', () => {
  streamService.stopAll();
});

app.on('window-all-closed', () => {
  streamService.stopAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const { app, BrowserWindow, ipcMain, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

// ==================== NVIDIA RTX 3060 專屬硬體加速開關 ====================
// 1. 強制鎖定 NVIDIA RTX 獨顯高效能模式 (防止切換到內顯)
app.commandLine.appendSwitch('force_high_performance_gpu');

// 2. 鎖定 Direct3D 11 原生繪圖核心 (Ampere 架構最佳相容與效能)
app.commandLine.appendSwitch('use-angle', 'd3d11');

// 3. 啟用 GPU 硬體加速與光柵化 (NVDEC 硬解與 Direct3D 11 支援)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// 5. 關閉多視訊背景頻率節流與解鎖自動播放
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 鎖定單一實例，防止重複開啟造成 GPUCache 檔案鎖死 (錯誤碼 0x5 存取被拒)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

// slotId (1..4) -> { child, url, quality, serverUrl }
const activeServers = new Map();

function getStreamlinkPath() {
  const commonPaths = [
    'C:\\Program Files\\Streamlink\\bin\\streamlink.exe',
    'C:\\Program Files (x86)\\Streamlink\\bin\\streamlink.exe'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'streamlink';
}

function getVlcPath() {
  const commonPaths = [
    'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'vlc';
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    execFile('taskkill', ['/pid', pid.toString(), '/T', '/F'], () => {});
  } catch (e) {}
}

function stopSlotServer(slotId) {
  const existing = activeServers.get(slotId);
  if (existing) {
    if (existing.child && existing.child.pid) {
      killProcessTree(existing.child.pid);
    }
    activeServers.delete(slotId);
  }
}

function startSlotServer(slotId, url, quality = 'best') {
  stopSlotServer(slotId);
  const streamlinkBin = getStreamlinkPath();

  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(streamlinkBin, [
      '--player-external-http',
      '--player-external-http-port', '0',
      '--player-external-http-continuous', 'no',
      '--hls-live-edge', '4',
      '--stream-segment-threads', '3',
      '--ringbuffer-size', '32M',
      '--http-timeout', '20',
      url,
      quality
    ]);

    activeServers.set(slotId, { child, url, quality, serverUrl: null });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stopSlotServer(slotId);
        resolve({ success: false, error: '本機串流伺服器啟動逾時 (15s)' });
      }
    }, 15000);

    let errorOutput = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/?/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        const serverUrl = `http://127.0.0.1:${match[1]}/`;
        const item = activeServers.get(slotId);
        if (item) item.serverUrl = serverUrl;
        resolve({ success: true, serverUrl });
      }
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        activeServers.delete(slotId);
        resolve({ success: false, error: errorOutput || `串流伺服器非預期結束 (代碼 ${code})` });
      } else {
        activeServers.delete(slotId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stream:server-closed', { slotId });
        }
      }
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        activeServers.delete(slotId);
        resolve({ success: false, error: err.message });
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0c0d14',
    title: 'EroStream - Quad Stream Player',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false
    }
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 絕不可竄改 YouTube / Googlevideo 媒體標頭，避免破壞 HTTP Range 認證引發 net::ERR_FAILED 無限轉圈
    if (
      details.url.includes('googlevideo.com') ||
      details.url.includes('youtube.com') ||
      details.url.includes('ytimg.com')
    ) {
      callback({});
      return;
    }

    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['X-Frame-Options'];
    delete responseHeaders['content-security-policy'];
    delete responseHeaders['Content-Security-Policy'];
    responseHeaders['access-control-allow-origin'] = ['*'];
    responseHeaders['access-control-allow-headers'] = ['*'];
    responseHeaders['access-control-allow-methods'] = ['GET, POST, OPTIONS, HEAD'];
    callback({ responseHeaders });
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:state-changed', { isMaximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:state-changed', { isMaximized: false });
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', { isFullScreen: true });
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', { isFullScreen: false });
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const [slotId] of activeServers) {
    stopSlotServer(slotId);
  }
});

app.on('window-all-closed', () => {
  for (const [slotId] of activeServers) {
    stopSlotServer(slotId);
  }
  if (process.platform !== 'darwin') app.quit();
});

// ==================== IPC 處理 ====================

// 視窗控制
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:toggleAlwaysOnTop', () => {
  if (!mainWindow) return false;
  const current = mainWindow.isAlwaysOnTop();
  const next = !current;
  mainWindow.setAlwaysOnTop(next, 'screen-saver');
  return next;
});

ipcMain.handle('window:isAlwaysOnTop', () => {
  return mainWindow ? mainWindow.isAlwaysOnTop() : false;
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('window:toggleFullScreen', () => {
  if (!mainWindow) return false;
  const isFull = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFull);
  return !isFull;
});

ipcMain.handle('window:isFullScreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

// 核心串流解析與伺服器調度
ipcMain.handle('streamlink:resolve', async (event, { url, preferredQuality = 'best', slotId = 1 }) => {
  const streamlinkBin = getStreamlinkPath();

  return new Promise((resolve) => {
    execFile(
      streamlinkBin,
      ['--json', url],
      { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
      async (err, stdout, stderr) => {
        if (err) {
          // 若 --json 失敗，嘗試啟動本機伺服器直連
          const serverRes = await startSlotServer(slotId, url, preferredQuality);
          if (serverRes.success) {
            resolve({
              success: true,
              metadata: { title: url, author: '' },
              streams: { [preferredQuality]: { type: 'mpegts' } },
              qualities: [preferredQuality],
              playType: 'mpegts',
              directUrl: serverRes.serverUrl,
              needsServer: true
            });
          } else {
            resolve({
              success: false,
              error: err.message || stderr || '無法解析此串流來源或頻道未開台'
            });
          }
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            resolve({ success: false, error: parsed.error });
            return;
          }
          if (!parsed.streams || Object.keys(parsed.streams).length === 0) {
            resolve({ success: false, error: '該頻道目前沒有可用串流（可能未開台）' });
            return;
          }

          const qualities = Object.keys(parsed.streams);
          const chosenQuality = parsed.streams[preferredQuality] ? preferredQuality : 'best';
          const targetStream = parsed.streams[chosenQuality] || parsed.streams[qualities[0]];

          // 判斷是否為 direct HLS URL 或是需要 Streamlink 轉發的 hls-multi / segmented 串流
          if (targetStream && targetStream.url && targetStream.type !== 'hls-multi') {
            stopSlotServer(slotId);
            resolve({
              success: true,
              metadata: parsed.metadata || {},
              plugin: parsed.plugin || '',
              streams: parsed.streams,
              qualities,
              playType: 'hls',
              directUrl: targetStream.url,
              needsServer: false
            });
          } else {
            // 如 Chaturbate 的 hls-multi：沒有靜態 direct URL，由 Streamlink 本機伺服器轉成 MPEG-TS
            const serverRes = await startSlotServer(slotId, url, chosenQuality);
            if (!serverRes.success) {
              resolve({ success: false, error: serverRes.error });
              return;
            }
            resolve({
              success: true,
              metadata: parsed.metadata || {},
              plugin: parsed.plugin || '',
              streams: parsed.streams,
              qualities,
              playType: 'mpegts',
              directUrl: serverRes.serverUrl,
              needsServer: true
            });
          }
        } catch (parseError) {
          resolve({
            success: false,
            error: 'Streamlink 回傳格式無效：' + parseError.message
          });
        }
      }
    );
  });
});

// 切換畫質 (若需要伺服器轉發則重啟伺服器)
ipcMain.handle('streamlink:changeQuality', async (event, { slotId, url, quality }) => {
  const serverRes = await startSlotServer(slotId, url, quality);
  return serverRes;
});

// 停止特定槽位的本機串流伺服器
ipcMain.handle('streamlink:stopServer', (event, { slotId }) => {
  stopSlotServer(slotId);
  return { success: true };
});

// 環境檢測
ipcMain.handle('env:check', async () => {
  const slPath = getStreamlinkPath();
  const vlcPath = getVlcPath();

  const slInstalled = fs.existsSync(slPath) || slPath === 'streamlink';
  const vlcInstalled = fs.existsSync(vlcPath);

  return {
    streamlink: { installed: slInstalled, path: slPath },
    vlc: { installed: vlcInstalled, path: vlcPath }
  };
});

// 外部 VLC 播放
ipcMain.handle('vlc:open', async (event, { url, originalUrl, quality }) => {
  const vlcPath = getVlcPath();
  const streamlinkBin = getStreamlinkPath();

  // 若為 direct m3u8 或本機伺服器 http://127.0.0.1:...
  if (url && (url.startsWith('http://127.0.0.1') || url.endsWith('.m3u8') || url.includes('.m3u8?'))) {
    try {
      const child = spawn(vlcPath, [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // 否則直接透過 streamlink 呼叫 VLC 播放原始網址
  try {
    const child = spawn(streamlinkBin, [originalUrl || url, quality || 'best'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 獲取 YouTube 影片標題與作者 (透過 oEmbed API)
ipcMain.handle('youtube:getMeta', async (event, url) => {
  try {
    const res = await net.fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (res.ok) {
      const data = await res.json();
      return { success: true, title: data.title, author: data.author_name };
    }
  } catch (e) {}
  return { success: false };
});

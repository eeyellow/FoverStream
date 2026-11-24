const path = require('path');
const { app, BrowserWindow, session, shell, webContents } = require('electron');
const {
  PROJECT_ROOT,
  WINDOW_SHOW_FALLBACK_MS,
  BYPASS_HEADER_DOMAINS,
  isSafeHttpUrl
} = require('./constants');

let corsHeadersConfigured = false;

function configureSessionHeaders(getMainWindow) {
  if (corsHeadersConfigured) return;
  corsHeadersConfigured = true;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 1. 絕不竄改 YouTube / Googlevideo 媒體標頭，避免破壞 HTTP Range 認證
    if (BYPASS_HEADER_DOMAINS.some((domain) => details.url.includes(domain))) {
      callback({});
      return;
    }

    // 2. 略過 <webview> 子頁面的回應標頭，保留網站原生 CSP 與帶憑證的 CORS (credentials: 'include')
    if (typeof details.webContentsId === 'number') {
      const mainWin = getMainWindow();
      const mainId = mainWin && !mainWin.isDestroyed() ? mainWin.webContents.id : null;
      if (details.webContentsId !== mainId) {
        const senderContents = webContents.fromId(details.webContentsId);
        if (senderContents && senderContents.getType() === 'webview') {
          callback({});
          return;
        }
      }
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
}

function createMainWindow(getMainWindow) {
  configureSessionHeaders(getMainWindow);

  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0c0d14',
    title: 'FoveaStream - Quad Stream Player',
    show: false,
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'src', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false
    }
  });

  // 相容性備援：部分環境 (如 Windows Insider Preview) Chromium 沙箱無法啟動 renderer 時，自動以 --no-sandbox 重啟
  win.webContents.on('render-process-gone', (event, details) => {
    if (details.reason === 'launch-failed' && !process.argv.includes('--no-sandbox')) {
      console.warn('[FoveaStream] Renderer 啟動失敗 (沙箱不相容)，改以 --no-sandbox 重新啟動...');
      app.relaunch({ args: process.argv.slice(1).concat(['--no-sandbox']) });
      app.exit(0);
    }
  });

  win.loadFile(path.join(PROJECT_ROOT, 'src', 'renderer', 'index.html'));

  // 防止主視窗被重導向至外部未信任頁面，且僅允許 http/https 外部開啟
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol !== 'file:') {
        event.preventDefault();
        if (isSafeHttpUrl(navigationUrl)) {
          shell.openExternal(navigationUrl);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  let shown = false;
  let fallbackTimer = null;

  const showWindow = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    win.show();
    win.focus();
  };

  win.once('ready-to-show', showWindow);
  fallbackTimer = setTimeout(showWindow, WINDOW_SHOW_FALLBACK_MS);

  win.on('closed', () => {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  });

  const sendSafe = (channel, payload) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  win.on('maximize', () => sendSafe('window:state-changed', { isMaximized: true }));
  win.on('unmaximize', () => sendSafe('window:state-changed', { isMaximized: false }));
  win.on('enter-full-screen', () => sendSafe('window:fullscreen-changed', { isFullScreen: true }));
  win.on('leave-full-screen', () => sendSafe('window:fullscreen-changed', { isFullScreen: false }));

  return win;
}

function registerWebContentsSecurityGuards(getMainWindow) {
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (waEvent, webPreferences, params) => {
      delete webPreferences.preload;
      delete webPreferences.preloadURL;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;

      if (params && params.src && params.src !== 'about:blank' && !isSafeHttpUrl(params.src)) {
        waEvent.preventDefault();
      }
    });

    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        if (isSafeHttpUrl(url)) {
          const mainWin = getMainWindow();
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('webview:new-window', {
              webContentsId: contents.id,
              url
            });
          } else {
            shell.openExternal(url);
          }
        }
        return { action: 'deny' };
      });
    }
  });
}

module.exports = {
  createMainWindow,
  registerWebContentsSecurityGuards
};

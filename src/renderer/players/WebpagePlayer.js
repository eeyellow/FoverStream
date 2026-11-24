import { CONSOLE_SIGNALS } from '../constants.js';

export class WebpagePlayer {
  constructor({
    container,
    slotNumber,
    onReady,
    onTitleUpdate,
    onNavigate,
    onMouseEnter,
    onLoadError
  }) {
    this.container = container;
    this.slotNumber = slotNumber;
    this.onReady = onReady;
    this.onTitleUpdate = onTitleUpdate;
    this.onNavigate = onNavigate;
    this.onMouseEnter = onMouseEnter;
    this.onLoadError = onLoadError;
    this.webview = null;
    this.isDomReady = false;
  }

  mount({ url, volume, muted }) {
    this.destroy();

    const webview = document.createElement('webview');
    webview.id = `web-wv-${this.slotNumber}`;
    webview.src = url;
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.border = 'none';
    webview.setAttribute('allowpopups', 'true');

    this.webview = webview;
    this.container.innerHTML = '';
    this.container.appendChild(webview);

    webview.addEventListener('dom-ready', async () => {
      if (this.webview !== webview) return;
      this.isDomReady = true;

      const title = webview.getTitle();
      if (title) {
        this.onTitleUpdate?.(title, webview.getURL() || url);
      }

      this.setMuted(muted);
      this.setVolume(volume);

      const enterSignal = JSON.stringify(CONSOLE_SIGNALS.MOUSEENTER);
      try {
        await webview.executeJavaScript(`
          (() => {
            if (window.__foveastreamWebInjected) return;
            window.__foveastreamWebInjected = true;
            window.addEventListener('mouseenter', () => {
              console.log(${enterSignal});
            });
          })()
        `);
      } catch {
        // ignore guest injection restrictions
      }

      this.onReady?.();
    });

    webview.addEventListener('page-title-updated', (e) => {
      if (e.title && this.webview === webview) {
        const currentUrl = this.isDomReady ? webview.getURL() || url : url;
        this.onTitleUpdate?.(e.title, currentUrl);
      }
    });

    webview.addEventListener('did-navigate', (e) => {
      if (e.url && this.webview === webview && e.url !== 'about:blank') {
        this.onNavigate?.(e.url);
      }
    });

    webview.addEventListener('console-message', (e) => {
      if (e.message === CONSOLE_SIGNALS.MOUSEENTER) {
        this.onMouseEnter?.();
      }
    });

    webview.addEventListener('did-fail-load', (e) => {
      // -3 (ERR_ABORTED) 為正常重新導向或中斷，忽略不報錯
      if (e.errorCode !== -3 && e.isMainFrame !== false) {
        this.onLoadError?.(`網頁載入失敗 (${e.errorDescription || e.errorCode})`);
      }
    });
  }

  goBack() {
    if (this.webview && this.isDomReady && this.webview.canGoBack()) {
      this.webview.goBack();
    }
  }

  goForward() {
    if (this.webview && this.isDomReady && this.webview.canGoForward()) {
      this.webview.goForward();
    }
  }

  setVolume(volume) {
    if (!this.webview || !this.isDomReady) return;
    const safeVolume = JSON.stringify(Number(volume) || 0);
    this.webview
      .executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) v.volume = ${safeVolume};
        })()
      `)
      .catch(() => {});
  }

  setMuted(muted) {
    if (!this.webview || !this.isDomReady) return;
    const flag = Boolean(muted);
    if (this.webview.setAudioMuted) {
      try {
        this.webview.setAudioMuted(flag);
      } catch {
        // ignore
      }
    }
    const safeMuted = JSON.stringify(flag);
    this.webview
      .executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) v.muted = ${safeMuted};
        })()
      `)
      .catch(() => {});
  }

  reload() {
    if (this.webview && this.isDomReady) {
      this.webview.reload();
    }
  }

  matchesWebContentsId(webContentsId) {
    if (!this.webview || !this.isDomReady) return false;
    try {
      return this.webview.getWebContentsId() === webContentsId;
    } catch {
      return false;
    }
  }

  handleNewWindow(url) {
    if (url && this.webview && this.isDomReady) {
      this.webview.loadURL(url);
    }
  }

  destroy() {
    this.isDomReady = false;
    if (this.webview) {
      try {
        this.webview.src = 'about:blank';
      } catch {
        // ignore
      }
      this.webview = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

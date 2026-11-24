import { CONSOLE_SIGNALS } from '../constants.js';

const THEATER_CLEAN_CSS = `
  #masthead-container, #secondary, #below, #comments, ytd-miniplayer, #chat, #chat-container, tp-yt-app-drawer, .ytp-chrome-top, .ytp-pause-overlay {
    display: none !important;
  }
  #movie_player {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    background: #000 !important;
  }
  .html5-video-container {
    width: 100% !important;
    height: 100% !important;
  }
  .html5-main-video {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
  }
`;

export class YouTubePlayer {
  constructor({ container, slotNumber, onReady, onDoubleClick, onMouseEnter }) {
    this.container = container;
    this.slotNumber = slotNumber;
    this.onReady = onReady;
    this.onDoubleClick = onDoubleClick;
    this.onMouseEnter = onMouseEnter;
    this.webview = null;
    this.isDomReady = false;
  }

  mount({ videoId, volume, muted, initialYtQuality }) {
    this.destroy();

    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const webview = document.createElement('webview');
    webview.id = `yt-wv-${this.slotNumber}`;
    webview.src = watchUrl;
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

      try {
        await webview.insertCSS(THEATER_CLEAN_CSS);

        const safeVolume = JSON.stringify(Number(volume) || 0);
        const safeMuted = JSON.stringify(Boolean(muted));
        const dblSignal = JSON.stringify(CONSOLE_SIGNALS.DBLCLICK);
        const enterSignal = JSON.stringify(CONSOLE_SIGNALS.MOUSEENTER);

        await webview.executeJavaScript(`
          (() => {
            if (window.__foveastreamYtInjected) return;
            window.__foveastreamYtInjected = true;

            const syncPlay = () => {
              const mp = document.getElementById('movie_player');
              if (mp && mp.playVideo) {
                mp.playVideo();
              }
              const v = document.querySelector('video');
              if (v) {
                v.volume = ${safeVolume};
                v.muted = ${safeMuted};
                v.play().catch(() => {});
              }
            };
            syncPlay();
            setTimeout(syncPlay, 1000);
            setTimeout(syncPlay, 2500);

            window.addEventListener('dblclick', () => {
              console.log(${dblSignal});
            });

            window.addEventListener('mouseenter', () => {
              console.log(${enterSignal});
            });

            setInterval(() => {
              const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
              if (skipBtn) skipBtn.click();
              const ad = document.querySelector('.ad-showing video');
              if (ad) {
                ad.playbackRate = 16;
              }
            }, 500);
          })()
        `);

        if (webview.setAudioMuted) {
          webview.setAudioMuted(Boolean(muted));
        }

        if (initialYtQuality) {
          this.setQuality(initialYtQuality);
        }
      } catch (err) {
        console.warn('[YouTubePlayer] Webview 初始化注入警告:', err);
      }

      this.onReady?.();
    });

    webview.addEventListener('console-message', (e) => {
      if (e.message === CONSOLE_SIGNALS.DBLCLICK) {
        this.onDoubleClick?.();
      } else if (e.message === CONSOLE_SIGNALS.MOUSEENTER) {
        this.onMouseEnter?.();
      }
    });
  }

  setQuality(ytQuality) {
    if (!this.webview || !this.isDomReady) return;
    const safeQuality = JSON.stringify(String(ytQuality));
    this.webview
      .executeJavaScript(`
        (() => {
          const mp = document.getElementById('movie_player');
          if (mp && mp.setPlaybackQualityRange) {
            mp.setPlaybackQualityRange(${safeQuality}, ${safeQuality});
          }
        })()
      `)
      .catch(() => {});
  }

  async togglePlay() {
    if (!this.webview || !this.isDomReady) return false;
    try {
      return await this.webview.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) {
            if (v.paused) { v.play(); } else { v.pause(); }
            return !v.paused;
          }
          return false;
        })()
      `);
    } catch {
      return false;
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
    if (url && window.api?.openExternal) {
      window.api.openExternal(url);
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

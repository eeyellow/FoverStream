// EroStream - Renderer Process (支援 direct HLS + 本機 MPEG-TS + YouTube 原生 + 網頁瀏覽器模式)

function formatUrl(url) {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^[a-zA-Z]+:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function extractYouTubeId(url) {
  if (!url) return null;
  const regExp = /(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

class StreamSlot {
  constructor(slotNumber, manager) {
    this.slotNumber = slotNumber;
    this.manager = manager;
    this.container = document.getElementById(`slot-${slotNumber}`);
    this.video = document.getElementById(`video-${slotNumber}`);
    this.ytContainer = document.getElementById(`yt-container-${slotNumber}`);
    this.setupView = document.getElementById(`setup-${slotNumber}`);
    this.loaderView = document.getElementById(`loader-${slotNumber}`);
    this.errorView = document.getElementById(`error-${slotNumber}`);
    this.errorMsg = this.errorView.querySelector('.error-msg');

    // 控制元件
    this.urlInput = this.setupView.querySelector('.stream-url-input');
    this.playBtn = this.setupView.querySelector('.btn-play-stream');
    this.browseWebBtn = this.setupView.querySelector('.btn-browse-web');
    this.titleEl = this.container.querySelector('.stream-title');
    this.qualitySelect = this.container.querySelector('.quality-select');
    this.playPauseBtn = this.container.querySelector('.play-pause-btn');
    this.refreshBtn = this.container.querySelector('.refresh-btn');
    this.webBackBtn = this.container.querySelector('.web-back-btn');
    this.webFwdBtn = this.container.querySelector('.web-forward-btn');
    this.muteBtn = this.container.querySelector('.mute-btn');
    this.volSlider = this.container.querySelector('.vol-slider');
    this.audioSoloBtn = this.container.querySelector('.audio-solo-btn');
    this.vlcBtn = this.container.querySelector('.vlc-btn');
    this.editBtn = this.container.querySelector('.edit-btn');
    this.soloBtn = this.container.querySelector('.solo-btn');
    this.retryBtn = this.errorView.querySelector('.btn-retry');
    this.editUrlBtn = this.errorView.querySelector('.btn-edit-url');

    // 播放器實例與串流狀態
    this.hls = null;
    this.mpegtsPlayer = null;
    this.ytWebview = null;
    this.playType = null; // 'hls' | 'mpegts' | 'youtube' | 'webpage'
    this.needsServer = false;
    this.originalUrl = '';
    this.currentDirectUrl = '';
    this.currentQuality = 'best';
    this.streamsMap = {};
    this.isMuted = true;
    this.volume = 0.8;
    this.video.volume = this.volume;
    this.video.muted = this.isMuted;

    this.bindEvents();
  }

  bindEvents() {
    this.playBtn.addEventListener('click', () => {
      const url = this.urlInput.value.trim();
      if (url) this.load(url);
    });

    if (this.browseWebBtn) {
      this.browseWebBtn.addEventListener('click', () => {
        const url = this.urlInput.value.trim();
        if (url) this.load(url, null, true);
      });
    }

    if (this.webBackBtn) {
      this.webBackBtn.addEventListener('click', () => {
        if (this.ytWebview && this.ytWebview.canGoBack()) {
          this.ytWebview.goBack();
        }
      });
    }

    if (this.webFwdBtn) {
      this.webFwdBtn.addEventListener('click', () => {
        if (this.ytWebview && this.ytWebview.canGoForward()) {
          this.ytWebview.goForward();
        }
      });
    }

    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = this.urlInput.value.trim();
        if (url) this.load(url);
      }
    });

    // 快速範例與貼上
    this.setupView.querySelectorAll('.sample-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        if (chip.classList.contains('clipboard-chip')) {
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              this.urlInput.value = text.trim();
              this.load(text.trim());
            }
          } catch (e) {
            console.error('剪貼簿讀取失敗:', e);
          }
        } else {
          const sample = chip.getAttribute('data-sample');
          if (sample) {
            this.urlInput.value = sample;
            this.load(sample);
          }
        }
      });
    });

    this.playPauseBtn.addEventListener('click', () => this.togglePlay());
    this.refreshBtn.addEventListener('click', () => this.reload());

    this.muteBtn.addEventListener('click', () => this.toggleMute());
    this.volSlider.addEventListener('input', (e) => {
      this.setVolume(parseFloat(e.target.value) / 100);
      if (this.isMuted) this.setMuted(false);
    });

    this.audioSoloBtn.addEventListener('click', () => {
      this.manager.soloAudio(this.slotNumber);
    });

    // 以 VLC 開啟
    this.vlcBtn.addEventListener('click', async () => {
      const res = await window.api.openInVlc({
        url: this.currentDirectUrl,
        originalUrl: this.originalUrl,
        quality: this.currentQuality
      });
      if (!res.success) {
        alert('無法啟動 VLC：' + (res.error || '請確認是否已安裝 VLC 或 Streamlink'));
      }
    });

    this.editBtn.addEventListener('click', () => this.showSetup());

    this.soloBtn.addEventListener('click', () => {
      this.manager.toggleSoloSlot(this.slotNumber);
    });

    this.video.addEventListener('dblclick', () => {
      this.manager.toggleSoloSlot(this.slotNumber);
    });

    this.container.addEventListener('mouseenter', () => {
      if (this.manager.audioFocusFollow && this.originalUrl) {
        this.manager.soloAudio(this.slotNumber);
      }
    });

    // 畫質選單切換
    this.qualitySelect.addEventListener('change', async (e) => {
      const q = e.target.value;
      this.currentQuality = q;

      if (this.needsServer) {
        this.showLoader(`正在切換至 ${q} 畫質...`);
        const res = await window.api.changeQuality({
          slotId: this.slotNumber,
          url: this.originalUrl,
          quality: q
        });
        if (res.success) {
          this.playMpegts(res.serverUrl);
        } else {
          this.showError('切換畫質失敗：' + (res.error || ''));
        }
      } else if (this.streamsMap[q]) {
        const streamTarget = this.streamsMap[q];
        const targetUrl = typeof streamTarget === 'string' ? streamTarget : streamTarget.url;
        this.playDirectHls(targetUrl);
      }
    });

    this.retryBtn.addEventListener('click', () => this.reload());
    this.editUrlBtn.addEventListener('click', () => this.showSetup());
  }

  async changeQualityTo(newQuality) {
    if (!this.originalUrl || this.currentQuality === newQuality) return;
    if (!this.streamsMap[newQuality] && newQuality !== 'best') return;

    this.currentQuality = newQuality;
    this.qualitySelect.value = newQuality;

    if (this.needsServer) {
      const res = await window.api.changeQuality({
        slotId: this.slotNumber,
        url: this.originalUrl,
        quality: newQuality
      });
      if (res.success) {
        this.playMpegts(res.serverUrl);
      }
    } else if (this.streamsMap[newQuality]) {
      const streamTarget = this.streamsMap[newQuality];
      const targetUrl = typeof streamTarget === 'string' ? streamTarget : streamTarget.url;
      this.playDirectHls(targetUrl);
    }
  }

  async load(url, preferredQuality = null, forceWebMode = false) {
    url = formatUrl(url);
    this.originalUrl = url;
    this.urlInput.value = url;

    // 強制以網頁瀏覽器模式開啟
    if (forceWebMode) {
      this.playWebPage(url);
      this.manager.saveState();
      return;
    }

    // 0. 若為 YouTube 網址，直接啟用原生 YouTube 播放核心 (支援所有 1080p/4K、動畫番劇與實況)
    const ytId = extractYouTubeId(url);
    if (ytId) {
      this.playYouTube(url, ytId);
      this.manager.saveState();
      return;
    }

    const targetQ = preferredQuality || this.manager.preferredGridQuality || '720p';
    this.currentQuality = targetQ;
    this.showLoader('Streamlink 解析串流網址中...');

    // 1. 若為直接 m3u8
    if (url.endsWith('.m3u8') || url.includes('.m3u8?')) {
      this.titleEl.textContent = 'HLS 直播源';
      this.qualitySelect.innerHTML = '<option value="direct">Direct HLS</option>';
      this.needsServer = false;
      this.playDirectHls(url);
      this.manager.saveState();
      return;
    }

    // 2. 透過 Streamlink 解析
    try {
      const res = await window.api.resolveStream({
        url,
        preferredQuality: targetQ,
        slotId: this.slotNumber
      });

      if (!res.success) {
        // 非直播串流或 Streamlink 不支援時，自動切換為網頁模式開啟
        console.log(`[Slot ${this.slotNumber}] 非串流源，切換至網頁模式:`, res.error);
        this.playWebPage(url);
        this.manager.saveState();
        return;
      }

      this.streamsMap = res.streams || {};
      const qualities = res.qualities || Object.keys(this.streamsMap);

      // 更新畫質選單
      this.qualitySelect.innerHTML = '';
      qualities.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q;
        opt.textContent = q;
        if (q === targetQ || (targetQ === 'best' && q === 'best')) {
          opt.selected = true;
        }
        this.qualitySelect.appendChild(opt);
      });

      // 更新頻道名稱 / 標題
      const meta = res.metadata || {};
      this.titleEl.textContent = meta.title || meta.author || url;
      this.titleEl.title = `${meta.author || ''} - ${meta.title || url}`;

      this.needsServer = res.needsServer;
      this.playType = res.playType;

      if (res.playType === 'mpegts') {
        // Chaturbate 等 hls-multi / segmented 串流，透過本機 MPEG-TS 伺服器播放
        this.playMpegts(res.directUrl);
      } else {
        // Direct HLS
        this.playDirectHls(res.directUrl);
      }

      this.manager.saveState();
    } catch (err) {
      this.showError('系統錯誤：' + err.message);
    }
  }

  async playYouTube(url, videoId) {
    this.destroyPlayers(true);
    this.playType = 'youtube';
    this.video.style.display = 'none';
    this.ytContainer.style.display = 'block';

    this.showLoader('YouTube 影片載入中...');

    try {
      const meta = await window.api.getYouTubeMeta(url);
      if (meta && meta.success) {
        this.titleEl.textContent = meta.title;
        this.titleEl.title = `${meta.author || ''} - ${meta.title}`;
      } else {
        this.titleEl.textContent = 'YouTube 影片';
      }
    } catch (e) {
      this.titleEl.textContent = 'YouTube 影片';
    }

    this.qualitySelect.innerHTML = '<option value="auto">YouTube 原生高畫質</option>';

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const webview = document.createElement('webview');
    webview.id = `yt-wv-${this.slotNumber}`;
    webview.src = watchUrl;
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.border = 'none';
    webview.setAttribute('allowpopups', 'true');

    this.ytWebview = webview;
    this.ytContainer.innerHTML = '';
    this.ytContainer.appendChild(webview);

    // 注入純淨劇院 CSS，讓 YouTube 播放器滿版並將視訊置頂顯示，杜絕高度坍塌或被覆蓋為黑畫面
    const cleanCSS = `
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

    webview.addEventListener('dom-ready', async () => {
      try {
        await webview.insertCSS(cleanCSS);

        // 注入自動播放、跳過廣告、雙擊放大 (Solo)、焦點跟隨與音量同步腳本
        await webview.executeJavaScript(`
          (() => {
            const syncPlay = () => {
              const mp = document.getElementById('movie_player');
              if (mp && mp.playVideo) {
                mp.playVideo();
              }
              const v = document.querySelector('video');
              if (v) {
                v.volume = ${this.volume};
                v.muted = ${this.isMuted};
                v.play().catch(() => {});
              }
            };
            syncPlay();
            setTimeout(syncPlay, 1000);
            setTimeout(syncPlay, 2500);

            // 雙擊通知外層 Solo 全螢幕
            window.addEventListener('dblclick', () => {
              console.log('__erostream_dblclick__');
            });

            // 滑鼠移入通知音訊焦點
            window.addEventListener('mouseenter', () => {
              console.log('__erostream_mouseenter__');
            });

            // 智慧自動略過廣告
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
          webview.setAudioMuted(this.isMuted);
        }
      } catch (err) {
        console.warn('Webview 初始化注入警告:', err);
      }
      this.hideOverlays();
      this.updatePlayState(true);
    });

    webview.addEventListener('console-message', (e) => {
      if (e.message === '__erostream_dblclick__') {
        this.manager.toggleSoloSlot(this.slotNumber);
      } else if (e.message === '__erostream_mouseenter__') {
        if (this.manager.audioFocusFollow && this.originalUrl) {
          this.manager.soloAudio(this.slotNumber);
        }
      }
    });
  }

  playWebPage(url) {
    this.destroyPlayers(true);
    this.playType = 'webpage';
    this.video.style.display = 'none';
    this.ytContainer.style.display = 'block';
    this.container.classList.add('is-web-mode');

    // 切換底部控制列模式
    if (this.webBackBtn) this.webBackBtn.classList.remove('hidden');
    if (this.webFwdBtn) this.webFwdBtn.classList.remove('hidden');
    if (this.playPauseBtn) this.playPauseBtn.classList.add('hidden');
    if (this.vlcBtn) this.vlcBtn.classList.add('hidden');

    this.showLoader('網頁載入中...');

    const targetUrl = formatUrl(url);
    this.originalUrl = targetUrl;
    this.urlInput.value = targetUrl;
    this.titleEl.textContent = targetUrl;
    this.titleEl.title = targetUrl;
    this.qualitySelect.innerHTML = '<option value="web">🌐 網頁模式</option>';

    const webview = document.createElement('webview');
    webview.id = `web-wv-${this.slotNumber}`;
    webview.src = targetUrl;
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.border = 'none';
    webview.setAttribute('allowpopups', 'true');

    this.ytWebview = webview;
    this.ytContainer.innerHTML = '';
    this.ytContainer.appendChild(webview);

    webview.addEventListener('dom-ready', async () => {
      this.hideOverlays();
      const title = webview.getTitle();
      if (title) {
        this.titleEl.textContent = title;
        this.titleEl.title = `${title} - ${webview.getURL()}`;
      }
      this.updatePlayState(true);

      if (webview.setAudioMuted) {
        webview.setAudioMuted(this.isMuted);
      }

      try {
        await webview.executeJavaScript(`
          (() => {
            window.addEventListener('mouseenter', () => {
              console.log('__erostream_mouseenter__');
            });
          })()
        `);
      } catch (e) {}
    });

    webview.addEventListener('page-title-updated', (e) => {
      if (e.title) {
        this.titleEl.textContent = e.title;
        this.titleEl.title = `${e.title} - ${webview.getURL() || targetUrl}`;
      }
    });

    webview.addEventListener('did-navigate', (e) => {
      if (e.url) {
        this.originalUrl = e.url;
        this.urlInput.value = e.url;
        this.manager.saveState();
      }
    });

    webview.addEventListener('new-window', (e) => {
      if (e.url) {
        webview.loadURL(e.url);
      }
    });

    webview.addEventListener('console-message', (e) => {
      if (e.message === '__erostream_mouseenter__') {
        if (this.manager.audioFocusFollow && this.originalUrl) {
          this.manager.soloAudio(this.slotNumber);
        }
      }
    });

    webview.addEventListener('did-fail-load', (e) => {
      if (e.errorCode !== -3) {
        this.showError(`網頁載入失敗 (${e.errorDescription || e.errorCode})`);
      }
    });
  }

  playDirectHls(streamUrl) {
    this.currentDirectUrl = streamUrl;
    this.destroyPlayers(false);

    if (window.Hls && window.Hls.isSupported()) {
      this.hls = new window.Hls({
        liveSyncDurationCount: 4, // 增加安全緩衝切片數 (原為 3)
        maxLiveSyncPlaybackRate: 1.05, // 溫和追趕延遲 (原為 1.5)，杜絕忽快忽慢與頓挫
        maxBufferLength: 15, // 允許 15 秒安全緩衝
        maxMaxBufferLength: 30,
        enableWorker: true,
        lowLatencyMode: false // 四開時關閉極限低延遲，保證畫面流暢
      });

      this.hls.loadSource(streamUrl);
      this.hls.attachMedia(this.video);

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.hideOverlays();
        this.video.play().catch(() => {});
        this.updatePlayState(true);
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.warn(`[Slot ${this.slotNumber}] HLS 網路錯誤，嘗試恢復...`);
              this.hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.warn(`[Slot ${this.slotNumber}] HLS 媒體解碼錯誤，嘗試恢復...`);
              this.hls.recoverMediaError();
              break;
            default:
              console.error(`[Slot ${this.slotNumber}] HLS 無法恢復的錯誤:`, data);
              this.destroyPlayers(true);
              this.showError('串流播放中斷或訊號遺失');
              break;
          }
        }
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = streamUrl;
      this.video.addEventListener('loadedmetadata', () => {
        this.hideOverlays();
        this.video.play().catch(() => {});
        this.updatePlayState(true);
      });
    } else {
      this.showError('此系統環境不支援 HLS 播放');
    }
  }

  playMpegts(streamUrl) {
    this.currentDirectUrl = streamUrl;
    this.destroyPlayers(false);

    if (window.mpegts && window.mpegts.isSupported()) {
      this.mpegtsPlayer = window.mpegts.createPlayer(
        {
          type: 'mpegts',
          isLive: true,
          url: streamUrl
        },
        {
          enableWorker: true,
          lazyLoad: false,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 5.0, // 放寬追趕門檻 (原 2.5s)，杜絕反覆跳秒掉幀
          liveBufferLatencyMinRemain: 1.5, // 保持 1.5s 安全緩衝 (原 0.5s)
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 20,
          autoCleanupMinBackwardDuration: 10
        }
      );

      this.mpegtsPlayer.attachMediaElement(this.video);
      this.mpegtsPlayer.load();

      this.mpegtsPlayer.play().then(() => {
        this.hideOverlays();
        this.updatePlayState(true);
      }).catch(() => {
        this.hideOverlays();
        this.updatePlayState(true);
      });

      this.mpegtsPlayer.on(window.mpegts.Events.ERROR, (errType, errDetail) => {
        console.warn(`[Slot ${this.slotNumber}] MPEG-TS 狀態:`, errType, errDetail);
      });
    } else {
      this.showError('系統不支援 MPEG-TS 串流播放');
    }
  }

  destroyPlayers(stopBackend = true) {
    this.container.classList.remove('is-web-mode');
    if (this.webBackBtn) this.webBackBtn.classList.add('hidden');
    if (this.webFwdBtn) this.webFwdBtn.classList.add('hidden');
    if (this.playPauseBtn) this.playPauseBtn.classList.remove('hidden');
    if (this.vlcBtn) this.vlcBtn.classList.remove('hidden');

    if (this.ytWebview) {
      try {
        this.ytWebview.src = 'about:blank';
      } catch (e) {}
      this.ytWebview = null;
    }
    if (this.ytContainer) {
      this.ytContainer.innerHTML = '';
      this.ytContainer.style.display = 'none';
    }
    if (this.video) {
      this.video.style.display = 'block';
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.mpegtsPlayer) {
      try {
        this.mpegtsPlayer.pause();
        this.mpegtsPlayer.unload();
        this.mpegtsPlayer.detachMediaElement();
        this.mpegtsPlayer.destroy();
      } catch (e) {}
      this.mpegtsPlayer = null;
    }
    if (stopBackend) {
      window.api.stopStreamServer(this.slotNumber);
    }
  }

  reload() {
    if ((this.playType === 'youtube' || this.playType === 'webpage') && this.ytWebview) {
      this.ytWebview.reload();
      return;
    }
    if (this.originalUrl) {
      const q = this.qualitySelect.value || this.currentQuality || 'best';
      this.load(this.originalUrl, q);
    }
  }

  togglePlay() {
    if (this.playType === 'youtube' && this.ytWebview) {
      this.ytWebview.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) {
            if (v.paused) { v.play(); } else { v.pause(); }
            return !v.paused;
          }
          return false;
        })()
      `).then((isPlaying) => {
        this.updatePlayState(isPlaying);
      }).catch(() => {});
      return;
    }

    if (this.video.paused) {
      this.video.play();
      this.updatePlayState(true);
    } else {
      this.video.pause();
      this.updatePlayState(false);
    }
  }

  updatePlayState(isPlaying) {
    this.playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.video.volume = this.volume;
    if ((this.playType === 'youtube' || this.playType === 'webpage') && this.ytWebview) {
      this.ytWebview.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) v.volume = ${this.volume};
        })()
      `).catch(() => {});
    }
    this.volSlider.value = Math.round(this.volume * 100);
    this.muteBtn.textContent = this.isMuted || this.volume === 0 ? '🔇' : '🔊';
  }

  setMuted(muted) {
    this.isMuted = muted;
    this.video.muted = muted;
    if ((this.playType === 'youtube' || this.playType === 'webpage') && this.ytWebview) {
      if (this.ytWebview.setAudioMuted) {
        this.ytWebview.setAudioMuted(muted);
      }
      this.ytWebview.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) v.muted = ${muted};
        })()
      `).catch(() => {});
    }
    this.muteBtn.textContent = muted ? '🔇' : '🔊';

    if (!muted) {
      this.container.classList.add('has-audio');
      this.audioSoloBtn.classList.add('active');
    } else {
      this.container.classList.remove('has-audio');
      this.audioSoloBtn.classList.remove('active');
    }
  }

  toggleMute() {
    this.setMuted(!this.isMuted);
  }

  showSetup() {
    this.destroyPlayers(true);
    this.setupView.classList.remove('hidden');
    this.loaderView.classList.add('hidden');
    this.errorView.classList.add('hidden');
  }

  showLoader(text = 'Streamlink 解析中...') {
    this.setupView.classList.add('hidden');
    this.loaderView.classList.remove('hidden');
    this.errorView.classList.add('hidden');
    this.loaderView.querySelector('.loader-text').textContent = text;
  }

  showError(msg) {
    this.setupView.classList.add('hidden');
    this.loaderView.classList.add('hidden');
    this.errorView.classList.remove('hidden');
    this.errorMsg.textContent = msg;
  }

  hideOverlays() {
    this.setupView.classList.add('hidden');
    this.loaderView.classList.add('hidden');
    this.errorView.classList.add('hidden');
  }
}

// 主管理器
class StreamManager {
  constructor() {
    this.slots = [];
    this.audioFocusFollow = true;
    this.isMasterMuted = false;
    this.activeSoloSlot = null;

    this.init();
  }

  async init() {
    for (let i = 1; i <= 4; i++) {
      this.slots.push(new StreamSlot(i, this));
    }

    document.getElementById('minBtn').addEventListener('click', () => window.api.window.minimize());
    document.getElementById('maxBtn').addEventListener('click', () => window.api.window.toggleMaximize());
    document.getElementById('closeBtn').addEventListener('click', () => window.api.window.close());

    const fullscreenBtn = document.getElementById('fullscreenBtn');
    fullscreenBtn.addEventListener('click', () => {
      this.toggleFullScreen();
    });

    const pinBtn = document.getElementById('alwaysOnTopBtn');
    pinBtn.addEventListener('click', async () => {
      const isTop = await window.api.window.toggleAlwaysOnTop();
      pinBtn.classList.toggle('pin-active', isTop);
    });

    window.api.window.onWindowStateChange(({ isMaximized }) => {
      document.getElementById('maxBtn').textContent = isMaximized ? '🗗' : '🗖';
    });

    window.api.window.onFullScreenChange(({ isFullScreen }) => {
      document.body.classList.toggle('is-fullscreen', isFullScreen);
      fullscreenBtn.textContent = isFullScreen ? '🗗' : '⛶';
      fullscreenBtn.title = isFullScreen ? '結束全螢幕 (F11 / Esc)' : '純淨全螢幕 (F11 / F)';
    });

    // 伺服器非預期關閉監聽
    window.api.onServerClosed(({ slotId }) => {
      console.warn(`[Main] Slot ${slotId} 伺服器已結束`);
    });

    const container = document.getElementById('playerContainer');
    const layout2x2 = document.getElementById('layout2x2');
    const layout1p3 = document.getElementById('layout1p3');

    layout2x2.addEventListener('click', () => {
      container.className = 'grid-container mode-2x2';
      layout2x2.classList.add('active');
      layout1p3.classList.remove('active');
      this.exitSolo();
    });

    layout1p3.addEventListener('click', () => {
      container.className = 'grid-container mode-1p3';
      layout1p3.classList.add('active');
      layout2x2.classList.remove('active');
      this.exitSolo();
    });

    // 4. 四分割畫質策略監聽
    this.preferredGridQuality = '720p';
    const gridQualitySelect = document.getElementById('gridQualitySelect');
    if (gridQualitySelect) {
      this.preferredGridQuality = gridQualitySelect.value;
      gridQualitySelect.addEventListener('change', (e) => {
        this.preferredGridQuality = e.target.value;
        // 若非 Solo 狀態，即時切換所有已連線槽位之畫質
        if (!this.activeSoloSlot) {
          this.slots.forEach((s) => {
            if (s.originalUrl) {
              s.changeQualityTo(this.preferredGridQuality);
            }
          });
        }
      });
    }

    const audioFocusBtn = document.getElementById('audioFocusToggle');
    audioFocusBtn.addEventListener('click', () => {
      this.audioFocusFollow = !this.audioFocusFollow;
      audioFocusBtn.classList.toggle('active', this.audioFocusFollow);
    });

    const muteAllBtn = document.getElementById('muteAllBtn');
    muteAllBtn.addEventListener('click', () => {
      this.toggleMasterMute();
    });

    document.getElementById('reloadAllBtn').addEventListener('click', () => {
      this.slots.forEach((s) => s.reload());
    });

    document.getElementById('savePresetBtn').addEventListener('click', () => {
      this.saveState();
      alert('已成功儲存當前四台串流配置！');
    });

    this.bindHotkeys();
    this.checkEnvironment();
    this.loadState();
  }

  soloAudio(targetSlotNum) {
    if (this.isMasterMuted) return;

    this.slots.forEach((s) => {
      if (s.slotNumber === targetSlotNum) {
        s.setMuted(false);
      } else {
        s.setMuted(true);
      }
    });
  }

  toggleMasterMute() {
    this.isMasterMuted = !this.isMasterMuted;
    const muteAllBtn = document.getElementById('muteAllBtn');
    muteAllBtn.classList.toggle('muted-active', this.isMasterMuted);

    this.slots.forEach((s) => {
      s.setMuted(this.isMasterMuted ? true : s.isMuted);
    });
  }

  toggleSoloSlot(slotNum) {
    const slot = this.slots[slotNum - 1];
    if (this.activeSoloSlot === slotNum) {
      this.exitSolo();
    } else {
      this.slots.forEach((s) => s.container.classList.remove('solo'));
      slot.container.classList.add('solo');
      this.activeSoloSlot = slotNum;
      this.soloAudio(slotNum);

      // 放大時自動無感升級至最高畫質 (1080p / best)
      slot.savedGridQuality = slot.currentQuality;
      const bestQ = slot.streamsMap['best'] ? 'best' : (slot.streamsMap['1080p'] ? '1080p' : null);
      if (bestQ && slot.currentQuality !== bestQ) {
        slot.changeQualityTo(bestQ);
      }
    }
  }

  exitSolo() {
    if (this.activeSoloSlot) {
      const slot = this.slots[this.activeSoloSlot - 1];
      if (slot && slot.savedGridQuality && slot.currentQuality !== slot.savedGridQuality) {
        // 縮回四分割時自動降回流暢畫質，節省頻寬與解碼負擔
        slot.changeQualityTo(slot.savedGridQuality);
      }
    }
    this.slots.forEach((s) => s.container.classList.remove('solo'));
    this.activeSoloSlot = null;
  }

  async toggleFullScreen() {
    const isFull = await window.api.window.toggleFullScreen();
    document.body.classList.toggle('is-fullscreen', isFull);
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
      fullscreenBtn.textContent = isFull ? '🗗' : '⛶';
      fullscreenBtn.title = isFull ? '結束全螢幕 (F11 / Esc)' : '純淨全螢幕 (F11 / F)';
    }
  }

  bindHotkeys() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

      const key = e.key;

      if (['1', '2', '3', '4'].includes(key)) {
        if (e.altKey) {
          this.soloAudio(parseInt(key, 10));
        } else {
          this.toggleSoloSlot(parseInt(key, 10));
        }
      }

      if (key === 'Escape') {
        if (document.body.classList.contains('is-fullscreen')) {
          this.toggleFullScreen();
        } else {
          this.exitSolo();
        }
      }

      if (key === 'F11') {
        e.preventDefault();
        this.toggleFullScreen();
      }

      if (key === 'f' || key === 'F') {
        this.toggleFullScreen();
      }

      if (key === 'm' || key === 'M') {
        this.toggleMasterMute();
      }

      if (key === 't' || key === 'T') {
        document.getElementById('alwaysOnTopBtn').click();
      }
    });
  }

  async checkEnvironment() {
    const slBadge = document.getElementById('slStatus');
    const vlcBadge = document.getElementById('vlcStatus');

    try {
      const res = await window.api.checkEnv();

      if (res.streamlink.installed) {
        slBadge.className = 'status-badge ready';
        slBadge.title = `Streamlink: ${res.streamlink.path}`;
      } else {
        slBadge.className = 'status-badge';
        slBadge.title = '未檢測到 Streamlink';
      }

      if (res.vlc.installed) {
        vlcBadge.className = 'status-badge ready';
        vlcBadge.title = `VLC: ${res.vlc.path}`;
      } else {
        vlcBadge.className = 'status-badge';
        vlcBadge.title = '未檢測到 VLC';
      }
    } catch (e) {
      console.error('環境檢測失敗:', e);
    }
  }

  saveState() {
    const data = {
      slots: this.slots.map((s) => ({
        url: s.originalUrl,
        volume: s.volume,
        playType: s.playType
      }))
    };
    localStorage.setItem('erostream_config', JSON.stringify(data));
  }

  loadState() {
    try {
      const raw = localStorage.getItem('erostream_config');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.slots && Array.isArray(data.slots)) {
        data.slots.forEach((item, idx) => {
          if (this.slots[idx] && item.url) {
            this.slots[idx].urlInput.value = item.url;
            if (item.volume !== undefined) this.slots[idx].setVolume(item.volume);
            if (item.playType === 'webpage') {
              this.slots[idx].load(item.url, null, true);
            } else {
              this.slots[idx].load(item.url);
            }
          }
        });
      }
    } catch (e) {
      console.error('載入設定失敗:', e);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new StreamManager();
});

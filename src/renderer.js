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
    this.cancelSetupBtn = this.setupView.querySelector('.btn-cancel-setup');
    this.titleEl = this.container.querySelector('.stream-title');
    this.qualitySelect = this.container.querySelector('.quality-select');
    this.playPauseBtn = this.container.querySelector('.play-pause-btn');
    this.refreshBtn = this.container.querySelector('.refresh-btn');
    this.webBackBtn = this.container.querySelector('.web-back-btn');
    this.webFwdBtn = this.container.querySelector('.web-forward-btn');
    this.muteBtn = this.container.querySelector('.mute-btn');
    this.volSlider = this.container.querySelector('.vol-slider');
    this.badge = this.container.querySelector('.slot-badge');
    this.primaryBtn = this.container.querySelector('.primary-btn');
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

    if (this.badge) {
      this.badge.addEventListener('click', () => {
        this.manager.setPrimarySlot(this.slotNumber);
        if (this.manager.audioFocusFollow && this.originalUrl) {
          this.manager.soloAudio(this.slotNumber);
        }
      });
    }

    if (this.primaryBtn) {
      this.primaryBtn.addEventListener('click', () => {
        this.manager.setPrimarySlot(this.slotNumber);
        if (this.manager.audioFocusFollow && this.originalUrl) {
          this.manager.soloAudio(this.slotNumber);
        }
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
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        this.hideSetup();
      }
    });

    if (this.cancelSetupBtn) {
      this.cancelSetupBtn.addEventListener('click', () => {
        this.hideSetup();
      });
    }

    this.setupView.addEventListener('click', (e) => {
      if (e.target === this.setupView && this.originalUrl) {
        this.hideSetup();
      }
    });

    this.urlInput.addEventListener('focus', () => {
      setTimeout(() => {
        this.urlInput.select();
      }, 0);
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

  findBestMatchingQuality(targetType) {
    if (!this.streamsMap || Object.keys(this.streamsMap).length === 0) return 'best';
    const available = Object.keys(this.streamsMap).filter(
      (q) => q !== 'audio_only' && !q.includes('audio')
    );
    if (available.length === 0) return 'best';

    if (targetType === 'high') {
      // 焦點主畫面：優先選 best / 1080p 最高解析度
      if (this.streamsMap['best']) return 'best';
      const highPref = ['1080p60', '1080p', '720p60', '720p'];
      for (const q of highPref) {
        if (this.streamsMap[q]) return q;
      }
      return available[0];
    }

    if (targetType === 'low') {
      // 流量集中給主台：副台自動降級為 480p / 360p 省頻寬
      const lowPref = ['480p', '480p30', '480p60', '360p', '360p30', 'worst'];
      for (const q of lowPref) {
        if (this.streamsMap[q] && q !== 'audio_only') return q;
      }
      const candidate = available.find((q) => /480|360/i.test(q));
      if (candidate) return candidate;
      return available[available.length - 1] || '480p';
    }

    if (targetType === 'grid') {
      const pref = this.manager.preferredGridQuality || '720p';
      if (this.streamsMap[pref]) return pref;
      if (pref === '720p') {
        const gPref = ['720p', '720p60', '480p', 'best'];
        for (const q of gPref) {
          if (this.streamsMap[q]) return q;
        }
      }
      return available[0];
    }

    return 'best';
  }

  async applyQualityMode(mode) {
    if (!this.originalUrl || this.playType === 'webpage') return;

    if (this.playType === 'youtube') {
      const qMap = { high: 'hd1080', low: 'small', grid: 'medium' };
      const ytQ = qMap[mode] || 'hd720';
      if (this.ytWebview) {
        this.ytWebview.executeJavaScript(`
          (() => {
            const mp = document.getElementById('movie_player');
            if (mp && mp.setPlaybackQualityRange) {
              mp.setPlaybackQualityRange('${ytQ}', '${ytQ}');
            }
          })()
        `).catch(() => {});
      }
      return;
    }

    const targetQuality = this.findBestMatchingQuality(mode);
    if (targetQuality && targetQuality !== this.currentQuality) {
      await this.changeQualityTo(targetQuality);
    }
  }

  async load(url, preferredQuality = null, forceWebMode = false) {
    url = formatUrl(url);
    this.originalUrl = url;
    this.urlInput.value = url;
    this.manager.saveState();

    // 強制以網頁瀏覽器模式開啟
    if (forceWebMode) {
      this.playWebPage(url);
      this.manager.saveState();
      return;
    }

    const desiredMode = this.manager.getDesiredQualityModeForSlot(this.slotNumber);

    // 0. 若為 YouTube 網址，直接啟用原生 YouTube 播放核心 (支援所有 1080p/4K、動畫番劇與實況)
    const ytId = extractYouTubeId(url);
    if (ytId) {
      this.playYouTube(url, ytId);
      this.manager.saveState();
      return;
    }

    let targetQ = preferredQuality;
    if (!targetQ) {
      if (desiredMode === 'high') targetQ = 'best';
      else if (desiredMode === 'low') targetQ = '480p';
      else targetQ = this.manager.preferredGridQuality || '720p';
    }
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

      const actualTargetQ = this.findBestMatchingQuality(desiredMode);
      this.currentQuality = actualTargetQ;

      // 更新畫質選單
      this.qualitySelect.innerHTML = '';
      qualities.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q;
        opt.textContent = q;
        if (q === actualTargetQ) {
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
        if (res.chosenQuality && res.chosenQuality !== actualTargetQ && this.streamsMap[actualTargetQ]) {
          await this.changeQualityTo(actualTargetQ);
        } else {
          this.playMpegts(res.directUrl);
        }
      } else {
        // Direct HLS
        const targetUrl = this.streamsMap[actualTargetQ]
          ? (typeof this.streamsMap[actualTargetQ] === 'string' ? this.streamsMap[actualTargetQ] : this.streamsMap[actualTargetQ].url)
          : res.directUrl;
        this.playDirectHls(targetUrl || res.directUrl);
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

        const desiredMode = this.manager.getDesiredQualityModeForSlot(this.slotNumber);
        this.applyQualityMode(desiredMode);
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
    // 保留目前背景播放之串流（不銷毀），允許隨時取消返回原畫面
    this.setupView.classList.remove('hidden');
    this.loaderView.classList.add('hidden');
    this.errorView.classList.add('hidden');

    if (this.cancelSetupBtn) {
      this.cancelSetupBtn.classList.toggle('hidden', !this.originalUrl);
    }

    if (this.urlInput) {
      if (this.originalUrl) {
        this.urlInput.value = this.originalUrl;
      }
      setTimeout(() => {
        this.urlInput.focus();
        this.urlInput.select();
      }, 50);
    }
  }

  hideSetup() {
    if (!this.originalUrl) return;
    this.setupView.classList.add('hidden');
    if (this.cancelSetupBtn) {
      this.cancelSetupBtn.classList.add('hidden');
    }
    this.urlInput.value = this.originalUrl;
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
    if (this.cancelSetupBtn) {
      this.cancelSetupBtn.classList.add('hidden');
    }
  }
}

// 主管理器
class StreamManager {
  constructor() {
    this.slots = [];
    this.audioFocusFollow = true;
    this.isMasterMuted = false;
    this.activeSoloSlot = null;
    this.currentLayout = '2x2';
    this.primarySlot = 1;
    this.isInitialized = false;

    this.init();
  }

  async init() {
    for (let i = 1; i <= 4; i++) {
      this.slots.push(new StreamSlot(i, this));
    }

    document.getElementById('minBtn').addEventListener('click', () => window.api.window.minimize());
    document.getElementById('maxBtn').addEventListener('click', () => window.api.window.toggleMaximize());
    document.getElementById('closeBtn').addEventListener('click', () => {
      this.saveState();
      window.api.window.close();
    });

    window.addEventListener('beforeunload', () => {
      this.saveState();
    });

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

    // 快捷佈局切換綁定
    const layout2x2 = document.getElementById('layout2x2');
    const layout1p3 = document.getElementById('layout1p3');
    const layoutTop1p3 = document.getElementById('layoutTop1p3');
    const layoutBottom1p3 = document.getElementById('layoutBottom1p3');

    if (layout2x2) layout2x2.addEventListener('click', () => this.setLayout('2x2'));
    if (layout1p3) layout1p3.addEventListener('click', () => this.setLayout('1p3'));
    if (layoutTop1p3) layoutTop1p3.addEventListener('click', () => this.setLayout('top1p3'));
    if (layoutBottom1p3) layoutBottom1p3.addEventListener('click', () => this.setLayout('bottom1p3'));

    // 快速鍵說明面板綁定
    const helpBtn = document.getElementById('helpBtn');
    const closeHelpBtn = document.getElementById('closeHelpBtn');
    const helpModal = document.getElementById('helpModal');

    if (helpBtn) helpBtn.addEventListener('click', () => this.toggleHelpModal());
    if (closeHelpBtn) closeHelpBtn.addEventListener('click', () => this.toggleHelpModal(false));
    if (helpModal) {
      helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) this.toggleHelpModal(false);
      });
    }

    // 4. 四分割畫質策略監聽
    this.preferredGridQuality = '720p';
    const gridQualitySelect = document.getElementById('gridQualitySelect');
    if (gridQualitySelect) {
      this.preferredGridQuality = gridQualitySelect.value;
      gridQualitySelect.addEventListener('change', (e) => {
        this.preferredGridQuality = e.target.value;
        // 若在 2x2 模式且非 Solo，套用新的四分割畫質
        if (!this.activeSoloSlot && this.currentLayout === '2x2') {
          this.applySmartQualityStrategy();
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
    await this.loadState();
  }

  setLayout(mode) {
    const validModes = ['2x2', '1p3', 'top1p3', 'bottom1p3'];
    if (!validModes.includes(mode)) mode = '2x2';
    this.currentLayout = mode;

    const container = document.getElementById('playerContainer');
    container.className = `grid-container mode-${mode}`;

    const btnMap = {
      '2x2': document.getElementById('layout2x2'),
      '1p3': document.getElementById('layout1p3'),
      'top1p3': document.getElementById('layoutTop1p3'),
      'bottom1p3': document.getElementById('layoutBottom1p3')
    };

    Object.entries(btnMap).forEach(([k, btn]) => {
      if (btn) btn.classList.toggle('active', k === mode);
    });

    if (this.activeSoloSlot) {
      this.exitSolo();
    }
    this.applySmartQualityStrategy();
    this.saveState();
  }

  cycleLayout() {
    const modes = ['2x2', '1p3', 'top1p3', 'bottom1p3'];
    const idx = modes.indexOf(this.currentLayout || '2x2');
    const next = modes[(idx + 1) % modes.length];
    this.setLayout(next);
  }

  setPrimarySlot(slotNum) {
    if (slotNum < 1 || slotNum > 4) return;
    this.primarySlot = slotNum;
    this.slots.forEach((s) => {
      s.container.classList.toggle('is-primary', s.slotNumber === slotNum);
    });
    // 處於 1+3 焦點模式且未在 Solo 狀態時，動態調配焦點主台與副台畫質
    if (!this.activeSoloSlot && ['1p3', 'top1p3', 'bottom1p3'].includes(this.currentLayout)) {
      this.applySmartQualityStrategy();
    }
    this.saveState();
  }

  cyclePrimarySlot() {
    const next = (this.primarySlot % 4) + 1;
    this.setPrimarySlot(next);
    if (this.audioFocusFollow && this.slots[next - 1].originalUrl) {
      this.soloAudio(next);
    }
  }

  getDesiredQualityModeForSlot(slotNum) {
    // Solo 全螢幕模式：Solo 台為 high，其餘 3 台降為 low
    if (this.activeSoloSlot) {
      return slotNum === this.activeSoloSlot ? 'high' : 'low';
    }
    // 1+3 焦點模式 (左/上/下)：焦點主台為 high，其餘 3 台降為 low
    if (['1p3', 'top1p3', 'bottom1p3'].includes(this.currentLayout)) {
      return slotNum === this.primarySlot ? 'high' : 'low';
    }
    // 2x2 四等分模式：全體均衡畫質 (720p)
    return 'grid';
  }

  applySmartQualityStrategy() {
    this.slots.forEach((s) => {
      const mode = this.getDesiredQualityModeForSlot(s.slotNumber);
      s.applyQualityMode(mode);
    });
  }

  toggleHelpModal(show) {
    const modal = document.getElementById('helpModal');
    if (!modal) return;
    const isHidden = modal.classList.contains('hidden');
    const shouldShow = show !== undefined ? show : isHidden;
    modal.classList.toggle('hidden', !shouldShow);
  }

  adjustVolume(delta) {
    if (this.activeSoloSlot) {
      const slot = this.slots[this.activeSoloSlot - 1];
      if (slot) slot.setVolume(slot.volume + delta);
    } else {
      this.slots.forEach((s) => {
        s.setVolume(s.volume + delta);
      });
    }
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
    const container = document.getElementById('playerContainer');
    if (this.activeSoloSlot === slotNum) {
      this.exitSolo();
    } else {
      this.slots.forEach((s) => {
        s.container.classList.remove('solo');
        if (s.soloBtn) {
          s.soloBtn.textContent = '⛶';
          s.soloBtn.title = '單一放大全螢幕 (雙擊畫面亦可)';
        }
      });
      slot.container.classList.add('solo');
      if (container) container.classList.add('has-solo');
      if (slot.soloBtn) {
        slot.soloBtn.textContent = '🗗';
        slot.soloBtn.title = '還原佈局 (Esc / 雙擊畫面)';
      }
      this.activeSoloSlot = slotNum;
      this.soloAudio(slotNum);
      this.applySmartQualityStrategy();
    }
  }

  exitSolo() {
    if (!this.activeSoloSlot) return;
    const container = document.getElementById('playerContainer');
    if (container) container.classList.remove('has-solo');
    this.slots.forEach((s) => {
      s.container.classList.remove('solo');
      if (s.soloBtn) {
        s.soloBtn.textContent = '⛶';
        s.soloBtn.title = '單一放大全螢幕 (雙擊畫面亦可)';
      }
    });
    this.activeSoloSlot = null;
    this.applySmartQualityStrategy();
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

      // 1. 數字快捷鍵 (1~4)
      if (['1', '2', '3', '4'].includes(key)) {
        if (e.ctrlKey) {
          // Ctrl + 1~4 將指定台設為焦點大主畫面 (上/左/下)
          this.setPrimarySlot(parseInt(key, 10));
          if (this.audioFocusFollow && this.slots[parseInt(key, 10) - 1].originalUrl) {
            this.soloAudio(parseInt(key, 10));
          }
        } else if (e.shiftKey) {
          // Shift + 1~4 切換佈局
          const layoutMap = { '1': '2x2', '2': '1p3', '3': 'top1p3', '4': 'bottom1p3' };
          this.setLayout(layoutMap[key]);
        } else if (e.altKey) {
          // Alt + 1~4 獨播指定台音訊
          this.soloAudio(parseInt(key, 10));
        } else {
          // 1~4 單台放大 (Solo) / 復原
          this.toggleSoloSlot(parseInt(key, 10));
        }
        return;
      }

      // Tab: 輪替主畫面焦點 (台1 -> 台2 -> 台3 -> 台4)
      if (key === 'Tab') {
        e.preventDefault();
        this.cyclePrimarySlot();
        return;
      }

      // 2. 佈局輪播 (L)
      if (key === 'l' || key === 'L') {
        this.cycleLayout();
        return;
      }

      // 3. 快速鍵說明面板 (? 或 H 或 F1)
      if (key === '?' || key === 'h' || key === 'H' || key === 'F1') {
        e.preventDefault();
        this.toggleHelpModal();
        return;
      }

      // 4. 音訊焦點切換 (A)
      if (key === 'a' || key === 'A') {
        const audioFocusBtn = document.getElementById('audioFocusToggle');
        if (audioFocusBtn) audioFocusBtn.click();
        return;
      }

      // 5. 重新載入所有台 (R)
      if ((key === 'r' || key === 'R') && !e.ctrlKey) {
        this.slots.forEach((s) => s.reload());
        return;
      }

      // 6. 儲存設定 (S)
      if ((key === 's' || key === 'S') && !e.ctrlKey) {
        this.saveState();
        const saveBtn = document.getElementById('savePresetBtn');
        if (saveBtn) {
          const old = saveBtn.textContent;
          saveBtn.textContent = '✓ 已儲存';
          setTimeout(() => { saveBtn.textContent = old; }, 1200);
        }
        return;
      }

      // 7. 空白鍵播放 / 暫停焦點台
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.activeSoloSlot) {
          this.slots[this.activeSoloSlot - 1].togglePlay();
        } else {
          const activeSlot = this.slots.find((s) => !s.isMuted && s.originalUrl) || this.slots[0];
          if (activeSlot) activeSlot.togglePlay();
        }
        return;
      }

      // 8. 音量快速調節 (方向鍵上下)
      if (key === 'ArrowUp') {
        e.preventDefault();
        this.adjustVolume(0.1);
        return;
      }
      if (key === 'ArrowDown') {
        e.preventDefault();
        this.adjustVolume(-0.1);
        return;
      }

      // 9. 退出全螢幕 / Solo / 關閉彈窗 / 取消換台 (Escape)
      if (key === 'Escape') {
        const modal = document.getElementById('helpModal');
        if (modal && !modal.classList.contains('hidden')) {
          this.toggleHelpModal(false);
          return;
        }

        // 若有任何槽位正在顯示換台畫面且原本已有串流，優先取消換台返回
        const activeSetupSlot = this.slots.find(
          (s) => !s.setupView.classList.contains('hidden') && s.originalUrl
        );
        if (activeSetupSlot) {
          activeSetupSlot.hideSetup();
          return;
        }

        if (document.body.classList.contains('is-fullscreen')) {
          this.toggleFullScreen();
        } else {
          this.exitSolo();
        }
        return;
      }

      if (key === 'F11') {
        e.preventDefault();
        this.toggleFullScreen();
        return;
      }

      if (key === 'f' || key === 'F') {
        this.toggleFullScreen();
        return;
      }

      if (key === 'm' || key === 'M') {
        this.toggleMasterMute();
        return;
      }

      if (key === 't' || key === 'T') {
        document.getElementById('alwaysOnTopBtn').click();
        return;
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
    if (!this.isInitialized) return;
    const data = {
      layout: this.currentLayout || '2x2',
      primarySlot: this.primarySlot || 1,
      preferredGridQuality: this.preferredGridQuality || '720p',
      slots: this.slots.map((s) => ({
        url: s.originalUrl || '',
        volume: s.volume,
        playType: s.playType
      }))
    };
    try {
      localStorage.setItem('erostream_config', JSON.stringify(data));
      if (window.api && window.api.saveConfig) {
        window.api.saveConfig(data);
      }
    } catch (e) {
      console.error('儲存設定失敗:', e);
    }
  }

  async loadState() {
    try {
      let data = null;
      if (window.api && window.api.loadConfig) {
        data = await window.api.loadConfig();
      }
      if (!data) {
        const raw = localStorage.getItem('erostream_config');
        if (raw) data = JSON.parse(raw);
      }
      if (!data) {
        this.setPrimarySlot(1);
        return;
      }

      if (data.layout) {
        this.setLayout(data.layout);
      }
      if (data.primarySlot) {
        this.setPrimarySlot(data.primarySlot);
      } else {
        this.setPrimarySlot(1);
      }
      if (data.preferredGridQuality) {
        this.preferredGridQuality = data.preferredGridQuality;
        const gridQualitySelect = document.getElementById('gridQualitySelect');
        if (gridQualitySelect) gridQualitySelect.value = data.preferredGridQuality;
      }
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
    } finally {
      this.isInitialized = true;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new StreamManager();
});

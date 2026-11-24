import { formatUrl, extractYouTubeId, isDirectHlsUrl } from '../utils/url.js';
import { findBestMatchingQuality, mapYouTubeQuality } from '../utils/quality.js';
import { HlsPlayer } from '../players/HlsPlayer.js';
import { MpegtsPlayer } from '../players/MpegtsPlayer.js';
import { YouTubePlayer } from '../players/YouTubePlayer.js';
import { WebpagePlayer } from '../players/WebpagePlayer.js';
import { showToast } from './Toast.js';

export class StreamSlot {
  static createDomElement(slotNumber) {
    const template = document.getElementById('slotTemplate');
    const fragment = template.content.cloneNode(true);
    const root = fragment.querySelector('.stream-slot');

    root.id = `slot-${slotNumber}`;
    root.dataset.slot = String(slotNumber);
    if (slotNumber === 1) {
      root.classList.add('is-primary');
    }

    root.querySelector('video').id = `video-${slotNumber}`;
    root.querySelector('.yt-player-container').id = `yt-container-${slotNumber}`;
    root.querySelector('.slot-setup').id = `setup-${slotNumber}`;
    root.querySelector('.slot-loader').id = `loader-${slotNumber}`;
    root.querySelector('.slot-error').id = `error-${slotNumber}`;

    root.querySelector('.slot-header-num').textContent = `台 ${slotNumber}`;

    const badge = root.querySelector('.slot-badge');
    badge.textContent = `台 ${slotNumber}`;
    badge.title = `點擊將此台設為焦點大畫面 (Ctrl+${slotNumber})`;

    const primaryBtn = root.querySelector('.primary-btn');
    primaryBtn.title = `將此台設為焦點大主畫面 (Ctrl+${slotNumber})`;

    return root;
  }

  constructor(slotNumber, manager, parentContainer) {
    this.slotNumber = slotNumber;
    this.manager = manager;

    this.container = StreamSlot.createDomElement(slotNumber);
    parentContainer.appendChild(this.container);

    this.video = this.container.querySelector('video');
    this.ytContainer = this.container.querySelector('.yt-player-container');
    this.setupView = this.container.querySelector('.slot-setup');
    this.loaderView = this.container.querySelector('.slot-loader');
    this.errorView = this.container.querySelector('.slot-error');
    this.errorMsg = this.errorView.querySelector('.error-msg');

    // 控制元件
    this.urlInput = this.setupView.querySelector('.stream-url-input');
    this.playBtn = this.setupView.querySelector('.btn-play-stream');
    this.browseWebBtn = this.setupView.querySelector('.btn-browse-web');
    this.stopSlotBtn = this.setupView.querySelector('.btn-stop-slot');
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

    // 播放核心與串流狀態
    this.hlsPlayer = new HlsPlayer({
      video: this.video,
      slotNumber,
      onReady: () => {
        this.hideOverlays();
        this.updatePlayState(true);
      },
      onFatalError: (msg) => {
        window.api.stopStreamServer(this.slotNumber);
        this.showError(msg);
      }
    });

    this.mpegtsPlayer = new MpegtsPlayer({
      video: this.video,
      slotNumber,
      onReady: () => {
        this.hideOverlays();
        this.updatePlayState(true);
      },
      onFatalError: (msg) => this.showError(msg)
    });

    this.youtubePlayer = null;
    this.webpagePlayer = null;

    this.loadSeq = 0;
    this.playType = null; // 'hls' | 'mpegts' | 'youtube' | 'webpage' | null
    this.needsServer = false;
    this.originalUrl = '';
    this.currentDirectUrl = '';
    this.currentQuality = 'best';
    this.streamsMap = {};
    this.isMuted = true;
    this.volume = 0.8;

    this.video.volume = this.volume;
    this.video.muted = true;

    this.bindEvents();
  }

  bindEvents() {
    this.playBtn.addEventListener('click', () => {
      const url = this.urlInput.value.trim();
      if (url) this.load(url);
    });

    this.browseWebBtn.addEventListener('click', () => {
      const url = this.urlInput.value.trim();
      if (url) this.load(url, null, true);
    });

    const handleSetPrimary = () => {
      this.manager.setPrimarySlot(this.slotNumber);
      if (this.manager.audioFocusFollow && this.originalUrl) {
        this.manager.soloAudio(this.slotNumber);
      }
    };

    this.badge.addEventListener('click', handleSetPrimary);
    this.primaryBtn.addEventListener('click', handleSetPrimary);

    this.webBackBtn.addEventListener('click', () => {
      this.webpagePlayer?.goBack();
    });

    this.webFwdBtn.addEventListener('click', () => {
      this.webpagePlayer?.goForward();
    });

    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = this.urlInput.value.trim();
        if (url) this.load(url);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        this.hideSetup();
      }
    });

    this.cancelSetupBtn.addEventListener('click', () => this.hideSetup());
    this.stopSlotBtn.addEventListener('click', () => this.clear());

    this.setupView.addEventListener('click', (e) => {
      if (e.target === this.setupView && this.originalUrl) {
        this.hideSetup();
      }
    });

    this.urlInput.addEventListener('focus', () => {
      setTimeout(() => this.urlInput.select(), 0);
    });

    this.setupView.querySelectorAll('.sample-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        if (chip.classList.contains('clipboard-chip')) {
          try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
              this.urlInput.value = text.trim();
              this.load(text.trim());
            } else {
              showToast('剪貼簿目前沒有文字內容');
            }
          } catch (err) {
            console.error('剪貼簿讀取失敗:', err);
            showToast('無法讀取剪貼簿內容', { type: 'error' });
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

    this.muteBtn.addEventListener('click', () => {
      if (this.manager.isMasterMuted) {
        this.manager.disengageMasterMute();
        this.setMuted(false);
        return;
      }
      this.toggleMute();
    });

    this.volSlider.addEventListener('input', (e) => {
      this.setVolume(parseFloat(e.target.value) / 100);
      if (this.manager.isMasterMuted) {
        this.manager.disengageMasterMute();
      }
      if (this.isMuted) {
        this.setMuted(false);
      }
    });

    this.audioSoloBtn.addEventListener('click', () => {
      this.manager.soloAudio(this.slotNumber, { forceUnmuteMaster: true });
    });

    this.vlcBtn.addEventListener('click', async () => {
      const res = await window.api.openInVlc({
        url: this.currentDirectUrl,
        originalUrl: this.originalUrl,
        quality: this.currentQuality
      });
      if (!res.success) {
        showToast(`無法啟動 VLC：${res.error || '請確認是否已安裝 VLC 或 Streamlink'}`, {
          type: 'error',
          duration: 3500
        });
      } else {
        showToast(`已在外部播放器開啟台 ${this.slotNumber}`);
      }
    });

    this.editBtn.addEventListener('click', () => this.showSetup());
    this.soloBtn.addEventListener('click', () => this.manager.toggleSoloSlot(this.slotNumber));
    this.video.addEventListener('dblclick', () => this.manager.toggleSoloSlot(this.slotNumber));

    this.container.addEventListener('mouseenter', () => {
      if (this.manager.audioFocusFollow && this.originalUrl) {
        this.manager.soloAudio(this.slotNumber);
      }
    });

    this.qualitySelect.addEventListener('change', async (e) => {
      const q = e.target.value;
      await this.changeQualityTo(q, { showLoadingOverlay: true });
    });

    this.retryBtn.addEventListener('click', () => this.reload());
    this.editUrlBtn.addEventListener('click', () => this.showSetup());
  }

  get effectivelyMuted() {
    return Boolean(this.isMuted || this.manager.isMasterMuted);
  }

  async changeQualityTo(newQuality, { showLoadingOverlay = false } = {}) {
    if (!this.originalUrl) return;
    if (!showLoadingOverlay && this.currentQuality === newQuality) return;
    if (!this.needsServer && !this.streamsMap[newQuality] && newQuality !== 'best') return;

    const seq = ++this.loadSeq;
    this.currentQuality = newQuality;
    this.qualitySelect.value = newQuality;

    if (this.needsServer) {
      if (showLoadingOverlay) {
        this.showLoader(`正在切換至 ${newQuality} 畫質...`);
      }
      const res = await window.api.changeQuality({
        slotId: this.slotNumber,
        url: this.originalUrl,
        quality: newQuality
      });
      if (seq !== this.loadSeq) return;
      if (res.success) {
        this.playMpegts(res.serverUrl);
      } else if (!res.aborted) {
        this.showError(`切換畫質失敗：${res.error || ''}`);
      }
    } else if (this.streamsMap[newQuality]) {
      const streamTarget = this.streamsMap[newQuality];
      const targetUrl = typeof streamTarget === 'string' ? streamTarget : streamTarget.url;
      this.playDirectHls(targetUrl);
    }
  }

  async applyQualityMode(mode) {
    if (!this.originalUrl || this.playType === 'webpage') return;

    if (this.playType === 'youtube') {
      this.youtubePlayer?.setQuality(mapYouTubeQuality(mode));
      return;
    }

    const targetQuality = findBestMatchingQuality(
      this.streamsMap,
      mode,
      this.manager.preferredGridQuality
    );
    if (targetQuality && targetQuality !== this.currentQuality) {
      await this.changeQualityTo(targetQuality);
    }
  }

  async load(rawUrl, preferredQuality = null, forceWebMode = false) {
    const seq = ++this.loadSeq;
    const url = formatUrl(rawUrl);
    if (!url) return;

    this.originalUrl = url;
    this.urlInput.value = url;

    if (forceWebMode) {
      this.playWebPage(url, seq);
      this.manager.saveState();
      return;
    }

    const desiredMode = this.manager.getDesiredQualityModeForSlot(this.slotNumber);

    const ytId = extractYouTubeId(url);
    if (ytId) {
      await this.playYouTube(url, ytId, seq);
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

    if (isDirectHlsUrl(url)) {
      this.playType = 'hls';
      this.streamsMap = {};
      this.needsServer = false;
      this.titleEl.textContent = 'HLS 直播源';
      this.titleEl.title = url;
      this.qualitySelect.innerHTML = '<option value="direct">Direct HLS</option>';
      this.playDirectHls(url);
      this.manager.saveState();
      return;
    }

    try {
      const res = await window.api.resolveStream({
        url,
        preferredQuality: targetQ,
        slotId: this.slotNumber
      });

      // 若等待解析期間使用者已換台或清空，放棄過期的回應
      if (seq !== this.loadSeq || res.aborted) return;

      if (!res.success) {
        if (res.streamlinkMissing) {
          this.showError(res.error);
          return;
        }
        console.log(`[Slot ${this.slotNumber}] 非串流源，自動切換至網頁模式:`, res.error);
        this.playWebPage(url, seq);
        this.manager.saveState();
        return;
      }

      this.streamsMap = res.streams || {};
      const qualities = res.qualities || Object.keys(this.streamsMap);
      const actualTargetQ = findBestMatchingQuality(
        this.streamsMap,
        desiredMode,
        this.manager.preferredGridQuality
      );
      this.currentQuality = actualTargetQ;

      this.qualitySelect.innerHTML = '';
      qualities.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q;
        opt.textContent = q;
        opt.selected = q === actualTargetQ;
        this.qualitySelect.appendChild(opt);
      });

      const meta = res.metadata || {};
      this.titleEl.textContent = meta.title || meta.author || url;
      this.titleEl.title = [meta.author, meta.title || url].filter(Boolean).join(' - ');

      this.needsServer = Boolean(res.needsServer);
      this.playType = res.playType;

      if (res.playType === 'mpegts') {
        if (res.chosenQuality && res.chosenQuality !== actualTargetQ && this.streamsMap[actualTargetQ]) {
          await this.changeQualityTo(actualTargetQ);
        } else {
          this.playMpegts(res.directUrl);
        }
      } else {
        const streamEntry = this.streamsMap[actualTargetQ];
        const targetUrl = streamEntry
          ? (typeof streamEntry === 'string' ? streamEntry : streamEntry.url)
          : res.directUrl;
        this.playDirectHls(targetUrl || res.directUrl);
      }

      this.manager.saveState();
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.showError(`系統錯誤：${err.message}`);
    }
  }

  async playYouTube(url, videoId, seq) {
    this.destroyPlayers(true);
    this.playType = 'youtube';
    this.needsServer = false;
    this.currentDirectUrl = '';
    this.streamsMap = {};
    this.video.style.display = 'none';
    this.ytContainer.style.display = 'block';

    this.showLoader('YouTube 影片載入中...');
    this.qualitySelect.innerHTML = '<option value="auto">YouTube 原生高畫質</option>';

    const desiredMode = this.manager.getDesiredQualityModeForSlot(this.slotNumber);
    this.youtubePlayer = new YouTubePlayer({
      container: this.ytContainer,
      slotNumber: this.slotNumber,
      onReady: () => {
        if (seq !== this.loadSeq) return;
        this.hideOverlays();
        this.updatePlayState(true);
      },
      onDoubleClick: () => this.manager.toggleSoloSlot(this.slotNumber),
      onMouseEnter: () => {
        if (this.manager.audioFocusFollow && this.originalUrl) {
          this.manager.soloAudio(this.slotNumber);
        }
      }
    });

    this.youtubePlayer.mount({
      videoId,
      volume: this.volume,
      muted: this.effectivelyMuted,
      initialYtQuality: mapYouTubeQuality(desiredMode)
    });

    try {
      const meta = await window.api.getYouTubeMeta(url);
      if (seq !== this.loadSeq) return;
      if (meta && meta.success) {
        this.titleEl.textContent = meta.title;
        this.titleEl.title = [meta.author, meta.title].filter(Boolean).join(' - ');
      } else {
        this.titleEl.textContent = 'YouTube 影片';
        this.titleEl.title = url;
      }
    } catch {
      if (seq === this.loadSeq) {
        this.titleEl.textContent = 'YouTube 影片';
      }
    }
  }

  playWebPage(url, seq) {
    this.destroyPlayers(true);
    this.playType = 'webpage';
    this.needsServer = false;
    this.currentDirectUrl = '';
    this.streamsMap = {};
    this.video.style.display = 'none';
    this.ytContainer.style.display = 'block';
    this.container.classList.add('is-web-mode');

    this.webBackBtn.classList.remove('hidden');
    this.webFwdBtn.classList.remove('hidden');
    this.playPauseBtn.classList.add('hidden');
    this.vlcBtn.classList.add('hidden');

    this.showLoader('網頁載入中...');

    const targetUrl = formatUrl(url);
    this.originalUrl = targetUrl;
    this.urlInput.value = targetUrl;
    this.titleEl.textContent = targetUrl;
    this.titleEl.title = targetUrl;
    this.qualitySelect.innerHTML = '<option value="web">🌐 網頁模式</option>';

    this.webpagePlayer = new WebpagePlayer({
      container: this.ytContainer,
      slotNumber: this.slotNumber,
      onReady: () => {
        if (seq !== this.loadSeq) return;
        this.hideOverlays();
        this.updatePlayState(true);
      },
      onTitleUpdate: (title, pageUrl) => {
        if (seq !== this.loadSeq) return;
        this.titleEl.textContent = title;
        this.titleEl.title = `${title} - ${pageUrl}`;
      },
      onNavigate: (nextUrl) => {
        if (seq !== this.loadSeq) return;
        this.originalUrl = nextUrl;
        this.urlInput.value = nextUrl;
        this.manager.saveState();
      },
      onMouseEnter: () => {
        if (this.manager.audioFocusFollow && this.originalUrl) {
          this.manager.soloAudio(this.slotNumber);
        }
      },
      onLoadError: (errMsg) => {
        if (seq !== this.loadSeq) return;
        this.showError(errMsg);
      }
    });

    this.webpagePlayer.mount({
      url: targetUrl,
      volume: this.volume,
      muted: this.effectivelyMuted
    });
  }

  playDirectHls(streamUrl) {
    this.currentDirectUrl = streamUrl;
    this.destroyPlayers(false);
    this.playType = 'hls';
    this.hlsPlayer.play(streamUrl);
  }

  playMpegts(streamUrl) {
    this.currentDirectUrl = streamUrl;
    this.destroyPlayers(false);
    this.playType = 'mpegts';
    this.mpegtsPlayer.play(streamUrl);
  }

  destroyPlayers(stopBackend = true) {
    this.container.classList.remove('is-web-mode');
    this.webBackBtn.classList.add('hidden');
    this.webFwdBtn.classList.add('hidden');
    this.playPauseBtn.classList.remove('hidden');
    this.vlcBtn.classList.remove('hidden');

    if (this.youtubePlayer) {
      this.youtubePlayer.destroy();
      this.youtubePlayer = null;
    }
    if (this.webpagePlayer) {
      this.webpagePlayer.destroy();
      this.webpagePlayer = null;
    }

    this.ytContainer.innerHTML = '';
    this.ytContainer.style.display = 'none';
    this.video.style.display = 'block';

    this.hlsPlayer.destroy();
    this.mpegtsPlayer.destroy();

    if (stopBackend) {
      window.api.stopStreamServer(this.slotNumber);
    }
  }

  clear({ save = true } = {}) {
    this.loadSeq++;
    this.destroyPlayers(true);
    this.playType = null;
    this.needsServer = false;
    this.originalUrl = '';
    this.currentDirectUrl = '';
    this.streamsMap = {};
    this.currentQuality = 'best';

    this.video.removeAttribute('src');
    this.video.load();

    this.urlInput.value = '';
    this.titleEl.textContent = '尚未連線';
    this.titleEl.title = '直播名稱';
    this.qualitySelect.innerHTML = '<option value="best">Best (自動最高)</option>';

    this.setMuted(true);
    this.setupView.classList.remove('hidden');
    this.loaderView.classList.add('hidden');
    this.errorView.classList.add('hidden');
    this.cancelSetupBtn.classList.add('hidden');
    this.stopSlotBtn.classList.add('hidden');

    if (save) {
      this.manager.saveState();
    }
  }

  reload() {
    if (this.playType === 'youtube' && this.youtubePlayer) {
      this.youtubePlayer.reload();
      return;
    }
    if (this.playType === 'webpage' && this.webpagePlayer) {
      this.webpagePlayer.reload();
      return;
    }
    if (this.originalUrl) {
      const q = this.qualitySelect.value || this.currentQuality || 'best';
      this.load(this.originalUrl, q);
    }
  }

  handleServerClosed() {
    if (this.needsServer && this.playType === 'mpegts' && this.originalUrl) {
      this.mpegtsPlayer.destroy();
      this.showError('串流已結束或本機串流伺服器中斷');
    }
  }

  handleWebviewNewWindow(webContentsId, url) {
    if (this.webpagePlayer?.matchesWebContentsId(webContentsId)) {
      this.webpagePlayer.handleNewWindow(url);
      return true;
    }
    if (this.youtubePlayer?.matchesWebContentsId(webContentsId)) {
      this.youtubePlayer.handleNewWindow(url);
      return true;
    }
    return false;
  }

  async togglePlay() {
    if (this.playType === 'youtube' && this.youtubePlayer) {
      const isPlaying = await this.youtubePlayer.togglePlay();
      this.updatePlayState(isPlaying);
      return;
    }

    if (this.video.paused) {
      this.video.play().catch(() => {});
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
    this.volume = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.8));
    this.video.volume = this.volume;
    this.youtubePlayer?.setVolume(this.volume);
    this.webpagePlayer?.setVolume(this.volume);
    this.volSlider.value = String(Math.round(this.volume * 100));
    this.syncAudioUi();
  }

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    this.syncAudioOutput();
  }

  syncAudioOutput() {
    const outMuted = this.effectivelyMuted;
    this.video.muted = outMuted;
    this.youtubePlayer?.setMuted(outMuted);
    this.webpagePlayer?.setMuted(outMuted);
    this.syncAudioUi();
  }

  syncAudioUi() {
    const outMuted = this.effectivelyMuted;
    this.muteBtn.textContent = outMuted || this.volume === 0 ? '🔇' : '🔊';
    this.container.classList.toggle('has-audio', !outMuted && Boolean(this.originalUrl));
    this.audioSoloBtn.classList.toggle('active', !outMuted && Boolean(this.originalUrl));
  }

  toggleMute() {
    this.setMuted(!this.isMuted);
  }

  showSetup() {
    const hasActiveStream = Boolean(this.originalUrl);
    this.setupView.classList.remove('hidden');
    this.loaderView.classList.add('hidden');
    this.errorView.classList.add('hidden');

    this.cancelSetupBtn.classList.toggle('hidden', !hasActiveStream);
    this.stopSlotBtn.classList.toggle('hidden', !hasActiveStream);

    if (hasActiveStream) {
      this.urlInput.value = this.originalUrl;
    }
    setTimeout(() => {
      this.urlInput.focus();
      this.urlInput.select();
    }, 50);
  }

  hideSetup() {
    if (!this.originalUrl) return;
    this.setupView.classList.add('hidden');
    this.cancelSetupBtn.classList.add('hidden');
    this.stopSlotBtn.classList.add('hidden');
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
    this.cancelSetupBtn.classList.add('hidden');
    this.stopSlotBtn.classList.add('hidden');
  }
}

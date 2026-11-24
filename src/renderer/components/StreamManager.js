import {
  SLOT_COUNT,
  LAYOUT_MODES,
  FOCUS_LAYOUT_MODES,
  PRESET_IDS,
  PRESET_LABELS,
  STORAGE_KEYS
} from '../constants.js';
import { StreamSlot } from './StreamSlot.js';
import { showToast } from './Toast.js';

export class StreamManager {
  constructor() {
    this.slots = [];
    this.audioFocusFollow = true;
    this.isMasterMuted = false;
    this.activeSoloSlot = null;
    this.currentLayout = '2x2';
    this.primarySlot = 1;
    this.preferredGridQuality = '720p';
    this.activePreset = 'default';
    this.presets = {
      default: this.createEmptyPreset(),
      preset2: this.createEmptyPreset(),
      preset3: this.createEmptyPreset()
    };
    this.isInitialized = false;
  }

  createEmptyPreset() {
    return {
      layout: '2x2',
      primarySlot: 1,
      preferredGridQuality: '720p',
      slots: []
    };
  }

  async init() {
    const playerContainer = document.getElementById('playerContainer');
    for (let i = 1; i <= SLOT_COUNT; i++) {
      this.slots.push(new StreamSlot(i, this, playerContainer));
    }

    this.bindWindowControls();
    this.bindToolbarControls();
    this.bindIpcEvents();
    this.bindHotkeys();

    this.checkEnvironment();
    await this.loadState();
  }

  bindWindowControls() {
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
    fullscreenBtn.addEventListener('click', () => this.toggleFullScreen());

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
  }

  bindToolbarControls() {
    document.getElementById('layout2x2')?.addEventListener('click', () => this.setLayout('2x2'));
    document.getElementById('layout1p3')?.addEventListener('click', () => this.setLayout('1p3'));
    document.getElementById('layoutTop1p3')?.addEventListener('click', () => this.setLayout('top1p3'));
    document.getElementById('layoutBottom1p3')?.addEventListener('click', () => this.setLayout('bottom1p3'));

    const helpBtn = document.getElementById('helpBtn');
    const closeHelpBtn = document.getElementById('closeHelpBtn');
    const helpModal = document.getElementById('helpModal');

    helpBtn?.addEventListener('click', () => this.toggleHelpModal());
    closeHelpBtn?.addEventListener('click', () => this.toggleHelpModal(false));
    helpModal?.addEventListener('click', (e) => {
      if (e.target === helpModal) this.toggleHelpModal(false);
    });

    const gridQualitySelect = document.getElementById('gridQualitySelect');
    if (gridQualitySelect) {
      this.preferredGridQuality = gridQualitySelect.value;
      gridQualitySelect.addEventListener('change', (e) => {
        this.preferredGridQuality = e.target.value;
        if (!this.activeSoloSlot && this.currentLayout === '2x2') {
          this.applySmartQualityStrategy();
        }
        this.saveState();
      });
    }

    const audioFocusBtn = document.getElementById('audioFocusToggle');
    audioFocusBtn?.addEventListener('click', () => {
      this.audioFocusFollow = !this.audioFocusFollow;
      audioFocusBtn.classList.toggle('active', this.audioFocusFollow);
      this.saveState();
    });

    document.getElementById('muteAllBtn')?.addEventListener('click', () => {
      this.toggleMasterMute();
    });

    document.getElementById('reloadAllBtn')?.addEventListener('click', () => {
      this.slots.forEach((s) => s.reload());
      showToast('正在重新連線所有直播台...');
    });

    const presetSelect = document.getElementById('presetSelect');
    presetSelect?.addEventListener('change', (e) => {
      this.switchPreset(e.target.value);
    });

    document.getElementById('savePresetBtn')?.addEventListener('click', () => {
      this.savePresetWithFeedback();
    });
  }

  bindIpcEvents() {
    window.api.onServerClosed(({ slotId }) => {
      console.warn(`[Main] Slot ${slotId} 本機伺服器已結束`);
      const slot = this.slots[slotId - 1];
      slot?.handleServerClosed();
    });

    window.api.onWebviewNewWindow?.(({ webContentsId, url }) => {
      for (const slot of this.slots) {
        if (slot.handleWebviewNewWindow(webContentsId, url)) {
          return;
        }
      }
      window.api.openExternal?.(url);
    });
  }

  savePresetWithFeedback() {
    this.saveState();
    const saveBtn = document.getElementById('savePresetBtn');
    if (saveBtn && saveBtn.textContent !== '✓ 已儲存') {
      const prevText = saveBtn.textContent;
      saveBtn.textContent = '✓ 已儲存';
      setTimeout(() => {
        saveBtn.textContent = prevText;
      }, 1200);
    }
    const label = PRESET_LABELS[this.activePreset] || this.activePreset;
    showToast(`已儲存至「${label}」`, { type: 'success' });
  }

  switchPreset(nextPresetId) {
    if (!PRESET_IDS.includes(nextPresetId) || nextPresetId === this.activePreset) return;

    // 先將當前狀態寫入舊分組
    this.presets[this.activePreset] = this.snapshotCurrentPreset();
    this.activePreset = nextPresetId;

    const targetPreset = this.presets[nextPresetId] || this.createEmptyPreset();
    this.applyPresetData(targetPreset);
    this.saveState();

    const label = PRESET_LABELS[nextPresetId] || nextPresetId;
    showToast(`已切換至「${label}」`);
  }

  snapshotCurrentPreset() {
    return {
      layout: this.currentLayout || '2x2',
      primarySlot: this.primarySlot || 1,
      preferredGridQuality: this.preferredGridQuality || '720p',
      slots: this.slots.map((s) => ({
        url: s.originalUrl || '',
        volume: s.volume,
        playType: s.playType
      }))
    };
  }

  applyPresetData(presetData) {
    if (this.activeSoloSlot) {
      this.exitSolo();
    }

    const prevInit = this.isInitialized;
    this.isInitialized = false;

    try {
      this.setLayout(presetData.layout || '2x2');
      this.setPrimarySlot(presetData.primarySlot || 1);

      this.preferredGridQuality = presetData.preferredGridQuality || '720p';
      const gridQualitySelect = document.getElementById('gridQualitySelect');
      if (gridQualitySelect) {
        gridQualitySelect.value = this.preferredGridQuality;
      }

      const savedSlots = Array.isArray(presetData.slots) ? presetData.slots : [];
      this.slots.forEach((slot, idx) => {
        const item = savedSlots[idx];
        if (item && item.url) {
          if (item.volume !== undefined) {
            slot.setVolume(item.volume);
          }
          slot.load(item.url, null, item.playType === 'webpage');
        } else {
          slot.clear({ save: false });
        }
      });
    } finally {
      this.isInitialized = prevInit;
    }
  }

  setLayout(mode) {
    const safeMode = LAYOUT_MODES.includes(mode) ? mode : '2x2';
    this.currentLayout = safeMode;

    const container = document.getElementById('playerContainer');
    container.className = `grid-container mode-${safeMode}`;

    const btnMap = {
      '2x2': document.getElementById('layout2x2'),
      '1p3': document.getElementById('layout1p3'),
      top1p3: document.getElementById('layoutTop1p3'),
      bottom1p3: document.getElementById('layoutBottom1p3')
    };

    Object.entries(btnMap).forEach(([k, btn]) => {
      btn?.classList.toggle('active', k === safeMode);
    });

    if (this.activeSoloSlot) {
      this.exitSolo();
    }
    this.applySmartQualityStrategy();
    this.saveState();
  }

  cycleLayout() {
    const idx = LAYOUT_MODES.indexOf(this.currentLayout || '2x2');
    const next = LAYOUT_MODES[(idx + 1) % LAYOUT_MODES.length];
    this.setLayout(next);
  }

  setPrimarySlot(slotNum) {
    if (slotNum < 1 || slotNum > SLOT_COUNT) return;
    this.primarySlot = slotNum;
    this.slots.forEach((s) => {
      s.container.classList.toggle('is-primary', s.slotNumber === slotNum);
    });
    if (!this.activeSoloSlot && FOCUS_LAYOUT_MODES.includes(this.currentLayout)) {
      this.applySmartQualityStrategy();
    }
    this.saveState();
  }

  cyclePrimarySlot() {
    const next = (this.primarySlot % SLOT_COUNT) + 1;
    this.setPrimarySlot(next);
    if (this.audioFocusFollow && this.slots[next - 1].originalUrl) {
      this.soloAudio(next);
    }
  }

  getDesiredQualityModeForSlot(slotNum) {
    if (this.activeSoloSlot) {
      return slotNum === this.activeSoloSlot ? 'high' : 'low';
    }
    if (FOCUS_LAYOUT_MODES.includes(this.currentLayout)) {
      return slotNum === this.primarySlot ? 'high' : 'low';
    }
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
      slot?.setVolume(slot.volume + delta);
    } else {
      this.slots.forEach((s) => s.setVolume(s.volume + delta));
    }
    this.saveState();
  }

  soloAudio(targetSlotNum, { forceUnmuteMaster = false } = {}) {
    if (this.isMasterMuted) {
      if (!forceUnmuteMaster) return;
      this.disengageMasterMute();
    }

    this.slots.forEach((s) => {
      s.setMuted(s.slotNumber !== targetSlotNum);
    });
  }

  disengageMasterMute() {
    if (!this.isMasterMuted) return;
    this.isMasterMuted = false;
    document.getElementById('muteAllBtn')?.classList.remove('muted-active');
    this.slots.forEach((s) => s.syncAudioOutput());
  }

  toggleMasterMute() {
    this.isMasterMuted = !this.isMasterMuted;
    document.getElementById('muteAllBtn')?.classList.toggle('muted-active', this.isMasterMuted);

    if (!this.isMasterMuted) {
      // 若解除全體靜音時所有台原本皆為靜音，自動為第一個已連線的主台開啟聲音
      const hasAnyUnmuted = this.slots.some((s) => !s.isMuted && s.originalUrl);
      if (!hasAnyUnmuted) {
        const fallback =
          this.slots.find((s) => s.slotNumber === this.primarySlot && s.originalUrl) ||
          this.slots.find((s) => Boolean(s.originalUrl));
        if (fallback) {
          fallback.isMuted = false;
        }
      }
    }

    // 僅更新實際音訊輸出，不覆蓋各槽位自身的 isMuted 記憶狀態
    this.slots.forEach((s) => s.syncAudioOutput());
  }

  toggleSoloSlot(slotNum) {
    const slot = this.slots[slotNum - 1];
    if (!slot) return;

    const container = document.getElementById('playerContainer');
    if (this.activeSoloSlot === slotNum) {
      this.exitSolo();
      return;
    }

    this.slots.forEach((s) => {
      s.container.classList.remove('solo');
      s.soloBtn.textContent = '⛶';
      s.soloBtn.title = '單一放大全螢幕 (雙擊畫面亦可)';
    });

    slot.container.classList.add('solo');
    container?.classList.add('has-solo');
    slot.soloBtn.textContent = '🗗';
    slot.soloBtn.title = '還原佈局 (Esc / 雙擊畫面)';

    this.activeSoloSlot = slotNum;
    this.soloAudio(slotNum);
    this.applySmartQualityStrategy();
  }

  exitSolo() {
    if (!this.activeSoloSlot) return;
    document.getElementById('playerContainer')?.classList.remove('has-solo');
    this.slots.forEach((s) => {
      s.container.classList.remove('solo');
      s.soloBtn.textContent = '⛶';
      s.soloBtn.title = '單一放大全螢幕 (雙擊畫面亦可)';
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
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      const key = e.key;
      const code = e.code;

      // 數字快捷鍵 (Digit1~Digit4 / 1~4，修正 Shift+1~4 在美式鍵盤會變成 !@#$ 的問題)
      const digitMatch = code && code.match(/^Digit([1-4])$/);
      if (digitMatch || ['1', '2', '3', '4'].includes(key)) {
        const num = digitMatch ? parseInt(digitMatch[1], 10) : parseInt(key, 10);

        if (e.ctrlKey) {
          this.setPrimarySlot(num);
          if (this.audioFocusFollow && this.slots[num - 1].originalUrl) {
            this.soloAudio(num);
          }
        } else if (e.shiftKey) {
          const layoutMap = { 1: '2x2', 2: '1p3', 3: 'top1p3', 4: 'bottom1p3' };
          this.setLayout(layoutMap[num]);
        } else if (e.altKey) {
          this.soloAudio(num, { forceUnmuteMaster: true });
        } else {
          this.toggleSoloSlot(num);
        }
        return;
      }

      if (key === 'Tab') {
        e.preventDefault();
        this.cyclePrimarySlot();
        return;
      }

      if (key === 'l' || key === 'L') {
        this.cycleLayout();
        return;
      }

      if (key === '?' || key === 'h' || key === 'H' || key === 'F1') {
        e.preventDefault();
        this.toggleHelpModal();
        return;
      }

      if (key === 'a' || key === 'A') {
        document.getElementById('audioFocusToggle')?.click();
        return;
      }

      if ((key === 'r' || key === 'R') && !e.ctrlKey) {
        this.slots.forEach((s) => s.reload());
        showToast('正在重新連線所有直播台...');
        return;
      }

      if ((key === 's' || key === 'S') && !e.ctrlKey) {
        this.savePresetWithFeedback();
        return;
      }

      if (code === 'Space') {
        e.preventDefault();
        if (this.activeSoloSlot) {
          this.slots[this.activeSoloSlot - 1].togglePlay();
        } else {
          const activeSlot =
            this.slots.find((s) => !s.effectivelyMuted && s.originalUrl) || this.slots[0];
          activeSlot?.togglePlay();
        }
        return;
      }

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

      if (key === 'Escape') {
        const modal = document.getElementById('helpModal');
        if (modal && !modal.classList.contains('hidden')) {
          this.toggleHelpModal(false);
          return;
        }

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
        document.getElementById('alwaysOnTopBtn')?.click();
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
        slBadge.title = '未偵測到 Streamlink (點擊網址將退回網頁模式)';
      }

      if (res.vlc.installed) {
        vlcBadge.className = 'status-badge ready';
        vlcBadge.title = `VLC: ${res.vlc.path}`;
      } else {
        vlcBadge.className = 'status-badge';
        vlcBadge.title = '未偵測到 VLC';
      }
    } catch (err) {
      console.error('環境檢測失敗:', err);
    }
  }

  saveState() {
    if (!this.isInitialized) return;

    const currentSnapshot = this.snapshotCurrentPreset();
    this.presets[this.activePreset] = currentSnapshot;

    const data = {
      activePreset: this.activePreset,
      audioFocusFollow: this.audioFocusFollow,
      layout: currentSnapshot.layout,
      primarySlot: currentSnapshot.primarySlot,
      preferredGridQuality: currentSnapshot.preferredGridQuality,
      slots: currentSnapshot.slots,
      presets: this.presets
    };

    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT, JSON.stringify(data));
      window.api?.saveConfig?.(data);
    } catch (err) {
      console.error('儲存設定失敗:', err);
    }
  }

  async loadState() {
    try {
      let data = null;
      if (window.api?.loadConfig) {
        data = await window.api.loadConfig();
      }
      if (!data) {
        const raw =
          localStorage.getItem(STORAGE_KEYS.CURRENT) ||
          localStorage.getItem(STORAGE_KEYS.LEGACY);
        if (raw) {
          data = JSON.parse(raw);
        }
      }

      if (!data) {
        this.setPrimarySlot(1);
        return;
      }

      if (typeof data.audioFocusFollow === 'boolean') {
        this.audioFocusFollow = data.audioFocusFollow;
        document
          .getElementById('audioFocusToggle')
          ?.classList.toggle('active', this.audioFocusFollow);
      }

      if (data.presets && typeof data.presets === 'object') {
        for (const id of PRESET_IDS) {
          if (data.presets[id]) {
            this.presets[id] = data.presets[id];
          }
        }
      } else {
        this.presets.default = {
          layout: data.layout || '2x2',
          primarySlot: data.primarySlot || 1,
          preferredGridQuality: data.preferredGridQuality || '720p',
          slots: Array.isArray(data.slots) ? data.slots : []
        };
      }

      this.activePreset = PRESET_IDS.includes(data.activePreset) ? data.activePreset : 'default';
      const presetSelect = document.getElementById('presetSelect');
      if (presetSelect) {
        presetSelect.value = this.activePreset;
      }

      this.applyPresetData(this.presets[this.activePreset]);
    } catch (err) {
      console.error('載入設定失敗:', err);
    } finally {
      this.isInitialized = true;
    }
  }
}

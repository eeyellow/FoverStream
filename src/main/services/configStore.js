const path = require('path');
const fs = require('fs');
const { CONFIG_FILENAME, LEGACY_CONFIG_FILENAME } = require('../constants');

const PRESET_IDS = ['default', 'preset2', 'preset3'];
const VALID_LAYOUTS = ['2x2', '1p3', 'top1p3', 'bottom1p3'];

function sanitizeSlotItem(item) {
  if (!item || typeof item !== 'object') {
    return { url: '', volume: 0.8, playType: null };
  }
  const url = typeof item.url === 'string' ? item.url : '';
  const rawVol = typeof item.volume === 'number' && Number.isFinite(item.volume) ? item.volume : 0.8;
  const volume = Math.max(0, Math.min(1, rawVol));
  const playType = typeof item.playType === 'string' ? item.playType : null;
  return { url, volume, playType };
}

function sanitizePreset(rawPreset = {}) {
  const layout = VALID_LAYOUTS.includes(rawPreset.layout) ? rawPreset.layout : '2x2';
  const primarySlot =
    Number.isInteger(rawPreset.primarySlot) && rawPreset.primarySlot >= 1 && rawPreset.primarySlot <= 4
      ? rawPreset.primarySlot
      : 1;
  const preferredGridQuality =
    typeof rawPreset.preferredGridQuality === 'string' && rawPreset.preferredGridQuality
      ? rawPreset.preferredGridQuality
      : '720p';
  const slots = Array.isArray(rawPreset.slots)
    ? rawPreset.slots.slice(0, 4).map(sanitizeSlotItem)
    : [];

  return {
    layout,
    primarySlot,
    preferredGridQuality,
    slots
  };
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const activePreset = PRESET_IDS.includes(raw.activePreset) ? raw.activePreset : 'default';
  const audioFocusFollow = typeof raw.audioFocusFollow === 'boolean' ? raw.audioFocusFollow : true;

  const rawPresets = raw.presets && typeof raw.presets === 'object' ? raw.presets : {};
  const presets = {};

  for (const id of PRESET_IDS) {
    if (rawPresets[id] && typeof rawPresets[id] === 'object') {
      presets[id] = sanitizePreset(rawPresets[id]);
    } else if (id === 'default') {
      // 相容舊版單層設定格式
      presets[id] = sanitizePreset(raw);
    } else {
      presets[id] = sanitizePreset({});
    }
  }

  // 若傳入資料同時帶有頂層最新狀態，同步寫入當前分組以維持向下相容
  if (Array.isArray(raw.slots) && (!raw.presets || !raw.presets[activePreset])) {
    presets[activePreset] = sanitizePreset(raw);
  }

  const current = presets[activePreset];

  return {
    activePreset,
    audioFocusFollow,
    layout: current.layout,
    primarySlot: current.primarySlot,
    preferredGridQuality: current.preferredGridQuality,
    slots: current.slots,
    presets
  };
}

function createConfigStore({ userDataDir }) {
  const configFilePath = path.join(userDataDir, CONFIG_FILENAME);
  const legacyConfigFilePath = path.join(userDataDir, LEGACY_CONFIG_FILENAME);
  let writeQueue = Promise.resolve();

  async function writeAtomic(filePath, serialized) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, serialized, 'utf-8');
    try {
      await fs.promises.rename(tempPath, filePath);
    } catch {
      // Windows 檔案鎖定備援：直接覆寫並清理暫存檔
      await fs.promises.writeFile(filePath, serialized, 'utf-8');
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  function save(data) {
    const normalized = normalizeConfig(data);
    if (!normalized) {
      return Promise.resolve({ success: false, error: '無效的設定資料' });
    }
    const serialized = JSON.stringify(normalized, null, 2);

    const task = writeQueue.then(async () => {
      try {
        await writeAtomic(configFilePath, serialized);
        return { success: true };
      } catch (err) {
        console.error('[FoveaStream] 儲存設定檔失敗:', err);
        return { success: false, error: err.message };
      }
    });

    // 確保錯誤不會中斷後續寫入佇列
    writeQueue = task.then(() => {}, () => {});
    return task;
  }

  async function load() {
    await writeQueue;
    try {
      if (fs.existsSync(configFilePath)) {
        const content = await fs.promises.readFile(configFilePath, 'utf-8');
        return normalizeConfig(JSON.parse(content));
      }
      if (fs.existsSync(legacyConfigFilePath)) {
        const content = await fs.promises.readFile(legacyConfigFilePath, 'utf-8');
        const normalized = normalizeConfig(JSON.parse(content));
        if (normalized) {
          await save(normalized);
        }
        return normalized;
      }
    } catch (err) {
      console.error('[FoveaStream] 讀取設定檔失敗:', err);
    }
    return null;
  }

  return {
    configFilePath,
    legacyConfigFilePath,
    load,
    save
  };
}

module.exports = {
  PRESET_IDS,
  VALID_LAYOUTS,
  normalizeConfig,
  createConfigStore
};

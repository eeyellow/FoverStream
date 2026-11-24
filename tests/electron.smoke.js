const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { createMainWindow, registerWebContentsSecurityGuards } = require('../src/main/window');
const { registerIpcHandlers } = require('../src/main/ipc');
const { createConfigStore } = require('../src/main/services/configStore');
const { createStreamService } = require('../src/main/services/streamService');

// 支援沙箱受限環境下執行冒煙測試
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'foveastream-smoke-'));
app.setPath('userData', tempUserData);

let win = null;
const getMainWindow = () => win;
const streamService = createStreamService();

async function cleanupAndExit(code) {
  try {
    streamService.stopAll();
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    fs.rmSync(tempUserData, { recursive: true, force: true });
  } catch {
    // ignore cleanup warnings
  }
  app.exit(code);
}

setTimeout(() => {
  console.error('[SMOKE FAIL] Timed out after 15s');
  cleanupAndExit(1);
}, 15_000);

app.whenReady().then(async () => {
  try {
    const configStore = createConfigStore({ userDataDir: tempUserData });
    registerWebContentsSecurityGuards(getMainWindow);
    registerIpcHandlers({
      getMainWindow,
      configStore,
      streamService
    });

    win = createMainWindow(getMainWindow);

    const result = await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const verify = () => {
          const slots = document.querySelectorAll('#playerContainer .stream-slot');
          if (slots.length < 4) {
            setTimeout(verify, 50);
            return;
          }

          // 1. 測試佈局切換按鈕
          document.getElementById('layoutTop1p3').click();
          const layoutClass = document.getElementById('playerContainer').className;

          // 2. 測試全體靜音與狀態還原 (先獨播台 2 音訊，再按兩次全體靜音應還原台 2 音訊)
          const slot2Video = document.getElementById('video-2');
          document.querySelector('#slot-2 .audio-solo-btn').click();
          const beforeMasterMute = slot2Video.muted;

          document.getElementById('muteAllBtn').click();
          const duringMasterMute = slot2Video.muted;

          document.getElementById('muteAllBtn').click();
          const afterMasterUnmute = slot2Video.muted;

          // 3. 測試分組選單切換
          const presetSelect = document.getElementById('presetSelect');
          presetSelect.value = 'preset2';
          presetSelect.dispatchEvent(new Event('change'));
          const layoutAfterPresetSwitch = document.getElementById('playerContainer').className;

          // 4. 測試快捷鍵說明面板開關
          document.getElementById('helpBtn').click();
          const modalOpen = !document.getElementById('helpModal').classList.contains('hidden');
          document.getElementById('closeHelpBtn').click();
          const modalClosed = document.getElementById('helpModal').classList.contains('hidden');

          resolve({
            hasApi: typeof window.api === 'object' && typeof window.api.resolveStream === 'function',
            slotCount: slots.length,
            slot1Primary: document.getElementById('slot-1')?.classList.contains('is-primary'),
            layoutClass,
            beforeMasterMute,
            duringMasterMute,
            afterMasterUnmute,
            layoutAfterPresetSwitch,
            modalOpen,
            modalClosed
          });
        };
        verify();
      })
    `);

    assert.equal(result.hasApi, true, 'preload window.api should be exposed');
    assert.equal(result.slotCount, 4, '4 stream slots should be instantiated from template');
    assert.equal(result.slot1Primary, true, 'slot-1 should default to primary');
    assert.match(result.layoutClass, /mode-top1p3/, 'layout button should switch grid mode');
    assert.equal(result.beforeMasterMute, false, 'slot-2 should unmute when solo audio clicked');
    assert.equal(result.duringMasterMute, true, 'slot-2 should mute during master mute');
    assert.equal(result.afterMasterUnmute, false, 'slot-2 unmuted state should restore after master unmute');
    assert.match(result.layoutAfterPresetSwitch, /mode-2x2/, 'switching to preset2 should apply preset2 layout');
    assert.equal(result.modalOpen, true, 'help modal should open');
    assert.equal(result.modalClosed, true, 'help modal should close');

    console.log('[SMOKE PASS] Full Electron main window, preload IPC, presets, audio restore, and ES modules verified.');
    await cleanupAndExit(0);
  } catch (err) {
    console.error('[SMOKE FAIL]', err);
    await cleanupAndExit(1);
  }
});

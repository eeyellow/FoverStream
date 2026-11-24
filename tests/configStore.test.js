const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore, normalizeConfig } = require('../src/main/services/configStore');

test('normalizeConfig upgrades legacy flat config into multi-preset schema', () => {
  const legacy = {
    layout: 'top1p3',
    primarySlot: 3,
    preferredGridQuality: '480p',
    slots: [
      { url: 'https://twitch.tv/ch1', volume: 0.5, playType: 'hls' },
      { url: '', volume: 1.5, playType: null }
    ]
  };

  const normalized = normalizeConfig(legacy);
  assert.equal(normalized.activePreset, 'default');
  assert.equal(normalized.audioFocusFollow, true);
  assert.equal(normalized.layout, 'top1p3');
  assert.equal(normalized.primarySlot, 3);
  assert.equal(normalized.preferredGridQuality, '480p');
  assert.equal(normalized.slots[0].url, 'https://twitch.tv/ch1');
  assert.equal(normalized.slots[1].volume, 1); // Clamped to [0, 1]
  assert.deepEqual(normalized.presets.default.slots, normalized.slots);
  assert.equal(normalized.presets.preset2.layout, '2x2');
  assert.equal(normalized.presets.preset3.layout, '2x2');
});

test('configStore migrates erostream_config.json and handles concurrent atomic writes safely', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'foveastream-cfg-'));
  try {
    const legacyPath = path.join(tmpDir, 'erostream_config.json');
    await fs.promises.writeFile(
      legacyPath,
      JSON.stringify({
        layout: '1p3',
        primarySlot: 2,
        slots: [{ url: 'https://youtu.be/dQw4w9WgXcQ', volume: 0.7, playType: 'youtube' }]
      }),
      'utf-8'
    );

    const store = createConfigStore({ userDataDir: tmpDir });
    const migrated = await store.load();
    assert.equal(migrated.layout, '1p3');
    assert.equal(migrated.primarySlot, 2);
    assert.equal(fs.existsSync(store.configFilePath), true);

    // Fire 8 concurrent writes to ensure write queue prevents JSON corruption
    const writes = [];
    for (let i = 1; i <= 8; i++) {
      writes.push(
        store.save({
          activePreset: 'preset2',
          audioFocusFollow: false,
          presets: {
            preset2: {
              layout: 'bottom1p3',
              primarySlot: (i % 4) + 1,
              preferredGridQuality: 'best',
              slots: [{ url: `https://example.com/${i}`, volume: 0.4, playType: 'webpage' }]
            }
          }
        })
      );
    }

    const results = await Promise.all(writes);
    assert.ok(results.every((r) => r.success));

    const finalConfig = await store.load();
    assert.equal(finalConfig.activePreset, 'preset2');
    assert.equal(finalConfig.audioFocusFollow, false);
    assert.equal(finalConfig.layout, 'bottom1p3');
    assert.equal(finalConfig.slots[0].url, 'https://example.com/8');
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

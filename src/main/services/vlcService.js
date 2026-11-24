const { spawn } = require('child_process');
const defaultBinaryResolver = require('./binaryResolver');
const { isSafeCliArg, sanitizeQuality } = require('../constants');

function spawnDetachedSafe(command, args, spawnFn = spawn) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawnFn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      child.once('spawn', () => {
        child.unref();
        finish({ success: true });
      });

      child.once('error', (err) => {
        const message =
          err && err.code === 'ENOENT'
            ? `找不到執行檔 (${command})，請確認已安裝 VLC 或 Streamlink`
            : err.message;
        finish({ success: false, error: message });
      });
    } catch (err) {
      finish({ success: false, error: err.message });
    }
  });
}

function isDirectPlayableUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('http://127.0.0.1') ||
    trimmed.endsWith('.m3u8') ||
    trimmed.includes('.m3u8?')
  );
}

async function openInVlc(
  { url, originalUrl, quality } = {},
  { binaryResolver = defaultBinaryResolver, spawnFn = spawn } = {}
) {
  const targetUrl = typeof (originalUrl || url) === 'string' ? (originalUrl || url).trim() : '';
  if (!isSafeCliArg(targetUrl)) {
    return { success: false, error: '不合法的播放網址' };
  }

  const safeQuality = sanitizeQuality(quality, 'best');
  const vlcPath = binaryResolver.getVlcPath();
  const streamlinkBin = binaryResolver.getStreamlinkPath();

  if (url && isSafeCliArg(url) && isDirectPlayableUrl(url)) {
    return spawnDetachedSafe(vlcPath, ['--', url.trim()], spawnFn);
  }

  const pluginArgs = binaryResolver.getStreamlinkPluginArgs();
  return spawnDetachedSafe(
    streamlinkBin,
    [...pluginArgs, '--', targetUrl, safeQuality],
    spawnFn
  );
}

module.exports = {
  openInVlc,
  isDirectPlayableUrl,
  spawnDetachedSafe
};

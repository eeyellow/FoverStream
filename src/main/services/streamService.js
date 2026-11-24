const { execFile, spawn } = require('child_process');
const defaultBinaryResolver = require('./binaryResolver');
const {
  STREAMLINK_RESOLVE_TIMEOUT_MS,
  STREAMLINK_SERVER_START_TIMEOUT_MS,
  STREAMLINK_MAX_BUFFER_BYTES,
  isSafeCliArg,
  sanitizeQuality
} = require('../constants');

const LOCAL_SERVER_REGEX = /http:\/\/(?:127\.0\.0\.1|localhost):(\d+)(?:\/|\s)/;

function createStreamService({
  onServerClosed = () => {},
  execFileFn = execFile,
  spawnFn = spawn,
  binaryResolver = defaultBinaryResolver,
  serverStartTimeoutMs = STREAMLINK_SERVER_START_TIMEOUT_MS,
  resolveTimeoutMs = STREAMLINK_RESOLVE_TIMEOUT_MS
} = {}) {
  // slotId -> { instanceId, child, url, quality, serverUrl, stoppedIntentionally }
  const activeServers = new Map();
  // slotId -> { requestId, child }
  const activeResolves = new Map();

  let nextInstanceId = 0;
  let nextRequestId = 0;

  function killProcessTree(pid) {
    if (!pid) return;
    try {
      if (process.platform === 'win32') {
        execFileFn('taskkill', ['/pid', pid.toString(), '/T', '/F'], { windowsHide: true }, () => {});
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // 忽略已結束的子程序錯誤
    }
  }

  function cancelPendingResolve(slotId) {
    const pending = activeResolves.get(slotId);
    if (!pending) return;
    activeResolves.delete(slotId);
    if (pending.child && pending.child.pid) {
      killProcessTree(pending.child.pid);
    } else if (pending.child && typeof pending.child.kill === 'function') {
      try {
        pending.child.kill();
      } catch {
        // ignore
      }
    }
  }

  function stopServer(slotId) {
    const existing = activeServers.get(slotId);
    if (!existing) return;
    existing.stoppedIntentionally = true;
    activeServers.delete(slotId);
    if (existing.child && existing.child.pid) {
      killProcessTree(existing.child.pid);
    } else if (existing.child && typeof existing.child.kill === 'function') {
      try {
        existing.child.kill();
      } catch {
        // ignore
      }
    }
  }

  function stopSlot(slotId) {
    cancelPendingResolve(slotId);
    stopServer(slotId);
  }

  function stopAll() {
    for (const slotId of [...activeResolves.keys()]) {
      cancelPendingResolve(slotId);
    }
    for (const slotId of [...activeServers.keys()]) {
      stopServer(slotId);
    }
  }

  function startSlotServer(slotId, url, quality = 'best') {
    stopServer(slotId);

    if (!isSafeCliArg(url)) {
      return Promise.resolve({ success: false, error: '不合法的串流網址' });
    }

    const trimmedUrl = url.trim();
    const safeQuality = sanitizeQuality(quality, 'best');
    const streamlinkBin = binaryResolver.getStreamlinkPath();
    const pluginArgs = binaryResolver.getStreamlinkPluginArgs();
    const instanceId = ++nextInstanceId;

    return new Promise((resolve) => {
      let resolved = false;
      let stdoutBuffer = '';
      let errorOutput = '';

      const child = spawnFn(
        streamlinkBin,
        [
          ...pluginArgs,
          '--player-external-http',
          '--player-external-http-port', '0',
          '--player-external-http-continuous', 'no',
          '--hls-live-edge', '4',
          '--stream-segment-threads', '3',
          '--ringbuffer-size', '32M',
          '--http-timeout', '20',
          '--',
          trimmedUrl,
          safeQuality
        ],
        { windowsHide: true }
      );

      const entry = {
        instanceId,
        child,
        url: trimmedUrl,
        quality: safeQuality,
        serverUrl: null,
        stoppedIntentionally: false
      };
      activeServers.set(slotId, entry);

      const isCurrentInstance = () => {
        const current = activeServers.get(slotId);
        return Boolean(current && current.instanceId === instanceId);
      };

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (isCurrentInstance()) {
            stopServer(slotId);
          }
          resolve({ success: false, error: '本機串流伺服器啟動逾時 (15s)' });
        }
      }, serverStartTimeoutMs);

      child.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        const match = stdoutBuffer.match(LOCAL_SERVER_REGEX);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          if (!isCurrentInstance() || entry.stoppedIntentionally) {
            resolve({ success: false, aborted: true, error: '串流伺服器已被取消' });
            return;
          }
          const serverUrl = `http://127.0.0.1:${match[1]}/`;
          entry.serverUrl = serverUrl;
          resolve({ success: true, serverUrl });
        }
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('close', (code) => {
        const wasCurrent = isCurrentInstance();
        if (wasCurrent) {
          activeServers.delete(slotId);
        }

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          if (entry.stoppedIntentionally) {
            resolve({ success: false, aborted: true, error: '串流伺服器已停止' });
          } else {
            resolve({
              success: false,
              error: errorOutput.trim() || `串流伺服器非預期結束 (代碼 ${code})`
            });
          }
        } else if (wasCurrent && !entry.stoppedIntentionally) {
          onServerClosed({ slotId });
        }
      });

      child.on('error', (err) => {
        if (isCurrentInstance()) {
          activeServers.delete(slotId);
        }
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          const streamlinkMissing = err && err.code === 'ENOENT';
          resolve({
            success: false,
            streamlinkMissing,
            error: streamlinkMissing
              ? '找不到 Streamlink，請先安裝：https://streamlink.github.io/install.html'
              : err.message
          });
        }
      });
    });
  }

  function resolveStream({ url, preferredQuality = 'best', slotId = 1 }) {
    if (!isSafeCliArg(url)) {
      return Promise.resolve({ success: false, error: '不合法的串流網址' });
    }

    cancelPendingResolve(slotId);

    const trimmedUrl = url.trim();
    const safeQuality = sanitizeQuality(preferredQuality, 'best');
    const streamlinkBin = binaryResolver.getStreamlinkPath();
    const pluginArgs = binaryResolver.getStreamlinkPluginArgs();
    const requestId = ++nextRequestId;

    const isLatestRequest = () => {
      const active = activeResolves.get(slotId);
      return Boolean(active && active.requestId === requestId);
    };

    return new Promise((resolve) => {
      const child = execFileFn(
        streamlinkBin,
        [...pluginArgs, '--json', '--', trimmedUrl],
        {
          timeout: resolveTimeoutMs,
          maxBuffer: STREAMLINK_MAX_BUFFER_BYTES,
          windowsHide: true
        },
        async (err, stdout, stderr) => {
          if (!isLatestRequest()) {
            resolve({ success: false, aborted: true, error: '已取消舊的解析請求' });
            return;
          }
          activeResolves.delete(slotId);

          if (err) {
            if (err.code === 'ENOENT') {
              resolve({
                success: false,
                streamlinkMissing: true,
                error: '找不到 Streamlink，請先安裝：https://streamlink.github.io/install.html'
              });
              return;
            }

            const outStr = `${stdout || ''}${stderr || ''}${err.message || ''}`;
            if (
              outStr.includes('No plugin can handle URL') ||
              outStr.includes('No playable streams found')
            ) {
              resolve({
                success: false,
                isNotStream: true,
                error: '非串流平台網址'
              });
              return;
            }

            // 若 --json 失敗，嘗試啟動本機伺服器直連
            const serverRes = await startSlotServer(slotId, trimmedUrl, safeQuality);
            if (serverRes.aborted) {
              resolve(serverRes);
              return;
            }
            if (serverRes.success) {
              resolve({
                success: true,
                metadata: { title: trimmedUrl, author: '' },
                streams: { [safeQuality]: { type: 'mpegts' } },
                qualities: [safeQuality],
                chosenQuality: safeQuality,
                playType: 'mpegts',
                directUrl: serverRes.serverUrl,
                needsServer: true
              });
            } else {
              resolve({
                success: false,
                streamlinkMissing: Boolean(serverRes.streamlinkMissing),
                error: err.message || stderr || '無法解析此串流來源或頻道未開台'
              });
            }
            return;
          }

          try {
            const parsed = JSON.parse(stdout);
            if (parsed.error) {
              resolve({ success: false, error: parsed.error });
              return;
            }
            if (!parsed.streams || Object.keys(parsed.streams).length === 0) {
              resolve({ success: false, error: '該頻道目前沒有可用串流（可能未開台）' });
              return;
            }

            const qualities = Object.keys(parsed.streams);
            const chosenQuality = parsed.streams[safeQuality] ? safeQuality : 'best';
            const targetStream = parsed.streams[chosenQuality] || parsed.streams[qualities[0]];

            // 判斷是否為 direct HLS URL，或需要 Streamlink 本機轉發的 hls-multi / segmented 串流
            if (targetStream && targetStream.url && targetStream.type !== 'hls-multi') {
              stopServer(slotId);
              resolve({
                success: true,
                metadata: parsed.metadata || {},
                plugin: parsed.plugin || '',
                streams: parsed.streams,
                qualities,
                chosenQuality,
                playType: 'hls',
                directUrl: targetStream.url,
                needsServer: false
              });
            } else {
              const serverRes = await startSlotServer(slotId, trimmedUrl, chosenQuality);
              if (!serverRes.success) {
                resolve({
                  success: false,
                  aborted: Boolean(serverRes.aborted),
                  streamlinkMissing: Boolean(serverRes.streamlinkMissing),
                  error: serverRes.error
                });
                return;
              }
              resolve({
                success: true,
                metadata: parsed.metadata || {},
                plugin: parsed.plugin || '',
                streams: parsed.streams,
                qualities,
                chosenQuality,
                playType: 'mpegts',
                directUrl: serverRes.serverUrl,
                needsServer: true
              });
            }
          } catch (parseError) {
            resolve({
              success: false,
              error: `Streamlink 回傳格式無效：${parseError.message}`
            });
          }
        }
      );

      activeResolves.set(slotId, { requestId, child });
    });
  }

  return {
    activeServers,
    activeResolves,
    resolveStream,
    startSlotServer,
    stopServer,
    stopSlot,
    stopAll
  };
}

module.exports = {
  createStreamService
};

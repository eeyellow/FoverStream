const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { PROJECT_ROOT } = require('../constants');

function getResourcesPath() {
  return typeof process.resourcesPath === 'string' ? process.resourcesPath : null;
}

function getStreamlinkPath({
  resourcesPath = getResourcesPath(),
  projectRoot = PROJECT_ROOT,
  env = process.env,
  existsSync = fs.existsSync
} = {}) {
  const possiblePaths = [
    // 1. 打包後的 extraResources 路徑
    ...(resourcesPath ? [path.join(resourcesPath, 'bin', 'streamlink', 'bin', 'streamlink.exe')] : []),
    // 2. 本地開發時的專案目錄
    path.join(projectRoot, 'resources', 'bin', 'streamlink', 'bin', 'streamlink.exe'),
    // 3. 使用者層級安裝路徑 (「僅為我安裝」預設位置)
    ...(env.LOCALAPPDATA
      ? [path.join(env.LOCALAPPDATA, 'Programs', 'Streamlink', 'bin', 'streamlink.exe')]
      : []),
    // 4. 系統標準安裝路徑
    'C:\\Program Files\\Streamlink\\bin\\streamlink.exe',
    'C:\\Program Files (x86)\\Streamlink\\bin\\streamlink.exe'
  ];

  for (const candidate of possiblePaths) {
    if (existsSync(candidate)) return candidate;
  }
  return 'streamlink';
}

function getStreamlinkPluginArgs({
  resourcesPath = getResourcesPath(),
  projectRoot = PROJECT_ROOT,
  existsSync = fs.existsSync
} = {}) {
  const possibleDirs = [
    ...(resourcesPath ? [path.join(resourcesPath, 'streamlink-plugins')] : []),
    path.join(projectRoot, 'streamlink-plugins')
  ];

  for (const dir of possibleDirs) {
    if (existsSync(dir)) return ['--plugin-dir', dir];
  }
  return [];
}

function getVlcPath({
  env = process.env,
  existsSync = fs.existsSync
} = {}) {
  const commonPaths = [
    'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    ...(env.LOCALAPPDATA
      ? [path.join(env.LOCALAPPDATA, 'Programs', 'VideoLAN', 'VLC', 'vlc.exe')]
      : [])
  ];

  for (const candidate of commonPaths) {
    if (existsSync(candidate)) return candidate;
  }
  return 'vlc';
}

function resolveExecutableOnPath(commandName, execFileFn = execFile) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFileFn(
      locator,
      [commandName],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        const firstMatch = stdout
          .toString()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
        resolve(firstMatch || null);
      }
    );
  });
}

async function resolveBinaryStatus(candidatePath, fallbackCommand, {
  existsSync = fs.existsSync,
  execFileFn = execFile
} = {}) {
  if (path.isAbsolute(candidatePath) && existsSync(candidatePath)) {
    return { installed: true, path: candidatePath };
  }
  const resolved = await resolveExecutableOnPath(fallbackCommand, execFileFn);
  if (resolved) {
    return { installed: true, path: resolved };
  }
  return { installed: false, path: '' };
}

async function checkEnvironment(deps = {}) {
  const slCandidate = getStreamlinkPath(deps);
  const vlcCandidate = getVlcPath(deps);

  const [streamlink, vlc] = await Promise.all([
    resolveBinaryStatus(slCandidate, 'streamlink', deps),
    resolveBinaryStatus(vlcCandidate, 'vlc', deps)
  ]);

  return { streamlink, vlc };
}

module.exports = {
  getStreamlinkPath,
  getStreamlinkPluginArgs,
  getVlcPath,
  resolveExecutableOnPath,
  resolveBinaryStatus,
  checkEnvironment
};

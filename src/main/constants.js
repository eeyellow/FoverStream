const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const CONFIG_FILENAME = 'foveastream_config.json';
const LEGACY_CONFIG_FILENAME = 'erostream_config.json';

const STREAMLINK_RESOLVE_TIMEOUT_MS = 20_000;
const STREAMLINK_SERVER_START_TIMEOUT_MS = 15_000;
const STREAMLINK_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const WINDOW_SHOW_FALLBACK_MS = 2_000;

const BYPASS_HEADER_DOMAINS = [
  'googlevideo.com',
  'youtube.com',
  'ytimg.com'
];

function isSafeHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeCliArg(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.trim().startsWith('-');
}

function sanitizeQuality(quality, fallback = 'best') {
  return isSafeCliArg(quality) ? quality.trim() : fallback;
}

module.exports = {
  PROJECT_ROOT,
  CONFIG_FILENAME,
  LEGACY_CONFIG_FILENAME,
  STREAMLINK_RESOLVE_TIMEOUT_MS,
  STREAMLINK_SERVER_START_TIMEOUT_MS,
  STREAMLINK_MAX_BUFFER_BYTES,
  WINDOW_SHOW_FALLBACK_MS,
  BYPASS_HEADER_DOMAINS,
  isSafeHttpUrl,
  isSafeCliArg,
  sanitizeQuality
};

export function formatUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function extractYouTubeId(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();

  try {
    const parsed = new URL(formatUrl(trimmed));
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }

      const pathMatch = parsed.pathname.match(/^\/(?:live|embed|shorts)\/([a-zA-Z0-9_-]{11})(?:\/|$)/);
      if (pathMatch) {
        return pathMatch[1];
      }
    }
  } catch {
    // 若 URL 解析失敗，退回正則匹配
  }

  const fallbackMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return fallbackMatch ? fallbackMatch[1] : null;
}

export function isDirectHlsUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.endsWith('.m3u8') || trimmed.includes('.m3u8?');
}

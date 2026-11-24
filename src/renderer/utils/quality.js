export function findBestMatchingQuality(streamsMap, targetType, preferredGridQuality = '720p') {
  if (!streamsMap || typeof streamsMap !== 'object' || Object.keys(streamsMap).length === 0) {
    return 'best';
  }

  const available = Object.keys(streamsMap).filter(
    (q) => q !== 'audio_only' && !q.toLowerCase().includes('audio')
  );
  if (available.length === 0) return 'best';

  if (targetType === 'high') {
    if (streamsMap.best) return 'best';
    const highPref = ['1080p60', '1080p', '720p60', '720p'];
    for (const q of highPref) {
      if (streamsMap[q]) return q;
    }
    return available[0];
  }

  if (targetType === 'low') {
    const lowPref = ['480p', '480p30', '480p60', '360p', '360p30', 'worst'];
    for (const q of lowPref) {
      if (streamsMap[q] && q !== 'audio_only') return q;
    }
    const candidate = available.find((q) => /480|360/i.test(q));
    if (candidate) return candidate;
    return available[available.length - 1] || '480p';
  }

  if (targetType === 'grid') {
    const pref = preferredGridQuality || '720p';
    if (streamsMap[pref]) return pref;
    if (pref === '720p') {
      const gPref = ['720p', '720p60', '480p', 'best'];
      for (const q of gPref) {
        if (streamsMap[q]) return q;
      }
    }
    if (pref === '480p') {
      const lowGridPref = ['480p', '480p30', '360p', '720p', 'best'];
      for (const q of lowGridPref) {
        if (streamsMap[q]) return q;
      }
    }
    return available[0];
  }

  return 'best';
}

export function mapYouTubeQuality(mode) {
  const qMap = {
    high: 'hd1080',
    low: 'small',
    grid: 'medium'
  };
  return qMap[mode] || 'hd720';
}

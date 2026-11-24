const { isSafeHttpUrl } = require('../constants');

async function getYouTubeMeta(url, fetchFn) {
  if (!isSafeHttpUrl(url)) {
    return { success: false };
  }

  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url.trim())}&format=json`;
    const res = await fetchFn(endpoint, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        title: data.title || '',
        author: data.author_name || ''
      };
    }
  } catch {
    // oEmbed 失敗時靜默退回預設標題
  }
  return { success: false };
}

module.exports = {
  getYouTubeMeta
};

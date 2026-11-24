const test = require('node:test');
const assert = require('node:assert/strict');

test('url utilities format URLs, extract YouTube IDs, and detect HLS streams', async () => {
  const { formatUrl, extractYouTubeId, isDirectHlsUrl } = await import('../src/renderer/utils/url.js');

  assert.equal(formatUrl(''), '');
  assert.equal(formatUrl('   '), '');
  assert.equal(formatUrl('twitch.tv/shroud'), 'https://twitch.tv/shroud');
  assert.equal(formatUrl('http://127.0.0.1:54321/'), 'http://127.0.0.1:54321/');

  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(
    extractYouTubeId('https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ&t=30'),
    'dQw4w9WgXcQ'
  );
  assert.equal(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=123'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://www.youtube.com/live/abcDEF_1234?feature=share'), 'abcDEF_1234');
  assert.equal(extractYouTubeId('https://www.youtube.com/shorts/xyz98765432'), 'xyz98765432');
  assert.equal(extractYouTubeId('https://www.twitch.tv/pokimane'), null);

  assert.equal(isDirectHlsUrl('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'), true);
  assert.equal(isDirectHlsUrl('https://cdn.example.com/live/master.m3u8?token=abc'), true);
  assert.equal(isDirectHlsUrl('https://www.twitch.tv/test'), false);
});

test('quality utilities select expected stream quality for high, low, and grid modes', async () => {
  const { findBestMatchingQuality, mapYouTubeQuality } = await import('../src/renderer/utils/quality.js');

  const sampleStreams = {
    audio_only: { url: 'a' },
    '360p': { url: '360' },
    '480p': { url: '480' },
    '720p60': { url: '720p60' },
    '1080p60': { url: '1080p60' },
    best: { url: 'best' }
  };

  assert.equal(findBestMatchingQuality(sampleStreams, 'high', '720p'), 'best');
  assert.equal(findBestMatchingQuality(sampleStreams, 'low', '720p'), '480p');
  assert.equal(findBestMatchingQuality(sampleStreams, 'grid', '720p'), '720p60');
  assert.equal(findBestMatchingQuality(sampleStreams, 'grid', '480p'), '480p');
  assert.equal(findBestMatchingQuality(sampleStreams, 'grid', 'best'), 'best');

  // Audio-only streams should never be picked as video quality
  assert.equal(findBestMatchingQuality({ audio_only: { url: 'a' } }, 'low', '720p'), 'best');

  assert.equal(mapYouTubeQuality('high'), 'hd1080');
  assert.equal(mapYouTubeQuality('low'), 'small');
  assert.equal(mapYouTubeQuality('grid'), 'medium');
});
